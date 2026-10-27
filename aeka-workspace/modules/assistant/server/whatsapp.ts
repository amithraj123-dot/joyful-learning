// WhatsApp channel (Meta Cloud API). The webhook verifies Meta's signature before reading anything,
// suppresses duplicates by provider message id, links numbers with a one-time code, honours STOP and
// queues other text from linked numbers for the same chat loop as the web. Outgoing messages go
// through as_outbox with recorded states; a timeout is "uncertain" and never retried automatically.
import { CloudError } from '../../../lib/cloud-store.ts';
import type { SystemContext } from '../../../core/server/env.ts';
import { getMember, type Member } from '../../../core/server/members.ts';
import { sameSecret } from '../../../core/server/secrets.ts';
import type { ChatMessage } from '../shared/types.ts';
import { ChatBusy, answer, withChatLease } from './chat.ts';
import { memberContext } from './context.ts';
import { HOUR, MINUTE } from './recurrence.ts';
import {
  REPLY_WINDOW,
  normaliseCode,
  readSettings,
  sha256,
  unlinkStatements,
  whatsappReady,
  type SettingsRow,
} from './settings.ts';

const MAX_BODY = 512 * 1024;
const MAX_TEXT = 4000;
const SEND_TIMEOUT = 15000;
const SEND_BATCH = 10;
const GIVE_UP_AFTER = 6 * HOUR; // queued rows that could not be sent by then are marked failed
const STUCK_SENDING = 5 * MINUTE;
const KEEP_EVENTS = 30 * 24 * HOUR;
const WRITE_TOOLS = new Set([
  'create_todo',
  'quick_add_todo',
  'complete_todo',
  'create_reminder',
  'snooze_reminder',
  'save_memory',
  'forget_memory',
  'draft_email_reply',
]);

type Defer = (p: Promise<unknown>) => void;
const enc = new TextEncoder();
const plain = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });

export const digitsOnly = (s: unknown) => (typeof s === 'string' ? s.replace(/\D/g, '') : '');
export const validPhone = (s: string) => /^\d{10,15}$/.test(s);

async function hmacHex(secret: string, bytes: Uint8Array<ArrayBuffer>) {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, bytes);
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- Outbox ----------

export const queueOutbox = (
  db: D1Database,
  member: string,
  phone: string,
  body: string,
  now: number,
  id: string = crypto.randomUUID(),
) =>
  db
    .prepare(
      "INSERT INTO as_outbox(id,member,phone,body,status,provider_id,error,created_at,updated_at) VALUES(?,?,?,?,'queued',NULL,'',?,?) ON CONFLICT(id) DO NOTHING",
    )
    .bind(id, member, phone, body.slice(0, MAX_TEXT), now, now);

// Delivery states never move backwards (a late "sent" after "read" is ignored).
const RANK_SQL =
  "CASE status WHEN 'queued' THEN 0 WHEN 'sending' THEN 1 WHEN 'accepted' THEN 2 WHEN 'uncertain' THEN 2 WHEN 'sent' THEN 3 WHEN 'delivered' THEN 4 WHEN 'read' THEN 5 ELSE 9 END";
const STATUS_RANK: Record<string, number> = { sent: 3, delivered: 4, read: 5, failed: 4 };
const rankOf = (column: string) =>
  `CASE ${column} WHEN 'sent' THEN 3 WHEN 'delivered' THEN 4 WHEN 'read' THEN 5 WHEN 'failed' THEN 6 ELSE 0 END`;

async function applyStatus(db: D1Database, providerId: string, status: string, error: string, now: number) {
  return db
    .prepare(
      `UPDATE as_outbox SET status = ?, error = ?, updated_at = ? WHERE provider_id = ? AND (${RANK_SQL}) < ?`,
    )
    .bind(status, error, now, providerId, STATUS_RANK[status])
    .run();
}

// A status for a message whose provider id is not stored yet (the callback beat the send response)
// is kept as an event and applied once the id is stored.
async function recordStatus(db: D1Database, providerId: string, status: string, error: string, now: number) {
  const known = await db
    .prepare('SELECT id FROM as_outbox WHERE provider_id = ? LIMIT 1')
    .bind(providerId)
    .first<{ id: string }>();
  if (known) return void (await applyStatus(db, providerId, status, error, now));
  await db
    .prepare(
      `INSERT INTO as_whatsapp_events(id,member,body,status,created_at) VALUES(?,NULL,?,'status',?)
       ON CONFLICT(id) DO UPDATE SET body = excluded.body WHERE (${rankOf('excluded.body')}) > (${rankOf('as_whatsapp_events.body')})`,
    )
    .bind('status:' + providerId, status, now)
    .run();
  await applyStatus(db, providerId, status, error, now);
}

async function applyPendingStatus(db: D1Database, providerId: string, now: number) {
  const e = await db
    .prepare("SELECT body FROM as_whatsapp_events WHERE id = ? AND status = 'status'")
    .bind('status:' + providerId)
    .first<{ body: string }>();
  if (e && STATUS_RANK[e.body] != null)
    await applyStatus(
      db,
      providerId,
      e.body,
      e.body === 'failed' ? 'WhatsApp could not deliver this message.' : '',
      now,
    );
}

const flatten = (s: string) =>
  s
    .split(/\n+/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('; ')
    .slice(0, 1000);

// Sends the member's queued messages (at most 10 per call): free text inside the 24-hour reply
// window, otherwise only the approved template.
export async function sendOutbox(sys: SystemContext, member: string, limit = SEND_BATCH) {
  const { db, env, now } = sys;
  if (!whatsappReady(env)) return 0;
  await db
    .prepare(
      "UPDATE as_outbox SET status = 'uncertain', error = 'Delivery could not be confirmed. It was not retried automatically.', updated_at = ? WHERE member = ? AND status = 'sending' AND updated_at < ?",
    )
    .bind(now, member, now - STUCK_SENDING)
    .run();
  const rows = (
    await db
      .prepare(
        "SELECT * FROM as_outbox WHERE member = ? AND status = 'queued' ORDER BY created_at, rowid LIMIT ?",
      )
      .bind(member, limit)
      .all<{ id: string; phone: string; body: string; created_at: number }>()
  ).results;
  if (!rows.length) return 0;
  const settings = await readSettings(db, member);
  const inWindow = settings.lastInboundAt != null && now - settings.lastInboundAt < REPLY_WINDOW;
  const url = `https://graph.facebook.com/${encodeURIComponent(env.WHATSAPP_GRAPH_VERSION || 'v23.0')}/${encodeURIComponent(
    env.WHATSAPP_PHONE_NUMBER_ID!,
  )}/messages`;
  const mark = (id: string, status: string, error: string, providerId: string | null = null) =>
    db
      .prepare(
        'UPDATE as_outbox SET status = ?, error = ?, provider_id = coalesce(?, provider_id), updated_at = ? WHERE id = ?',
      )
      .bind(status, error.slice(0, 300), providerId, now, id)
      .run();
  let sent = 0;
  for (const row of rows) {
    if (now - row.created_at > GIVE_UP_AFTER) {
      await mark(row.id, 'failed', 'Not sent: WhatsApp could not take it within 6 hours.');
      continue;
    }
    const claim = await db
      .prepare("UPDATE as_outbox SET status = 'sending', updated_at = ? WHERE id = ? AND status = 'queued'")
      .bind(now, row.id)
      .run();
    if (!claim.meta.changes) continue;
    let payload: Record<string, unknown>;
    if (inWindow) payload = { type: 'text', text: { body: row.body, preview_url: false } };
    else if (env.WHATSAPP_NOTIFICATION_TEMPLATE?.trim())
      payload = {
        type: 'template',
        template: {
          name: env.WHATSAPP_NOTIFICATION_TEMPLATE.trim(),
          language: { code: env.WHATSAPP_TEMPLATE_LANGUAGE?.trim() || 'en' },
          components: [{ type: 'body', parameters: [{ type: 'text', text: flatten(row.body) }] }],
        },
      };
    else {
      await mark(
        row.id,
        'failed',
        'Not sent: more than 24 hours since you last wrote on WhatsApp, and no approved template is set up.',
      );
      continue;
    }
    let res: Response;
    try {
      res = await sys.fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: row.phone,
          ...payload,
        }),
        signal: AbortSignal.timeout(SEND_TIMEOUT),
      });
    } catch {
      await mark(row.id, 'uncertain', 'Delivery could not be confirmed. It was not retried automatically.');
      continue;
    }
    let body: { messages?: { id?: unknown }[]; error?: { message?: unknown; code?: unknown } } = {};
    try {
      body = await res.json();
    } catch {
      body = {};
    }
    if (res.ok) {
      const providerId = body.messages?.[0]?.id;
      if (typeof providerId !== 'string' || !providerId) {
        await mark(
          row.id,
          'uncertain',
          'WhatsApp did not confirm the message. It was not retried automatically.',
        );
        continue;
      }
      await mark(row.id, 'accepted', '', providerId.slice(0, 200));
      await applyPendingStatus(db, providerId.slice(0, 200), now);
      sent++;
    } else if (res.status === 429 || res.status === 503) {
      // Not accepted: try again on a later tick (until the 6-hour cap), and stop for now.
      await mark(row.id, 'queued', 'WhatsApp was busy. It will be tried again shortly.');
      break;
    } else {
      const detail = typeof body.error?.message === 'string' ? `: ${body.error.message.slice(0, 160)}` : '';
      await mark(row.id, 'failed', `WhatsApp refused the message (HTTP ${res.status})${detail}.`);
    }
  }
  return sent;
}

// Notices the member chose (reminders, briefs, urgent mail, meetings) created since linking, queued once each.
export async function queueNotices(sys: SystemContext, row: SettingsRow) {
  const linkedAt = row.settings.linkedAt;
  if (!row.phone || linkedAt == null) return 0;
  const kinds = [
    row.settings.alerts.reminders ? 'reminder' : '',
    row.settings.alerts.brief ? 'brief' : '',
    row.settings.alerts.urgentMail ? 'mail.urgent' : '',
    row.settings.alerts.meetings ? 'meeting' : '',
  ].filter(Boolean);
  if (!kinds.length) return 0;
  const notices = (
    await sys.db
      .prepare(
        `SELECT id, title, body FROM org_notifications WHERE recipient = ? AND created_at >= ? AND kind IN (${kinds
          .map(() => '?')
          .join(',')}) AND (',' || delivered || ',') NOT LIKE '%,whatsapp,%' ORDER BY created_at LIMIT 20`,
      )
      .bind(row.member, linkedAt, ...kinds)
      .all<{ id: string; title: string; body: string }>()
  ).results;
  for (const n of notices)
    await sys.db.batch([
      queueOutbox(sys.db, row.member, row.phone, `${n.title}\n${n.body}`.trim(), sys.now, 'notice:' + n.id),
      sys.db
        .prepare(
          "UPDATE org_notifications SET delivered = CASE WHEN delivered = '' THEN 'whatsapp' ELSE delivered || ',whatsapp' END WHERE id = ? AND recipient = ? AND (',' || delivered || ',') NOT LIKE '%,whatsapp,%'",
        )
        .bind(n.id, row.member),
    ]);
  return notices.length;
}

// ---------- Inbound ----------

// The text sent back to WhatsApp for one answer: the reply, what was done, and any notice.
export function replyText(messages: ChatMessage[]) {
  const parts: string[] = [];
  for (const m of messages) {
    if (m.role === 'user') continue;
    if (m.content) parts.push(m.content);
    const done = m.tools
      .filter((n) => !n.ok || WRITE_TOOLS.has(n.name))
      .map((n) => (n.ok ? 'Done: ' : '') + n.summary);
    if (done.length) parts.push(done.join('\n'));
  }
  return parts.join('\n\n').slice(0, MAX_TEXT) || 'Aeka could not prepare an answer. Please try again.';
}

async function activeMember(db: D1Database, email: string | null) {
  if (!email) return null;
  const m = await getMember(db, email);
  return m?.active ? m : null;
}

// Answers the member's oldest queued WhatsApp message. Returns false when there is nothing to do or
// another answer for the member is in progress (the message then waits for the next tick).
export async function processInbound(sys: SystemContext, member: Member): Promise<boolean> {
  const { db, now } = sys;
  const ctx = memberContext(sys, member);
  const phone = (await readSettings(db, member.email)).phone;
  try {
    return await withChatLease(ctx, async () => {
      // Under the lease nobody else is answering for this member, so a message still marked
      // "processing" was interrupted. It is not answered again (its actions may have run).
      const stale = (
        await db
          .prepare("SELECT id FROM as_whatsapp_events WHERE member = ? AND status = 'processing' LIMIT 5")
          .bind(member.email)
          .all<{ id: string }>()
      ).results;
      for (const s of stale) {
        await db
          .prepare(
            "UPDATE as_whatsapp_events SET status = 'failed', body = '' WHERE id = ? AND status = 'processing'",
          )
          .bind(s.id)
          .run();
        if (phone)
          await queueOutbox(
            db,
            member.email,
            phone,
            'Aeka could not finish answering one of your messages. Send it again if it still needs an answer, and check your to-dos and reminders first.',
            now,
          ).run();
      }
      const row = await db
        .prepare(
          "SELECT id, body FROM as_whatsapp_events WHERE member = ? AND status = 'queued' ORDER BY created_at, rowid LIMIT 1",
        )
        .bind(member.email)
        .first<{ id: string; body: string }>();
      if (!row) return false;
      const claimed = await db
        .prepare("UPDATE as_whatsapp_events SET status = 'processing' WHERE id = ? AND status = 'queued'")
        .bind(row.id)
        .run();
      if (!claimed.meta.changes) return false;
      if (!phone) {
        // Unlinked after the message arrived: nothing is answered.
        await db
          .prepare("UPDATE as_whatsapp_events SET status = 'ignored', body = '' WHERE id = ?")
          .bind(row.id)
          .run();
        return true;
      }
      let reply: string;
      let status = 'done';
      try {
        const r = await answer(ctx, null, row.body.slice(0, MAX_TEXT), 'whatsapp');
        reply = replyText(r.messages);
      } catch (e) {
        status = 'failed';
        reply =
          e instanceof CloudError
            ? `Aeka could not answer: ${e.message}`
            : 'Aeka could not answer this message because of an internal error. Please try again later.';
        if (!(e instanceof CloudError))
          console.error('WhatsApp message could not be answered', e instanceof Error ? e.name : '');
      }
      await db.batch([
        queueOutbox(db, member.email, phone, reply, now),
        db.prepare("UPDATE as_whatsapp_events SET status = ?, body = '' WHERE id = ?").bind(status, row.id),
      ]);
      return true;
    });
  } catch (e) {
    if (e instanceof ChatBusy) return false;
    throw e;
  }
}

const STOP = /^(stop|unsubscribe)[.!]?$/i;
const LINK = /^link\s+([a-z0-9][a-z0-9 -]{3,24})$/i;

// One inbound message, already known to be new. Returns the member whose work should run next.
async function handleMessage(
  sys: SystemContext,
  m: Record<string, unknown>,
  id: string,
): Promise<string | null> {
  const { db, now } = sys;
  const phone = digitsOnly(m.from);
  const ts = Number(m.timestamp) * 1000;
  if (!validPhone(phone) || !Number.isFinite(ts) || ts > now + 5 * MINUTE || ts < now - REPLY_WINDOW)
    return null;
  const linked = await db
    .prepare('SELECT member FROM as_settings WHERE whatsapp_phone = ?')
    .bind(phone)
    .first<{ member: string }>();
  const member = await activeMember(db, linked?.member ?? null);
  const at = Math.min(ts, now);
  if (member)
    await db
      .prepare(
        'UPDATE as_settings SET last_inbound_at = max(coalesce(last_inbound_at, 0), ?) WHERE member = ?',
      )
      .bind(at, member.email)
      .run();
  const text =
    m.type === 'text' && typeof (m.text as { body?: unknown })?.body === 'string'
      ? String((m.text as { body: string }).body).trim()
      : '';
  if (!text) return null; // only text messages are handled

  const link = text.match(LINK);
  if (link) {
    const code = await sha256(normaliseCode(link[1]));
    const target = await db
      .prepare('SELECT member FROM as_settings WHERE link_code = ? AND link_expires > ?')
      .bind(code, now)
      .first<{ member: string }>();
    const who = await activeMember(db, target?.member ?? null);
    if (!who) {
      if (!member) return null; // unknown numbers get no reply
      await queueOutbox(
        db,
        member.email,
        phone,
        'That link code is not valid or has expired. Create a new one in Assistant settings.',
        now,
      ).run();
      await db
        .prepare("UPDATE as_whatsapp_events SET member = ?, status = 'done' WHERE id = ?")
        .bind(member.email, id)
        .run();
      return member.email;
    }
    const previous = member && member.email !== who.email ? member.email : null;
    await db.batch([
      ...(previous
        ? unlinkStatements(db, previous, now, 'Not sent: the number was linked to another account.')
        : []),
      db
        .prepare(
          "UPDATE as_outbox SET status = 'failed', error = 'Not sent: a new number was linked.', updated_at = ? WHERE member = ? AND status = 'queued' AND phone != ?",
        )
        .bind(now, who.email, phone),
      db
        .prepare(
          "UPDATE as_settings SET whatsapp_phone = ?, link_code = NULL, link_expires = NULL, last_inbound_at = ?, settings = json_set(settings, '$.linkedAt', ?), updated_at = ? WHERE member = ?",
        )
        .bind(phone, at, now, now, who.email),
      queueOutbox(
        db,
        who.email,
        phone,
        `This number is now linked to Aeka Workspace for ${who.name}. The reminders and alerts you choose in Assistant settings will arrive here, and you can message Aeka here. Reply STOP at any time to stop them.`,
        now,
      ),
      db
        .prepare("UPDATE as_whatsapp_events SET member = ?, status = 'done' WHERE id = ?")
        .bind(who.email, id),
    ]);
    return who.email;
  }
  if (!member) return null; // unknown numbers are ignored without a reply
  if (STOP.test(text)) {
    await db.batch([
      ...unlinkStatements(db, member.email, now, 'Not sent: WhatsApp alerts were stopped.'),
      queueOutbox(
        db,
        member.email,
        phone,
        'Aeka alerts to this number have stopped. To start them again, link your number from Assistant settings.',
        now,
      ),
      db
        .prepare("UPDATE as_whatsapp_events SET member = ?, status = 'done' WHERE id = ?")
        .bind(member.email, id),
    ]);
    return member.email;
  }
  await db
    .prepare("UPDATE as_whatsapp_events SET member = ?, body = ?, status = 'queued' WHERE id = ?")
    .bind(member.email, text.slice(0, MAX_TEXT), id)
    .run();
  return member.email;
}

// Runs the follow-up work for members touched by a webhook: answers, then sends what is queued.
async function followUp(sys: SystemContext, members: string[]) {
  for (const email of members) {
    try {
      const member = await activeMember(sys.db, email);
      if (member) await processInbound(sys, member);
      await sendOutbox(sys, email);
    } catch (e) {
      console.error('WhatsApp follow-up failed', e instanceof Error ? e.name : '');
    }
  }
}

// GET /api/whatsapp (Meta verification) and POST /api/whatsapp (events). `defer` runs work after the
// response (waitUntil); without it, queued work waits for the next tick.
export async function whatsappWebhook(request: Request, sys: SystemContext, options: { defer?: Defer } = {}) {
  const env = sys.env;
  if (env.WHATSAPP_ENABLED !== 'true') return plain('Not found.', 404);
  if (request.method === 'GET') {
    const q = new URL(request.url).searchParams;
    const token = env.WHATSAPP_VERIFY_TOKEN?.trim() || '';
    if (q.get('hub.mode') !== 'subscribe' || !token || !sameSecret(q.get('hub.verify_token') || '', token))
      return plain('Verification failed.', 403);
    return plain((q.get('hub.challenge') || '').slice(0, 200));
  }
  if (request.method !== 'POST') return plain('Method not allowed.', 405);
  const secret = env.WHATSAPP_APP_SECRET?.trim() || '';
  if (!secret || !whatsappReady(env)) return plain('WhatsApp is not configured.', 503);
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > MAX_BODY) return plain('Request is too large.', 413);
  const raw = new Uint8Array(await request.arrayBuffer());
  if (raw.length > MAX_BODY) return plain('Request is too large.', 413);
  const given = request.headers.get('X-Hub-Signature-256') || '';
  if (!sameSecret(given, 'sha256=' + (await hmacHex(secret, raw)))) return plain('Invalid signature.', 401);

  let payload: { object?: unknown; entry?: unknown };
  try {
    payload = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return plain('Invalid JSON.', 400);
  }
  if (payload?.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry))
    return json({ ok: true });
  const touched = new Set<string>();
  const { db, now } = sys;
  for (const entry of payload.entry.slice(0, 50) as { changes?: unknown }[]) {
    for (const change of (Array.isArray(entry?.changes) ? entry.changes : []).slice(0, 50)) {
      const value = (change as { value?: Record<string, unknown> })?.value;
      const meta = value?.metadata as { phone_number_id?: unknown } | undefined;
      if (!value || String(meta?.phone_number_id ?? '') !== env.WHATSAPP_PHONE_NUMBER_ID) continue;
      for (const s of (Array.isArray(value.statuses) ? value.statuses : []).slice(0, 100) as Record<
        string,
        unknown
      >[]) {
        if (typeof s?.id !== 'string' || s.id.length > 200 || typeof s.status !== 'string') continue;
        if (STATUS_RANK[s.status] == null) continue;
        const err = Array.isArray(s.errors) ? (s.errors[0] as { title?: unknown; code?: unknown }) : null;
        const error =
          s.status === 'failed'
            ? `WhatsApp could not deliver this message${typeof err?.title === 'string' ? `: ${err.title.slice(0, 160)}` : ''}.`
            : '';
        await recordStatus(db, s.id, s.status, error, now);
      }
      for (const m of (Array.isArray(value.messages) ? value.messages : []).slice(0, 100) as Record<
        string,
        unknown
      >[]) {
        if (typeof m?.id !== 'string' || !m.id || m.id.length > 200 || m.id.startsWith('status:')) continue;
        // Duplicate suppression: the provider id is recorded once; a repeat delivery does nothing.
        const fresh = await db
          .prepare(
            "INSERT INTO as_whatsapp_events(id,member,body,status,created_at) VALUES(?,NULL,'','ignored',?) ON CONFLICT(id) DO NOTHING",
          )
          .bind(m.id, now)
          .run();
        if (!fresh.meta.changes) continue;
        const member = await handleMessage(sys, m, m.id);
        if (member) touched.add(member);
      }
    }
  }
  if (touched.size && options.defer) {
    try {
      options.defer(followUp(sys, [...touched]));
    } catch {
      // left queued for the next tick
    }
  }
  return json({ ok: true });
}

// Removes old WhatsApp event records (kept 30 days for duplicate suppression).
export async function pruneEvents(db: D1Database, now: number) {
  await db
    .prepare(
      "DELETE FROM as_whatsapp_events WHERE id IN (SELECT id FROM as_whatsapp_events WHERE created_at < ? AND status NOT IN ('queued','processing') LIMIT 200)",
    )
    .bind(now - KEEP_EVENTS)
    .run();
}
