'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type Settings, type Term } from '../lib/flow-core';
import {
  createBrowserDictation,
  type BrowserDictation,
  type BrowserRecognition,
} from '../lib/browser-dictation';
import { transcribeAudio } from '../lib/desktop-runtime';
type State = 'idle' | 'requesting' | 'recording' | 'stopping' | 'transcribing' | 'error';
type Result = { text: string; duration: number; engine: string };
type SpeechWindow = Window & {
  SpeechRecognition?: new () => BrowserRecognition;
  webkitSpeechRecognition?: new () => BrowserRecognition;
};
export function useRecorder(onComplete: (result: Result) => void) {
  const [state, setState] = useState<State>('idle');
  const stateRef = useRef<State>('idle');
  const [interim, setInterim] = useState('');
  const [error, setError] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [canRetry, setCanRetry] = useState(false);
  const [supported, setSupported] = useState(false);
  const sequence = useRef(0),
    started = useRef(0),
    recognition = useRef<BrowserDictation | null>(null),
    media = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    context = useRef<AudioContext | null>(null),
    controller = useRef<AbortController | null>(null),
    timer = useRef<ReturnType<typeof setInterval> | null>(null),
    failed = useRef<{ file: File; settings: Settings; terms: Term[]; duration: number } | null>(null),
    complete = useRef(onComplete);
  complete.current = onComplete;
  const transition = useCallback((s: State) => {
    stateRef.current = s;
    setState(s);
  }, []);
  const release = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    void context.current?.close().catch(() => {});
    context.current = null;
    setLevel(0);
  }, []);
  const cancel = useCallback(() => {
    sequence.current++;
    controller.current?.abort();
    controller.current = null;
    recognition.current?.abort();
    recognition.current = null;
    if (media.current?.state === 'recording') media.current.stop();
    media.current = null;
    release();
    failed.current = null;
    setCanRetry(false);
    setInterim('');
    setError('');
    transition('idle');
  }, [release, transition]);
  useEffect(() => {
    const w = window as SpeechWindow;
    setSupported(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
    return () => {
      sequence.current++;
      controller.current?.abort();
      recognition.current?.abort();
      if (media.current?.state === 'recording') media.current.stop();
      release();
    };
  }, [release]);
  const upload = useCallback(
    async (file: File, settings: Settings, terms: Term[], duration: number, id: number) => {
      if (id !== sequence.current) return;
      transition('transcribing');
      setError('');
      setCanRetry(false);
      failed.current = { file, settings, terms, duration };
      const abort = new AbortController();
      controller.current = abort;
      try {
        const data = await transcribeAudio(
          file,
          settings.language,
          settings.context,
          settings.useVocabulary ? terms.map((t) => t.replacement) : [],
          abort.signal,
        );
        if (id !== sequence.current) return;
        if (!data.text?.trim())
          throw new Error('No speech was detected. Try speaking closer to the microphone.');
        failed.current = null;
        setCanRetry(false);
        transition('idle');
        setInterim('');
        complete.current({ text: data.text, duration, engine: data.engine || 'gpt-transcribe' });
      } catch (e) {
        if (id === sequence.current) {
          setError(e instanceof Error ? e.message : 'Transcription failed.');
          setCanRetry(true);
          transition('error');
        }
      } finally {
        if (id === sequence.current) controller.current = null;
      }
    },
    [transition],
  );
  const stop = useCallback(() => {
    if (stateRef.current === 'requesting') {
      cancel();
      return;
    }
    if (stateRef.current !== 'recording') return;
    transition('stopping');
    if (recognition.current) {
      recognition.current.stop();
      return;
    }
    if (media.current?.state === 'recording') media.current.stop();
  }, [cancel, transition]);
  const stopRef = useRef(stop);
  stopRef.current = stop;
  const clock = useCallback(() => {
    timer.current = setInterval(() => {
      const secs = (Date.now() - started.current) / 1000;
      setElapsed(secs);
      if (secs >= 300) stopRef.current();
    }, 150);
  }, []);
  const start = useCallback(
    async (settings: Settings, terms: Term[]) => {
      if (!['idle', 'error'].includes(stateRef.current)) return;
      cancel();
      const id = sequence.current;
      setElapsed(0);
      setInterim('');
      setError('');
      transition('requesting');
      if (settings.engine === 'browser') {
        const w = window as SpeechWindow;
        const Speech = w.SpeechRecognition || w.webkitSpeechRecognition;
        if (!Speech) {
          setError(
            'Browser dictation is unavailable here. Try Chrome or Edge, use cloud transcription, or paste text.',
          );
          transition('error');
          return;
        }
        const session = createBrowserDictation({
          createRecognition: () => new Speech(),
          language: settings.language,
          onStart: () => {
            if (id !== sequence.current) return;
            started.current = Date.now();
            transition('recording');
            clock();
          },
          onTranscript: (text) => {
            if (id === sequence.current) setInterim(text);
          },
          onComplete: (text, warning) => {
            if (id !== sequence.current) return;
            release();
            recognition.current = null;
            setInterim('');
            transition('idle');
            complete.current({
              text,
              duration: (Date.now() - started.current) / 1000,
              engine: 'Browser speech',
            });
            if (warning) setError(warning + ' The completed text was kept.');
          },
          onError: (message) => {
            if (id !== sequence.current) return;
            release();
            recognition.current = null;
            setInterim('');
            setError(message);
            transition('error');
          },
        });
        recognition.current = session;
        session.start();
        return;
      }
      try {
        const input = await navigator.mediaDevices.getUserMedia({
          audio: {
            ...(settings.deviceId ? { deviceId: { exact: settings.deviceId } } : {}),
            echoCancellation: true,
            noiseSuppression: true,
            channelCount: 1,
          },
        });
        if (id !== sequence.current) {
          input.getTracks().forEach((t) => t.stop());
          return;
        }
        stream.current = input;
        const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) =>
          MediaRecorder.isTypeSupported(t),
        );
        const recorder = new MediaRecorder(input, mime ? { mimeType: mime } : undefined);
        media.current = recorder;
        const chunks: Blob[] = [];
        let bytes = 0;
        recorder.ondataavailable = (e) => {
          if (id !== sequence.current) return;
          if (e.data.size) {
            chunks.push(e.data);
            bytes += e.data.size;
            if (bytes >= 19 * 1024 * 1024) stopRef.current();
          }
        };
        recorder.onerror = () => {
          if (id === sequence.current) {
            cancel();
            setError('Recording was interrupted. Please try again.');
            transition('error');
          }
        };
        recorder.onstop = () => {
          if (id !== sequence.current) return;
          const duration = (Date.now() - started.current) / 1000;
          const blob = new Blob(chunks, { type: recorder.mimeType });
          release();
          media.current = null;
          const ext = recorder.mimeType.includes('mp4') ? 'm4a' : 'webm';
          void upload(
            new File([blob], `dictation.${ext}`, { type: blob.type }),
            settings,
            terms,
            duration,
            id,
          );
        };
        input.getAudioTracks().forEach((t) =>
          t.addEventListener('ended', () => {
            if (id === sequence.current) stopRef.current();
          }),
        );
        started.current = Date.now();
        recorder.start(250);
        transition('recording');
        clock();
        try {
          const ac = new AudioContext();
          context.current = ac;
          const analyser = ac.createAnalyser();
          analyser.fftSize = 256;
          ac.createMediaStreamSource(input).connect(analyser);
          const data = new Uint8Array(analyser.frequencyBinCount);
          const meter = () => {
            if (id !== sequence.current || !context.current) return;
            analyser.getByteTimeDomainData(data);
            const rms = Math.sqrt(data.reduce((a, b) => a + ((b - 128) / 128) ** 2, 0) / data.length);
            setLevel(Math.min(1, rms * 8));
            requestAnimationFrame(meter);
          };
          meter();
        } catch {
          /* Recording remains usable without the visual meter. */
        }
      } catch (e) {
        if (id === sequence.current) {
          release();
          setError(
            e instanceof DOMException && e.name === 'NotAllowedError'
              ? 'Microphone access was denied. Allow it in your browser settings.'
              : e instanceof DOMException && e.name === 'NotFoundError'
                ? 'No microphone was found. Connect an input device.'
                : 'Could not start the microphone. Check your selected device and browser permissions.',
          );
          transition('error');
        }
      }
    },
    [cancel, clock, release, transition, upload],
  );
  const importAudio = useCallback(
    (file: File, settings: Settings, terms: Term[]) => {
      cancel();
      setElapsed(0);
      if (file.size > 20 * 1024 * 1024) {
        setError('Choose an audio file smaller than 20 MB.');
        transition('error');
        return;
      }
      void upload(file, settings, terms, 0, sequence.current);
    },
    [cancel, transition, upload],
  );
  const retry = useCallback(() => {
    if (failed.current) {
      const f = failed.current;
      sequence.current++;
      void upload(f.file, f.settings, f.terms, f.duration, sequence.current);
    }
  }, [upload]);
  const downloadRecording = useCallback(() => {
    if (!failed.current) return;
    const url = URL.createObjectURL(failed.current.file);
    const a = document.createElement('a');
    a.href = url;
    a.download = failed.current.file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);
  return {
    state,
    interim,
    error,
    elapsed,
    level,
    canRetry,
    supported,
    start,
    stop,
    cancel,
    retry,
    importAudio,
    downloadRecording,
    busy: !['idle', 'error'].includes(state),
  };
}
