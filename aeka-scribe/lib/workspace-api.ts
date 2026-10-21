import { saveNote, deleteNote, CloudError, enforceRetention, policyFor } from './cloud-store.ts';
import { validNote, type Note } from './workspace-core.ts';
import { extractImageText } from './image-context.ts';
import { generateText } from './ai-workspace.ts';
import { defaultStudio, validStudio, prepareStudioTask, parseActions } from './meeting-studio.ts';
const limits = new Map<string, { at: number; count: number }>();
const response = (value: unknown, status = 200) =>
  Response.json(status === 200 ? { value } : { error: value }, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
export async function workspaceRequest(
  request: Request,
  db: D1Database | undefined,
  key: string | undefined,
  userId: string | null,
  fetcher: typeof fetch = fetch,
) {
  if (!userId) return response('Sign in to save and read your notes.', 401);
  if (request.headers.get('Origin') !== new URL(request.url).origin)
    return response('This request must come from your workspace.', 403);
  if (!db) return response('Note storage is not available yet. Try again after deployment.', 503);
  const text = await request.text();
  if (text.length > 1800000) return response('This note exceeds the storage limit.', 413);
  try {
    const p = JSON.parse(text),
      owner = userId;
    await enforceRetention(db, owner);
    const getNotes = async () => {
      const r = await db
        .prepare('SELECT value FROM workspace_notes WHERE owner = ? ORDER BY updated_at DESC LIMIT 2000')
        .bind(owner)
        .all<{ value: string }>();
      return r.results.map((x) => JSON.parse(x.value) as Note);
    };
    if (p.action === 'notes.list') return response(await getNotes());
    if (p.action === 'notes.save') return response(await saveNote(db, owner, p.note, p.baseUpdatedAt));
    if (p.action === 'notes.delete') return response(await deleteNote(db, owner, p.id, p.baseUpdatedAt));
    const studioGet = async () => {
      const old = await db
        .prepare('SELECT value,revision FROM workspace_studio WHERE owner = ?')
        .bind(owner)
        .first<{ value: string; revision: number }>();
      return {
        config: old ? validStudio(JSON.parse(old.value)) : defaultStudio(),
        revision: old?.revision || 0,
      };
    };
    if (p.action === 'studio.get') return response(await studioGet());
    if (p.action === 'studio.save') {
      const config = validStudio(p.config),
        old = await studioGet();
      if (old.revision !== p.revision)
        throw new CloudError('Templates changed in another window. Reload before saving.', 409);
      const revision = Math.max(Date.now(), old.revision + 1);
      const result = old.revision
        ? await db
            .prepare('UPDATE workspace_studio SET value = ?,revision = ? WHERE owner = ? AND revision = ?')
            .bind(JSON.stringify(config), revision, owner, old.revision)
            .run()
        : await db
            .prepare('INSERT OR IGNORE INTO workspace_studio(owner,value,revision) VALUES(?,?,?)')
            .bind(owner, JSON.stringify(config), revision)
            .run();
      if (!result.meta.changes)
        throw new CloudError('Templates changed in another window. Reload before saving.', 409);
      return response({ config, revision });
    }
    if (p.action === 'ai' || p.action === 'context.image') {
      if (!(await policyFor(db, owner)).cloudAI)
        return response('Cloud AI is disabled in workspace controls.', 403);
      const now = Date.now(),
        rate = limits.get(owner);
      if (rate && now - rate.at < 60000 && rate.count >= 8)
        return response('Wait a minute before requesting more AI edits.', 429);
      limits.set(owner, {
        at: rate && now - rate.at < 60000 ? rate.at : now,
        count: rate && now - rate.at < 60000 ? rate.count + 1 : 1,
      });
      if (limits.size > 5000) for (const [id, r] of limits) if (now - r.at > 60000) limits.delete(id);
      if (p.action === 'context.image') return response(await extractImageText(key, p.image, fetcher));
      const task = prepareStudioTask(await getNotes(), (await studioGet()).config, p);
      const answer = await generateText(key, task.input, task.instructions, fetcher);
      return response({
        text: answer,
        sources: task.sources,
        coverage: task.coverage,
        ...(p.kind === 'actions' ? { actions: parseActions(answer) } : {}),
      });
    }
    return response('Unknown workspace action.', 400);
  } catch (e) {
    return response(
      e instanceof Error ? e.message : 'Workspace request failed.',
      e instanceof CloudError ? e.status : 400,
    );
  }
}
