import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
// Read the PCM WAV container rather than treating arbitrary bytes as samples.
export function mono16kWav(input) {
  const b = Buffer.from(input);
  if (b.length < 44 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE')
    throw Error('Local speech recognition needs PCM WAV audio.');
  let format, data;
  for (let p = 12; p + 8 <= b.length;) {
    const type = b.toString('ascii', p, p + 4),
      size = b.readUInt32LE(p + 4),
      start = p + 8;
    if (start + size > b.length) throw Error('Incomplete WAV audio.');
    if (type === 'fmt ' && size >= 16)
      format = {
        codec: b.readUInt16LE(start),
        channels: b.readUInt16LE(start + 2),
        rate: b.readUInt32LE(start + 4),
        bits: b.readUInt16LE(start + 14),
      };
    if (type === 'data') data = b.subarray(start, start + size);
    p = start + size + (size % 2);
  }
  if (
    !format ||
    !data ||
    format.codec !== 1 ||
    format.bits !== 16 ||
    format.channels < 1 ||
    format.channels > 2 ||
    format.rate < 8000 ||
    format.rate > 192000
  )
    throw Error('Use 16-bit PCM WAV audio.');
  const frames = Math.floor(data.length / (2 * format.channels)),
    length = Math.floor((frames * 16000) / format.rate);
  if (length > 16000 * 300) throw Error('Local audio is limited to five minutes per request.');
  const out = Buffer.alloc(44 + length * 2);
  out.write('RIFF', 0);
  out.writeUInt32LE(out.length - 8, 4);
  out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(16000, 24);
  out.writeUInt32LE(32000, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(length * 2, 40);
  for (let i = 0; i < length; i++) {
    const from = Math.floor((i * format.rate) / 16000),
      to = Math.min(frames, Math.max(from + 1, Math.floor(((i + 1) * format.rate) / 16000)));
    let sum = 0;
    for (let j = from; j < to; j++)
      for (let c = 0; c < format.channels; c++) sum += data.readInt16LE((j * format.channels + c) * 2);
    out.writeInt16LE(Math.round(sum / ((to - from) * format.channels)), 44 + i * 2);
  }
  return out;
}
export function createLocalASR({ vault, tempDir, permitted = () => true, spawnProcess = spawn }) {
  let queue = Promise.resolve();
  const transcribe = (payload) => {
    const result = queue.then(async () => {
      if (!permitted()) throw Error('Local speech recognition is disabled by managed policy.');
      const config = await vault.read('local-asr', {});
      if (!config.executable || !config.model)
        throw Error('Choose whisper-cli.exe and a Whisper model in Desktop settings.');
      const wave = mono16kWav(payload.audioBuffer);
      const folder = await fs.mkdtemp(path.join(tempDir, 'flow-asr-'));
      try {
        const file = path.join(folder, 'audio.wav'),
          output = path.join(folder, 'result');
        await fs.writeFile(file, wave, { mode: 0o600 });
        const language = /^[a-z]{2,3}$/.test(payload.language) ? payload.language : 'auto';
        await new Promise((resolve, reject) => {
          const child = spawnProcess(
            config.executable,
            ['-m', config.model, '-f', file, '-otxt', '-of', output, '-l', language, '-np', '-nt'],
            { windowsHide: true, shell: false, stdio: 'ignore' },
          );
          const timer = setTimeout(() => {
            child.kill();
            reject(Error('Local transcription timed out. Try a smaller Whisper model.'));
          }, 180000);
          child.on('error', () => {
            clearTimeout(timer);
            reject(Error('Whisper could not start. Check the executable and its companion DLLs.'));
          });
          child.on('exit', (code) => {
            clearTimeout(timer);
            code === 0
              ? resolve()
              : reject(
                  Error(
                    'Whisper could not transcribe this recording. Check its model and Windows dependencies.',
                  ),
                );
          });
        });
        const stat = await fs.stat(output + '.txt');
        if (stat.size > 1000000) throw Error('Local transcript is too large.');
        return { text: (await fs.readFile(output + '.txt', 'utf8')).trim(), segments: [] };
      } finally {
        await fs.rm(folder, { recursive: true, force: true });
      }
    });
    queue = result.catch(() => {});
    return result;
  };
  return {
    transcribe,
    status: async () => {
      const c = await vault.read('local-asr', {});
      return {
        configured: !!(c.executable && c.model),
        executable: c.executable || '',
        model: c.model || '',
      };
    },
    configure: async (executable, model) => {
      if (!permitted()) throw Error('Local speech recognition is disabled.');
      if (
        path.basename(executable).toLowerCase() !== 'whisper-cli.exe' ||
        !path.isAbsolute(executable) ||
        !path.isAbsolute(model) ||
        !model.toLowerCase().endsWith('.bin')
      )
        throw Error('Choose whisper-cli.exe and its ggml .bin model.');
      const [a, b] = await Promise.all([fs.stat(executable), fs.stat(model)]);
      if (!a.isFile() || !b.isFile() || b.size < 1000000 || b.size > 4 * 1024 ** 3)
        throw Error('Invalid Whisper executable or model.');
      await vault.write('local-asr', { executable, model });
      return { configured: true };
    },
  };
}
