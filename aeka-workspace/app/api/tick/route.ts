import { env } from 'cloudflare:workers';
import type { ServerEnv } from '../../../core/server/env';
import { serverModules } from '../../../core/server/registry';
import { sameSecret } from '../../../core/server/secrets';
import { runTicks } from '../../../core/server/tick';

// Background work for every member: POST with "Authorization: Bearer <AEKA_TICK_TOKEN>" every few
// minutes from an external scheduler.
export async function POST(request: Request) {
  const e = env as unknown as ServerEnv & { DB?: D1Database };
  const token = e.AEKA_TICK_TOKEN?.trim() || '';
  const given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (token.length < 24 || !sameSecret(given, token))
    return Response.json({ error: 'Not authorised.' }, { status: 401 });
  if (!e.DB) return Response.json({ error: 'Storage unavailable.' }, { status: 503 });
  const r = await runTicks({ db: e.DB, env: e, fetch, now: Date.now() }, serverModules);
  return Response.json(r, { headers: { 'Cache-Control': 'no-store' } });
}
