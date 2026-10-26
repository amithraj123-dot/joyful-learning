// Notifications for one member, from any module: reminders, briefs, urgent mail, assistant results.
// A dedupe key makes a notice idempotent (for example one per reminder occurrence). Delivery to other
// channels (WhatsApp) is done by the module that owns the channel, reading undelivered rows.
export interface Notice {
  id: string;
  recipient: string; // member email
  module: string;
  kind: string; // e.g. "reminder", "brief", "mail.urgent"
  title: string;
  body: string;
  link: string; // page id (and optional "#id") to open
  createdAt: number;
  readAt: number | null;
}

export async function notify(
  db: D1Database,
  n: Omit<Notice, 'id' | 'createdAt' | 'readAt'> & { dedupeKey?: string },
  now = Date.now(),
) {
  const id = crypto.randomUUID();
  const r = await db
    .prepare(
      'INSERT INTO org_notifications(id,recipient,module,kind,title,body,link,dedupe_key,created_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING',
    )
    .bind(
      id,
      n.recipient,
      n.module,
      n.kind,
      n.title.slice(0, 200),
      n.body.slice(0, 2000),
      n.link.slice(0, 200),
      n.dedupeKey ? n.dedupeKey.slice(0, 200) : id,
      now,
    )
    .run();
  return r.meta.changes ? id : null;
}

export async function listNotices(db: D1Database, recipient: string, limit = 50) {
  const r = await db
    .prepare(
      'SELECT id,recipient,module,kind,title,body,link,created_at AS createdAt,read_at AS readAt FROM org_notifications WHERE recipient = ? ORDER BY created_at DESC, rowid DESC LIMIT ?',
    )
    .bind(recipient, Math.min(Math.max(limit, 1), 200))
    .all<Notice>();
  return r.results;
}

export async function unreadCount(db: D1Database, recipient: string) {
  const r = await db
    .prepare('SELECT count(*) AS n FROM org_notifications WHERE recipient = ? AND read_at IS NULL')
    .bind(recipient)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

export async function markRead(db: D1Database, recipient: string, ids: string[] | 'all', now = Date.now()) {
  if (ids === 'all') {
    await db
      .prepare('UPDATE org_notifications SET read_at = ? WHERE recipient = ? AND read_at IS NULL')
      .bind(now, recipient)
      .run();
    return;
  }
  for (const id of ids.slice(0, 200))
    await db
      .prepare('UPDATE org_notifications SET read_at = coalesce(read_at, ?) WHERE recipient = ? AND id = ?')
      .bind(now, recipient, id)
      .run();
}

// A short lease, so two overlapping ticks never run the same background job at once.
export async function takeLease(db: D1Database, name: string, now: number, ms: number) {
  const r = await db
    .prepare(
      'INSERT INTO core_leases(name,until) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET until = excluded.until WHERE core_leases.until <= ?',
    )
    .bind(name, now + ms, now)
    .run();
  return r.meta.changes > 0;
}
export async function releaseLease(db: D1Database, name: string) {
  await db.prepare('DELETE FROM core_leases WHERE name = ?').bind(name).run();
}
