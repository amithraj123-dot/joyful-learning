export type SpeechResult = { isFinal: boolean; [index: number]: { transcript: string } };
export type SpeechResultEvent = { resultIndex?: number; results: ArrayLike<SpeechResult> };
export type BrowserRecognition = {
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  lang: string;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

export type BrowserDictation = { start: () => void; stop: () => void; abort: () => void };
type Options = {
  createRecognition: () => BrowserRecognition;
  language: string;
  onStart: () => void;
  onTranscript: (text: string) => void;
  onComplete: (text: string, warning: string) => void;
  onError: (message: string) => void;
};
type Turn = {
  recognition: BrowserRecognition;
  final: string;
  interim: string;
  error: string;
};

const messages: Record<string, string> = {
  'not-allowed': 'Microphone access was denied. Allow the microphone in your browser settings.',
  'service-not-allowed': 'Your browser has disabled its speech service. Use another browser or cloud transcription.',
  'audio-capture': 'No microphone was found. Check your input device.',
  network: 'The browser speech service could not connect. Try cloud transcription or paste text.',
  'no-speech': 'No speech was detected. Try again.',
  'language-not-supported': 'This language is unavailable in the browser speech service.',
};

/**
 * One recognizer per utterance, one commit per recognizer.
 *
 * continuous=false specifies a single final recognition, so each result is a
 * replacement hypothesis for this turn, never another sentence to append.
 * Some providers expose a growing list of cumulative hypotheses even in this
 * mode; only its newest snapshot is used. No words are deduplicated by content.
 * A natural end starts the next turn; Finish, silence/errors and Cancel do not.
 * This also makes late callbacks from a previous turn harmless.
 * https://webaudio.github.io/web-speech-api/#dom-speechrecognition-continuous
 */
export function createBrowserDictation(options: Options): BrowserDictation {
  const completed: string[] = [];
  let current: Turn | null = null;
  let closed = false;
  let begun = false;
  let listening = false;
  let stopping = false;
  let endTimer: ReturnType<typeof setTimeout> | undefined;

  const clearEndTimer = () => {
    if (endTimer !== undefined) clearTimeout(endTimer);
    endTimer = undefined;
  };
  const detach = (recognition: BrowserRecognition) => {
    recognition.onstart = recognition.onresult = recognition.onerror = recognition.onend = null;
  };
  const abortQuietly = (recognition: BrowserRecognition) => {
    try { recognition.abort(); } catch { /* Already ended. */ }
  };
  const finish = (warning = '') => {
    if (closed) return;
    closed = true;
    clearEndTimer();
    if (current) {
      detach(current.recognition);
      abortQuietly(current.recognition);
      current = null;
    }
    const text = completed.join(' ').trim();
    if (text) options.onComplete(text, warning);
    else options.onError(warning || 'No speech was captured. Please try again.');
  };
  const isCurrent = (turn: Turn) => !closed && current === turn;

  const endTurn = (turn: Turn, forced = false) => {
    if (!isCurrent(turn)) return;
    clearEndTimer();
    // Invalidate before aborting: some engines dispatch end synchronously.
    current = null;
    detach(turn.recognition);
    if (forced) abortQuietly(turn.recognition);
    if (turn.final.trim()) completed.push(turn.final.trim());
    if (stopping || turn.error || !turn.final.trim()) {
      finish(turn.error || (turn.interim ? 'The browser stopped before confirming the last words. Please dictate those words again.' : ''));
      return;
    }
    // Restart only after the previous microphone session has ended, keeping
    // complete utterances distinct even when the speaker repeats a sentence.
    beginTurn();
  };
  const waitForEnd = (turn: Turn, warning: string) => {
    clearEndTimer();
    endTimer = setTimeout(() => {
      if (!isCurrent(turn)) return;
      stopping = true;
      turn.error ||= warning;
      endTurn(turn, true);
    }, 5000);
  };
  const beginTurn = () => {
    if (closed || stopping) return;
    let recognition: BrowserRecognition;
    try { recognition = options.createRecognition(); }
    catch { finish('Could not start browser dictation. Please retry.'); return; }
    const turn: Turn = { recognition, final: '', interim: '', error: '' };
    current = turn;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.lang = options.language;
    recognition.onstart = () => {
      if (!isCurrent(turn)) return;
      if (!listening) { listening = true; options.onStart(); }
    };
    recognition.onresult = event => {
      if (!isCurrent(turn)) return;
      // The result list belongs to this single utterance. Never concatenate
      // cumulative snapshots or copy previous interim words into final text.
      const latest = event.results[event.results.length - 1];
      const text = latest?.[0]?.transcript?.trim() || '';
      turn.interim = latest?.isFinal ? '' : text;
      if (latest?.isFinal) turn.final = text;
      options.onTranscript([...completed, turn.interim || turn.final].filter(Boolean).join(' '));
    };
    recognition.onerror = event => {
      if (!isCurrent(turn)) return;
      stopping = true;
      // Silence after an already completed thought is a normal finish.
      turn.error = event.error === 'no-speech' && completed.length
        ? '' : messages[event.error] || 'Browser dictation stopped. Please try again.';
      waitForEnd(turn, turn.error || 'The browser speech service did not finish normally.');
      abortQuietly(recognition);
    };
    recognition.onend = () => endTurn(turn);
    try { recognition.start(); }
    catch { finish('Could not start browser dictation. Please retry.'); }
  };

  return {
    start() {
      if (begun || closed) return;
      begun = true;
      beginTurn();
    },
    stop() {
      if (closed || stopping) return;
      stopping = true;
      const turn = current;
      if (!turn) { finish(); return; }
      // stop() can deliver one last corrected final result before end.
      waitForEnd(turn, 'The browser took too long to finish. Please check the completed text.');
      try { turn.recognition.stop(); }
      catch { endTurn(turn, true); }
    },
    abort() {
      if (closed) return;
      closed = true;
      clearEndTimer();
      const turn = current;
      current = null;
      completed.length = 0;
      if (turn) { detach(turn.recognition); abortQuietly(turn.recognition); }
    },
  };
}
