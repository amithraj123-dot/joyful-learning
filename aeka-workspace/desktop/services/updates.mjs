import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
const version = (v) =>
  typeof v === 'string' && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(v) ? v.split('.').map(Number) : null;
export const newer = (a, b) => {
  const x = version(a),
    y = version(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};
function https(v) {
  const u = new URL(v);
  if (u.protocol !== 'https:' || u.username || u.password || u.hash)
    throw Error('The update feed must use HTTPS.');
  return u;
}
export function verifyManifest(envelope, key, feed, current, at = Date.now()) {
  if (
    typeof envelope?.payload !== 'string' ||
    envelope.payload.length > 20000 ||
    typeof envelope.signature !== 'string'
  )
    throw Error('Invalid signed update manifest.');
  const publicKey = crypto.createPublicKey(key);
  if (
    publicKey.asymmetricKeyType !== 'ed25519' ||
    !crypto.verify(null, Buffer.from(envelope.payload), publicKey, Buffer.from(envelope.signature, 'base64'))
  )
    throw Error('The update signature is invalid.');
  const m = JSON.parse(envelope.payload),
    origin = https(feed).origin,
    url = https(m.url);
  if (
    m.product !== 'com.aekaadvisors.scribe' ||
    m.platform !== 'win32-x64' ||
    url.origin !== origin ||
    !url.pathname.toLowerCase().endsWith('.exe') ||
    !version(m.version) ||
    !/^[a-f0-9]{64}$/.test(m.sha256) ||
    !Number.isSafeInteger(m.bytes) ||
    m.bytes < 1000000 ||
    m.bytes > 500 * 1024 * 1024 ||
    !Number.isFinite(Date.parse(m.expiresAt)) ||
    Date.parse(m.expiresAt) <= at ||
    Date.parse(m.expiresAt) > at + 31 * 86400000
  )
    throw Error('The signed update is expired or incompatible.');
  return {
    ...m,
    available: newer(m.version, current),
    notes: typeof m.notes === 'string' ? m.notes.slice(0, 2000) : '',
  };
}
export function createUpdates({
  vault,
  cacheDir,
  current,
  fetcher = fetch,
  verifyInstaller,
  launch,
  canInstall = () => true,
  // Trust anchors pinned by managed policy ({ feed, publicKey, publisherThumbprint }) or null.
  pinned = () => null,
  // Native confirmations shown by the main process. Both refuse unless the host supplies them.
  confirmTrust = async () => false,
  confirmInstall = async () => false,
}) {
  let state = { phase: 'idle', error: '', version: current, notes: '', lastChecked: 0 },
    busy = false;
  const config = async () => {
    const c = await vault.read('updates', {}),
      p = pinned();
    return p ? { ...c, ...p, managed: true } : c;
  };
  // Identifies the trust anchors a pending installer was verified against.
  const trustId = (c) =>
    crypto
      .createHash('sha256')
      .update(JSON.stringify([c.feed, c.publicKey, c.publisherThumbprint]))
      .digest('hex');
  const status = async () => {
    const c = await config();
    return {
      ...state,
      configured: !!c.feed,
      managed: !!c.managed,
      automatic: !!c.automatic,
      feed: c.feed || '',
      publicKey: c.publicKey || '',
      publisherThumbprint: c.publisherThumbprint || '',
    };
  };
  const check = async () => {
    const c = await config();
    if (!c.feed) throw Error('A publisher-signed update feed has not been configured.');
    const r = await fetcher(c.feed, { redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw Error('The update feed is unavailable.');
    const text = await limitedText(r, 30000);
    const m = verifyManifest(JSON.parse(text), c.publicKey, c.feed, current);
    state = {
      phase: m.available ? 'available' : 'current',
      error: '',
      version: m.version,
      notes: m.notes,
      lastChecked: Date.now(),
    };
    return { manifest: m, config: c };
  };
  const download = async ({ reuse = false } = {}) => {
    if (busy) throw Error('An update check is already running.');
    busy = true;
    try {
      const { manifest: m, config: c } = await check();
      if (!m.available) return status();
      if (reuse) {
        // Keep an installer already verified for this exact release instead of downloading it again.
        const pending = await vault.read('pending-update'),
          size = await fs
            .stat(path.join(cacheDir, 'Aeka-Scribe-update.exe'))
            .then((x) => x.size)
            .catch(() => -1);
        if (
          pending?.manifest?.version === m.version &&
          pending.manifest.sha256 === m.sha256 &&
          pending.manifest.bytes === m.bytes &&
          pending.trust === trustId(c) &&
          size === m.bytes
        ) {
          state.phase = 'ready';
          return status();
        }
      }
      state.phase = 'downloading';
      await fs.mkdir(cacheDir, { recursive: true });
      const filename = path.join(cacheDir, 'Aeka-Scribe-update.exe'),
        temp = path.join(cacheDir, 'Aeka-Scribe-update.partial.exe');
      const r = await fetcher(m.url, { redirect: 'error', signal: AbortSignal.timeout(300000) });
      if (!r.ok || !r.body) throw Error('The installer could not be downloaded.');
      const handle = await fs.open(temp, 'w', 0o600),
        hash = crypto.createHash('sha256');
      let bytes = 0;
      try {
        for await (const chunk of r.body) {
          bytes += chunk.length;
          if (bytes > m.bytes) throw Error('The installer size does not match its signed manifest.');
          hash.update(chunk);
          await handle.write(chunk);
        }
      } finally {
        await handle.close();
      }
      if (bytes !== m.bytes || hash.digest('hex') !== m.sha256)
        throw Error('The installer failed its integrity check.');
      const signature = await verifyInstaller(temp);
      if (
        !signature.valid ||
        signature.thumbprint?.replace(/\s/g, '').toUpperCase() !== c.publisherThumbprint
      )
        throw Error('The installer is not signed by the trusted Windows publisher.');
      await fs.rename(temp, filename);
      await vault.write('pending-update', {
        filename,
        manifest: m,
        trust: trustId(c),
        publisher: typeof signature.publisher === 'string' ? signature.publisher.slice(0, 200) : '',
      });
      state.phase = 'ready';
      return status();
    } catch (e) {
      state.error = e.message;
      state.phase = 'error';
      await fs.rm(path.join(cacheDir, 'Aeka-Scribe-update.partial.exe'), { force: true }).catch(() => {});
      throw e;
    } finally {
      busy = false;
    }
  };
  return {
    status,
    configure: async (c) => {
      if (pinned()) {
        // Managed devices: only the automatic preference is the user's to change.
        if (c.feed || c.publicKey || c.publisherThumbprint)
          throw Error('Update publisher settings are managed by your administrator.');
        await vault.write('updates', {
          ...(await vault.read('updates', {})),
          automatic: c.automatic === true,
        });
        return status();
      }
      const feed = https(c.feed).href,
        key = crypto.createPublicKey(c.publicKey);
      if (key.asymmetricKeyType !== 'ed25519' || !/^[A-Fa-f0-9]{40}$/.test(c.publisherThumbprint || ''))
        throw Error('Provide an Ed25519 public key and the publisher’s 40-character certificate thumbprint.');
      const publisherThumbprint = c.publisherThumbprint.toUpperCase();
      if (!(await confirmTrust({ host: new URL(feed).host, feed, publisherThumbprint })))
        throw Error('The update publisher was not changed.');
      await vault.write('updates', {
        feed,
        publicKey: key.export({ type: 'spki', format: 'pem' }).toString(),
        publisherThumbprint,
        automatic: c.automatic === true,
      });
      await vault.remove('pending-update');
      state = { ...state, phase: 'idle', error: '' };
      return status();
    },
    check: async () => {
      try {
        await check();
        return status();
      } catch (e) {
        state.error = e.message;
        state.phase = 'error';
        throw e;
      }
    },
    download,
    automatic: async () => {
      if ((await config()).automatic && !busy)
        try {
          await download({ reuse: true });
        } catch {}
    },
    install: async () => {
      if (!(await canInstall()))
        throw Error('Finish all recordings and pending transcription before installing an update.');
      const c = await config(),
        pending = await vault.read('pending-update');
      if (!pending || pending.filename !== path.join(cacheDir, 'Aeka-Scribe-update.exe'))
        throw Error('Download and verify an update first.');
      const m = pending.manifest;
      if (!newer(m.version, current) || Date.parse(m.expiresAt) <= Date.now())
        throw Error('Check for updates again; this installer is no longer current.');
      // An installer verified against other trust anchors (for example before a policy change) is not used.
      if (pending.trust !== trustId(c)) throw Error('Download and verify an update first.');
      const intact = async () => {
        const bytes = await fs.readFile(pending.filename);
        if (bytes.length !== m.bytes || crypto.createHash('sha256').update(bytes).digest('hex') !== m.sha256)
          throw Error('The downloaded installer changed. Download it again.');
      };
      await intact();
      const sig = await verifyInstaller(pending.filename);
      if (!sig.valid || sig.thumbprint !== c.publisherThumbprint)
        throw Error('Publisher verification failed.');
      const publisher = typeof sig.publisher === 'string' ? sig.publisher.slice(0, 200) : '';
      if (
        !(await confirmInstall({ version: m.version, publisher, publisherThumbprint: c.publisherThumbprint }))
      )
        return false;
      // The confirmation can stay open for a while: check the app is still idle and the file unchanged.
      if (!(await canInstall()))
        throw Error('Finish all recordings and pending transcription before installing an update.');
      await intact();
      await launch(pending.filename);
      return true;
    },
  };
}
async function limitedText(response, limit) {
  const chunks = [];
  let size = 0;
  if (!response.body) throw Error('Empty update manifest.');
  for await (const b of response.body) {
    size += b.length;
    if (size > limit) throw Error('The update manifest is too large.');
    chunks.push(b);
  }
  return Buffer.concat(chunks).toString('utf8');
}
