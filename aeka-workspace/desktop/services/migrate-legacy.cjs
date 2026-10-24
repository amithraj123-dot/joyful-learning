'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Copies the data an Aeka Scribe install needs from a pre-rename Flow Desktop profile.
// Returns null on success or when there is nothing to copy, or the Error that stopped it.
function migrateLegacyData(target, legacy, fsSync = fs) {
  if (target === legacy || fsSync.existsSync(path.join(target, 'vault'))) return null;
  if (!fsSync.existsSync(path.join(legacy, 'vault'))) return null;
  const staging = target + '.migrating',
    required = ['Local State', 'vault'],
    optional = [path.join('Partitions', 'flow-web-account')];
  try {
    fsSync.rmSync(staging, { recursive: true, force: true });
    fsSync.mkdirSync(path.join(staging, 'Partitions'), { recursive: true });
    for (const rel of required)
      fsSync.cpSync(path.join(legacy, rel), path.join(staging, rel), { recursive: true });
    for (const rel of optional)
      try {
        fsSync.cpSync(path.join(legacy, rel), path.join(staging, rel), { recursive: true });
      } catch {} // a locked cookie store only means signing in to the web workspace again
    fsSync.mkdirSync(path.join(target, 'Partitions'), { recursive: true });
    for (const rel of [...optional, ...required]) {
      if (!fsSync.existsSync(path.join(staging, rel))) continue;
      fsSync.rmSync(path.join(target, rel), { recursive: true, force: true });
      fsSync.renameSync(path.join(staging, rel), path.join(target, rel));
    }
    fsSync.rmSync(staging, { recursive: true, force: true });
    return null;
  } catch (e) {
    try {
      fsSync.rmSync(path.join(target, 'vault'), { recursive: true, force: true });
    } catch {}
    return e;
  }
}

module.exports = { migrateLegacyData };
