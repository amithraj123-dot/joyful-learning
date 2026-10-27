// Runs the real PowerShell helper. Windows only (CI windows job); skipped elsewhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { windowsBridge } from '../services/windows.mjs';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'windows', 'bridge.ps1');

test(
  'real Windows helper starts under the default policy and answers',
  { skip: process.platform !== 'win32' },
  async () => {
    const bridge = windowsBridge(script);
    try {
      assert.equal(typeof (await bridge.call('clipboardSequence')), 'number');
      assert.equal(typeof (await bridge.call('holdKey', { key: 119 })), 'boolean');
      await assert.rejects(bridge.call('holdKey', { key: 13 }));
    } finally {
      bridge.close();
    }
  },
);
