import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { windowsBridge } from '../services/windows.mjs';

function fakeSpawn() {
  const spawned = [];
  const spawnProcess = (exe, args) => {
    const proc = new EventEmitter();
    proc.stdout = new PassThrough();
    proc.stderr = new PassThrough();
    proc.stdin = new PassThrough();
    proc.args = args;
    proc.kill = () => proc.emit('exit', 0);
    proc.reply = (raw) => proc.stdout.write(raw);
    proc.stdin.on('data', (d) => (proc.last = JSON.parse(String(d))));
    spawned.push(proc);
    return proc;
  };
  return { spawned, spawnProcess };
}

test('Windows helper runs with a process-scoped execution policy and decodes split UTF-8', async () => {
  const { spawned, spawnProcess } = fakeSpawn();
  const bridge = windowsBridge('bridge.ps1', { spawnProcess, platform: 'win32' });
  assert.deepEqual(spawned[0].args.slice(0, 4), [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
  ]);
  const call = bridge.call('selection');
  await new Promise((r) => setImmediate(r));
  const line = Buffer.from(JSON.stringify({ id: spawned[0].last.id, result: { text: 'ಕನ್ನಡ ₹' } }) + '\n');
  const cut = line.indexOf(Buffer.from('ನ')) + 1; // split inside a multi-byte character
  spawned[0].reply(line.subarray(0, cut));
  spawned[0].reply(line.subarray(cut));
  assert.deepEqual(await call, { text: 'ಕನ್ನಡ ₹' });
  bridge.close();
});

test('Windows helper restarts after it exits', async () => {
  const { spawned, spawnProcess } = fakeSpawn();
  const bridge = windowsBridge('bridge.ps1', { spawnProcess, platform: 'win32' });
  const lost = bridge.call('focus');
  await new Promise((r) => setImmediate(r));
  spawned[0].emit('exit', 1);
  await assert.rejects(lost, /unavailable/);
  const next = bridge.call('focus'); // a call after a crash starts a fresh helper immediately
  assert.equal(spawned.length, 2);
  await new Promise((r) => setImmediate(r));
  spawned[1].reply(JSON.stringify({ id: spawned[1].last.id, result: { ok: true } }) + '\n');
  assert.deepEqual(await next, { ok: true });
  bridge.close();
});
