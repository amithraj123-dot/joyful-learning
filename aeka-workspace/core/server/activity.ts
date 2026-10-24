// Firm-wide activity trail shared by every team module. Entries record who did what, never note content.
export interface ActivityEntry {
  id: string;
  at: number;
  actor: string; // email
  actorName: string;
  module: string;
  action: string; // machine name, e.g. "todo.updated"
  target: string; // record id
  summary: string; // human-readable line
}

const MAX_SUMMARY = 300;

export async function recordActivity(
  db: D1Database,
  entry: Omit<ActivityEntry, 'id' | 'at'>,
  at = Date.now(),
) {
  await db
    .prepare(
      'INSERT INTO org_activity(id,at,actor,actor_name,module,action,target,summary) VALUES(?,?,?,?,?,?,?,?)',
    )
    .bind(
      crypto.randomUUID(),
      at,
      entry.actor,
      entry.actorName.slice(0, 120),
      entry.module,
      entry.action,
      entry.target.slice(0, 200),
      entry.summary.slice(0, MAX_SUMMARY),
    )
    .run();
}

export async function listActivity(
  db: D1Database,
  {
    module,
    target,
    before,
    limit = 100,
  }: { module?: string; target?: string; before?: number; limit?: number },
) {
  const where: string[] = [],
    params: unknown[] = [];
  if (module) (where.push('module = ?'), params.push(module));
  if (target) (where.push('target = ?'), params.push(target));
  if (before) (where.push('at < ?'), params.push(before));
  const r = await db
    .prepare(
      `SELECT id,at,actor,actor_name AS actorName,module,action,target,summary FROM org_activity ${
        where.length ? 'WHERE ' + where.join(' AND ') : ''
      } ORDER BY at DESC, rowid DESC LIMIT ?`,
    )
    .bind(...params, Math.min(Math.max(limit, 1), 500))
    .all<ActivityEntry>();
  return r.results;
}
