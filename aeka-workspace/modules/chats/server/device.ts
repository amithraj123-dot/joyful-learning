// The phone's API: POST /api/device (see docs/ANDROID-PROTOCOL.md). `pair` exchanges a one-time code
// for a device token; `sync` stores the phone's messages and returns the member's notices not yet shown
// on the phone. The token is stored only as a hash; a revoked device or an inactive member gets 401.
import { CloudError, clientError, declaredTooLarge } from '../../../lib/cloud-store.ts';
import { getMember, type Member } from '../../../core/server/members.ts';
import type { SystemContext } from '../../../core/server/env.ts';
import { APPS, type AppId, type ChatSettings } from '../shared/types.ts';
import { isApp, loadSettings, MINUTE, sha256, type Row, type Sys } from './store.ts';

export const PAIR_CODE_MS = 10 * MINUTE;
const MAX_BODY = 1_000_000;
export const MAX_EVENTS = 200;
const MAX_DEVICES = 5;
const SYNC_SECONDS = 900;
// A burst of messages is triaged once: a one-to-one chat waits 90 seconds after its newest message, a
// group 10 minutes (VIP groups 90 seconds).
export const DEBOUNCE_MS = 90_000;
export const GROUP_DEBOUNCE_MS = 10 * MINUTE;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const TOKEN_PREFIX = 'aekad_';
const headers = { 'Cache-Control': 'private, no-store' };
const reply = (value: unknown, status = 200) =>
  Response.json(status < 400 ? { value } : { error: value }, { status, headers });

// ---------- Pairing codes ----------

const normaliseCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');

export async function newPairingCode(db: D1Database, member: string, now: number) {
  await db.prepare('DELETE FROM ch_pairings WHERE expires_at <= ? OR used_at IS NOT NULL').bind(now).run();
  const open = await db
    .prepare('SELECT count(*) AS n FROM ch_pairings WHERE member = ?')
    .bind(member)
    .first<{ n: number }>();
  if ((open?.n ?? 0) >= 5)
    throw new CloudError('Use one of the codes already shown, or wait 10 minutes.', 429);
  const picks: string[] = [];
  while (picks.length < 8) {
    const [b] = crypto.getRandomValues(new Uint8Array(1));
    if (b < 248) picks.push(CODE_ALPHABET[b % CODE_ALPHABET.length]); // 248 = 8 x 31, no bias
  }
  const code = `${picks.slice(0, 4).join('')}-${picks.slice(4).join('')}`;
  await db
    .prepare('INSERT INTO ch_pairings(code_hash,member,created_at,expires_at) VALUES(?,?,?,?)')
    .bind(await sha256(normaliseCode(code)), member, now, now + PAIR_CODE_MS)
    .run();
  return { code, expiresAt: now + PAIR_CODE_MS };
}

const randomSecret = () =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const str = (v: unknown, max: number) =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';

async function pair(sys: Sys, body: Row) {
  const code = typeof body.code === 'string' ? normaliseCode(body.code) : '';
  if (code.length !== 8) throw new CloudError('Enter the 8-character code shown in the workspace.', 400);
  const hash = await sha256(code);
  const row = await sys.db
    .prepare('SELECT member FROM ch_pairings WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?')
    .bind(hash, sys.now)
    .first<{ member: string }>();
  if (!row)
    throw new CloudError('This code is not valid or has expired. Ask the workspace for a new one.', 401);
  const used = await sys.db
    .prepare('UPDATE ch_pairings SET used_at = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?')
    .bind(sys.now, hash, sys.now)
    .run();
  if (!used.meta.changes) throw new CloudError('This code has already been used. Ask for a new one.', 401);
  const member = await getMember(sys.db, row.member);
  if (!member?.active) throw new CloudError('Your account is not an active member of this workspace.', 403);
  const count = await sys.db
    .prepare('SELECT count(*) AS n FROM ch_devices WHERE member = ? AND revoked_at IS NULL')
    .bind(member.email)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_DEVICES)
    throw new CloudError(`At most ${MAX_DEVICES} phones can be connected. Disconnect one first.`, 409);
  const id = crypto.randomUUID().replace(/-/g, '');
  const secret = randomSecret();
  const android = Number(body.android);
  await sys.db
    .prepare(
      'INSERT INTO ch_devices(id,member,name,model,app_version,android,secret_hash,access_json,created_at,last_seen_at,revoked_at) VALUES(?,?,?,?,?,?,?,?,?,?,NULL)',
    )
    .bind(
      id,
      member.email,
      str(body.name, 60) || 'Android phone',
      str(body.model, 80),
      str(body.appVersion, 20),
      Number.isInteger(android) && android > 0 && android < 100 ? android : 0,
      await sha256(secret),
      '',
      sys.now,
      sys.now,
    )
    .run();
  return {
    token: `${TOKEN_PREFIX}${id}.${secret}`,
    deviceId: id,
    member: { name: member.name, email: member.email },
  };
}

// The device and its member for a bearer token, or a 401.
export async function deviceFor(
  sys: Sys,
  authorization: string | null,
): Promise<{ device: Row; member: Member }> {
  const m = /^Bearer (aekad_([a-f0-9]{32})\.([A-Za-z0-9_-]{20,100}))$/.exec(authorization ?? '');
  const denied = new CloudError('This phone is not connected. Connect it again from the workspace.', 401);
  if (!m) throw denied;
  const device = await sys.db
    .prepare('SELECT * FROM ch_devices WHERE id = ? AND revoked_at IS NULL')
    .bind(m[2])
    .first<Row>();
  if (!device) throw denied;
  const hash = await sha256(m[3]);
  const stored = device.secret_hash as string;
  let diff = hash.length ^ stored.length;
  for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ (stored.charCodeAt(i) || 0);
  if (diff) throw denied;
  const member = await getMember(sys.db, device.member as string);
  if (!member?.active) throw denied;
  return { device, member };
}

// ---------- Sync ----------

export interface MessageEvent {
  type: 'message';
  id: string;
  app: AppId;
  chat: string;
  title: string;
  group: boolean;
  sender: string;
  fromMe: boolean;
  text: string;
  at: number;
  address: string;
}
export interface ClearedEvent {
  type: 'cleared';
  app: AppId;
  chat: string;
  at: number;
  reason: 'opened' | 'dismissed' | 'read' | 'other';
}

const HASH = /^[a-f0-9]{16,64}$/;
const validTime = (v: unknown, now: number) =>
  typeof v === 'number' && Number.isFinite(v) && v > now - 60 * 86400000 && v < now + 10 * MINUTE
    ? Math.round(v)
    : null;

// Events that fail validation are dropped one by one, never the whole batch: one odd notification must
// not keep the rest of the phone's queue from arriving.
export function parseEvents(raw: unknown, now: number) {
  const messages: MessageEvent[] = [];
  const cleared: ClearedEvent[] = [];
  let dropped = 0;
  if (!Array.isArray(raw)) return { messages, cleared, dropped };
  if (raw.length > MAX_EVENTS) throw new CloudError(`Send at most ${MAX_EVENTS} events at a time.`, 413);
  for (const e of raw as Row[]) {
    if (!e || typeof e !== 'object' || !isApp(e.app)) {
      dropped++;
      continue;
    }
    const chat = typeof e.chat === 'string' ? e.chat.trim().slice(0, 200) : '';
    const at = validTime(e.at, now);
    if (!chat || at == null) {
      dropped++;
      continue;
    }
    if (e.type === 'message') {
      const text = typeof e.text === 'string' ? e.text.trim().slice(0, 4000) : '';
      const id = typeof e.id === 'string' ? e.id.toLowerCase() : '';
      if (!text || !HASH.test(id)) {
        dropped++;
        continue;
      }
      const address = typeof e.address === 'string' ? e.address.replace(/\D/g, '').slice(0, 15) : '';
      messages.push({
        type: 'message',
        id,
        app: e.app,
        chat,
        title: str(e.title, 200) || str(e.sender, 120) || 'Unknown',
        group: e.group === true,
        sender: str(e.sender, 120),
        fromMe: e.fromMe === true,
        text,
        at,
        address: address.length >= 8 ? address : '',
      });
    } else if (e.type === 'cleared') {
      const reason = (['opened', 'dismissed', 'read'] as const).find((r) => r === e.reason) ?? 'other';
      cleared.push({ type: 'cleared', app: e.app, chat, at, reason });
    } else dropped++;
  }
  return { messages, cleared, dropped };
}

export interface IngestResult {
  accepted: number;
  inbound: number; // new messages from others, which need triage
}

// Stores new messages (each once), updates each chat's reply state and marks chats for triage.
export async function ingest(
  sys: Sys,
  member: string,
  settings: ChatSettings,
  messages: MessageEvent[],
  cleared: ClearedEvent[],
): Promise<IngestResult> {
  const db = sys.db;
  const result: IngestResult = { accepted: 0, inbound: 0 };
  const wanted = messages.filter((m) => settings.apps[m.app]);
  // Messages already stored (WhatsApp repeats unread history in every notification).
  const known = new Set<string>();
  const hashes = [...new Set(wanted.map((m) => m.id))];
  for (let i = 0; i < hashes.length; i += 90) {
    const part = hashes.slice(i, i + 90);
    const r = await db
      .prepare(
        `SELECT msg_hash FROM ch_messages WHERE member = ? AND msg_hash IN (${part.map(() => '?').join(',')})`,
      )
      .bind(member, ...part)
      .all<{ msg_hash: string }>();
    for (const x of r.results) known.add(x.msg_hash);
  }
  const byChat = new Map<string, MessageEvent[]>();
  for (const m of wanted) {
    if (known.has(m.id)) continue;
    known.add(m.id);
    byChat.set(m.chat, [...(byChat.get(m.chat) ?? []), m]);
  }
  for (const [chat, list] of byChat) {
    list.sort((a, b) => a.at - b.at);
    const latest = list[list.length - 1];
    const thread = await ensureThread(db, member, latest, sys.now);
    const statements: D1PreparedStatement[] = list.map((m) =>
      db
        .prepare(
          'INSERT OR IGNORE INTO ch_messages(id,member,thread_id,msg_hash,sender,from_me,text,at,received_at) VALUES(?,?,?,?,?,?,?,?,?)',
        )
        .bind(
          crypto.randomUUID(),
          member,
          thread.id,
          m.id,
          m.sender || (m.fromMe ? 'Me' : thread.title),
          m.fromMe ? 1 : 0,
          m.text,
          m.at,
          sys.now,
        ),
    );
    const next = replyState(thread, list, sys.now);
    statements.push(
      db
        .prepare(
          `UPDATE ch_threads SET title = ?, is_group = ?, address = CASE WHEN ? != '' THEN ? ELSE address END,
             last_in_at = ?, last_in_sender = ?, last_in_text = ?, last_out_at = ?, waiting_since = ?, unanswered = ?,
             nudge_level = ?, triage_status = ?, next_attempt_at = ?, attempts = ?, updated_at = ?, revision = revision + 1
           WHERE member = ? AND id = ?`,
        )
        .bind(
          latest.title,
          latest.group ? 1 : 0,
          latest.address,
          latest.address,
          next.lastInAt,
          next.lastInSender,
          next.lastInText,
          next.lastOutAt,
          next.waitingSince,
          next.unanswered,
          next.nudgeLevel,
          next.triageStatus,
          next.nextAttemptAt,
          next.attempts,
          sys.now,
          member,
          thread.id,
        ),
    );
    await db.batch(statements);
    result.accepted += list.length;
    result.inbound += list.filter((m) => !m.fromMe).length;
  }
  for (const c of cleared) {
    if (!settings.apps[c.app] || c.reason === 'other') continue;
    await db
      .prepare(
        'UPDATE ch_threads SET seen_at = max(coalesce(seen_at, 0), ?), updated_at = ? WHERE member = ? AND chat_key = ?',
      )
      .bind(c.at, sys.now, member, c.chat)
      .run();
  }
  return result;
}

async function ensureThread(db: D1Database, member: string, m: MessageEvent, now: number) {
  await db
    .prepare(
      `INSERT OR IGNORE INTO ch_threads(id,member,app,chat_key,title,is_group,address,created_at,updated_at,revision)
       VALUES(?,?,?,?,?,?,?,?,?,1)`,
    )
    .bind(
      crypto.randomUUID().replace(/-/g, ''),
      member,
      m.app,
      m.chat,
      m.title,
      m.group ? 1 : 0,
      m.address,
      now,
      now,
    )
    .run();
  const r = await db
    .prepare('SELECT * FROM ch_threads WHERE member = ? AND chat_key = ?')
    .bind(member, m.chat)
    .first<Row>();
  if (!r) throw new CloudError('The chat could not be stored. Try again.', 503);
  return {
    id: r.id as string,
    title: r.title as string,
    group: !!r.is_group,
    muted: !!r.muted,
    vip: !!r.vip,
    lastInAt: (r.last_in_at as number | null) ?? null,
    lastInSender: r.last_in_sender as string,
    lastInText: r.last_in_text as string,
    lastOutAt: (r.last_out_at as number | null) ?? null,
    waitingSince: (r.waiting_since as number | null) ?? null,
    unanswered: Number(r.unanswered ?? 0),
    nudgeLevel: Number(r.nudge_level ?? 0),
    triageStatus: r.triage_status as string,
    nextAttemptAt: Number(r.next_attempt_at ?? 0),
    attempts: Number(r.attempts ?? 0),
  };
}

type ThreadState = Awaited<ReturnType<typeof ensureThread>>;

// The chat's reply state after these new messages (oldest first). Exported for tests.
export function replyState(t: ThreadState, list: MessageEvent[], now: number) {
  let { lastInAt, lastInSender, lastInText, lastOutAt, waitingSince, unanswered, nudgeLevel } = t;
  const before = waitingSince;
  let inbound = 0;
  for (const m of list) {
    if (m.fromMe) {
      if (lastOutAt == null || m.at > lastOutAt) lastOutAt = m.at;
      continue;
    }
    inbound++;
    if (lastInAt == null || m.at >= lastInAt) {
      lastInAt = m.at;
      lastInSender = m.sender;
      lastInText = m.text.slice(0, 200);
    }
  }
  // Waiting: from the first message after my last reply, counting those messages.
  const answered = lastOutAt != null && (lastInAt == null || lastOutAt >= lastInAt);
  if (answered) {
    waitingSince = null;
    unanswered = 0;
    nudgeLevel = 0;
  } else {
    const after = list.filter((m) => !m.fromMe && (lastOutAt == null || m.at > lastOutAt));
    const stillValid = waitingSince != null && (lastOutAt == null || waitingSince > lastOutAt);
    const first = after.length ? after[0].at : null;
    waitingSince = stillValid ? Math.min(waitingSince!, first ?? Infinity) : (first ?? lastInAt);
    unanswered = (stillValid ? unanswered : 0) + after.length;
    if (waitingSince !== before) nudgeLevel = 0;
  }
  let { triageStatus, nextAttemptAt, attempts } = t;
  if (inbound && !t.muted) {
    triageStatus = 'pending';
    nextAttemptAt = now + (t.group && !t.vip ? GROUP_DEBOUNCE_MS : DEBOUNCE_MS);
    attempts = 0;
  }
  return {
    lastInAt,
    lastInSender,
    lastInText,
    lastOutAt,
    waitingSince,
    unanswered,
    nudgeLevel,
    triageStatus,
    nextAttemptAt,
    attempts,
  };
}

// The member's notices not yet shown on a phone (created since this phone was connected, at most a day
// old, unread), each returned once.
export async function phoneNotices(sys: Sys, member: string, since: number) {
  const r = await sys.db
    .prepare(
      `SELECT id, title, body, link FROM org_notifications WHERE recipient = ? AND created_at >= ? AND read_at IS NULL
       AND (',' || delivered || ',') NOT LIKE '%,phone,%' ORDER BY created_at LIMIT 20`,
    )
    .bind(member, Math.max(since, sys.now - 86400000))
    .all<{ id: string; title: string; body: string; link: string }>();
  for (const n of r.results)
    await sys.db
      .prepare(
        "UPDATE org_notifications SET delivered = CASE WHEN delivered = '' THEN 'phone' ELSE delivered || ',phone' END WHERE id = ? AND recipient = ?",
      )
      .bind(n.id, member)
      .run();
  return r.results;
}

async function sync(sys: Sys, device: Row, member: Member, body: Row) {
  const settings = await loadSettings(sys.db, member.email);
  const { messages, cleared, dropped } = parseEvents(body.events, sys.now);
  const result = await ingest(sys, member.email, settings, messages, cleared);
  // Which chats can be answered from the phone right now.
  const live = Array.isArray(body.live)
    ? [
        ...new Set(
          (body.live as unknown[])
            .filter((c): c is string => typeof c === 'string')
            .map((c) => c.slice(0, 200)),
        ),
      ].slice(0, 90)
    : [];
  await sys.db
    .prepare(
      `UPDATE ch_threads SET live = CASE WHEN chat_key IN (${live.map(() => '?').join(',') || "''"}) THEN 1 ELSE 0 END
       WHERE member = ? AND (live = 1 OR chat_key IN (${live.map(() => '?').join(',') || "''"}))`,
    )
    .bind(...live, member.email, ...live)
    .run();
  // Permissions as the phone reports them; a sync without them keeps the last known ones.
  const access = body.access && typeof body.access === 'object' ? (body.access as Row) : null;
  const android = Number(body.android);
  await sys.db
    .prepare(
      'UPDATE ch_devices SET last_seen_at = ?, app_version = ?, android = ?, access_json = coalesce(?, access_json) WHERE id = ? AND revoked_at IS NULL',
    )
    .bind(
      sys.now,
      str(body.appVersion, 20) || (device.app_version as string),
      Number.isInteger(android) && android > 0 && android < 100 ? android : Number(device.android ?? 0),
      access
        ? JSON.stringify({
            notifications: access.notifications === true,
            postNotifications: access.postNotifications === true,
            batteryUnrestricted: access.batteryUnrestricted === true,
          })
        : null,
      device.id,
    )
    .run();
  const notices = await phoneNotices(sys, member.email, device.created_at as number);
  return {
    result,
    value: {
      accepted: result.accepted,
      dropped,
      apps: Object.fromEntries(APPS.map((a) => [a, settings.apps[a]])),
      notices,
      syncSeconds: SYNC_SECONDS,
    },
  };
}

// The route handler. `afterSync` runs triage for the member once new messages arrived (in the
// background when the runtime allows it).
export async function deviceRequest(
  request: Request,
  sys: SystemContext | null,
  afterSync?: (member: Member) => Promise<unknown>,
  defer?: (p: Promise<unknown>) => void,
) {
  if (request.method !== 'POST') return reply('Use POST.', 405);
  if (!sys) return reply('Workspace storage is not available yet.', 503);
  if (declaredTooLarge(request, MAX_BODY)) return reply('Request is too large.', 413);
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) throw new CloudError('Request is too large.', 413);
    let body: Row;
    try {
      body = JSON.parse(text) as Row;
    } catch {
      throw new CloudError('Invalid request.');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new CloudError('Invalid request.');
    if (body.op === 'pair') return reply(await pair(sys, body));
    if (body.op === 'sync') {
      const { device, member } = await deviceFor(sys, request.headers.get('Authorization'));
      const { result, value } = await sync(sys, device, member, body);
      if (result.inbound && afterSync) {
        const work = afterSync(member).catch((e) => console.error('Chats: triage after sync failed', e));
        if (defer) defer(work);
        else await work;
      }
      return reply(value);
    }
    throw new CloudError('Unknown request.', 404);
  } catch (e) {
    const { message, status } = clientError(e, 'The phone request failed.');
    return reply(message, status);
  }
}
