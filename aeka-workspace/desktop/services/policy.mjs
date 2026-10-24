import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
export const managedDefaults = {
  allowRecording: true,
  allowIntegrations: true,
  allowCloudAI: true,
  allowSync: true,
  allowExports: true,
  allowCalendar: true,
  allowLocalASR: true,
  retentionDays: 0,
  allowAudioRetention: true,
  // Update trust anchors. Empty means the user may configure them; all three are pinned together.
  updateFeed: '',
  updatePublicKey: '',
  updateThumbprint: '',
};
const updateKeys = ['updateFeed', 'updatePublicKey', 'updateThumbprint'];
function validUpdatePins(value) {
  const set = updateKeys.filter((k) => value[k] !== undefined && value[k] !== '');
  if (!set.length) return {};
  if (set.length !== updateKeys.length || updateKeys.some((k) => typeof value[k] !== 'string'))
    throw Error('Invalid update policy.');
  const feed = new URL(value.updateFeed);
  if (feed.protocol !== 'https:' || feed.username || feed.password || feed.hash)
    throw Error('Invalid update policy.');
  if (value.updatePublicKey.length > 1000) throw Error('Invalid update policy.');
  const key = crypto.createPublicKey(value.updatePublicKey);
  if (key.asymmetricKeyType !== 'ed25519' || !/^[A-Fa-f0-9]{40}$/.test(value.updateThumbprint))
    throw Error('Invalid update policy.');
  return {
    updateFeed: feed.href,
    updatePublicKey: key.export({ type: 'spki', format: 'pem' }).toString(),
    updateThumbprint: value.updateThumbprint.toUpperCase(),
  };
}
export function validatePolicy(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid managed policy.');
  const p = { ...managedDefaults };
  for (const key of Object.keys(p)) {
    if (updateKeys.includes(key)) continue;
    if (key === 'retentionDays') {
      if (value[key] !== undefined && ![0, 7, 30, 90, 365].includes(value[key]))
        throw Error('Invalid retention policy.');
    } else if (value[key] !== undefined && typeof value[key] !== 'boolean')
      throw Error('Invalid managed policy.');
    if (value[key] !== undefined) p[key] = value[key];
  }
  return { ...p, ...validUpdatePins(value) };
}
// The pinned update trust anchors, or null when the user may configure them.
export const updatePins = (values) =>
  values?.updateFeed
    ? {
        feed: values.updateFeed,
        publicKey: values.updatePublicKey,
        publisherThumbprint: values.updateThumbprint,
      }
    : null;
const execText = (file, args) =>
  new Promise((resolve, reject) =>
    execFile(file, args, { windowsHide: true, timeout: 10000, encoding: 'utf8' }, (e, out) =>
      e ? reject(e) : resolve(out),
    ),
  );
// Resolves %ProgramData% without trusting the process environment, which a standard user controls.
// The value comes from the machine registry via the system reg.exe; C:\Windows is preferred over
// %SystemRoot% so a spoofed variable cannot substitute another reg.exe on a standard installation.
export async function resolveProgramData({
  platform = process.platform,
  env = process.env,
  exec = execText,
  exists = existsSync,
} = {}) {
  if (platform !== 'win32') return env.ProgramData || 'C:\\ProgramData';
  const win = path.win32;
  const envRoot = /^[A-Za-z]:\\[^%"<>|?*]+$/.test(env.SystemRoot || '') ? env.SystemRoot : '';
  const systemRoot =
    [...new Set(['C:\\Windows', envRoot].filter(Boolean))].find((r) =>
      exists(win.join(r, 'System32', 'reg.exe')),
    ) || 'C:\\Windows';
  const drive = systemRoot.slice(0, 2).toUpperCase(),
    fallback = drive + '\\ProgramData';
  try {
    const out = await exec(win.join(systemRoot, 'System32', 'reg.exe'), [
      'query',
      'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\ProfileList',
      '/v',
      'ProgramData',
    ]);
    const m = /^\s*ProgramData\s+REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/im.exec(String(out));
    if (!m) return fallback;
    // Expand only %SystemDrive%, from the system root rather than the environment.
    const value = m[1].replace(/%SystemDrive%/gi, drive);
    return /^[A-Za-z]:\\[^%"<>|?*]*$/.test(value) ? win.normalize(value) : fallback;
  } catch {
    return fallback;
  }
}
export async function loadPolicy(filename) {
  try {
    return {
      managed: true,
      values: validatePolicy(JSON.parse((await fs.readFile(filename, 'utf8')).replace(/^\uFEFF/, ''))),
    };
  } catch (e) {
    if (e.code === 'ENOENT') return { managed: false, values: { ...managedDefaults } };
    throw Error(
      'The managed Aeka Scribe policy is invalid. Ask your administrator to correct it before starting Aeka Scribe.',
    );
  }
}
export function enforcePolicy(policy, action) {
  const rules = {
    allowRecording: ['recording.state', 'queue.add'],
    allowCloudAI: ['semantic.build', 'ai', 'context.image', 'briefs.run'],
    allowSync: ['cloud.request', 'cloud.connect', 'cloud.sync'],
    allowIntegrations: [
      'integrations.configure',
      'integrations.prepare',
      'integrations.commit',
      'integrations.mailContext',
    ],
    allowExports: [
      'integrations.prepare',
      'integrations.commit',
      'backup.export',
      'sync.save',
      'resources.export',
      'notes.export',
    ],
    allowCalendar: ['calendar.connect', 'calendar.events', 'calendar.join'],
    allowLocalASR: ['local.configure'],
  };
  for (const [key, actions] of Object.entries(rules))
    if (actions.includes(action) && !policy[key])
      throw Error('This action is disabled by your managed ' + key + ' policy.');
}
