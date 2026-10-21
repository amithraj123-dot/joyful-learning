import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export function seal(bytes, key) {
  const iv = crypto.randomBytes(12),
    c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(bytes), c.final()]);
  return Buffer.concat([Buffer.from('FLOW2'), iv, c.getAuthTag(), data]);
}
export function unseal(bytes, key) {
  if (bytes.subarray(0, 5).toString() !== 'FLOW2') throw Error('Invalid encrypted file.');
  const d = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(5, 17));
  d.setAuthTag(bytes.subarray(17, 33));
  return Buffer.concat([d.update(bytes.subarray(33)), d.final()]);
}
export async function openVault(directory, safeStorage) {
  if (!safeStorage.isEncryptionAvailable())
    throw Error(
      'Windows secure storage is unavailable. Flow will not save credentials or notes unencrypted.',
    );
  await fs.mkdir(directory, { recursive: true });
  const keyPath = path.join(directory, 'device.key');
  let key;
  try {
    key = Buffer.from(safeStorage.decryptString(await fs.readFile(keyPath)), 'base64');
  } catch (e) {
    if (e.code !== 'ENOENT') throw Error('This Windows account cannot unlock the Flow data vault.');
    key = crypto.randomBytes(32);
    await fs.writeFile(keyPath, safeStorage.encryptString(key.toString('base64')), { mode: 0o600 });
  }
  let queue = Promise.resolve();
  const filename = (id) => {
    if (!/^[a-zA-Z0-9_-]{1,150}$/.test(id)) throw Error('Invalid storage identifier.');
    return path.join(directory, id + '.flow');
  };
  const read = async (id, fallback = null) => {
    await queue;
    try {
      return JSON.parse(unseal(await fs.readFile(filename(id)), key).toString());
    } catch (e) {
      if (e.code === 'ENOENT') return fallback;
      throw Error('Saved data could not be decrypted. Keep a backup before changing this file.');
    }
  };
  const write = (id, value) => {
    const task = queue.then(async () => {
      const file = filename(id),
        temp = file + '.tmp';
      await fs.writeFile(temp, seal(Buffer.from(JSON.stringify(value)), key), { mode: 0o600 });
      await fs.rename(temp, file);
    });
    queue = task.catch(() => {});
    return task;
  };
  const remove = (id) => {
    const task = queue.then(() => fs.rm(filename(id), { force: true }));
    queue = task.catch(() => {});
    return task;
  };
  return { read, write, remove, directory };
}
export function portableSeal(value, password) {
  if (typeof password !== 'string' || password.length < 12)
    throw Error('Use a backup password of at least 12 characters.');
  const salt = crypto.randomBytes(16),
    key = crypto.scryptSync(password, salt, 32);
  return Buffer.concat([Buffer.from('FLOWBACKUP2'), salt, seal(Buffer.from(JSON.stringify(value)), key)]);
}
export function portableUnseal(bytes, password) {
  if (bytes.subarray(0, 11).toString() !== 'FLOWBACKUP2') throw Error('Not a Flow encrypted backup.');
  const key = crypto.scryptSync(password, bytes.subarray(11, 27), 32);
  try {
    return JSON.parse(unseal(bytes.subarray(27), key).toString());
  } catch {
    throw Error('Backup password is incorrect or the file is damaged.');
  }
}
