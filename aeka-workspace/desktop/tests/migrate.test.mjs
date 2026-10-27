import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const { migrateLegacyData } = createRequire(import.meta.url)('../services/migrate-legacy.cjs');

function profile() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aeka-migrate-'));
  const legacy = path.join(root, 'Flow Desktop'),
    target = path.join(root, 'Aeka Scribe');
  fs.mkdirSync(path.join(legacy, 'vault'), { recursive: true });
  fs.mkdirSync(path.join(legacy, 'Partitions', 'flow-web-account'), { recursive: true });
  fs.mkdirSync(path.join(legacy, 'Cache'), { recursive: true });
  fs.writeFileSync(path.join(legacy, 'Local State'), '{"os_crypt":{"encrypted_key":"legacy"}}');
  fs.writeFileSync(path.join(legacy, 'vault', 'notes.flow'), 'sealed');
  fs.writeFileSync(path.join(legacy, 'Partitions', 'flow-web-account', 'Cookies'), 'c');
  fs.writeFileSync(path.join(legacy, 'Cache', 'big'), 'x');
  return { root, legacy, target };
}

test('Legacy Flow Desktop data is copied once, without caches, and the original is kept', () => {
  const { legacy, target } = profile();
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'Local State'), '{"os_crypt":{"encrypted_key":"fresh"}}');
  assert.equal(migrateLegacyData(target, legacy), null);
  assert.equal(fs.readFileSync(path.join(target, 'vault', 'notes.flow'), 'utf8'), 'sealed');
  assert.match(fs.readFileSync(path.join(target, 'Local State'), 'utf8'), /legacy/); // key that unlocks the vault
  assert.ok(fs.existsSync(path.join(target, 'Partitions', 'flow-web-account', 'Cookies')));
  assert.ok(!fs.existsSync(path.join(target, 'Cache')));
  assert.ok(!fs.existsSync(target + '.migrating'));
  assert.ok(fs.existsSync(path.join(legacy, 'vault', 'notes.flow')));
  fs.writeFileSync(path.join(target, 'vault', 'notes.flow'), 'newer');
  assert.equal(migrateLegacyData(target, legacy), null); // never overwrites an existing vault
  assert.equal(fs.readFileSync(path.join(target, 'vault', 'notes.flow'), 'utf8'), 'newer');
});

test('A failed copy reports an error and leaves no vault behind, so the next launch retries', () => {
  const { legacy, target } = profile();
  const failing = {
    ...fs,
    cpSync: (from, to, o) => {
      if (from.endsWith('vault')) throw Object.assign(Error('busy'), { code: 'EBUSY' });
      return fs.cpSync(from, to, o);
    },
  };
  const error = migrateLegacyData(target, legacy, failing);
  assert.equal(error?.code, 'EBUSY');
  assert.ok(!fs.existsSync(path.join(target, 'vault')));
  assert.equal(migrateLegacyData(target, legacy), null);
  assert.ok(fs.existsSync(path.join(target, 'vault', 'notes.flow')));
});
