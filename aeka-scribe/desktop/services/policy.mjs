import fs from 'node:fs/promises';
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
};
export function validatePolicy(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid managed policy.');
  const p = { ...managedDefaults };
  for (const key of Object.keys(p)) {
    if (key === 'retentionDays') {
      if (value[key] !== undefined && ![0, 7, 30, 90, 365].includes(value[key]))
        throw Error('Invalid retention policy.');
    } else if (value[key] !== undefined && typeof value[key] !== 'boolean')
      throw Error('Invalid managed policy.');
    if (value[key] !== undefined) p[key] = value[key];
  }
  return p;
}
export async function loadPolicy(filename) {
  try {
    return { managed: true, values: validatePolicy(JSON.parse(await fs.readFile(filename, 'utf8'))) };
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
