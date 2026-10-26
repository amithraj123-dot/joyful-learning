import { env } from 'cloudflare:workers';
import type { ServerEnv, SystemContext } from '../../../core/server/env';
import { whatsappWebhook } from '../../../modules/assistant/server/whatsapp';

// Meta WhatsApp Cloud API webhook: GET verifies the subscription, POST delivers signed events. The
// logic lives in modules/assistant/server/whatsapp.ts.
const system = (): SystemContext | null => {
  const e = env as unknown as ServerEnv & { DB?: D1Database };
  return e.DB ? { db: e.DB, env: e, fetch, now: Date.now() } : null;
};

// Work after the response (answers, sends) runs with waitUntil when the runtime offers it; otherwise
// it waits for the next background tick.
async function defer() {
  try {
    const workers = await import('cloudflare:workers');
    return typeof workers.waitUntil === 'function' ? workers.waitUntil : undefined;
  } catch {
    return undefined;
  }
}

async function handle(request: Request) {
  const sys = system();
  if (!sys) return Response.json({ error: 'Storage unavailable.' }, { status: 503 });
  return whatsappWebhook(request, sys, { defer: await defer() });
}

export const GET = handle;
export const POST = handle;
