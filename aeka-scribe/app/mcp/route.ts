import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../chatgpt-auth';
import { notesMCP } from '../../lib/notes-mcp';
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  return notesMCP(request, env.DB, user?.userId || null);
}
