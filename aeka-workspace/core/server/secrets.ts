// Sealing of stored credentials with AES-GCM. The key is derived per purpose from AEKA_ENCRYPTION_KEY,
// so a sealed value cannot be reused for another purpose, and the purpose plus a record id are bound
// as additional data.
import { CloudError } from '../../lib/cloud-store.ts';
import type { ServerEnv } from './env.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function rawKey(env: ServerEnv): Uint8Array<ArrayBuffer> {
  const v = env.AEKA_ENCRYPTION_KEY?.trim() || '';
  let bytes: Uint8Array<ArrayBuffer> | null = null;
  if (/^[0-9a-f]{64,}$/i.test(v)) bytes = Uint8Array.from(v.match(/../g)!.map((h) => parseInt(h, 16)));
  else if (/^[A-Za-z0-9+/_-]{43,}={0,2}$/.test(v)) {
    try {
      bytes = unb64(v.replace(/-/g, '+').replace(/_/g, '/'));
    } catch {
      bytes = null;
    }
  }
  if (!bytes || bytes.length < 32)
    throw new CloudError(
      'Secure storage is not set up. An administrator must set AEKA_ENCRYPTION_KEY (32 random bytes) in the hosting secrets.',
      503,
    );
  return bytes;
}

export const sealingAvailable = (env: ServerEnv) => {
  try {
    rawKey(env);
    return true;
  } catch {
    return false;
  }
};

async function keyFor(env: ServerEnv, purpose: string) {
  const base = await crypto.subtle.importKey('raw', rawKey(env), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('aeka-workspace-v1'), info: enc.encode(purpose) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function seal(env: ServerEnv, purpose: string, recordId: string, plaintext: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: enc.encode(purpose + ':' + recordId) },
    await keyFor(env, purpose),
    enc.encode(plaintext),
  );
  return `v1.${b64(iv)}.${b64(new Uint8Array(ct))}`;
}

export async function unseal(env: ServerEnv, purpose: string, recordId: string, sealed: string) {
  const [v, iv, ct] = sealed.split('.');
  if (v !== 'v1' || !iv || !ct) throw new CloudError('A stored credential is unreadable. Reconnect.', 409);
  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64(iv), additionalData: enc.encode(purpose + ':' + recordId) },
      await keyFor(env, purpose),
      unb64(ct),
    );
    return dec.decode(pt);
  } catch {
    throw new CloudError(
      'A stored credential could not be opened (the key may have changed). Reconnect.',
      409,
    );
  }
}

// Constant-time comparison of two strings (tokens, signatures).
export function sameSecret(a: string, b: string) {
  const x = enc.encode(a),
    y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
