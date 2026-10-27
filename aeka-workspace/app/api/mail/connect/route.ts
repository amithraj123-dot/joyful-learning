import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../../chatgpt-auth';
import type { ServerEnv } from '../../../../core/server/env';
import { startConnect } from '../../../../modules/mail/server/oauth';

// Starts Microsoft sign-in for the signed-in member's own Outlook mailbox.
export async function GET(request: Request) {
  const user = await getChatGPTUser();
  const e = env as unknown as ServerEnv & { DB?: D1Database };
  return startConnect(request, {
    db: e.DB,
    user: user ? { userId: user.userId, email: user.email || '', name: user.fullName } : null,
    env: e,
    fetch,
  });
}
