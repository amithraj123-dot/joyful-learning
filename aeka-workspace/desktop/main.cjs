const {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  Tray,
  Menu,
  nativeImage,
  safeStorage,
  session,
  desktopCapturer,
  shell,
  dialog,
  clipboard,
  ClipboardItem,
  Notification,
  powerSaveBlocker,
  powerMonitor,
  screen,
} = require('electron');
const path = require('node:path'),
  fs = require('node:fs/promises'),
  { pathToFileURL } = require('node:url');
let pendingRestore = null,
  automationError = '',
  quitWatchdog = null;
let window,
  overlay,
  tray,
  windows,
  workspace,
  calendars,
  integrations,
  briefs,
  vault,
  cloudSync,
  automation,
  localASR,
  updates,
  cloudSession,
  cloudWindow,
  policyManager,
  managedPolicy,
  locked = false,
  calendarFreshAt = 0,
  quitting = false,
  quitPending = false,
  quitPrompt = false,
  recording = false,
  meeting = false,
  target = null,
  lastText = '',
  calendarCache = [],
  reminded = new Set(),
  timers = [],
  powerId = null,
  shortcutErrors = [],
  captureGrantedUntil = 0,
  holdEnabled = false,
  holdCode = 119,
  holdKeyCode;
const ui = path.join(__dirname, 'ui-dist', 'index.html'),
  trustedURL = pathToFileURL(ui).href;
const cloudOrigin = 'https://flow-voice-workspace.amithraj123.chatgpt.site';
const emit = (type, payload = {}) => {
  if (type === 'automation-countdown' && window && !window.isDestroyed()) {
    window.showInactive();
    toast('Scheduled recording', 'Recording starts in 20 seconds. Open Aeka Scribe to cancel.');
  }
  if (window && !window.isDestroyed()) window.webContents.send('aeka-scribe-event', { type, ...payload });
};
const show = () => {
  window.show();
  window.focus();
};
const toast = (title, body) => {
  if (Notification.isSupported()) {
    const n = new Notification({ title, body });
    n.on('click', show);
    n.show();
  } else emit('notice', { message: body });
};
async function startTarget() {
  try {
    const f = await windows.call('focus');
    const s = await workspace.settings();
    target =
      !f.isPassword &&
      f.focusKnown &&
      !s.excludedApps.some((x) => x.toLowerCase() === f.process.toLowerCase()) &&
      !['Aeka Scribe', 'Flow Desktop', 'electron'].includes(f.process)
        ? f
        : null;
    return {
      target,
      style: s.appStyles.find((x) => x.process.toLowerCase() === f.process.toLowerCase())?.style,
    };
  } catch {
    target = null;
    return {};
  }
}
async function toggle() {
  if (meeting) {
    show();
    emit('notice', { message: 'Finish the meeting before starting dictation.' });
    return;
  }
  if (recording) {
    emit('dictation-stop');
    return;
  }
  const context = await startTarget();
  emit('dictation-start', { style: context.style, process: context.target?.process || '' });
}
function registerShortcuts(s) {
  holdEnabled = s.holdToTalk;
  // Saved settings may predate the hold key choice; anything outside F1 to F12 falls back to F8.
  holdCode = holdKeyCode(s.holdKey) || 119;
  globalShortcut.unregisterAll();
  shortcutErrors = [];
  for (const [key, fn] of [
    [s.shortcut, toggle],
    [s.cancelShortcut, () => emit('dictation-cancel')],
    [
      s.pasteShortcut,
      async () => {
        await startTarget();
        await pasteText(lastText).catch((e) => emit('notice', { message: e.message }));
      },
    ],
    [
      s.commandShortcut,
      async () => {
        try {
          if (!s.captureSelection) throw Error('Enable selected-text access in Desktop settings first.');
          const data = await windows.call('selection');
          show();
          emit('command', { text: data.text, process: data.process });
        } catch (e) {
          show();
          emit('notice', { message: e.message });
        }
      },
    ],
  ]) {
    try {
      if (!globalShortcut.register(key, fn)) shortcutErrors.push(key);
    } catch {
      shortcutErrors.push(key);
    }
  }
}
async function pasteText(text) {
  if (!text) return { pasted: false, reason: 'No completed dictation yet.' };
  if (!target) return { pasted: false, reason: 'No safe destination field was captured. Use Copy.' };
  const current = await windows.call('focus');
  if (current.handle !== target.handle || current.isPassword || !current.focusKnown)
    return { pasted: false, reason: 'The focused field changed. Use Copy to insert your reviewed text.' };
  // Electron 44 exposes only the async ClipboardItem API (no availableFormats/readBuffer/writeBuffer).
  // Snapshot every format as resolved Blobs before overwriting. When a second paste arrives while a
  // restore is still pending, reuse the first snapshot so the dictated text is never saved as "the
  // user's clipboard".
  let snapshot = pendingRestore?.snapshot;
  if (pendingRestore) clearTimeout(pendingRestore.timer);
  pendingRestore = null;
  if (!snapshot) {
    let total = 0;
    snapshot = [];
    for (const item of await clipboard.read()) {
      const entries = {};
      for (const type of item.types) {
        const value = await item.getType(type);
        total += value?.size || 0;
        if (total > 16 * 1024 * 1024)
          return { pasted: false, reason: 'Your clipboard is too large to preserve safely. Use Copy.' };
        entries[type] = value;
      }
      if (Object.keys(entries).length) snapshot.push(new ClipboardItem(entries));
    }
  }
  await clipboard.writeText(text);
  const sequence = await windows.call('clipboardSequence');
  let done;
  try {
    done = await windows.call('paste', { handle: target.handle });
  } finally {
    const saved = snapshot;
    pendingRestore = {
      snapshot: saved,
      timer: setTimeout(async () => {
        pendingRestore = null;
        try {
          // Restore only if nothing else (the user or another app) has written to the clipboard since.
          if ((await windows.call('clipboardSequence')) !== sequence) return;
          if (saved.length) await clipboard.write(saved);
          else clipboard.clear();
        } catch {}
      }, 1000),
    };
  }
  return done;
}
function overlayState(state) {
  if (!overlay || overlay.isDestroyed()) return;
  if (state === 'idle' || state === 'error') {
    overlay.hide();
    return;
  }
  overlay.webContents.send('aeka-scribe-event', { type: 'overlay-state', state });
  const bounds = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  overlay.setPosition(Math.round(bounds.x + bounds.width / 2 - 150), bounds.y + bounds.height - 100);
  overlay.showInactive();
}
async function refreshCalendars() {
  if (!managedPolicy.values.allowCalendar)
    return {
      events: [],
      errors: [{ provider: 'Policy', message: 'Calendar access is disabled.' }],
      refreshedAt: null,
    };
  const r = await calendars.events();
  if (!r.errors.length) {
    calendarCache = r.events;
    calendarFreshAt = Date.now();
  } else {
    const failed = new Set(r.errors.map((x) => x.provider));
    calendarCache = [...calendarCache.filter((e) => failed.has(e.provider)), ...r.events];
    calendarFreshAt = 0;
  }
  return { ...r, events: calendarCache };
}
async function cloudRequest(payload) {
  if (!managedPolicy.values.allowSync) throw Error('Cloud access is disabled by managed policy.');
  if (!payload || typeof payload.action !== 'string' || JSON.stringify(payload).length > 1800000)
    throw Error('Invalid cloud request.');
  let r;
  try {
    r = await cloudSession.fetch(cloudOrigin + '/api/cloud', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: cloudOrigin },
      body: JSON.stringify(payload),
      credentials: 'include',
      redirect: 'manual',
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw Error('Could not reach your web workspace. Local notes are safe.');
  }
  if (
    (r.status >= 300 && r.status < 400) ||
    !(r.headers.get('Content-Type') || '').includes('application/json')
  )
    throw Error('Connect your web account in Desktop settings first.');
  const d = await r.json();
  if (!r.ok) throw Object.assign(Error(d.error || 'The cloud request failed.'), { status: r.status });
  return d.value;
}
function openCloudWindow() {
  if (cloudWindow && !cloudWindow.isDestroyed()) {
    cloudWindow.show();
    return;
  }
  cloudWindow = new BrowserWindow({
    width: 1000,
    height: 820,
    title: 'Connect Aeka Scribe web workspace',
    webPreferences: {
      // Partition name kept from 0.5 so the web sign-in survives the upgrade.
      partition: 'persist:flow-web-account',
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  cloudWindow.setMenuBarVisibility(false);
  const secure = (win) => {
    win.webContents.on('will-navigate', (event, url) => {
      try {
        if (new URL(url).protocol !== 'https:') event.preventDefault();
      } catch {
        event.preventDefault();
      }
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
      try {
        if (new URL(url).protocol === 'https:')
          return {
            action: 'allow',
            overrideBrowserWindowOptions: {
              webPreferences: {
                partition: 'persist:flow-web-account',
                sandbox: true,
                contextIsolation: true,
                nodeIntegration: false,
              },
            },
          };
      } catch {}
      return { action: 'deny' };
    });
    win.webContents.on('did-create-window', (child) => secure(child));
  };
  secure(cloudWindow);
  cloudWindow.on('closed', () => {
    cloudWindow = null;
    void cloudSync.tick();
  });
  void cloudWindow.loadURL(cloudOrigin);
}
async function remind() {
  const s = await workspace.settings();
  if (!s.reminders) return;
  const now = Date.now();
  for (const e of calendarCache) {
    const delta = Date.parse(e.start) - now;
    if (delta >= -60000 && delta <= s.reminderMinutes * 60000 && !reminded.has(e.id)) {
      reminded.add(e.id);
      emit('reminder', { event: e });
      toast('Meeting coming up', e.title);
    }
  }
}
async function dispatch(action, p = {}) {
  if (action !== 'recording.state' || !['idle', 'error', 'stopping'].includes(p.state))
    policyManager.enforcePolicy(managedPolicy.values, action);
  switch (action) {
    case 'status':
      return { ...(await workspace.status()), shortcutErrors, policy: managedPolicy };
    case 'settings.save': {
      const s = await workspace.setSettings(p);
      registerShortcuts(s);
      app.setLoginItemSettings({ openAtLogin: s.launchAtLogin });
      return { ...s, shortcutErrors };
    }
    case 'cloud.request':
      return cloudRequest(p);
    case 'cloud.status':
      return cloudSync.status();
    case 'cloud.connect':
      if (p.enableSync) await cloudSync.enable();
      openCloudWindow();
      return { opened: true };
    case 'cloud.sync':
      await cloudSync.tick();
      return cloudSync.status();
    case 'cloud.disconnect':
      await cloudSync.disable();
      cloudWindow?.close();
      await cloudSession.clearStorageData();
      await cloudSession.clearCache();
      return { disconnected: true };
    case 'automation.list':
      return automation.list();
    case 'automation.arm': {
      if (!managedPolicy.values.allowRecording) throw Error('Recording is disabled by policy.');
      const e = calendarCache.find((e) => e.id === p.id);
      if (!e) throw Error('Refresh your calendar before scheduling a recording.');
      return automation.arm({
        ...e,
        participantsInformed: p.participantsInformed,
        join: p.join,
        systemAudio: p.systemAudio,
        grace: p.grace,
      });
    }
    case 'automation.cancel':
      return automation.cancel(p.id);
    case 'automation.extend':
      return automation.extend(p.id);
    case 'automation.started':
      return automation.started(p.id, p.noteId, p.success === true);
    case 'local.status':
      return localASR.status();
    case 'local.configure': {
      const exe = await dialog.showOpenDialog(window, {
        title: 'Choose a trusted whisper.cpp executable (whisper-cli.exe)',
        properties: ['openFile'],
        filters: [{ name: 'Whisper executable', extensions: ['exe'] }],
      });
      if (exe.canceled) return { cancelled: true };
      const model = await dialog.showOpenDialog(window, {
        title: 'Choose a ggml Whisper model',
        properties: ['openFile'],
        filters: [{ name: 'Whisper model', extensions: ['bin'] }],
      });
      if (model.canceled) return { cancelled: true };
      return localASR.configure(exe.filePaths[0], model.filePaths[0]);
    }
    case 'updates.status':
      return updates.status();
    case 'updates.configure':
      return updates.configure(p);
    case 'updates.check':
      return updates.check();
    case 'updates.download':
      return updates.download();
    case 'updates.install':
      return updates.install();
    case 'export.check':
      if (!managedPolicy.values.allowExports) throw Error('Exports are disabled by managed policy.');
      return true;
    case 'notes.export': {
      const { exportNote } = await import('./generated/workspace-core.mjs');
      const n = (await workspace.list()).find((n) => n.id === p.id);
      if (!n) throw Error('Note not found.');
      return exportNote(n);
    }
    case 'credentials.save':
      return workspace.setKey(p.key);
    case 'profile.get':
      return workspace.profileGet();
    case 'profile.save':
      return workspace.profileSave(p);
    case 'studio.get':
      return workspace.studioGet();
    case 'studio.save':
      return workspace.studioSave(p.config, p.revision);
    case 'notes.list':
      return workspace.list();
    case 'notes.get':
      return workspace.get(p.id);
    case 'notes.index':
      return workspace.index();
    case 'notes.save':
      return workspace.save(p.note, p.baseUpdatedAt);
    case 'notes.delete':
      return workspace.remove(p.id, p.baseUpdatedAt);
    case 'semantic.status':
      return workspace.semantic.status();
    case 'semantic.build':
      return workspace.semantic.build();
    case 'semantic.configure':
      return workspace.semantic.configure(p.enabled);
    case 'semantic.clear':
      return workspace.semantic.clear();
    case 'semantic.cancel':
      return workspace.semantic.cancel();
    case 'context.image':
      return workspace.extractImage(p.image);
    case 'integrations.status':
      return integrations.status();
    case 'integrations.configure':
      return integrations.configure(p);
    case 'integrations.prepare':
      return integrations.prepare(p);
    case 'integrations.commit':
      return integrations.commit(p);
    case 'integrations.history':
      return integrations.list();
    case 'integrations.discard':
      return integrations.discard(p.id);
    case 'integrations.mailContext':
      return integrations.mailContext(p);
    case 'briefs.status':
      return briefs.status();
    case 'briefs.configure':
      return briefs.configure(p);
    case 'briefs.retry':
      return briefs.retry(p.id);
    case 'briefs.run':
      await refreshCalendars();
      return briefs.tick({
        events: calendarCache,
        fresh: Date.now() - calendarFreshAt < 360000,
        busy: recording || meeting,
        force: true,
      });
    case 'ai':
      return workspace.ai(p);
    case 'transcribe':
      return workspace.transcribe(p);
    case 'queue.add':
      return workspace.enqueue(p);
    case 'queue.list':
      return workspace.queueStatus();
    case 'queue.retry':
      void workspace.processQueue().catch((e) => console.error('Queue processing failed:', e?.message));
      return true;
    case 'audio.clear':
      return workspace.clearAudio();
    case 'calendar.status':
      return calendars.status();
    case 'calendar.config':
      return calendars.saveConfig(p);
    case 'calendar.connect': {
      const result = await calendars.connect(p.provider);
      void refreshCalendars().catch(() => {});
      return result;
    }
    case 'calendar.disconnect': {
      const result = await calendars.disconnect(p.provider);
      calendarCache = calendarCache.filter((e) => e.provider !== p.provider);
      return result;
    }
    case 'calendar.events':
      return refreshCalendars();
    case 'calendar.join': {
      const e = calendarCache.find((x) => x.id === p.id);
      if (!e?.url) throw Error('Refresh your calendar and choose a meeting with a supported call link.');
      await shell.openExternal(e.url);
      return true;
    }
    case 'backup.export': {
      const data = await workspace.backup(),
        { portableSeal } = await import('./services/vault.mjs');
      const b = portableSeal(data, p.password);
      const result = await dialog.showSaveDialog(window, {
        defaultPath: 'Aeka-Scribe-backup.aekabackup',
        filters: [{ name: 'Encrypted Aeka Scribe backup', extensions: ['aekabackup'] }],
      });
      if (result.canceled) return { cancelled: true };
      await fs.writeFile(result.filePath, b);
      return { saved: true };
    }
    case 'backup.import': {
      const { portableUnseal } = await import('./services/vault.mjs');
      const result = await dialog.showOpenDialog(window, {
        properties: ['openFile'],
        // .flowbackup files were written by releases before the Aeka Scribe rename.
        filters: [{ name: 'Encrypted Aeka Scribe backup', extensions: ['aekabackup', 'flowbackup'] }],
      });
      if (result.canceled) return { cancelled: true };
      const stat = await fs.stat(result.filePaths[0]);
      if (stat.size > 100 * 1024 * 1024) throw Error('Backup is too large.');
      return workspace.restore(portableUnseal(await fs.readFile(result.filePaths[0]), p.password));
    }
    case 'sync.folder': {
      const result = await dialog.showOpenDialog(window, {
        properties: ['openDirectory', 'createDirectory'],
        title: 'Choose a folder synced by OneDrive, Google Drive or Dropbox',
      });
      if (result.canceled) return { cancelled: true };
      await vault.write('sync', { folder: result.filePaths[0] });
      return { selected: true };
    }
    case 'sync.save': {
      const config = await vault.read('sync');
      if (!config?.folder) throw Error('Choose a synced folder first.');
      const { portableSeal } = await import('./services/vault.mjs');
      const dest = path.join(config.folder, 'Aeka-Scribe-workspace.aekabackup'),
        temp = dest + '.tmp';
      await fs.writeFile(temp, portableSeal(await workspace.backup(), p.password));
      await fs.rename(temp, dest);
      return { saved: true };
    }
    case 'sync.load': {
      const config = await vault.read('sync');
      if (!config?.folder) throw Error('Choose a synced folder first.');
      const { portableUnseal } = await import('./services/vault.mjs');
      // Other devices may still be on a pre-rename release and write the legacy snapshot: use the newer one.
      const current = path.join(config.folder, 'Aeka-Scribe-workspace.aekabackup'),
        legacy = path.join(config.folder, 'Flow-workspace.flowbackup');
      const [a, b] = await Promise.all([current, legacy].map((f) => fs.stat(f).catch(() => null)));
      const filename = b && (!a || b.mtimeMs > a.mtimeMs) ? legacy : current;
      if ((await fs.stat(filename)).size > 100 * 1024 * 1024) throw Error('Snapshot is too large.');
      return workspace.restore(portableUnseal(await fs.readFile(filename), p.password));
    }
    case 'recording.state': {
      const states = ['idle', 'requesting', 'recording', 'stopping', 'transcribing', 'error', 'paused'];
      if (!states.includes(p.state)) throw Error('Invalid recording state.');
      const active = !['idle', 'error'].includes(p.state);
      if (p.kind === 'meeting') {
        meeting = active;
        if (active && powerId === null) powerId = powerSaveBlocker.start('prevent-app-suspension');
        if (!active && powerId !== null) {
          powerSaveBlocker.stop(powerId);
          powerId = null;
        }
        if (!active && p.noteId) void automation.finish(p.noteId);
      } else recording = active;
      if (p.state === 'requesting' && p.kind === 'meeting') captureGrantedUntil = Date.now() + 30000;
      if (p.state === 'error' && quitPending) {
        quitPending = false;
        quitting = false;
        show();
        emit('notice', { message: 'Finish or recover the recording before quitting.' });
      }
      if (quitPending && !recording && !meeting && p.state === 'idle') {
        quitPending = false;
        quitting = true;
        setImmediate(() => app.quit());
      }
      overlayState(active ? (p.kind === 'meeting' ? 'Meeting · ' + p.state : p.state) : 'idle');
      return true;
    }
    case 'dictation.complete': {
      if (typeof p.text !== 'string' || p.text.length > 200000) throw Error('Invalid dictation.');
      lastText = p.text;
      const s = await workspace.settings();
      const r = s.autoPaste
        ? await pasteText(lastText)
        : { pasted: false, reason: 'Auto-insert is off. Your text is ready to copy.' };
      if (!r.pasted) {
        show();
        emit('notice', { message: r.reason });
      }
      return r;
    }
    case 'paste.last':
      await startTarget();
      return pasteText(lastText);
    case 'context.selection':
      if (!(await workspace.settings()).captureSelection) throw Error('Enable selected-text access first.');
      return windows.call('selection');
    case 'window.show':
      show();
      return true;
    case 'window.hide':
      window.hide();
      return true;
    case 'help.open': {
      const urls = {
        google: 'https://developers.google.com/identity/protocols/oauth2/native-app',
        whisper: 'https://github.com/ggml-org/whisper.cpp',
        microsoft: 'https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app',
        openai: 'https://platform.openai.com/api-keys',
        workspace: 'https://flow-voice-workspace.amithraj123.chatgpt.site',
      };
      if (!urls[p.topic]) throw Error('Unknown help page.');
      await shell.openExternal(urls[p.topic]);
      return true;
    }
    default:
      throw Error('Unknown desktop action.');
  }
}
// Releases before the rename kept data in %APPDATA%\Flow Desktop. Copy what the app needs once (the
// original stays as a fallback): "Local State" holds the safeStorage key that unlocks the vault, "vault"
// holds notes, settings and credentials, and the web-account partition keeps the hosted sign-in.
// Files are staged first and the vault is moved into place last, so an interrupted copy (for example
// while Flow Desktop is still running) is retried on the next launch instead of leaving an empty vault.
// CI smoke launch: a throwaway profile, then exit 0 once the window has loaded and the Windows helper
// answers, or exit 1 on any failure or after 90 seconds. Never used by an installed copy.
const smokeTest = process.env.AEKA_SCRIBE_SMOKE_TEST === '1';
if (smokeTest) {
  app.setPath(
    'userData',
    require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'aeka-scribe-smoke-')),
  );
  setTimeout(() => {
    console.error('Smoke launch timed out.');
    app.exit(1);
  }, 90000).unref();
  process.on('unhandledRejection', (e) => {
    console.error('Smoke launch failed:', e);
    app.exit(1);
  });
}
async function finishSmokeTest() {
  try {
    if (window.webContents.isLoading())
      await new Promise((r) => window.webContents.once('did-finish-load', r));
    const title = await window.webContents.executeJavaScript('document.title');
    const sequence = await windows.call('clipboardSequence');
    console.log('AEKA_SCRIBE_SMOKE_OK', JSON.stringify({ title, sequence: typeof sequence }));
    app.exit(0);
  } catch (e) {
    console.error('Smoke launch failed:', e?.message || e);
    app.exit(1);
  }
}
const { migrateLegacyData } = require('./services/migrate-legacy.cjs');
const migrationError = migrateLegacyData(
  app.getPath('userData'),
  path.join(app.getPath('appData'), 'Flow Desktop'),
);
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => window && show());
  app
    .whenReady()
    .then(async () => {
      if (process.platform !== 'win32') {
        dialog.showErrorBox(
          'Windows build required',
          'Aeka Scribe targets Windows 10/11. Use the hosted workspace on other platforms.',
        );
        app.quit();
        return;
      }
      app.setAppUserModelId('com.aekaadvisors.scribe');
      if (migrationError) {
        dialog.showErrorBox(
          'Earlier data could not be copied',
          'Aeka Scribe could not copy your notes and settings from Flow Desktop (' +
            (migrationError.code || migrationError.message) +
            '). Quit Flow Desktop from its tray icon, then start Aeka Scribe again. Nothing has been deleted.',
        );
        app.quit();
        return;
      }
      const { openVault } = await import('./services/vault.mjs'),
        { createWorkspace } = await import('./services/workspace.mjs'),
        { createCalendars } = await import('./services/calendars.mjs'),
        windowsService = await import('./services/windows.mjs'),
        { windowsBridge } = windowsService;
      holdKeyCode = windowsService.holdKeyCode;
      policyManager = await import('./services/policy.mjs');
      // %ProgramData% in the environment is user-controlled; resolve it from the machine registry.
      const programData = await policyManager.resolveProgramData();
      managedPolicy = await policyManager.loadPolicy(path.join(programData, 'Aeka Scribe', 'policy.json'));
      // Keep honouring a policy deployed for the pre-rename product, so restrictions never lapse silently.
      if (!managedPolicy.managed)
        managedPolicy = await policyManager.loadPolicy(path.join(programData, 'Flow Desktop', 'policy.json'));
      vault = await openVault(path.join(app.getPath('userData'), 'vault'), safeStorage);
      const { createLocalASR } = await import('./services/local-asr.mjs');
      localASR = createLocalASR({
        vault,
        tempDir: app.getPath('temp'),
        permitted: () => managedPolicy.values.allowLocalASR,
      });
      workspace = createWorkspace({
        vault,
        emit,
        localTranscribe: localASR.transcribe,
        policy: () => managedPolicy.values,
      });
      await workspace.recover();
      calendars = createCalendars({ vault, openExternal: (url) => shell.openExternal(url) });
      windows = windowsBridge(
        path.join(app.isPackaged ? process.resourcesPath : __dirname, 'windows', 'bridge.ps1'),
      );
      const { createIntegrations } = await import('./services/integrations.mjs'),
        { createBriefs } = await import('./services/briefs.mjs');
      integrations = createIntegrations({
        vault,
        workspace,
        calendars,
        permitted: () => managedPolicy.values.allowIntegrations && managedPolicy.values.allowExports,
      });
      briefs = createBriefs({
        vault,
        workspace,
        emit,
        permitted: () => managedPolicy.values.allowCloudAI && managedPolicy.values.allowCalendar,
      });
      await integrations.recover();
      await briefs.recover();
      cloudSession = session.fromPartition('persist:flow-web-account');
      cloudSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
      cloudSession.setPermissionCheckHandler(() => false);
      cloudSession.on('will-download', (event) => event.preventDefault());
      const { createSync } = await import('./services/sync.mjs'),
        { createAutomation } = await import('./services/automation.mjs'),
        { createUpdates } = await import('./services/updates.mjs');
      cloudSync = createSync({
        vault,
        workspace,
        request: cloudRequest,
        emit,
        permitted: () => managedPolicy.values.allowSync,
      });
      automation = createAutomation({ vault, emit, join: (e) => shell.openExternal(e.url) });
      await automation.recover();
      updates = createUpdates({
        vault,
        cacheDir: path.join(app.getPath('userData'), 'updates'),
        current: app.getVersion(),
        verifyInstaller: (file) => windows.call('verifyInstaller', { file }),
        canInstall: async () => !meeting && !recording && !(await workspace.queueStatus()).length,
        // Trust anchors come from managed policy when pinned; otherwise a renderer request to change them
        // or to run an installer needs the user's confirmation in a native dialog the renderer cannot drive.
        pinned: () => policyManager.updatePins(managedPolicy.values),
        confirmTrust: async ({ host, publisherThumbprint }) => {
          show();
          const { response } = await dialog.showMessageBox(window, {
            type: 'warning',
            buttons: ['Trust this publisher', 'Cancel'],
            defaultId: 1,
            cancelId: 1,
            noLink: true,
            title: 'Aeka Scribe updates',
            message: 'Trust a new update publisher?',
            detail:
              'Aeka Scribe will download and offer to install updates from this publisher only.\n\nUpdate feed: ' +
              host +
              '\nWindows publisher thumbprint: ' +
              publisherThumbprint +
              '\n\nContinue only if your administrator or the publisher supplied these details.',
          });
          return response === 0;
        },
        confirmInstall: async ({ version, publisher, publisherThumbprint }) => {
          show();
          const { response } = await dialog.showMessageBox(window, {
            type: 'question',
            buttons: ['Install and close Aeka Scribe', 'Cancel'],
            defaultId: 1,
            cancelId: 1,
            noLink: true,
            title: 'Aeka Scribe updates',
            message: 'Install Aeka Scribe ' + version + '?',
            detail:
              'Publisher: ' +
              (publisher || 'Unknown') +
              '\nWindows publisher thumbprint: ' +
              publisherThumbprint +
              '\n\nSave your edits first. Aeka Scribe closes while the installer runs.',
          });
          return response === 0;
        },
        launch: async (file) => {
          const error = await shell.openPath(file);
          if (error) throw Error(error);
          quitting = true;
          app.quit();
        },
      });
      powerMonitor.on('lock-screen', () => {
        locked = true;
      });
      powerMonitor.on('unlock-screen', () => {
        locked = false;
      });
      powerMonitor.on('suspend', () => {
        locked = true;
      });
      powerMonitor.on('resume', () => {
        // Resume does not imply a locked screen (sign-in may not be required after sleep); ask Windows.
        locked = powerMonitor.getSystemIdleState(1) === 'locked';
        calendarFreshAt = 0;
        void refreshCalendars().catch(() => {});
      });
      window = new BrowserWindow({
        width: 1380,
        height: 920,
        minWidth: 920,
        minHeight: 650,
        show: false,
        backgroundColor: '#ffffff',
        title: 'Aeka Scribe',
        webPreferences: {
          preload: path.join(__dirname, 'preload.cjs'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          backgroundThrottling: false,
          webSecurity: true,
        },
      });
      window.setMenuBarVisibility(false);
      window.on('close', (e) => {
        if (!quitting) {
          e.preventDefault();
          window.hide();
        }
      });
      window.once('ready-to-show', show);
      if (smokeTest) window.once('ready-to-show', () => void finishSmokeTest());
      window.webContents.on('render-process-gone', (_event, details) => {
        // The renderer owned the recording; reset main-process state so quit and dictation work again.
        recording = false;
        meeting = false;
        if (powerId !== null) {
          powerSaveBlocker.stop(powerId);
          powerId = null;
        }
        overlayState('idle');
        if (quitPending) {
          quitPending = false;
          quitting = true;
          app.quit();
          return;
        }
        if (details.reason !== 'clean-exit') window.reload();
      });
      // Windows log-off or shutdown: ask the renderer to save what it can.
      window.on('session-end', () => emit('app-finish'));
      window.webContents.setWindowOpenHandler(({ url }) => {
        try {
          const u = new URL(url);
          if (
            u.protocol === 'https:' &&
            ['developers.openai.com', 'developers.deepgram.com', 'elevenlabs.io'].includes(u.hostname)
          )
            void shell.openExternal(url);
        } catch {}
        return { action: 'deny' };
      });
      window.webContents.on('will-navigate', (e, url) => {
        if (url !== trustedURL) e.preventDefault();
      });
      const trusted = (wc, origin) => wc === window.webContents && origin.startsWith('file://');
      const permissionAllowed = (permission) =>
        ['media', 'display-capture'].includes(permission)
          ? managedPolicy.values.allowRecording
          : permission === 'clipboard-sanitized-write' && managedPolicy.values.allowExports;
      session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) =>
        callback(trusted(wc, details.requestingUrl || '') && permissionAllowed(permission)),
      );
      session.defaultSession.setPermissionCheckHandler(
        (wc, permission, origin) => trusted(wc, origin) && permissionAllowed(permission),
      );
      session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
        if (request.frame !== window.webContents.mainFrame || Date.now() > captureGrantedUntil) {
          callback({});
          return;
        }
        captureGrantedUntil = 0;
        try {
          const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: { width: 0, height: 0 },
          });
          if (sources[0]) callback({ video: sources[0], audio: 'loopback' });
          else callback({});
        } catch {
          callback({});
        }
      });
      ipcMain.handle('aeka-scribe', async (event, action, payload) => {
        if (
          event.sender !== window.webContents ||
          event.senderFrame !== window.webContents.mainFrame ||
          event.senderFrame.url !== trustedURL
        )
          return { ok: false, error: 'This window is not authorized.' };
        try {
          return { ok: true, value: await dispatch(action, payload) };
        } catch (e) {
          return { ok: false, error: e?.message || 'Desktop operation failed.' };
        }
      });
      await window.loadFile(ui);
      overlay = new BrowserWindow({
        width: 300,
        height: 48,
        frame: false,
        resizable: false,
        focusable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        show: false,
        backgroundColor: '#991b1e',
        webPreferences: {
          preload: path.join(__dirname, 'overlay-preload.cjs'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      overlay.setIgnoreMouseEvents(true);
      await overlay.loadFile(path.join(__dirname, 'overlay.html'));
      const icon = nativeImage.createFromPath(path.join(__dirname, 'ui-dist', 'aeka-scribe-icon.png'));
      tray = new Tray(icon);
      tray.setToolTip('Aeka Scribe');
      tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: 'Open Aeka Scribe', click: show },
          { label: 'Start / stop dictation', click: toggle },
          { label: 'Cancel dictation', click: () => emit('dictation-cancel') },
          { type: 'separator' },
          {
            label: 'Quit Aeka Scribe',
            click: () => {
              quitting = true;
              app.quit();
            },
          },
        ]),
      );
      tray.on('double-click', show);
      registerShortcuts(await workspace.settings());
      let automationChecking = false;
      timers.push(
        setInterval(async () => {
          if (automationChecking) return;
          automationChecking = true;
          try {
            await automation.tick({
              events: calendarCache,
              busy: recording || meeting,
              fresh: Date.now() - calendarFreshAt < 360000,
              locked:
                locked ||
                powerMonitor.getSystemIdleState(1) === 'locked' ||
                !managedPolicy.values.allowRecording,
            });
            automationError = '';
          } catch (e) {
            // Report a failing scheduler once instead of silently skipping every scheduled recording.
            const message = e?.message || 'Scheduled recordings could not be checked.';
            if (message !== automationError) emit('notice', { message: 'Scheduled recordings: ' + message });
            automationError = message;
          } finally {
            automationChecking = false;
          }
        }, 1000),
        setInterval(() => void cloudSync.tick(), 15000),
        setInterval(() => {
          void workspace.maintenance().catch(() => {});
          void integrations.recover().catch(() => {});
        }, 60000),
        setInterval(() => void updates.automatic(), 21600000),
      );
      void cloudSync.tick();
      void updates.automatic();
      void workspace.maintenance().catch(() => {});
      timers.push(
        setInterval(
          () =>
            void briefs
              .tick({
                events: calendarCache,
                fresh: Date.now() - calendarFreshAt < 360000,
                busy: recording || meeting,
              })
              .catch(() => {}),
          60000,
        ),
      );
      timers.push(
        setInterval(
          () =>
            void workspace.processQueue().catch((e) => console.error('Queue processing failed:', e?.message)),
          60000,
        ),
        setInterval(() => void refreshCalendars().catch(() => {}), 300000),
        setInterval(() => void remind().catch(() => {}), 15000),
      );
      let holding = false,
        holdStarted = false,
        checkingKey = false;
      timers.push(
        setInterval(async () => {
          if (!holdEnabled || checkingKey) return;
          checkingKey = true;
          try {
            const down = await windows.call('holdKey', { key: holdCode });
            if (down && !holding && !recording && !meeting) {
              holdStarted = true;
              await toggle();
            }
            if (!down && holding && holdStarted) {
              emit('dictation-stop');
              holdStarted = false;
            }
            holding = down;
          } catch {
          } finally {
            checkingKey = false;
          }
        }, 60),
      );
      let lastCall = 0;
      timers.push(
        setInterval(async () => {
          try {
            if (
              recording ||
              meeting ||
              !(await workspace.settings()).callDetection ||
              Date.now() - lastCall < 600000
            )
              return;
            const r = await windows.call('call');
            if (r.candidate) {
              lastCall = Date.now();
              emit('call-detected', { process: r.process });
              toast('Possible meeting detected', 'Open Aeka Scribe to confirm and start recording.');
            }
          } catch {}
        }, 15000),
      );
      void refreshCalendars().catch(() => {});
      void workspace.processQueue().catch((e) => console.error('Queue processing failed:', e?.message));
    })
    .catch((e) => {
      if (smokeTest) {
        console.error('Smoke launch failed:', e?.message || e);
        app.exit(1);
        return;
      }
      dialog.showErrorBox('Aeka Scribe could not start', e.message || 'Startup failed.');
      quitting = true;
      app.quit();
    });
  // If the window never reports the recording as finished (it crashed or hung), do not block every
  // later quit, including the installer's: offer to quit anyway after two minutes.
  function armQuitWatchdog() {
    clearTimeout(quitWatchdog);
    quitWatchdog = setTimeout(async () => {
      if (!quitPending) return;
      const { response } = await dialog.showMessageBox({
        type: 'warning',
        buttons: ['Quit anyway', 'Keep waiting'],
        defaultId: 1,
        cancelId: 1,
        message: 'The recording has not finished saving.',
        detail: 'Saved audio chunks are recovered on the next start. The current unsaved chunk may be lost.',
      });
      if (response === 0 && quitPending) {
        quitPending = false;
        quitting = true;
        app.quit();
      } else if (quitPending) armQuitWatchdog();
    }, 120000);
  }
  app.on('before-quit', (event) => {
    if ((recording || meeting) && !quitPending) {
      event.preventDefault();
      quitting = false;
      if (!quitPrompt) {
        quitPrompt = true;
        void dialog
          .showMessageBox(window, {
            type: 'question',
            buttons: ['Finish recording & quit', 'Keep Aeka Scribe open'],
            defaultId: 1,
            cancelId: 1,
            message: 'A recording or transcription is active.',
            detail: 'Aeka Scribe will finish and save the current recording before it closes.',
          })
          .then(({ response }) => {
            quitPrompt = false;
            if (response === 0) {
              quitPending = true;
              emit('app-finish');
              armQuitWatchdog();
            }
          });
      }
      return;
    }
    if (quitPending) {
      event.preventDefault();
      return;
    }
    quitting = true;
    timers.forEach(clearInterval);
    workspace?.close();
    briefs?.close();
    cloudSync?.close();
    calendars?.close();
    windows?.close();
    globalShortcut.unregisterAll();
  });
  app.on('window-all-closed', () => {
    if (quitting) app.quit();
  });
}
