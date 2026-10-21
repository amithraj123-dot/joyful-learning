import { isTrashed } from './note-details.ts';
import { validNote, type Note } from './workspace-core.ts';
export class CloudError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
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
export async function getNote(db: D1Database, owner: string, id: string) {
  const r = await db
    .prepare('SELECT value FROM workspace_notes WHERE owner = ? AND id = ?')
    .bind(owner, id)
    .first<{ value: string }>();
  return r ? (JSON.parse(r.value) as Note) : null;
}
export async function saveNote(
  db: D1Database,
  owner: string,
  value: unknown,
  base: number | undefined,
  actor = owner,
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
export async function deleteNote(db: D1Database, owner: string, id: string, base?: number) {
  if (!/^[\w-]{1,100}$/.test(id)) throw new CloudError('Invalid note.');
  const old = await getNote(db, owner, id);
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
  await audit(db, owner, owner, 'note.deleted', id);
  return true;
}
export async function enforceRetention(db: D1Database, owner: string) {
  const p = await policyFor(db, owner);
  const expired = await db
    .prepare(
      "SELECT id,updated_at FROM workspace_notes WHERE owner = ? AND coalesce(json_extract(value,'$.details.trashedAt'),0) > 0 AND json_extract(value,'$.details.trashedAt') < ? AND json_extract(value,'$.status') != 'recording' LIMIT 100",
    )
    .bind(owner, Date.now() - 30 * 86400000)
    .all<{ id: string; updated_at: number }>();
  for (const n of expired.results) await deleteNote(db, owner, n.id, n.updated_at);
  if (!p.retentionDays) return;
  const cutoff = Date.now() - p.retentionDays * 86400000;
  const old = await db
    .prepare(
      "SELECT id,updated_at FROM workspace_notes WHERE owner = ? AND updated_at < ? AND json_extract(value,'$.status') != 'recording' LIMIT 100",
    )
    .bind(owner, cutoff)
    .all<{ id: string; updated_at: number }>();
  for (const n of old.results) await deleteNote(db, owner, n.id, n.updated_at);
}
