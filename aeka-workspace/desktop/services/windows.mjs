import { spawn } from 'node:child_process';
import path from 'node:path';

const ACTIONS = ['focus', 'paste', 'selection', 'clipboardSequence', 'call', 'holdKey', 'verifyInstaller'];
// Authenticode checks on a large installer (with antivirus scanning) can take far longer than a paste.
const TIMEOUTS = { verifyInstaller: 120000 };
// Hold-to-talk may poll only F1 to F12 (virtual-key codes 112 to 123).
export const holdKeyCode = (name) => {
  const m = /^F([1-9]|1[0-2])$/.exec(typeof name === 'string' ? name : '');
  return m ? 111 + Number(m[1]) : null;
};
const validArgs = (action, args) =>
  action !== 'holdKey' ||
  args.key === undefined ||
  (Number.isInteger(args.key) && args.key >= 112 && args.key <= 123);

export function windowsBridge(script, { spawnProcess = spawn, platform = process.platform } = {}) {
  if (platform !== 'win32')
    return {
      call: async () => {
        throw Error('This feature requires Windows.');
      },
      close: () => {},
    };
  const executable = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  let child = null,
    closed = false,
    sequence = 0,
    buffer = '',
    failures = 0,
    restartTimer = null;
  const pending = new Map();
  const fail = (message = 'The Windows helper is unavailable. Check your PowerShell policy.') => {
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(Error(message));
    }
    pending.clear();
  };
  const onLine = (line) => {
    try {
      const d = JSON.parse(line),
        p = pending.get(d.id);
      if (!p) return;
      failures = 0;
      pending.delete(d.id);
      clearTimeout(p.timer);
      d.error ? p.reject(Error(d.error)) : p.resolve(d.result);
    } catch {}
  };
  const start = () => {
    if (closed || child) return;
    buffer = '';
    // "-ExecutionPolicy Bypass" applies to this process only. It lets the packaged helper run under
    // the default Restricted policy (and despite mark-of-the-web on an extracted ZIP), but it does not
    // override a policy set by Group Policy, so organisation controls still win.
    const proc = spawnProcess(
      executable,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    child = proc;
    // Decode as a stream so a multi-byte character split across chunks is not corrupted.
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (data) => {
      buffer += data;
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        onLine(line);
      }
    });
    proc.stderr.on('data', () => {});
    // A write after the helper died raises EPIPE on stdin; without a listener it would crash main.
    proc.stdin.on('error', () => {});
    const down = () => {
      if (child !== proc) return;
      child = null;
      fail();
      if (closed) return;
      // Restart with backoff; stop retrying in the background after repeated failures (the next call
      // still tries once more), so a blocked helper does not spin.
      failures++;
      if (failures <= 5) restartTimer = setTimeout(start, Math.min(30000, 1000 * 2 ** (failures - 1)));
    };
    proc.on('error', down);
    proc.on('exit', down);
  };
  start();
  return {
    call: (action, args = {}) =>
      new Promise((resolve, reject) => {
        if (!ACTIONS.includes(action)) {
          reject(Error('Unknown Windows operation.'));
          return;
        }
        if (!validArgs(action, args)) {
          reject(Error('Unsupported hold-to-talk key.'));
          return;
        }
        if (closed) {
          reject(Error('Windows helper is unavailable.'));
          return;
        }
        if (!child) {
          clearTimeout(restartTimer);
          start();
        }
        const id = ++sequence,
          timer = setTimeout(() => {
            pending.delete(id);
            reject(Error('Windows did not respond in time.'));
          }, TIMEOUTS[action] || 8000);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(JSON.stringify({ id, action, ...args }) + '\n', (e) => {
          if (e) {
            clearTimeout(timer);
            pending.delete(id);
            reject(Error('Windows helper is unavailable.'));
          }
        });
      }),
    close: () => {
      closed = true;
      clearTimeout(restartTimer);
      child?.kill();
      child = null;
      fail();
    },
  };
}
