import { isTrashed } from './note-details.ts';
import { validNote, type Note } from './workspace-core.ts';
export class CloudError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
// Messages from CloudError and from the note validators are written for users. Built-in runtime errors
// and database errors can carry SQL fragments or internals, so those are logged and replaced.
export function clientError(e: unknown, fallback: string) {
  if (e instanceof CloudError) return { message: e.message, status: e.status };
  const internal =
    !(e instanceof Error) ||
    e instanceof TypeError ||
    e instanceof SyntaxError ||
    e instanceof RangeError ||
    e instanceof ReferenceError ||
    /D1_|SQLITE|no such (table|column)|constraint failed/i.test(e.message);
  if (internal) {
    console.error(fallback, e);
    return { message: fallback, status: e instanceof SyntaxError ? 400 : 500 };
  }
  return { message: e.message, status: 400 };
}
// Reject an oversized body from its declared length before buffering it.
export const declaredTooLarge = (request: Request, max: number) =>
  Number(request.headers.get('content-length') || 0) > max;
export const policyDefaults = { sharing: true, cloudAI: true, retentionDays: 0 };
export async function policyFor(db: D1Database, owner: string) {
  const r = await db
    .prepare('SELECT value FROM workspace_policy WHERE owner = ?')
    .bind(owner)
    .first<{ value: string }>();
  return { ...policyDefaults, ...(r ? JSON.parse(r.value) : {}) } as typeof policyDefaults;
}
export async function audit(db: D1Database, owner: string, actor: string, action: string, target: string) {
  await db.batch([
    db
      .prepare('INSERT INTO workspace_audit(id,owner,actor,action,target,at) VALUES(?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), owner, actor.slice(0, 300), action, target.slice(0, 300), Date.now()),
    db
      .prepare(
        'DELETE FROM workspace_audit WHERE owner = ? AND id NOT IN (SELECT id FROM workspace_audit WHERE owner = ? ORDER BY at DESC, id DESC LIMIT 1000)',
      )
      .bind(owner, owner),
  ]);
}
const DAY = 86400000;
// A recording not saved for six hours was interrupted (for example by a browser crash).
export const STALE_RECORDING_MS = 6 * 3600000;
const RETENTION_INTERVAL_MS = 5 * 60000;
export const RETENTION_ACTOR = 'Retention policy';
const retentionDays =
  "coalesce((SELECT json_extract(p.value,'$.retentionDays') FROM workspace_policy p WHERE p.owner = workspace_notes.owner),0)";
// SQL over workspace_notes that is true once a note is past the 30-day trash window or the owner's
// retention period. Live recordings are exempt. Bind expiryParams() where it appears.
export const expiredSql = `((json_extract(value,'$.status') != 'recording' OR updated_at < ?) AND ((coalesce(json_extract(value,'$.details.trashedAt'),0) > 0 AND json_extract(value,'$.details.trashedAt') < ?) OR (${retentionDays} > 0 AND updated_at < ? - ${retentionDays} * ${DAY})))`;
export const expiryParams = (now = Date.now()) => [now - STALE_RECORDING_MS, now - 30 * DAY, now];
// Report a stale recording as interrupted so it can be trashed and is not shown as live.
export const served = (n: Note, now = Date.now()): Note =>
  n.status === 'recording' && n.updatedAt < now - STALE_RECORDING_MS ? { ...n, status: 'interrupted' } : n;
async function readNote(db: D1Database, owner: string, id: string) {
  const r = await db
    .prepare(`SELECT value, ${expiredSql} AS expired FROM workspace_notes WHERE owner = ? AND id = ?`)
    .bind(...expiryParams(), owner, id)
    .first<{ value: string; expired: number }>();
  return r ? { note: JSON.parse(r.value) as Note, expired: !!r.expired } : null;
}
const ignoreConflict = (e: unknown) => {
  if (!(e instanceof CloudError)) throw e;
};
// Returns null for a missing or expired note; an expired one is purged now rather than at the next sweep.
export async function getNote(db: D1Database, owner: string, id: string) {
  const r = await readNote(db, owner, id);
  if (!r) return null;
  if (!r.expired) return served(r.note);
  await deleteNote(db, owner, id, r.note.updatedAt, RETENTION_ACTOR).catch(ignoreConflict);
  return null;
}
// Owner's live notes (trashed included, expired excluded), newest first.
export async function listNotes(db: D1Database, owner: string) {
  const r = await db
    .prepare(
      `SELECT value FROM workspace_notes WHERE owner = ? AND NOT ${expiredSql} ORDER BY updated_at DESC LIMIT 2000`,
    )
    .bind(owner, ...expiryParams())
    .all<{ value: string }>();
  return r.results.map((x) => served(JSON.parse(x.value) as Note));
}
// The same notes as listNotes, as id and revision only.
export async function noteIndex(db: D1Database, owner: string) {
  const r = await db
    .prepare(
      `SELECT id, updated_at FROM workspace_notes WHERE owner = ? AND NOT ${expiredSql} ORDER BY updated_at DESC LIMIT 2000`,
    )
    .bind(owner, ...expiryParams())
    .all<{ id: string; updated_at: number }>();
  return r.results;
}
export async function saveNote(
  db: D1Database,
  owner: string,
  value: unknown,
  base: number | undefined,
  actor: string,
) {
  const n = validNote(value),
    old = await getNote(db, owner, n.id);
  if (old && old.updatedAt !== base)
    throw new CloudError('This note changed elsewhere. Refresh before saving.', 409);
  if (
    !old &&
    (await db
      .prepare('SELECT id FROM workspace_deleted WHERE owner = ? AND id = ?')
      .bind(owner, n.id)
      .first())
  )
    throw new CloudError('This note was deleted. Save the changes as a new note.', 410);
  if (!old && base !== undefined && base !== 0)
    throw new CloudError('This note was deleted elsewhere. Save your edits as a new note.', 409);
  if (isTrashed(n) && n.status === 'recording' && old?.status === 'interrupted') n.status = 'interrupted';
  if (isTrashed(n) && (n.status === 'recording' || old?.status === 'recording'))
    throw new CloudError('Finish recording before moving this note to trash.');
  n.updatedAt = Math.max(Date.now(), (old?.updatedAt || 0) + 1);
  const r = old
    ? await db
        .prepare(
          'UPDATE workspace_notes SET value = ?, updated_at = ? WHERE owner = ? AND id = ? AND updated_at = ? AND (SELECT coalesce(sum(length(CAST(value AS BLOB))),0) FROM workspace_notes WHERE owner = ?) - length(CAST(value AS BLOB)) + length(CAST(? AS BLOB)) <= 16777216',
        )
        .bind(JSON.stringify(n), n.updatedAt, owner, n.id, old.updatedAt, owner, JSON.stringify(n))
        .run()
    : await db
        .prepare(
          'INSERT OR IGNORE INTO workspace_notes(owner,id,value,updated_at) SELECT ?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM workspace_deleted WHERE owner = ? AND id = ?) AND (SELECT count(*) FROM workspace_notes WHERE owner = ?) < 2000 AND (SELECT coalesce(sum(length(CAST(value AS BLOB))),0) FROM workspace_notes WHERE owner = ?) + length(CAST(? AS BLOB)) <= 16777216',
        )
        .bind(owner, n.id, JSON.stringify(n), n.updatedAt, owner, n.id, owner, owner, JSON.stringify(n))
        .run();
  if (!r.meta.changes)
    throw new CloudError(
      'This note changed or was deleted, or the 2,000-note / 16 MB workspace limit was reached. Refresh before saving.',
      409,
    );
  await audit(db, owner, actor, old ? 'note.updated' : 'note.created', n.id);
  return n;
}
export async function deleteNote(
  db: D1Database,
  owner: string,
  id: string,
  base: number | undefined,
  actor: string,
) {
  if (!/^[\w-]{1,100}$/.test(id)) throw new CloudError('Invalid note.');
  const old = (await readNote(db, owner, id))?.note;
  if (!old) return true;
  if (base !== undefined && base !== old.updatedAt)
    throw new CloudError('This note changed before deletion. Refresh and review it.', 409);
  const results = await db.batch([
    db
      .prepare(
        'INSERT OR REPLACE INTO workspace_deleted(owner,id,updated_at) SELECT owner,id,? FROM workspace_notes WHERE owner = ? AND id = ? AND updated_at = ?',
      )
      .bind(Date.now(), owner, id, old.updatedAt),
    db
      .prepare('DELETE FROM workspace_notes WHERE owner = ? AND id = ? AND updated_at = ?')
      .bind(owner, id, old.updatedAt),
    db
      .prepare(
        "DELETE FROM workspace_grants WHERE owner = ? AND kind = 'note' AND target = ? AND NOT EXISTS (SELECT 1 FROM workspace_notes WHERE owner = ? AND id = ?)",
      )
      .bind(owner, id, owner, id),
    db
      .prepare(
        'DELETE FROM workspace_comments WHERE owner = ? AND note_id = ? AND NOT EXISTS (SELECT 1 FROM workspace_notes WHERE owner = ? AND id = ?)',
      )
      .bind(owner, id, owner, id),
  ]);
  if (!results[1].meta.changes) throw new CloudError('This note changed before deletion.', 409);
  await audit(db, owner, actor, 'note.deleted', id);
  return true;
}
// Purges expired notes at most every five minutes per owner. Reads hide expired notes in between.
export async function enforceRetention(db: D1Database, owner: string) {
  const now = Date.now();
  const claim = await db
    .prepare(
      'INSERT INTO workspace_maintenance(owner,retention_at) VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET retention_at = excluded.retention_at WHERE workspace_maintenance.retention_at <= ?',
    )
    .bind(owner, now, now - RETENTION_INTERVAL_MS)
    .run();
  if (!claim.meta.changes) return;
  const expired = await db
    .prepare(`SELECT id,updated_at FROM workspace_notes WHERE owner = ? AND ${expiredSql} LIMIT 100`)
    .bind(owner, ...expiryParams(now))
    .all<{ id: string; updated_at: number }>();
  for (const n of expired.results)
    await deleteNote(db, owner, n.id, n.updated_at, RETENTION_ACTOR).catch(ignoreConflict);
  // More remain: let the next request continue.
  if (expired.results.length === 100) await resetRetention(db, owner);
}
// Makes the next request run the purge, e.g. after a shorter retention period is saved.
export async function resetRetention(db: D1Database, owner: string) {
  await db.prepare('DELETE FROM workspace_maintenance WHERE owner = ?').bind(owner).run();
}
