import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../chatgpt-auth';
import { moduleRequest } from '../../../core/server/router';
import { serverModules } from '../../../core/server/registry';

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  return moduleRequest(
    request,
    env.DB,
    user ? { userId: user.userId, email: user.email || '', name: user.fullName } : null,
    serverModules,
  );
}
