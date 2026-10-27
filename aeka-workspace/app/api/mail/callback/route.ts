import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../../chatgpt-auth';
import type { ServerEnv } from '../../../../core/server/env';
import { finishConnect } from '../../../../modules/mail/server/oauth';

// Microsoft returns here after sign-in; the state must belong to the same signed-in member.
export async function GET(request: Request) {
  const user = await getChatGPTUser();
  const e = env as unknown as ServerEnv & { DB?: D1Database };
  return finishConnect(request, {
    db: e.DB,
    user: user ? { userId: user.userId, email: user.email || '', name: user.fullName } : null,
    env: e,
    fetch,
  });
}
