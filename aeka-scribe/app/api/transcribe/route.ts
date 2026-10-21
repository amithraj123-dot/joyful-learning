import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../chatgpt-auth';
import { transcribe } from '../../../lib/transcription';
export async function POST(request:Request){
  const user=await getChatGPTUser();
  return transcribe(request,env.OPENAI_API_KEY,user?.userId??null);
}
