'use client';
import { useEffect, useRef, useState } from 'react';
import { encodeWav } from '../lib/workspace-core';
import { isDesktop, runtime } from '../lib/desktop-runtime';
import { newId } from '../lib/scribe-core';
import { pcmProcessorSource } from '../lib/pcm-processor';
type Phase = 'idle' | 'requesting' | 'recording' | 'paused' | 'stopping' | 'error';
type Options = {
  noteId: string;
  systemAudio: boolean;
  deviceId: string;
  language: string;
  keywords: string[];
  offset: number;
};
export function useMeetingRecorder(onEnd: (noteId: string, duration: number) => Promise<void>) {
  const [phase, setPhase] = useState<Phase>('idle'),
    [elapsed, setElapsed] = useState(0),
    [level, setLevel] = useState(0),
    [error, setError] = useState('');
  const phaseRef = useRef<Phase>('idle'),
    seq = useRef(0),
    streams = useRef<MediaStream[]>([]),
    audio = useRef<AudioContext | null>(null),
    node = useRef<AudioWorkletNode | null>(null),
    options = useRef<Options | null>(null),
    frames = useRef<Float32Array[]>([]),
    samples = useRef(0),
    total = useRef(0),
    silence = useRef(0),
    saveChain = useRef(Promise.resolve()),
    end = useRef(onEnd),
    failRef = useRef<(s: string) => void>(() => {}),
    lastRate = useRef(24000),
    drainAck = useRef<(() => void) | null>(null),
    draining = useRef(false);
  const [recovery, setRecovery] = useState<{ buffer: ArrayBuffer; name: string }[]>([]);
  end.current = onEnd;
  const transition = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
    void runtime('recording.state', { kind: 'meeting', state: p, noteId: options.current?.noteId }).catch(
      () => {},
    );
  };
  const release = () => {
    streams.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    streams.current = [];
    node.current?.disconnect();
    node.current = null;
    void audio.current?.close().catch(() => {});
    audio.current = null;
    setLevel(0);
  };
  const flush = () => {
    const count = samples.current,
      opt = options.current;
    if (!count || !opt) return;
    const joined = new Float32Array(count);
    let at = 0;
    for (const f of frames.current) {
      joined.set(f, at);
      at += f.length;
    }
    frames.current = [];
    samples.current = 0;
    silence.current = 0;
    const rate = lastRate.current,
      start = opt.offset + total.current / rate;
    total.current += count;
    const item = {
      id: newId(),
      noteId: opt.noteId,
      start,
      end: opt.offset + total.current / rate,
      audioBuffer: encodeWav(joined, rate),
      language: opt.language,
      keywords: opt.keywords,
    };
    saveChain.current = saveChain.current
      .then(async () => {
        await runtime('queue.add', item);
      })
      .catch((e) => {
        // Keep at most the latest 20 unsaved chunks (about 20 MB) in memory.
        setRecovery((old) =>
          [...old, { buffer: item.audioBuffer, name: 'Aeka-Scribe-unsaved-' + item.id + '.wav' }].slice(-20),
        );
        failRef.current(e instanceof Error ? e.message : 'Audio could not be saved.');
        throw e;
      });
    void saveChain.current.catch(() => {});
  };
  const drain = (pause = false) =>
    new Promise<void>((resolve, reject) => {
      if (!node.current) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        drainAck.current = null;
        reject(Error('Audio stopped responding. Previously saved segments are kept.'));
      }, 1200);
      drainAck.current = () => {
        clearTimeout(timer);
        drainAck.current = null;
        resolve();
      };
      node.current.port.postMessage({ type: 'flush', id: 1, pause });
    });
  const finish = async () => {
    if (!['recording', 'paused', 'requesting'].includes(phaseRef.current) || draining.current) return;
    draining.current = true;
    transition('stopping');
    try {
      await drain(true);
      seq.current++;
      flush();
      release();
      await saveChain.current;
      if (options.current)
        await end.current(options.current.noteId, options.current.offset + total.current / lastRate.current);
      transition('idle');
    } catch (e) {
      seq.current++;
      flush();
      release();
      setError(e instanceof Error ? e.message : 'The last audio segment could not be saved.');
      transition('error');
    } finally {
      draining.current = false;
    }
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;
  failRef.current = (message) => {
    seq.current++;
    release();
    setError(message);
    transition('error');
  };
  useEffect(
    () => () => {
      seq.current++;
      release();
      void runtime('recording.state', { kind: 'meeting', state: 'idle' }).catch(() => {});
    },
    [],
  );
  const start = async (opt: Options) => {
    if (!['idle', 'error'].includes(phaseRef.current)) return;
    const id = ++seq.current;
    options.current = opt;
    frames.current = [];
    samples.current = 0;
    total.current = 0;
    silence.current = 0;
    saveChain.current = Promise.resolve();
    setElapsed(opt.offset);
    setError('');
    transition('requesting');
    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(opt.deviceId ? { deviceId: { exact: opt.deviceId } } : {}),
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
        },
      });
      if (id !== seq.current) {
        mic.getTracks().forEach((t) => t.stop());
        return;
      }
      streams.current = [mic];
      if (opt.systemAudio) {
        await runtime('recording.state', { kind: 'meeting', state: 'requesting' });
        const display = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
          ...(isDesktop() ? {} : { systemAudio: 'include' }),
        } as DisplayMediaStreamOptions);
        if (id !== seq.current) {
          display.getTracks().forEach((t) => t.stop());
          release();
          return;
        }
        streams.current.push(display);
        if (!display.getAudioTracks().length)
          throw Error(
            'No system audio was shared. Enable “Share audio” or choose microphone only.',
          ); /* Keep the display track alive: stopping it can also stop loopback audio. No video frames are read or saved. */
      }
      const ac = new AudioContext({ sampleRate: 24000 });
      audio.current = ac;
      lastRate.current = ac.sampleRate;
      const url = URL.createObjectURL(new Blob([pcmProcessorSource], { type: 'text/javascript' }));
      try {
        await ac.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      if (id !== seq.current) {
        release();
        return;
      }
      const processor = new AudioWorkletNode(ac, 'aeka-pcm', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      node.current = processor;
      const mixer = ac.createGain();
      mixer.gain.value = opt.systemAudio ? 0.6 : 1;
      for (const stream of streams.current) {
        const audioOnly = new MediaStream(stream.getAudioTracks());
        ac.createMediaStreamSource(audioOnly).connect(mixer);
      }
      mixer.connect(processor);
      const mute = ac.createGain();
      mute.gain.value = 0;
      processor.connect(mute).connect(ac.destination);
      processor.port.onmessage = (e) => {
        if (e.data.flushed) {
          drainAck.current?.();
          return;
        }
        if (id !== seq.current || !['recording', 'stopping'].includes(phaseRef.current)) return;
        const f = e.data.samples as Float32Array;
        if (!f?.length) return;
        frames.current.push(f);
        samples.current += f.length;
        let energy = 0;
        for (const x of f) energy += x * x;
        const rms = Math.sqrt(energy / f.length);
        setLevel(Math.min(1, rms * 7));
        silence.current = rms < 0.008 ? silence.current + f.length : 0;
        setElapsed(opt.offset + (total.current + samples.current) / ac.sampleRate);
        if (
          samples.current >= ac.sampleRate * 20 ||
          (samples.current > ac.sampleRate * 8 && silence.current > ac.sampleRate * 0.7)
        )
          flush();
        if ((total.current + samples.current) / ac.sampleRate >= 4 * 3600) void finishRef.current();
      };
      for (const stream of streams.current)
        for (const track of stream.getAudioTracks())
          track.addEventListener('ended', () => {
            if (id === seq.current) {
              setError('An audio device disconnected. Captured audio has been kept.');
              void finishRef.current();
            }
          });
      await ac.resume();
      transition('recording');
      return true;
    } catch (e) {
      if (id !== seq.current) return;
      release();
      setError(e instanceof Error ? e.message : 'Could not start meeting audio.');
      transition('error');
      return false;
    }
  };
  const pause = async () => {
    if (draining.current) return;
    if (phaseRef.current === 'recording') {
      draining.current = true;
      try {
        await drain(true);
        flush();
        transition('paused');
        setLevel(0);
      } catch (e) {
        failRef.current(e instanceof Error ? e.message : 'Could not pause recording.');
      } finally {
        draining.current = false;
      }
    } else if (phaseRef.current === 'paused') {
      node.current?.port.postMessage({ type: 'resume' });
      transition('recording');
    }
  };
  const saveRecovery = () => {
    for (const item of recovery) {
      const url = URL.createObjectURL(new Blob([item.buffer], { type: 'audio/wav' })),
        a = document.createElement('a');
      a.href = url;
      a.download = item.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  };
  return {
    currentNoteId: () => options.current?.noteId || '',
    phase,
    elapsed,
    level,
    error,
    start,
    pause,
    finish,
    saveRecovery,
    recoveryCount: recovery.length,
    active: ['requesting', 'recording', 'paused', 'stopping'].includes(phase),
    noteId: options.current?.noteId || '',
  };
}
