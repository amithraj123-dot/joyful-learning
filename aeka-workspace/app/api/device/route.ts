import { env } from 'cloudflare:workers';
import type { ServerEnv, SystemContext } from '../../../core/server/env';
import { deviceRequest } from '../../../modules/chats/server/device';
import { chatsPass } from '../../../modules/chats/server/index';

// The Aeka Android app: pairing and syncing of messages read from phone notifications. The logic lives
// in modules/chats/server/device.ts; docs/ANDROID-PROTOCOL.md describes the protocol.
const system = (): SystemContext | null => {
  const e = env as unknown as ServerEnv & { DB?: D1Database };
  return e.DB ? { db: e.DB, env: e, fetch, now: Date.now() } : null;
};

// Triage after a sync runs once the response is sent, when the runtime offers waitUntil.
async function defer() {
  try {
    const workers = await import('cloudflare:workers');
    return typeof workers.waitUntil === 'function' ? workers.waitUntil : undefined;
  } catch {
    return undefined;
  }
}

export async function POST(request: Request) {
  const sys = system();
  const later = await defer();
  return deviceRequest(
    request,
    sys,
    sys ? (member) => chatsPass({ ...sys, now: Date.now() }, member) : undefined,
    later ? (p) => later(p) : undefined,
  );
}
