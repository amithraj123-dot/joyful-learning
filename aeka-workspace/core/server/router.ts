// Single entry point for module actions: POST /api/modules with { module, action, ...payload }.
import { CloudError, clientError, declaredTooLarge } from '../../lib/cloud-store.ts';
import { recordActivity } from './activity.ts';
import { resolveMember, type SignedInUser } from './members.ts';
import type { ServerEnv } from './env.ts';
import type { ModuleContext, ServerModule } from './module.ts';

const MAX_BODY = 1_800_000;
const headers = { 'Cache-Control': 'private, no-store' };
const reply = (value: unknown, status = 200) =>
  Response.json(status < 400 ? { value } : { error: value }, { status, headers });

export async function moduleRequest(
  request: Request,
  db: D1Database | undefined,
  user: SignedInUser | null,
  modules: ServerModule[],
  options: { env?: ServerEnv; fetcher?: typeof fetch } = {},
) {
  if (!user) return reply('Sign in to use the workspace.', 401);
  if (request.headers.get('Origin') !== new URL(request.url).origin)
    return reply('This request must come from your workspace.', 403);
  if (!db) return reply('Workspace storage is not available yet. Try again after deployment.', 503);
  if (declaredTooLarge(request, MAX_BODY)) return reply('Request is too large.', 413);
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) throw new CloudError('Request is too large.', 413);
    const payload = JSON.parse(text) as Record<string, unknown>;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
      throw new CloudError('Invalid request.');
    const mod = modules.find((m) => m.id === payload.module);
    const action = mod && typeof payload.action === 'string' ? mod.actions[payload.action] : undefined;
    if (!mod || !action || !Object.hasOwn(mod.actions, payload.action as string))
      throw new CloudError('Unknown workspace action.', 404);
    const member = await resolveMember(db, user);
    const ctx: ModuleContext = {
      db,
      user,
      member,
      now: Date.now(),
      env: options.env ?? {},
      fetch: options.fetcher ?? fetch,
      log: (act, target, summary) =>
        recordActivity(db, {
          actor: member?.email || user.email,
          actorName: member?.name || user.email,
          module: mod.id,
          action: act,
          target,
          summary,
        }),
    };
    const rule = action.permission ?? 'member';
    if (rule !== 'personal') {
      if (!member)
        throw new CloudError(
          'Your account is not a member of this firm workspace. Ask an administrator to add your email.',
          403,
        );
      if (typeof rule === 'function' && !(await rule(ctx, payload)))
        throw new CloudError('You do not have permission for this action.', 403);
    }
    return reply((await action.handler(ctx, payload)) ?? null);
  } catch (e) {
    const { message, status } = clientError(e, 'Workspace action failed.');
    return reply(message, status);
  }
}
