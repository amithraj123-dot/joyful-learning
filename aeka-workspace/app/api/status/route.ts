import { env } from 'cloudflare:workers';
export async function GET() {
  return Response.json(
    { openaiConfigured: !!env.OPENAI_API_KEY, model: 'gpt-transcribe' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
