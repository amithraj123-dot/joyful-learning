// Delta sync of Inbox and Sent Items. Each page is written in one batch together with the triage rows
// for new inbox messages and the resumable checkpoint (nextLink or deltaLink), so a failure part way
// loses nothing and repeats nothing. Deletions (@removed) mark the message removed; they never become
// failures. Sent items are kept only to know replies and thread context; they are never triaged.
import { GraphError, GRAPH, type GraphSession } from './graph.ts';
import { DAY, messageKey } from './store.ts';

const FIRST_RUN_DAYS = 14;
const PAGE_SIZE = 50;
const MAX_PAGES = 8; // at most 400 messages per folder per call
export const SYNC_BUDGET_MS = 20000;
export const BODY_CAP = 20000;
const SELECT = [
  'id',
  'subject',
  'from',
  'toRecipients',
  'ccRecipients',
  'receivedDateTime',
  'sentDateTime',
  'bodyPreview',
  'body',
  'hasAttachments',
  'importance',
  'isRead',
  'conversationId',
  'internetMessageId',
  'webLink',
];

type Folder = 'inbox' | 'sent';
const FOLDERS: { folder: Folder; graph: string; column: 'inbox_delta' | 'sent_delta' }[] = [
  { folder: 'inbox', graph: 'inbox', column: 'inbox_delta' },
  { folder: 'sent', graph: 'sentitems', column: 'sent_delta' },
];

interface GraphAddress {
  emailAddress?: { name?: string; address?: string };
}
interface GraphMessage {
  id?: string;
  '@removed'?: unknown;
  subject?: string;
  from?: GraphAddress;
  toRecipients?: GraphAddress[];
  ccRecipients?: GraphAddress[];
  receivedDateTime?: string;
  sentDateTime?: string;
  bodyPreview?: string;
  body?: { content?: string };
  hasAttachments?: boolean;
  importance?: string;
  isRead?: boolean;
  conversationId?: string;
  internetMessageId?: string;
  webLink?: string;
  internetMessageHeaders?: { name?: string; value?: string }[];
}

const addr = (a: GraphAddress | undefined) => ({
  name: (a?.emailAddress?.name || '').slice(0, 200),
  address: (a?.emailAddress?.address || '').trim().toLowerCase().slice(0, 254),
});
const addrs = (list: GraphAddress[] | undefined) =>
  (Array.isArray(list) ? list : [])
    .slice(0, 100)
    .map(addr)
    .filter((a) => a.address);

// Bulk mail by its headers: 1 bulk, 0 not, -1 unknown (headers not returned; read before triage).
export function bulkFromHeaders(headers: { name?: string; value?: string }[] | undefined) {
  if (!Array.isArray(headers)) return -1;
  const h = new Map(headers.map((x) => [(x.name || '').toLowerCase(), (x.value || '').trim().toLowerCase()]));
  if (h.has('list-unsubscribe') || h.has('list-id')) return 1;
  if (/^(bulk|list|junk)$/.test(h.get('precedence') || '')) return 1;
  const auto = h.get('auto-submitted');
  if (auto && auto !== 'no') return 1;
  return 0;
}

// The new text of a message: quoted history and common signatures cut where easy, capped. Forwards
// keep their content, since the forwarded message is the substance.
export function trimBody(text: string, subject: string) {
  const lines = (text || '').replace(/\r\n?/g, '\n').split('\n');
  const forward = /^\s*(fw|fwd)\s*:/i.test(subject);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    const hasText = out.some((l) => l.trim());
    if (/^(--|__)\s*$/.test(t) && hasText) break; // signature delimiter
    if (/^(sent from my|get outlook for)\b/i.test(t) && hasText) break;
    if (!forward && hasText) {
      if (/^-{2,}\s*original message\s*-{2,}$/i.test(t)) break;
      if (/^on\b.{0,240}\bwrote:\s*$/i.test(t)) break;
      if (/^on\b.{0,200}$/i.test(t) && /^wrote:\s*$/i.test(lines[i + 1]?.trim() || '')) break;
      if (/^_{8,}$/.test(t) && /^from:/i.test(lines[i + 1]?.trim() || '')) break;
      if (/^from:\s/i.test(t) && lines.slice(i + 1, i + 5).some((l) => /^(sent|date):\s/i.test(l.trim()))) break;
    }
    if (!forward && t.startsWith('>')) continue;
    out.push(line.replace(/\s+$/, ''));
  }
  const joined = out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return (joined || (text || '').trim()).slice(0, BODY_CAP);
}

const time = (s: string | undefined) => {
  const t = s ? Date.parse(s) : NaN;
  return Number.isFinite(t) ? t : null;
};

function firstUrl(graphFolder: string, now: number, withHeaders: boolean) {
  const since = new Date(now - FIRST_RUN_DAYS * DAY).toISOString().slice(0, 19) + 'Z';
  const select = withHeaders ? [...SELECT, 'internetMessageHeaders'] : SELECT;
  return (
    `${GRAPH}/me/mailFolders('${graphFolder}')/messages/delta?$select=${select.join(',')}` +
    `&$filter=${encodeURIComponent(`receivedDateTime ge ${since}`)}`
  );
}

export interface SyncResult {
  fetched: number; // new messages stored
  removed: number;
  complete: boolean; // both folders reached their deltaLink
  busy: GraphError | null;
}

// Fetches changes for both folders within the time budget. Throws GraphError (other than busy) and
// ReauthError; a busy reply stops the run and is returned so the caller can wait.
export async function syncMailbox(s: GraphSession, budgetMs = SYNC_BUDGET_MS): Promise<SyncResult> {
  const { db } = s.sys;
  const member = s.account.member;
  const started = Date.now();
  const result: SyncResult = { fetched: 0, removed: 0, complete: true, busy: null };
  for (const f of FOLDERS) {
    let link = s.account[f.column];
    let fresh = !link;
    let headersRequested = fresh && f.folder === 'inbox';
    if (!link) link = firstUrl(f.graph, s.sys.now, headersRequested);
    for (let page = 0; ; page++) {
      if (page >= MAX_PAGES || Date.now() - started > budgetMs) {
        result.complete = false;
        break;
      }
      let data: Record<string, unknown>;
      try {
        ({ data } = await s.request('GET', link, undefined, `odata.maxpagesize=${PAGE_SIZE}`));
      } catch (e) {
        if (e instanceof GraphError && e.busy) {
          result.busy = e;
          result.complete = false;
          return result;
        }
        // Some mailboxes refuse headers on delta; read them per message before triage instead.
        if (e instanceof GraphError && e.status === 400 && fresh && headersRequested) {
          headersRequested = false;
          link = firstUrl(f.graph, s.sys.now, false);
          continue;
        }
        // A stale delta token: start again from the first-run window (upserts keep it idempotent).
        if (e instanceof GraphError && (e.status === 410 || (e.status === 400 && !fresh))) {
          fresh = true;
          link = firstUrl(f.graph, s.sys.now, false);
          continue;
        }
        throw e;
      }
      const items = Array.isArray(data.value) ? (data.value as GraphMessage[]) : [];
      const next = typeof data['@odata.nextLink'] === 'string' ? (data['@odata.nextLink'] as string) : null;
      const delta = typeof data['@odata.deltaLink'] === 'string' ? (data['@odata.deltaLink'] as string) : null;
      const counts = await writePage(s, f.folder, items, next || delta, f.column);
      result.fetched += counts.fetched;
      result.removed += counts.removed;
      s.account[f.column] = next || delta || link;
      if (!next) break;
      link = next;
    }
  }
  await db
    .prepare('UPDATE mail_accounts SET last_sync_at = ?, updated_at = ? WHERE member = ?')
    .bind(s.sys.now, s.sys.now, member)
    .run();
  return result;
}

async function writePage(
  s: GraphSession,
  folder: Folder,
  items: GraphMessage[],
  checkpoint: string | null,
  column: 'inbox_delta' | 'sent_delta',
) {
  const { db, now } = s.sys;
  const member = s.account.member;
  const statements: D1PreparedStatement[] = [];
  let fetched = 0,
    removed = 0;
  const known = new Set<string>();
  for (const m of items) {
    if (!m || typeof m.id !== 'string' || !m.id || m.id.length > 400) continue;
    if (m['@removed']) {
      removed++;
      statements.push(
        db
          .prepare(
            'UPDATE mail_messages SET removed_at = ?, updated_at = ? WHERE member = ? AND graph_id = ? AND removed_at IS NULL',
          )
          .bind(now, now, member, m.id),
      );
      continue;
    }
    const received = time(folder === 'sent' ? m.sentDateTime || m.receivedDateTime : m.receivedDateTime);
    if (received === null) {
      // A partial change (for example the read flag): update what came, never invent the rest.
      if (typeof m.isRead === 'boolean')
        statements.push(
          db
            .prepare('UPDATE mail_messages SET is_read = ?, updated_at = ? WHERE member = ? AND graph_id = ?')
            .bind(m.isRead ? 1 : 0, now, member, m.id),
        );
      continue;
    }
    const id = await messageKey(member, m.id);
    if (known.has(id)) continue;
    known.add(id);
    const subject = (m.subject || '').slice(0, 500);
    const from = addr(m.from);
    const importance = ['low', 'high'].includes(m.importance || '') ? m.importance! : 'normal';
    const bulk = folder === 'inbox' ? bulkFromHeaders(m.internetMessageHeaders) : 0;
    statements.push(
      db
        .prepare(
          `INSERT INTO mail_messages(id,member,graph_id,internet_message_id,conversation_id,folder,subject,from_address,
           from_name,to_json,cc_json,received_at,preview,body_text,has_attachments,importance,is_read,bulk,web_link,
           removed_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?)
           ON CONFLICT(member, graph_id) DO UPDATE SET internet_message_id = excluded.internet_message_id,
           conversation_id = excluded.conversation_id, folder = excluded.folder, subject = excluded.subject,
           from_address = excluded.from_address, from_name = excluded.from_name, to_json = excluded.to_json,
           cc_json = excluded.cc_json, received_at = excluded.received_at, preview = excluded.preview,
           body_text = excluded.body_text, has_attachments = excluded.has_attachments,
           importance = excluded.importance, is_read = excluded.is_read,
           bulk = CASE WHEN excluded.bulk < 0 THEN mail_messages.bulk ELSE excluded.bulk END,
           web_link = excluded.web_link, removed_at = NULL, updated_at = excluded.updated_at`,
        )
        .bind(
          id,
          member,
          m.id,
          (m.internetMessageId || '').slice(0, 500),
          (m.conversationId || '').slice(0, 500),
          folder,
          subject,
          from.address,
          from.name,
          JSON.stringify(addrs(m.toRecipients)),
          JSON.stringify(addrs(m.ccRecipients)),
          received,
          (m.bodyPreview || '').replace(/\s+/g, ' ').trim().slice(0, 300),
          trimBody(m.body?.content || '', subject),
          m.hasAttachments ? 1 : 0,
          importance,
          m.isRead ? 1 : 0,
          bulk,
          (m.webLink || '').startsWith('https://') ? m.webLink!.slice(0, 2000) : '',
          now,
          now,
        ),
    );
    if (folder === 'inbox') {
      // The triage row is created with the message, so nothing is ever left untriaged.
      statements.push(
        db
          .prepare(
            `INSERT INTO mail_triage(message_id,member,status,attempts,next_attempt_at,source,tier,category,handling,why,
             deadline,asks,reply_needed,draft_decision,delegate,matter_id,matter_confidence,confidence,safety_flag,
             corrected,model,error,triaged_at,updated_at,revision)
             VALUES(?,?,'pending',0,0,'ai',3,'unknown','uncertain','',NULL,'[]','no','undecided',NULL,NULL,NULL,0,NULL,
             0,'','',NULL,?,1) ON CONFLICT(message_id) DO NOTHING`,
          )
          .bind(id, member, now),
      );
    }
    fetched++;
  }
  if (checkpoint)
    statements.push(
      db
        .prepare(`UPDATE mail_accounts SET ${column} = ?, updated_at = ? WHERE member = ?`)
        .bind(checkpoint, now, member),
    );
  if (statements.length) await db.batch(statements);
  return { fetched, removed };
}

// Reads headers for inbox messages whose delta reply lacked them (bounded per run).
export async function readHeaders(s: GraphSession, rows: { id: string; graph_id: string }[]) {
  const out = new Map<string, number>();
  for (const r of rows) {
    const { data } = await s.request(
      'GET',
      `/me/messages/${encodeURIComponent(r.graph_id)}?$select=internetMessageHeaders`,
    );
    const bulk = bulkFromHeaders(
      (data.internetMessageHeaders as { name?: string; value?: string }[] | undefined) ?? [],
    );
    out.set(r.id, bulk);
    await s.sys.db
      .prepare('UPDATE mail_messages SET bulk = ? WHERE member = ? AND id = ?')
      .bind(bulk, s.account.member, r.id)
      .run();
  }
  return out;
}

// Removes the member's stored mail. With the account (disconnecting), corrections, rules, sign-in
// states, the token and settings go too; without it (another mailbox connected), the learning stays.
export async function deleteMailData(db: D1Database, member: string, withAccount: boolean) {
  const tables = ['mail_drafts', 'mail_triage', 'mail_messages'];
  if (withAccount) tables.push('mail_corrections', 'mail_rules', 'mail_oauth_states', 'mail_accounts');
  await db.batch(tables.map((t) => db.prepare(`DELETE FROM ${t} WHERE member = ?`).bind(member)));
}
