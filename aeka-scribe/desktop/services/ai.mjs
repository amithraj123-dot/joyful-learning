// Fixed provider endpoints. Credentials remain in the main process.
export async function audioToText(key, payload, fetcher = fetch) {
  if (!key) throw Error('Add your OpenAI API key in Desktop settings.');
  const bytes = Buffer.from(payload.audioBuffer || []);
  if (!bytes.length || bytes.length > 20 * 1024 * 1024)
    throw Error('Audio must be between 1 byte and 20 MB.');
  const extension = String(payload.filename || 'audio.wav')
    .split('.')
    .pop()
    .toLowerCase();
  if (!['wav', 'mp3', 'mp4', 'm4a', 'mpeg', 'mpga', 'webm', 'ogg'].includes(extension))
    throw Error('Unsupported audio file.');
  const mime = {
    wav: 'audio/wav',
    mp3: 'audio/mpeg',
    mp4: 'audio/mp4',
    m4a: 'audio/mp4',
    mpeg: 'audio/mpeg',
    mpga: 'audio/mpeg',
    webm: 'audio/webm',
    ogg: 'audio/ogg',
  }[extension];
  const diarize = payload.diarize === true,
    form = new FormData();
  form.set('file', new Blob([bytes], { type: mime }), 'audio.' + extension);
  form.set('model', diarize ? 'gpt-4o-transcribe-diarize' : 'gpt-transcribe');
  if (diarize) {
    form.set('response_format', 'diarized_json');
    form.set('chunking_strategy', 'auto');
  } else {
    if (payload.language) form.append('languages[]', String(payload.language).split('-')[0]);
    for (const s of (Array.isArray(payload.keywords) ? payload.keywords : []).slice(0, 100))
      if (typeof s === 'string' && s.length <= 80) form.append('keywords[]', s);
    if (payload.context) form.set('prompt', String(payload.context).slice(0, 1000));
  }
  const r = await fetcher('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(120000),
  });
  if (!r.ok)
    throw Error(
      r.status === 429
        ? 'OpenAI quota or rate limit reached. Your recording can be retried.'
        : r.status === 401
          ? 'Your OpenAI key needs attention.'
          : 'Transcription failed. Your recording can be retried.',
    );
  const d = await r.json();
  if (typeof d.text !== 'string') throw Error('Invalid transcription response.');
  return {
    text: d.text,
    segments: Array.isArray(d.segments)
      ? d.segments
          .filter(
            (s) =>
              typeof s.text === 'string' &&
              Number.isFinite(s.start) &&
              Number.isFinite(s.end) &&
              s.start >= 0 &&
              s.end >= s.start &&
              s.text.length <= 20000,
          )
          .map((s) => ({ text: s.text, start: s.start, end: s.end, speaker: String(s.speaker || 'Speaker') }))
      : [],
  };
}
export async function textAI(key, { input, instructions, model = 'gpt-4.1-mini' }, fetcher = fetch) {
  if (!key) throw Error('Add your OpenAI API key in Desktop settings.');
  if (
    typeof input !== 'string' ||
    input.length > 220000 ||
    typeof instructions !== 'string' ||
    instructions.length > 8000 ||
    !/^[a-zA-Z0-9._-]{1,80}$/.test(model)
  )
    throw Error('Invalid AI request.');
  const r = await fetcher('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input, instructions, store: false, max_output_tokens: 5000 }),
    signal: AbortSignal.timeout(90000),
  });
  if (!r.ok)
    throw Error(
      r.status === 429
        ? 'OpenAI quota or rate limit reached.'
        : r.status === 401
          ? 'Your OpenAI key needs attention.'
          : 'The AI request failed.',
    );
  const d = await r.json(),
    text = d.output
      ?.flatMap((x) => x.content || [])
      .filter((x) => x.type === 'output_text')
      .map((x) => x.text || '')
      .join('\n');
  if (!text) throw Error('No AI output was returned.');
  return text;
}
