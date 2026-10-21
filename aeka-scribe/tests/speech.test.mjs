import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserDictation } from '../lib/browser-dictation.ts';

const hypothesis = (transcript, isFinal = false) => ({ isFinal, 0: { transcript } });
const growingSentence = [
  'hello', 'hello', 'hello', 'hello', 'hello', 'hello how',
  'hello how is', 'hello how is the', 'hello how is the weather',
  'hello how is the weather today', 'hello how is the weather today',
  'hello how is the weather today', 'hello how is the weather today',
  'hello how is the weather today are', 'hello how is the weather today are you doing',
];

// The same event handlers used by the production recorder run against this
// controllable browser boundary. No text cleanup or test-only production path.
function harness(overrides = {}) {
  const instances = [], updates = [], completions = [], errors = [];
  let starts = 0;
  const createRecognition = () => {
    const r = {
      onstart: null, onresult: null, onend: null, onerror: null,
      startCount: 0, stopCount: 0, abortCount: 0,
      start() { this.startCount++; this.onstart?.(); },
      stop() { this.stopCount++; },
      abort() { this.abortCount++; },
      result(text, final = false) { this.onresult?.({ resultIndex: 0, results: [hypothesis(text, final)] }); },
      end() { this.onend?.(); },
      ...overrides,
    };
    instances.push(r);
    return r;
  };
  const session = createBrowserDictation({
    createRecognition, language: 'en-IN', onStart: () => starts++,
    onTranscript: text => updates.push(text),
    onComplete: (text, warning) => completions.push({ text, warning }),
    onError: message => errors.push(message),
  });
  return { session, instances, updates, completions, errors, get starts() { return starts; } };
}

test('reported growing phrase replaces interim text and produces exactly one final sentence', () => {
  const h = harness(); h.session.start();
  const r = h.instances[0];
  for (const text of growingSentence) {
    r.result(text);
    assert.equal(h.updates.at(-1), text);
    assert.equal(h.completions.length, 0);
  }
  h.session.stop();
  r.result(growingSentence.at(-1), true); r.end();
  assert.deepEqual(h.completions, [{ text: growingSentence.at(-1), warning: '' }]);
  assert.equal(h.instances.length, 1);
});

test('provider cumulative final-result list reproducing the report is not concatenated', () => {
  const h = harness(); h.session.start();
  const r = h.instances[0];
  // Single-utterance mode gives these snapshots one identity. Older code
  // joined this list into the exact repeated-prefix string reported by Amith.
  assert.equal(r.continuous, false);
  assert.equal(r.lang, 'en-IN');
  assert.equal(r.maxAlternatives, 1);
  for (let i = 1; i <= growingSentence.length; i++) {
    const event = { resultIndex: i - 1, results: growingSentence.slice(0, i).map(text => hypothesis(text, true)) };
    r.onresult(event); r.onresult(event); // Duplicate dispatch is idempotent.
    assert.equal(h.updates.at(-1), growingSentence[i - 1]);
  }
  h.session.stop(); r.end();
  assert.deepEqual(h.completions, [{ text: 'hello how is the weather today are you doing', warning: '' }]);
});

test('a cumulative list of interim hypotheses contributes only its final snapshot', () => {
  const h = harness(); h.session.start(); const r = h.instances[0];
  r.onresult({ resultIndex: 0, results: growingSentence.map(text => hypothesis(text)) });
  assert.equal(h.updates.at(-1), growingSentence.at(-1));
  assert.equal(h.completions.length, 0);
  r.onresult({ resultIndex: 0, results: [hypothesis(growingSentence.at(-1), true)] });
  h.session.stop(); r.end();
  assert.equal(h.completions[0].text, growingSentence.at(-1));
});

test('revised hypotheses and a disappearing interim result never leave stale words', () => {
  const h = harness(); h.session.start(); const r = h.instances[0];
  r.result('send fifteen lakh'); r.result('send twelve lakh');
  assert.equal(h.updates.at(-1), 'send twelve lakh');
  r.onresult({ resultIndex: 0, results: [] });
  assert.equal(h.updates.at(-1), '');
  r.result('do not send 12,50,000', true);
  h.session.stop(); r.end();
  assert.equal(h.completions[0].text, 'do not send 12,50,000');
});

test('multiple utterances keep distinct content and start the session clock only once', () => {
  const h = harness(); h.session.start(); h.session.start();
  const first = h.instances[0];
  first.result('Hello, how is the weather today?', true); first.end();
  assert.equal(h.instances.length, 2);
  assert.equal(h.completions.length, 0);
  const second = h.instances[1]; second.result('Are you doing well?');
  assert.equal(h.updates.at(-1), 'Hello, how is the weather today? Are you doing well?');
  h.session.stop(); second.result('Are you doing well?', true); second.end();
  assert.equal(h.starts, 1);
  assert.equal(h.completions[0].text, 'Hello, how is the weather today? Are you doing well?');
});

test('intentional repeated words, numbers, Indic text and repeated sentences survive', () => {
  const h = harness(); h.session.start();
  const text = 'No, no, no. Very very good. 100 100. ಹೌದು ಹೌದು. Hello again.';
  h.instances[0].result(text, true); h.instances[0].end();
  h.instances[1].result(text, true); h.session.stop(); h.instances[1].end();
  assert.equal(h.completions[0].text, `${text} ${text}`);
});

test('Finish accepts the final correction sent after stop and never restarts', () => {
  const h = harness(); h.session.start(); const r = h.instances[0];
  r.result('the amount is fifteen');
  h.session.stop(); h.session.stop();
  assert.equal(r.stopCount, 1);
  r.result('the amount is twelve', true); r.end();
  assert.equal(h.completions[0].text, 'the amount is twelve');
  assert.equal(h.instances.length, 1);
});

test('duplicate end and queued result callbacks from older utterances are ignored', () => {
  const h = harness(); h.session.start(); const first = h.instances[0];
  const staleResult = first.onresult, staleEnd = first.onend, staleStart = first.onstart;
  first.result('first sentence', true); first.end();
  const count = h.updates.length;
  staleResult({ resultIndex: 0, results: [hypothesis('WRONG', true)] });
  staleEnd(); staleStart();
  assert.equal(h.updates.length, count);
  assert.equal(h.instances.length, 2);
  h.session.stop(); h.instances[1].end();
  staleEnd();
  assert.deepEqual(h.completions, [{ text: 'first sentence', warning: '' }]);
});

test('Cancel suppresses queued events, completion and automatic restart', () => {
  const h = harness(); h.session.start(); const r = h.instances[0];
  r.result('cancel this');
  const result = r.onresult, end = r.onend, error = r.onerror;
  h.session.abort();
  result({ resultIndex: 0, results: [hypothesis('cancel this', true)] }); end(); error({ error: 'network' });
  h.session.start(); h.session.stop();
  assert.equal(r.abortCount, 1);
  assert.equal(h.instances.length, 1);
  assert.equal(h.updates.length, 1);
  assert.deepEqual(h.completions, []); assert.deepEqual(h.errors, []);
});

test('a new dictation starts empty after a cancelled recording', () => {
  const a = harness(); a.session.start(); a.instances[0].result('old words', true); a.session.abort();
  const b = harness(); b.session.start(); b.instances[0].result('new words', true); b.session.stop(); b.instances[0].end();
  assert.equal(b.completions[0].text, 'new words'); assert.equal(a.completions.length, 0);
});

test('natural silence finishes earlier utterances without endlessly restarting', () => {
  const h = harness(); h.session.start(); h.instances[0].result('a complete thought', true); h.instances[0].end();
  const second = h.instances[1]; second.onerror({ error: 'no-speech' }); second.end();
  assert.deepEqual(h.completions, [{ text: 'a complete thought', warning: '' }]);
  assert.equal(h.instances.length, 2);
});

test('permission denial gives a useful error and never restarts', () => {
  const h = harness(); h.session.start(); const r = h.instances[0];
  r.onerror({ error: 'not-allowed' }); r.end();
  assert.equal(h.completions.length, 0);
  assert.match(h.errors[0], /Microphone access was denied/);
  assert.equal(h.instances.length, 1);
});

test('network errors keep confirmed text once and report the interruption', () => {
  const h = harness(); h.session.start(); const r = h.instances[0];
  r.result('keep these words', true); r.onerror({ error: 'network' }); r.end();
  assert.equal(h.completions.length, 1);
  assert.equal(h.completions[0].text, 'keep these words');
  assert.match(h.completions[0].warning, /could not connect/);
});

test('a provisional result is never silently saved as a confirmed transcript', () => {
  const h = harness(); h.session.start(); const r = h.instances[0];
  r.result('unconfirmed wording'); h.session.stop(); r.end();
  assert.deepEqual(h.completions, []);
  assert.match(h.errors[0], /before confirming the last words/);
});

test('stop timeout releases the microphone and ignores a later end event', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(); h.session.start(); const r = h.instances[0], end = r.onend;
  r.result('confirmed words', true); h.session.stop(); t.mock.timers.tick(5000);
  assert.equal(r.abortCount, 1);
  assert.equal(h.completions.length, 1);
  assert.equal(h.completions[0].text, 'confirmed words');
  assert.match(h.completions[0].warning, /too long/);
  end(); assert.equal(h.completions.length, 1);
});

test('start failure releases resources and reports one error', () => {
  const h = harness({ start() { throw new Error('start failed'); } }); h.session.start();
  assert.equal(h.instances[0].abortCount, 1);
  assert.equal(h.errors.length, 1); assert.match(h.errors[0], /Could not start/);
  assert.equal(h.completions.length, 0);
});

test('Cancel clears a pending finish watchdog', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(); h.session.start(); h.instances[0].result('discard', true);
  h.session.stop(); h.session.abort(); t.mock.timers.tick(6000);
  assert.deepEqual(h.completions, []); assert.deepEqual(h.errors, []);
});
