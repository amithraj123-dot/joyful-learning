import { isTrashed, inFolder } from './note-details.ts';
import {
  CloudError,
  policyDefaults,
  policyFor,
  audit,
  getNote,
  saveNote,
  deleteNote,
  enforceRetention,
} from './cloud-store.ts';
import { validResources } from './resources-core.ts';
type User = { userId: string; email: string };
const reply = (value: unknown, status = 200) =>
  Response.json(status === 200 ? { value } : { error: value }, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
const id = (s: unknown) => {
  if (typeof s !== 'string' || !/^[\w-]{1,100}$/.test(s)) throw new CloudError('Invalid record.');
  return s;
};
const ownerId = (s: unknown) => {
  if (typeof s !== 'string' || !s || s.length > 300 || /[\x00-\x1f]/.test(s))
    throw new CloudError('Invalid owner.');
  return s;
};
const email = (s: unknown) => {
  if (typeof s !== 'string' || s.length > 254 || !/^\S+@\S+\.\S+$/.test(s))
    throw new CloudError('Enter a valid email address.');
  return s.trim().toLowerCase();
};
export async function cloudRequest(request: Request, db: D1Database | undefined, user: User | null) {
  if (!user) return reply('Sign in to your hosted workspace first.', 401);
  if (request.headers.get('Origin') !== new URL(request.url).origin)
    return reply('Use your workspace to make this request.', 403);
  if (!db) return reply('Workspace storage is unavailable.', 503);
  try {
    const body = await request.text();
    if (body.length > 1800000) throw new CloudError('Request is too large.', 413);
    const p = JSON.parse(body),
      me = user.userId,
      myEmail = user.email.toLowerCase();
    await enforceRetention(db, me);
    const ownPolicy = await policyFor(db, me);
    const accessibleNote = async (owner: string, noteId: string) => {
      const n = await getNote(db, owner, noteId);
      return n && !isTrashed(n) ? n : null;
    };
    const access = async (owner: string, kind: string, target: string, edit = false) => {
      await enforceRetention(db, owner);
      if (owner === me) return 'owner';
      if (!(await policyFor(db, owner)).sharing)
        throw new CloudError('Sharing is disabled for this workspace.', 403);
      const r = await db
        .prepare(
          'SELECT role FROM workspace_grants WHERE owner = ? AND kind = ? AND target = ? AND email = ? AND (expires_at = 0 OR expires_at > ?)',
        )
        .bind(owner, kind, target, myEmail, Date.now())
        .first<{ role: string }>();
      if (r && (!edit || r.role === 'editor')) return r.role;
      if (kind === 'note') {
        const note = await accessibleNote(owner, target);
        if (note) {
          const folders = await db
            .prepare(
              "SELECT target,role FROM workspace_grants WHERE owner = ? AND kind = 'folder' AND email = ? AND (expires_at = 0 OR expires_at > ?)",
            )
            .bind(owner, myEmail, Date.now())
            .all<{ target: string; role: string }>();
          const grant = folders.results.find(
            (g) => (!edit || g.role === 'editor') && inFolder(note, g.target),
          );
          if (grant) return grant.role;
        }
      }
      throw new CloudError('You do not have permission for this item.', 403);
    };
    if (p.action === 'status') return reply({ account: me, email: user.email, policy: ownPolicy });
    if (p.action === 'sync.index') {
      const r = await db
        .prepare('SELECT id,updated_at FROM workspace_notes WHERE owner = ? ORDER BY id LIMIT 2000')
        .bind(me)
        .all();
      return reply(r.results);
    }
    if (p.action === 'sync.get') return reply(await getNote(db, me, id(p.id)));
    if (p.action === 'sync.save') return reply(await saveNote(db, me, p.note, p.baseUpdatedAt));
    if (p.action === 'sync.delete') {
      if (!Number.isFinite(p.baseUpdatedAt)) throw new CloudError('A revision is required.');
      return reply(await deleteNote(db, me, id(p.id), p.baseUpdatedAt));
    }
    if (p.action === 'policy.save') {
      if (
        typeof p.policy?.sharing !== 'boolean' ||
        typeof p.policy?.cloudAI !== 'boolean' ||
        ![0, 7, 30, 90, 365].includes(p.policy?.retentionDays)
      )
        throw new CloudError('Invalid workspace policy.');
      const policy = {
        sharing: p.policy.sharing,
        cloudAI: p.policy.cloudAI,
        retentionDays: p.policy.retentionDays,
      };
      await db
        .prepare(
          'INSERT INTO workspace_policy(owner,value) VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET value = excluded.value',
        )
        .bind(me, JSON.stringify(policy))
        .run();
      await audit(db, me, myEmail, 'policy.updated', 'workspace');
      await enforceRetention(db, me);
      return reply(policy);
    }
    if (p.action === 'audit.list') {
      const r = await db
        .prepare(
          'SELECT actor,action,target,at FROM workspace_audit WHERE owner = ? ORDER BY at DESC LIMIT 200',
        )
        .bind(me)
        .all();
      return reply(r.results);
    }
    if (p.action === 'shares.list')
      return reply(
        (
          await db
            .prepare(
              'SELECT kind,target,email,role,expires_at FROM workspace_grants WHERE owner = ? ORDER BY email LIMIT 500',
            )
            .bind(me)
            .all()
        ).results,
      );
    if (p.action === 'shares.grant' || p.action === 'shares.revoke') {
      const kind = p.kind === 'resources' ? 'resources' : p.kind === 'folder' ? 'folder' : 'note';
      if (
        kind === 'folder' &&
        (typeof p.id !== 'string' || !p.id.trim() || p.id.length > 100 || /[\x00-\x1f]/.test(p.id))
      )
        throw new CloudError('Choose a valid folder.');
      const target = kind === 'resources' ? 'dictionary' : kind === 'folder' ? p.id : id(p.id),
        recipient = email(p.email);
      if (p.action === 'shares.revoke') {
        await db
          .prepare('DELETE FROM workspace_grants WHERE owner = ? AND kind = ? AND target = ? AND email = ?')
          .bind(me, kind, target, recipient)
          .run();
        await audit(db, me, myEmail, 'share.revoked', target + ':' + recipient);
        return reply(true);
      }
      if (!ownPolicy.sharing) throw new CloudError('Enable sharing in workspace controls first.', 403);
      if (recipient === myEmail) throw new CloudError('You already own this item.');
      if (!['viewer', 'editor'].includes(p.role)) throw new CloudError('Choose viewer or editor.');
      if (kind === 'note' && !(await accessibleNote(me, target)))
        throw new CloudError('Sync or save the note to the web workspace first.', 404);
      if (kind === 'folder') {
        const rows = await db
          .prepare('SELECT value FROM workspace_notes WHERE owner = ? LIMIT 2000')
          .bind(me)
          .all<{ value: string }>();
        if (
          !rows.results.some((r) => {
            const n = JSON.parse(r.value);
            return !isTrashed(n) && inFolder(n, target);
          })
        )
          throw new CloudError('Sync or save a note in this folder before sharing it.');
      }
      if (
        kind === 'resources' &&
        !(await db.prepare('SELECT owner FROM workspace_resources WHERE owner = ?').bind(me).first())
      )
        throw new CloudError('Publish your team dictionary first.');
      const expiry = p.expiresAt || 0;
      if (
        !Number.isFinite(expiry) ||
        (expiry !== 0 && (expiry <= Date.now() || expiry > Date.now() + 366 * 86400000))
      )
        throw new CloudError('Invalid sharing expiry.');
      const count = await db
        .prepare('SELECT count(*) AS n FROM workspace_grants WHERE owner = ?')
        .bind(me)
        .first<{ n: number }>();
      if ((count?.n || 0) >= 500) throw new CloudError('Remove older grants before adding more.');
      await db
        .prepare(
          'INSERT INTO workspace_grants(owner,kind,target,email,role,expires_at) VALUES(?,?,?,?,?,?) ON CONFLICT(owner,kind,target,email) DO UPDATE SET role = excluded.role, expires_at = excluded.expires_at',
        )
        .bind(me, kind, target, recipient, p.role, expiry)
        .run();
      await audit(db, me, myEmail, 'share.granted', target + ':' + recipient);
      return reply(true);
    }
    if (p.action === 'shared.list') {
      const r = await db
        .prepare(
          `SELECT g.owner,g.kind,g.target,g.role,n.id AS note_id,n.updated_at,json_extract(n.value,'$.title') AS title FROM workspace_grants g LEFT JOIN workspace_notes n ON g.owner = n.owner AND ((g.kind = 'note' AND g.target = n.id) OR (g.kind = 'folder' AND (json_extract(n.value,'$.folder') = g.target OR substr(json_extract(n.value,'$.folder'),1,length(g.target)+1) = g.target || '/' OR EXISTS (SELECT 1 FROM json_each(coalesce(json_extract(n.value,'$.details.folders'),'[]')) f WHERE f.value = g.target OR substr(f.value,1,length(g.target)+1) = g.target || '/')))) LEFT JOIN workspace_policy p ON p.owner = g.owner WHERE g.email = ? AND (g.expires_at = 0 OR g.expires_at > ?) AND coalesce(json_extract(p.value,'$.sharing'),1) = 1 AND (g.kind = 'resources' OR (n.id IS NOT NULL AND coalesce(json_extract(n.value,'$.details.trashedAt'),0) = 0 AND (coalesce(json_extract(p.value,'$.retentionDays'),0) = 0 OR n.updated_at >= ? - json_extract(p.value,'$.retentionDays')*86400000 OR json_extract(n.value,'$.status') = 'recording'))) LIMIT 2000`,
        )
        .bind(myEmail, Date.now(), Date.now())
        .all<{
          owner: string;
          kind: string;
          target: string;
          role: string;
          note_id: string | null;
          updated_at: number;
          title: string;
        }>();
      const unique = new Map<string, any>();
      for (const row of r.results) {
        const item = {
            owner: row.owner,
            kind: row.kind === 'folder' ? 'note' : row.kind,
            target: row.note_id || row.target,
            role: row.role,
            viaFolder: row.kind === 'folder' ? row.target : undefined,
            note: row.note_id ? { id: row.note_id, title: row.title, updatedAt: row.updated_at } : undefined,
          },
          key = item.owner + ':' + item.kind + ':' + item.target;
        if (!unique.has(key) || item.role === 'editor') unique.set(key, item);
      }
      return reply([...unique.values()]);
    }
    if (p.action === 'shared.get') {
      const owner = ownerId(p.owner),
        noteId = id(p.id);
      await access(owner, 'note', noteId);
      const note = await accessibleNote(owner, noteId);
      if (!note) throw new CloudError('This note is no longer available.', 404);
      return reply(note);
    }
    if (p.action === 'shared.save') {
      const owner = ownerId(p.owner),
        noteId = id(p.note?.id);
      await access(owner, 'note', noteId, true);
      const original = await accessibleNote(owner, noteId);
      if (!original) throw new CloudError('The owner deleted this note.', 404);
      if (
        owner !== me &&
        (p.note.folder !== original.folder ||
          JSON.stringify(p.note.details?.folders || []) !== JSON.stringify(original.details?.folders || []))
      )
        throw new CloudError('Only the owner can change folder membership.', 403);
      if (isTrashed(p.note)) throw new CloudError('Only the owner can move this note to trash.', 403);
      return reply(await saveNote(db, owner, p.note, p.baseUpdatedAt, myEmail));
    }
    if (p.action === 'comments.list' || p.action === 'comments.add' || p.action === 'comments.delete') {
      const owner = ownerId(p.owner || me),
        noteId = id(p.id);
      await access(owner, 'note', noteId);
      if (!(await accessibleNote(owner, noteId)))
        throw new CloudError('This note is no longer available.', 404);
      if (p.action === 'comments.list')
        return reply(
          (
            await db
              .prepare(
                'SELECT id,author,email,text,at FROM workspace_comments WHERE owner = ? AND note_id = ? ORDER BY at LIMIT 500',
              )
              .bind(owner, noteId)
              .all()
          ).results,
        );
      if (p.action === 'comments.delete') {
        await db
          .prepare(
            'DELETE FROM workspace_comments WHERE owner = ? AND note_id = ? AND id = ? AND (author = ? OR owner = ?)',
          )
          .bind(owner, noteId, id(p.commentId), me, me)
          .run();
        return reply(true);
      }
      if (typeof p.text !== 'string' || !p.text.trim() || p.text.length > 4000)
        throw new CloudError('Write a comment of up to 4,000 characters.');
      const count = await db
        .prepare('SELECT count(*) AS n FROM workspace_comments WHERE owner = ? AND note_id = ?')
        .bind(owner, noteId)
        .first<{ n: number }>();
      if ((count?.n || 0) >= 500) throw new CloudError('This note has reached its comment limit.');
      await db
        .prepare(
          'INSERT OR IGNORE INTO workspace_comments(id,owner,note_id,author,email,text,at) VALUES(?,?,?,?,?,?,?)',
        )
        .bind(id(p.commentId), owner, noteId, me, user.email, p.text.trim(), Date.now())
        .run();
      await audit(db, owner, myEmail, 'comment.added', noteId);
      return reply(true);
    }
    if (p.action === 'resources.get' || p.action === 'resources.save') {
      const owner = ownerId(p.owner || me);
      await access(owner, 'resources', 'dictionary', p.action === 'resources.save');
      const old = await db
        .prepare('SELECT value,revision FROM workspace_resources WHERE owner = ?')
        .bind(owner)
        .first<{ value: string; revision: number }>();
      if (p.action === 'resources.get')
        return reply({
          value: old ? JSON.parse(old.value) : { terms: [], snippets: [] },
          revision: old?.revision || 0,
        });
      const value = validResources(p.value);
      if ((old?.revision || 0) !== p.revision)
        throw new CloudError('The team dictionary changed. Refresh before saving.', 409);
      const revision = Math.max(Date.now(), (old?.revision || 0) + 1);
      const result = old
        ? await db
            .prepare(
              'UPDATE workspace_resources SET value = ?, revision = ? WHERE owner = ? AND revision = ?',
            )
            .bind(JSON.stringify(value), revision, owner, old.revision)
            .run()
        : await db
            .prepare('INSERT OR IGNORE INTO workspace_resources(owner,value,revision) VALUES(?,?,?)')
            .bind(owner, JSON.stringify(value), revision)
            .run();
      if (!result.meta.changes) throw new CloudError('The dictionary changed. Refresh before saving.', 409);
      await audit(db, owner, myEmail, 'dictionary.updated', 'dictionary');
      return reply({ value, revision });
    }
    throw new CloudError('Unknown cloud action.');
  } catch (e) {
    return reply(
      e instanceof Error ? e.message : 'Workspace action failed.',
      e instanceof CloudError ? e.status : 400,
    );
  }
}
