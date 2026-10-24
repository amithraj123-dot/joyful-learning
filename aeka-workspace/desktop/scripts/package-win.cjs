// Cross-build NSIS without executing Windows binaries on Linux. electron-builder
// already provides a static uninstaller reader for its macOS build path. Use the
// same reader here, retaining its normal signing, size checks and final compiler.
// This hook uses internal APIs, so fail closed if the pinned builder changes.
const fs = require('node:fs/promises');
const path = require('node:path');
// Never carry stale runtime files into a new distributable.
if (!process.argv.some((arg) => arg.startsWith('--config.directories.output'))) {
  require('node:fs').rmSync(path.join(__dirname, '..', 'release', 'win-unpacked'), {
    recursive: true,
    force: true,
  });
}

if (process.platform === 'linux') {
  require('app-builder-lib'); // Initialize its normal module graph before internals.
  const version = require('app-builder-lib/package.json').version;
  if (version !== '26.15.3')
    throw new Error(`Review the static NSIS hook before using electron-builder ${version}.`);
  // Build hosts can leave atomic-copy staging files beside large executables.
  // Exclude these from both distribution formats, including the nested NSIS payload.
  const archives = require('app-builder-lib/out/targets/archive');
  const originalArchive = archives.archive;
  archives.archive = async (format, outFile, directory, options = {}) => {
    await fs.rm(outFile, { force: true });
    return originalArchive(format, outFile, directory, {
      ...options,
      excluded: [...new Set([...(options.excluded || []), '.*'])],
    });
  };
  const { NsisTarget } = require('app-builder-lib/out/targets/nsis/NsisTarget');
  const { UninstallerReader, nsisTemplatesDir } = require('app-builder-lib/out/targets/nsis/nsisUtil');
  NsisTarget.prototype.computeScriptAndSignUninstaller = async function (
    defines,
    commands,
    installerPath,
    sharedHeader,
    archs,
  ) {
    const customScript = await this.packager.getResource(this.options.script, 'installer.nsi');
    if (customScript)
      throw new Error('The Linux static build supports only the standard NSIS installer script.');
    const script = await fs.readFile(path.join(nsisTemplatesDir, 'installer.nsi'), 'utf8');
    const uninstallerPath = path.join(this.outDir, `${path.basename(installerPath, 'exe')}__uninstaller.exe`);
    defines.BUILD_UNINSTALLER = null;
    defines.UNINSTALLER_OUT_FILE = path.win32.join('Z:', uninstallerPath);
    await this.executeMakensis(
      defines,
      commands,
      sharedHeader + (await this.computeFinalScript(script, false, archs)),
    );
    await UninstallerReader.exec(installerPath, uninstallerPath);
    await this.packager.signIf(uninstallerPath);
    delete defines.BUILD_UNINSTALLER;
    defines.UNINSTALLER_OUT_FILE = uninstallerPath;
    return { script, isCustomScript: false };
  };
}

require('electron-builder/cli.js');
