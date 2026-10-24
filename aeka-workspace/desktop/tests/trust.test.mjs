import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createUpdates } from '../services/updates.mjs';
import { validatePolicy, updatePins, resolveProgramData, loadPolicy } from '../services/policy.mjs';

const vault = (initial = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    values,
    read: async (k, d = null) => structuredClone(values.has(k) ? values.get(k) : d),
    write: async (k, v) => {
      values.set(k, structuredClone(v));
    },
    remove: async (k) => {
      values.delete(k);
    },
  };
};
function release(bytes = Buffer.alloc(1000000)) {
  const keys = crypto.generateKeyPairSync('ed25519'),
    publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    feed = 'https://releases.example/scribe.json',
    m = {
      product: 'com.aekaadvisors.scribe',
      platform: 'win32-x64',
      version: '0.7.0',
      url: 'https://releases.example/Aeka-Scribe.exe',
      bytes: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    },
    payload = JSON.stringify(m);
  return {
    publicKey,
    feed,
    m,
    bytes,
    envelope: {
      payload,
      signature: crypto.sign(null, Buffer.from(payload), keys.privateKey).toString('base64'),
    },
  };
}
async function setup(t, options = {}) {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'scribe-trust-test-'));
  t.after(() => fs.rm(cacheDir, { recursive: true, force: true }));
  const r = release(),
    thumbprint = 'A'.repeat(40),
    calls = { manifest: 0, installer: 0, launched: 0, trust: [], install: [] },
    v = vault();
  const u = createUpdates({
    vault: v,
    cacheDir,
    current: '0.6.0',
    fetcher: async (url) => {
      if (url === r.feed) {
        calls.manifest++;
        return Response.json(r.envelope);
      }
      calls.installer++;
      return new Response(r.bytes);
    },
    verifyInstaller: async () => ({ valid: true, thumbprint, publisher: 'Aeka Advisors India LLP' }),
    launch: async () => {
      calls.launched++;
    },
    confirmTrust: async (d) => {
      calls.trust.push(d);
      return options.trust ?? true;
    },
    confirmInstall: async (d) => {
      calls.install.push(d);
      return options.install ?? true;
    },
    pinned: options.pinned?.(r, thumbprint),
  });
  return { u, r, v, thumbprint, calls, cacheDir };
}

test('managed policy pins update trust anchors only as a complete, valid set', () => {
  const { publicKey } = release(),
    pins = { updateFeed: 'https://updates.example/scribe.json', updatePublicKey: publicKey };
  const p = validatePolicy({ ...pins, updateThumbprint: 'ab'.repeat(20) });
  assert.equal(p.updateThumbprint, 'AB'.repeat(20));
  assert.deepEqual(updatePins(p), {
    feed: 'https://updates.example/scribe.json',
    publicKey: p.updatePublicKey,
    publisherThumbprint: 'AB'.repeat(20),
  });
  assert.equal(updatePins(validatePolicy({})), null);
  const rsa = crypto
    .generateKeyPairSync('rsa', { modulusLength: 1024 })
    .publicKey.export({ type: 'spki', format: 'pem' });
  for (const bad of [
    pins, // partial
    { ...pins, updateThumbprint: 'A'.repeat(39) },
    { ...pins, updateThumbprint: 'Z'.repeat(40) },
    { ...pins, updateFeed: 'http://updates.example/scribe.json', updateThumbprint: 'A'.repeat(40) },
    { ...pins, updateFeed: 'not a url', updateThumbprint: 'A'.repeat(40) },
    { ...pins, updatePublicKey: rsa, updateThumbprint: 'A'.repeat(40) },
    { ...pins, updatePublicKey: 'garbage', updateThumbprint: 'A'.repeat(40) },
    { ...pins, updateThumbprint: 40 },
  ])
    assert.throws(() => validatePolicy(bad));
});

test('an invalid pinned update publisher prevents startup instead of being ignored', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scribe-policy-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'policy.json');
  await fs.writeFile(file, JSON.stringify({ updateFeed: 'https://updates.example/x.json' }));
  await assert.rejects(loadPolicy(file), /administrator/);
});

test('ProgramData comes from the machine registry, not the environment', async () => {
  const runs = [];
  const exec = async (file, args) => {
    runs.push(file);
    assert.deepEqual(args.slice(-2), ['/v', 'ProgramData']);
    return '\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\ProfileList\r\n    ProgramData    REG_EXPAND_SZ    %SystemDrive%\\ProgramData\r\n\r\n';
  };
  const spoofed = { ProgramData: 'C:\\Users\\me\\fake', SystemRoot: 'C:\\Users\\me\\win', SystemDrive: 'Z:' };
  // A spoofed %SystemRoot% does not replace the system reg.exe when C:\Windows has one.
  assert.equal(
    await resolveProgramData({ platform: 'win32', env: spoofed, exec, exists: () => true }),
    'C:\\ProgramData',
  );
  assert.equal(runs[0], 'C:\\Windows\\System32\\reg.exe');
  // Windows on another drive: %SystemDrive% is taken from the system root.
  assert.equal(
    await resolveProgramData({
      platform: 'win32',
      env: { SystemRoot: 'D:\\Windows' },
      exec,
      exists: (f) => f.startsWith('D:'),
    }),
    'D:\\ProgramData',
  );
  // An administrator-relocated folder is honoured.
  assert.equal(
    await resolveProgramData({
      platform: 'win32',
      env: {},
      exists: () => true,
      exec: async () => '    ProgramData    REG_EXPAND_SZ    E:\\Shared Data\r\n',
    }),
    'E:\\Shared Data',
  );
  // Failures and unexpected variables fall back to ProgramData on the system drive, never to %ProgramData%.
  for (const failing of [
    async () => {
      throw Error('reg.exe missing');
    },
    async () => '    ProgramData    REG_EXPAND_SZ    %ALLUSERSPROFILE%\r\n',
    async () => 'nothing useful',
  ])
    assert.equal(
      await resolveProgramData({ platform: 'win32', env: spoofed, exec: failing, exists: () => true }),
      'C:\\ProgramData',
    );
});

test('a pinned publisher overrides the vault and cannot be changed from the renderer', async (t) => {
  const { u, r, v, calls } = await setup(t, {
    pinned: (r, thumbprint) => () => ({
      feed: r.feed,
      publicKey: r.publicKey,
      publisherThumbprint: thumbprint,
    }),
  });
  await v.write('updates', {
    feed: 'https://attacker.example/x.json',
    publicKey: 'x',
    publisherThumbprint: 'B',
  });
  const s = await u.status();
  assert.equal(s.managed, true);
  assert.equal(s.feed, r.feed);
  const other = release();
  await assert.rejects(
    u.configure({ feed: other.feed, publicKey: other.publicKey, publisherThumbprint: 'C'.repeat(40) }),
    /administrator/,
  );
  assert.equal((await u.configure({ automatic: true })).automatic, true);
  assert.equal(calls.trust.length, 0);
  await u.download();
  assert.equal(calls.installer, 1);
});

test('trusting a publisher and installing need native confirmation', async (t) => {
  const refused = await setup(t, { trust: false });
  await assert.rejects(
    refused.u.configure({
      feed: refused.r.feed,
      publicKey: refused.r.publicKey,
      publisherThumbprint: refused.thumbprint.toLowerCase(),
    }),
    /not changed/,
  );
  assert.deepEqual(refused.calls.trust, [
    { host: 'releases.example', feed: refused.r.feed, publisherThumbprint: refused.thumbprint },
  ]);
  assert.equal((await refused.u.status()).configured, false);

  const { u, r, thumbprint, calls } = await setup(t, { install: false });
  await u.configure({ feed: r.feed, publicKey: r.publicKey, publisherThumbprint: thumbprint });
  await u.download();
  assert.equal(await u.install(), false);
  assert.deepEqual(calls.install, [
    { version: '0.7.0', publisher: 'Aeka Advisors India LLP', publisherThumbprint: thumbprint },
  ]);
  assert.equal(calls.launched, 0);
});

test('an installer verified against another publisher is not installed', async (t) => {
  const { u, r, v, thumbprint } = await setup(t);
  await u.configure({ feed: r.feed, publicKey: r.publicKey, publisherThumbprint: thumbprint });
  await u.download();
  const pending = await v.read('pending-update');
  await v.write('pending-update', { ...pending, trust: 'other' });
  await assert.rejects(u.install(), /Download and verify/);
});

test('automatic updates keep an installer already verified for the same release', async (t) => {
  const { u, r, thumbprint, calls, cacheDir } = await setup(t);
  await u.configure({
    feed: r.feed,
    publicKey: r.publicKey,
    publisherThumbprint: thumbprint,
    automatic: true,
  });
  await u.automatic();
  assert.equal(calls.installer, 1);
  await u.automatic();
  assert.equal(calls.manifest, 2);
  assert.equal(calls.installer, 1);
  assert.equal((await u.status()).phase, 'ready');
  // A damaged cached file is downloaded again.
  await fs.writeFile(path.join(cacheDir, 'Aeka-Scribe-update.exe'), 'tampered');
  await u.automatic();
  assert.equal(calls.installer, 2);
  // A manual download always fetches a fresh copy.
  await u.download();
  assert.equal(calls.installer, 3);
  await u.install();
  assert.equal(calls.launched, 1);
});
