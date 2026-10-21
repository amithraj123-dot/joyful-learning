import { sanitizeKeywords } from './flow-core.ts';

export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const limits = new Map<string, { start: number; count: number }>();
function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}
export async function transcribe(
  request: Request,
  key: string | undefined,
  userId: string | null,
  fetcher: typeof fetch = fetch,
) {
  if (!userId) return json({ error: 'Sign in to use cloud transcription.' }, 401);
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin)
    return json({ error: 'Please submit audio from this workspace.' }, 403);
  if (!key)
    return json(
      {
        error:
          'Cloud transcription is not connected yet. Use Browser dictation or connect OpenAI in the workspace settings.',
      },
      503,
    );
  if (Number(request.headers.get('content-length')) > MAX_AUDIO_BYTES + 100000)
    return json({ error: 'Choose an audio file smaller than 20 MB.' }, 413);
  if (!request.headers.get('content-type')?.startsWith('multipart/form-data'))
    return json({ error: 'An audio file is required.' }, 400);
  const now = Date.now();
  for (const [id, l] of limits) if (now - l.start > 60000) limits.delete(id);
  const limit = limits.get(userId) ?? { start: now, count: 0 };
  // Meeting capture uploads a chunk every 8 to 20 seconds (up to about 8 a minute) on top of dictation, so
  // 6 a minute stalled the meeting queue. This per-isolate counter is a courtesy brake, not abuse control.
  if (limit.count >= 20) return json({ error: 'Too many requests. Wait a minute and try again.' }, 429);
  limit.count++;
  limits.set(userId, limit);
  let data: FormData;
  try {
    data = await request.formData();
  } catch {
    return json({ error: 'The upload could not be read.' }, 400);
  }
  const audio = data.get('audio');
  if (!(audio instanceof File) || audio.size === 0)
    return json({ error: 'The recording is empty. Please try again.' }, 400);
  if (audio.size > MAX_AUDIO_BYTES) return json({ error: 'Choose an audio file smaller than 20 MB.' }, 413);
  if (!/\.(mp3|mp4|mpeg|mpga|m4a|wav|webm)$/i.test(audio.name))
    return json({ error: 'Use MP3, MP4, M4A, WAV, MPEG or WebM audio.' }, 400);
  const language = String(data.get('language') ?? 'en').split('-')[0];
  if (!['en', 'hi', 'kn', 'ta', 'te', 'mr'].includes(language))
    return json({ error: 'Choose a supported language.' }, 400);
  const prompt = String(data.get('context') ?? '').trim();
  if (prompt.length > 1000) return json({ error: 'Keep the context under 1,000 characters.' }, 400);
  let keywords: string[] = [];
  try {
    keywords = sanitizeKeywords(JSON.parse(String(data.get('keywords') ?? '[]')));
  } catch {
    return json({ error: 'The vocabulary could not be read.' }, 400);
  }
  const form = new FormData();
  form.set('model', 'gpt-transcribe');
  form.set('file', audio);
  form.append('languages[]', language);
  for (const keyword of keywords) form.append('keywords[]', keyword);
  if (prompt) form.set('prompt', prompt);
  try {
    const response = await fetcher('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(90000)]),
    });
    if (!response.ok) {
      const status = response.status;
      return json(
        {
          error:
            status === 429
              ? 'The transcription service is busy or its quota is exhausted. Your recording is available to retry.'
              : status === 401 || status === 403
                ? 'The OpenAI connection needs attention. Update its server credential.'
                : 'Transcription failed. Your recording is available to retry.',
        },
        status === 429 ? 429 : 502,
      );
    }
    const result = (await response.json()) as { text?: unknown; languages?: unknown };
    if (typeof result.text !== 'string')
      return json({ error: 'The transcription service returned an invalid result.' }, 502);
    return json({ text: result.text, model: 'gpt-transcribe', elapsedMs: Date.now() - now });
  } catch (error) {
    return json(
      {
        error: request.signal.aborted
          ? 'Transcription cancelled.'
          : error instanceof Error && /Timeout|Abort/.test(error.name)
            ? 'Transcription timed out. Your recording is available to retry.'
            : 'Could not reach the transcription service. Your recording is available to retry.',
      },
      request.signal.aborted ? 499 : 504,
    );
  }
}
