import { createSemantic } from './semantic.mjs';
import { extractImageText } from '../generated/image-context.mjs';
import { noteHash } from './sync.mjs';
import crypto from 'node:crypto';
import { validNote, upsertSegment } from '../generated/workspace-core.mjs';
import { validateBackup } from '../generated/flow-core.mjs';
import { audioToText, textAI } from './ai.mjs';
import {
  defaultStudio,
  validStudio,
  prepareStudioTask,
  parseActions,
  scopeNotes,
  builtinRecipes,
} from '../generated/meeting-studio.mjs';
import { isTrashed } from '../generated/note-details.mjs';

export const desktopDefaults = {
  launchAtLogin: false,
  autoPaste: true,
  holdToTalk: false,
  shortcut: 'CommandOrControl+Shift+Space',
  // Ctrl+Shift+Esc is Task Manager and Ctrl+Shift+V is "paste as plain text" in most apps.
  cancelShortcut: 'CommandOrControl+Shift+Backspace',
  pasteShortcut: 'CommandOrControl+Alt+V',
  commandShortcut: 'CommandOrControl+Shift+E',
  reminders: true,
  reminderMinutes: 2,
  callDetection: false,
  retainAudio: false,
  autoSummary: false,
  meetingLanguage: 'en',
  textModel: 'gpt-4.1-mini',
  customTransforms: [],
  appStyles: [],
  excludedApps: ['1Password', 'KeePass', 'Bitwarden'],
  captureSelection: false,
  asrEngine: 'openai',
  liveSpeakers: false,
  retentionDays: 0,
};
export function validDesktopSettings(v) {
  const s = { ...desktopDefaults };
  if (!v || typeof v !== 'object') return s;
  for (const k of [
    'launchAtLogin',
    'autoPaste',
    'holdToTalk',
    'reminders',
    'callDetection',
    'retainAudio',
    'autoSummary',
    'captureSelection',
    'liveSpeakers',
  ])
    if (typeof v[k] === 'boolean') s[k] = v[k];
  for (const k of ['shortcut', 'cancelShortcut', 'pasteShortcut', 'commandShortcut'])
    if (
      typeof v[k] === 'string' &&
      v[k].length <= 80 &&
      /^(CommandOrControl|Control|Alt|Shift|Super|F[1-9])/.test(v[k])
    )
      s[k] = v[k];
  // Settings saved by 0.5 carry the old, conflicting defaults; move those (and only those) to the new ones.
  if (s.cancelShortcut === 'CommandOrControl+Shift+Escape')
    s.cancelShortcut = 'CommandOrControl+Shift+Backspace';
  if (s.pasteShortcut === 'CommandOrControl+Shift+V') s.pasteShortcut = 'CommandOrControl+Alt+V';
  s.asrEngine = v.asrEngine === 'local' ? 'local' : 'openai';
  s.retentionDays = [0, 7, 30, 90, 365].includes(v.retentionDays) ? v.retentionDays : 0;
  s.reminderMinutes = [0, 1, 2, 5, 10].includes(v.reminderMinutes) ? v.reminderMinutes : 2;
  if (typeof v.meetingLanguage === 'string' && /^[a-z]{2,3}$/.test(v.meetingLanguage))
    s.meetingLanguage = v.meetingLanguage;
  if (typeof v.textModel === 'string' && /^[a-zA-Z0-9._-]{1,100}$/.test(v.textModel))
    s.textModel = v.textModel;
  if (Array.isArray(v.excludedApps))
    s.excludedApps = v.excludedApps.filter((x) => typeof x === 'string' && x.length <= 100).slice(0, 50);
  if (Array.isArray(v.appStyles))
    s.appStyles = v.appStyles
      .filter(
        (x) =>
          x &&
          typeof x.process === 'string' &&
          x.process.length <= 100 &&
          ['verbatim', 'clean', 'sentences', 'notes'].includes(x.style),
      )
      .slice(0, 50)
      .map((x) => ({ process: x.process, style: x.style }));
  if (Array.isArray(v.customTransforms))
    s.customTransforms = v.customTransforms
      .filter((x) => typeof x === 'string' && x.length <= 4000 && x.trim())
      .slice(0, 8);
  return s;
}
export function createWorkspace({
  vault,
  emit,
  fetcher = fetch,
  localTranscribe,
  policy = () => ({ allowCloudAI: true, allowRecording: true, allowAudioRetention: true, retentionDays: 0 }),
}) {
  let lock = Promise.resolve(),
    processing = false,
    closed = false;
  const mutate = (fn) => {
    const p = lock.then(fn);
    lock = p.catch(() => {});
    return p;
  };
  const notes = () => vault.read('notes', []);
  const writeNotes = async (all) => {
    if (Buffer.byteLength(JSON.stringify(all)) > 16 * 1024 * 1024)
      throw Error('The 16 MB note workspace limit is reached. Export and remove older notes.');
    await vault.write('notes', all);
  };
  const list = async () => {
    await lock;
    return notes();
  };
  // One note, or each note's id and revision in list order, for callers that need no more.
  const get = async (id) => (await list()).find((n) => n.id === id) || null;
  const index = async () => (await list()).map((n) => ({ id: n.id, updatedAt: n.updatedAt }));
  const save = async (value, baseUpdatedAt) =>
    mutate(async () => {
      const n = validNote(value),
        all = await notes(),
        old = all.find((x) => x.id === n.id);
      if (!old && baseUpdatedAt !== undefined && baseUpdatedAt !== 0)
        throw Error('This note was deleted elsewhere. Save your edits in a new note.');
      if (old && old.updatedAt !== baseUpdatedAt)
        throw Error('This note changed in another window. Refresh before saving.');
      if (
        isTrashed(n) &&
        !isTrashed(old || {}) &&
        (old?.status === 'recording' ||
          n.status === 'recording' ||
          (await vault.read('queue', [])).some((q) => q.noteId === n.id && !q.done))
      )
        throw Error('Finish recording and pending transcription before moving this note to trash.');
      if (!old && all.length >= 2000) throw Error('Export older notes before adding more.');
      n.updatedAt = Math.max(Date.now(), (old?.updatedAt || 0) + 1);
      await writeNotes([n, ...all.filter((x) => x.id !== n.id)]);
      emit('notes-changed', { id: n.id });
      return n;
    }).then(async (result) => {
      await semantic.prune();
      return result;
    });
  const remove = async (id, baseUpdatedAt) =>
    mutate(async () => {
      if (!/^[\w-]{1,100}$/.test(id)) throw Error('Invalid note.');
      const current = (await notes()).find((x) => x.id === id);
      if (current && baseUpdatedAt !== undefined && current.updatedAt !== baseUpdatedAt)
        throw Error('This note changed before deletion. Refresh first.');
      await writeNotes((await notes()).filter((x) => x.id !== id));
      const q = await vault.read('queue', []),
        matched = q.filter((x) => x.noteId === id);
      await vault.write(
        'queue',
        q.filter((x) => x.noteId !== id),
      );
      for (const item of matched) await vault.remove('audio_' + item.id);
      const deleted = await vault.read('deleted', {});
      deleted[id] = Date.now();
      await vault.write('deleted', deleted);
      emit('notes-changed', { id });
      return true;
    }).then(async (result) => {
      await semantic.prune();
      return result;
    });
  const credentials = () => vault.read('credentials', {});
  const settings = async () => {
    const s = validDesktopSettings(await vault.read('settings', {})),
      p = policy();
    if (!p.allowAudioRetention) s.retainAudio = false;
    if (p.retentionDays)
      s.retentionDays = s.retentionDays ? Math.min(s.retentionDays, p.retentionDays) : p.retentionDays;
    return s;
  };
  const speech = async (p) => {
    const s = await settings();
    if (s.asrEngine === 'local') {
      if (!localTranscribe) throw Error('Configure local speech recognition first.');
      if (p.diarize) throw Error('Speaker separation requires the OpenAI engine.');
      return localTranscribe(p);
    }
    if (!policy().allowCloudAI) throw Error('Cloud AI is disabled by managed policy.');
    return audioToText((await credentials()).openaiKey, p, fetcher);
  };
  const studioGet = async () => {
    await lock;
    return vault.read('studio', { config: defaultStudio(), revision: 0 });
  };
  const studioSave = async (config, revision) =>
    mutate(async () => {
      const old = await vault.read('studio', { revision: 0 });
      if (old.revision !== revision)
        throw Error('Templates changed in another window. Reload before saving.');
      const saved = { config: validStudio(config), revision: Math.max(Date.now(), old.revision + 1) };
      await vault.write('studio', saved);
      return saved;
    });
  const semantic = createSemantic({
    vault,
    getNotes: list,
    getKey: async () => (await credentials()).openaiKey,
    permitted: () => policy().allowCloudAI,
    fetcher,
    emit,
  });
  const ai = async (p) => {
    const c = await credentials(),
      s = await settings();
    if (!policy().allowCloudAI) throw Error('Cloud AI is disabled by managed policy.');
    const all = await list(),
      config = (await studioGet()).config,
      params = { noteIds: [], text: '', instruction: '', ...p };
    let task = prepareStudioTask(all, config, params),
      semanticUsed = null;
    if (['ask', 'recipe'].includes(p.kind)) {
      const query =
        p.kind === 'recipe'
          ? ([...builtinRecipes, ...config.recipes].find((r) => r.id === p.recipeId)?.prompt || '') +
            ' ' +
            params.text
          : params.text;
      semanticUsed = await semantic.rank(scopeNotes(all, params.noteIds, params.scope), query);
      if (semanticUsed) task = prepareStudioTask(all, config, params, semanticUsed.ids);
    }
    const text = await textAI(
      c.openaiKey,
      { input: task.input, instructions: task.instructions, model: s.textModel },
      fetcher,
    );
    return {
      text,
      sources: task.sources,
      coverage: { ...task.coverage, ...(semanticUsed ? { semanticIndexed: semanticUsed.indexed } : {}) },
      ...(p.kind === 'actions' ? { actions: parseActions(text) } : {}),
    };
  };

  const queueStatus = async () => {
    await lock;
    return (await vault.read('queue', []))
      .filter((x) => !x.done)
      .map(({ id, noteId, start, end, error }) => ({ id, noteId, start, end, error: error || '' }));
  };
  const runQueue = async () => {
    if (processing || closed) return;
    processing = true;
    try {
      const c = await credentials(),
        s = await settings();
      if (s.asrEngine !== 'local' && (!c.openaiKey || !policy().allowCloudAI)) return;
      const items = (await vault.read('queue', [])).filter((x) => !x.done);
      for (const item of items) {
        if (closed) break;
        try {
          const record = await vault.read('audio_' + item.id);
          if (!record) throw Error('Saved audio is missing.');
          const result = await speech({
            audioBuffer: Buffer.from(record.audio, 'base64'),
            filename: 'meeting.wav',
            mime: 'audio/wav',
            language: item.language,
            keywords: item.keywords,
            diarize: s.liveSpeakers && s.asrEngine === 'openai',
          });
          await mutate(async () => {
            const all = await notes(),
              note = all.find((x) => x.id === item.noteId),
              q = await vault.read('queue', []),
              still = q.find((x) => x.id === item.id);
            if (!still) return;
            if (note && !isTrashed(note)) {
              note.duration = Math.max(note.duration, item.end);
              if (result.segments?.length) {
                for (const [index, seg] of result.segments.entries()) {
                  const start = Math.min(item.end, item.start + seg.start),
                    end = Math.min(item.end, item.start + seg.end);
                  note.segments = upsertSegment(note.segments, {
                    id: item.id + '_' + index,
                    start,
                    end: Math.max(start, end),
                    text: seg.text,
                    speaker: (item.id.slice(0, 8) + '_' + seg.speaker).slice(0, 100),
                  });
                }
              } else
                note.segments = upsertSegment(note.segments, {
                  id: item.id,
                  start: item.start,
                  end: item.end,
                  text: result.text,
                  speaker: '',
                });
              note.updatedAt = Math.max(Date.now(), note.updatedAt + 1);
              await writeNotes(all);
            }
            const keep = (await settings()).retainAudio;
            if (keep) {
              still.done = true;
              still.error = '';
            } else {
              q.splice(q.indexOf(still), 1);
              await vault.remove('audio_' + item.id);
            }
            await vault.write('queue', q);
          });
          emit('notes-changed', { id: item.noteId });
        } catch (e) {
          await mutate(async () => {
            const q = await vault.read('queue', []),
              found = q.find((x) => x.id === item.id);
            if (found) {
              found.error = String(e.message || 'Transcription failed.').slice(0, 300);
              await vault.write('queue', q);
            }
          });
          emit('queue-changed', {});
          break;
        }
      }
    } finally {
      processing = false;
      emit('queue-changed', {});
    }
  };
  let queueRun = null;
  const processQueue = async () => {
    if (queueRun) {
      await queueRun;
      return processQueue();
    }
    queueRun = runQueue();
    try {
      return await queueRun;
    } finally {
      queueRun = null;
    }
  };
  const enqueue = async (p) => {
    if (!policy().allowRecording) throw Error('Recording is disabled by managed policy.');
    if (
      !p ||
      !/^[\w-]{1,100}$/.test(p.id) ||
      !/^[\w-]{1,100}$/.test(p.noteId) ||
      !Number.isFinite(p.start) ||
      !Number.isFinite(p.end) ||
      p.start < 0 ||
      p.end <= p.start ||
      p.end - p.start > 65
    )
      throw Error('Invalid audio segment.');
    const b = Buffer.from(p.audioBuffer || []);
    if (
      b.length < 44 ||
      b.length > 7 * 1024 * 1024 ||
      b.toString('ascii', 0, 4) !== 'RIFF' ||
      b.toString('ascii', 8, 12) !== 'WAVE'
    )
      throw Error('Invalid meeting audio.');
    await mutate(async () => {
      const all = await notes(),
        note = all.find((n) => n.id === p.noteId);
      if (!note || isTrashed(note)) throw Error('Save or restore the meeting before recording.');
      const q = await vault.read('queue', []);
      if (
        q.some((x) => x.id === p.id) ||
        note.segments.some((x) => x.id === p.id || x.id.startsWith(p.id + '_'))
      )
        return;
      if (q.length >= 3000) throw Error('The recording queue is full. Export or clear older recordings.');
      await vault.write('audio_' + p.id, { audio: b.toString('base64') });
      q.push({
        id: p.id,
        noteId: p.noteId,
        start: p.start,
        end: p.end,
        language: typeof p.language === 'string' ? p.language.slice(0, 3) : 'en',
        keywords: Array.isArray(p.keywords)
          ? p.keywords.filter((x) => typeof x === 'string').slice(0, 100)
          : [],
        done: false,
      });
      await vault.write('queue', q);
      note.duration = Math.max(note.duration, p.end);
      note.updatedAt = Math.max(Date.now(), note.updatedAt + 1);
      await writeNotes(all);
    });
    emit('queue-changed', {});
    void processQueue();
    return { saved: true };
  };
  const profileGet = async () => {
    const p = await vault.read('profile');
    if (p && p.version === undefined && validateBackup({ ...p, version: 2 })) {
      const migrated = { ...p, version: 2 };
      await vault.write('profile', migrated);
      return migrated;
    }
    return p;
  };
  const backup = async () => {
    await lock;
    return {
      version: 3,
      notes: await notes(),
      profile: await profileGet(),
      studio: await vault.read('studio', { config: defaultStudio(), revision: 0 }),
      settings: await settings(),
      deleted: await vault.read('deleted', {}),
      createdAt: Date.now(),
    };
  };
  const restore = async (data) => {
    if (data?.version !== 3 || !Array.isArray(data.notes) || data.notes.length > 2000)
      throw Error('This is not an Aeka Scribe backup.');
    const studio = data.studio ? validStudio(data.studio.config) : null;
    const incoming = data.notes.map(validNote),
      profile = data.profile ? validateBackup(data.profile) : null;
    if (data.profile && !profile) throw Error('Backup dictation profile is invalid.');
    return mutate(async () => {
      const all = await notes();
      let added = 0,
        conflicts = 0;
      for (const n of incoming) {
        const old = all.find((x) => x.id === n.id);
        if (!old) {
          all.push(n);
          added++;
        } else if (JSON.stringify({ ...old, updatedAt: 0 }) !== JSON.stringify({ ...n, updatedAt: 0 })) {
          const copyId =
            'import_' +
            crypto
              .createHash('sha256')
              .update(JSON.stringify({ ...n, updatedAt: 0 }))
              .digest('hex')
              .slice(0, 32);
          if (!all.some((x) => x.id === copyId)) {
            all.push({
              ...n,
              id: copyId,
              title: (n.title + ' (imported copy)').slice(0, 300),
              updatedAt: Date.now(),
            });
            conflicts++;
          }
        }
      }
      if (all.length > 2000) throw Error('Too many notes in merged backup.');
      await writeNotes(all);
      if (studio) {
        const old = await vault.read('studio', { revision: 0 });
        await vault.write('studio', { config: studio, revision: Math.max(Date.now(), old.revision + 1) });
      }
      if (profile) await vault.write('profile', { version: 2, ...profile });
      if (data.settings) await vault.write('settings', validDesktopSettings(data.settings));
      emit('notes-changed', {});
      return { added, conflicts };
    });
  };
  const recover = async () =>
    mutate(async () => {
      const all = await notes();
      let changed = false;
      for (const n of all)
        if (n.status === 'recording') {
          n.status = 'interrupted';
          n.updatedAt = Date.now();
          changed = true;
        }
      if (changed) await writeNotes(all);
    });
  const syncApply = (incoming, expected, id) =>
    mutate(async () => {
      const all = await notes(),
        old = all.find((n) => n.id === id);
      if (
        old?.updatedAt !== expected ||
        old?.status === 'recording' ||
        (await vault.read('queue', [])).some((x) => x.noteId === id && !x.done)
      )
        return false;
      if (incoming && !old && all.length >= 2000) throw Error('The local note limit is reached.');
      if (!incoming) {
        const q = await vault.read('queue', []);
        for (const item of q.filter((x) => x.noteId === id)) await vault.remove('audio_' + item.id);
        await vault.write(
          'queue',
          q.filter((x) => x.noteId !== id),
        );
      }
      await writeNotes(
        incoming ? [validNote(incoming), ...all.filter((n) => n.id !== id)] : all.filter((n) => n.id !== id),
      );
      emit('notes-changed', { id });
      return true;
    }).then(async (result) => {
      await semantic.prune();
      return result;
    });
  const syncConflict = (value) =>
    mutate(async () => {
      const all = await notes(),
        id = 'conflict_' + noteHash(value).slice(0, 40);
      if (!all.some((n) => n.id === id)) {
        if (all.length >= 2000) throw Error('Free space for a conflict copy before syncing.');
        all.push({
          ...validNote(value),
          id,
          title: (value.title + ' (conflict copy)').slice(0, 300),
          updatedAt: Date.now(),
          status: value.status === 'recording' ? 'interrupted' : value.status,
        });
        await writeNotes(all);
        emit('notes-changed', { id });
      }
      return id;
    });
  const maintenance = async () => {
    const s = await settings(),
      all = await list(),
      pending = await queueStatus();
    for (const n of all)
      if (
        n.status !== 'recording' &&
        ((s.retentionDays && n.updatedAt < Date.now() - s.retentionDays * 86400000) ||
          (isTrashed(n) && n.details.trashedAt < Date.now() - 30 * 86400000)) &&
        !pending.some((x) => x.noteId === n.id)
      )
        await remove(n.id);
    if (s.autoSummary && policy().allowCloudAI && (await credentials()).openaiKey)
      for (const n of all
        .filter(
          (n) =>
            !isTrashed(n) &&
            n.kind === 'meeting' &&
            n.status === 'complete' &&
            !n.summary &&
            n.segments.length &&
            !pending.some((x) => x.noteId === n.id),
        )
        .slice(0, 1)) {
        const previous = await vault.read('summary-attempts', {});
        if (Date.now() - (previous[n.id] || 0) < 600000) continue;
        previous[n.id] = Date.now();
        await vault.write('summary-attempts', previous);
        const result = await ai({ kind: 'summary', noteIds: [n.id] });
        try {
          await save({ ...n, summary: result.text }, n.updatedAt);
        } catch {
          /* A newer edit always wins. */
        }
      }
  };
  return {
    semantic,
    list,
    get,
    index,
    save,
    remove,
    ai,
    studioGet,
    studioSave,
    enqueue,
    syncApply,
    syncConflict,
    maintenance,
    queueStatus,
    processQueue,
    backup,
    restore,
    recover,
    settings,
    status: async () => ({
      openaiConfigured: policy().allowCloudAI && !!(await credentials()).openaiKey,
      model: 'gpt-transcribe',
      settings: await settings(),
      platform: process.platform,
      version: '0.5.0',
      speechConfigured:
        (await settings()).asrEngine === 'local'
          ? policy().allowLocalASR !== false && !!(await vault.read('local-asr', {})).model
          : policy().allowCloudAI && !!(await credentials()).openaiKey,
    }),
    setSettings: async (v) => {
      const s = validDesktopSettings(v);
      await vault.write('settings', s);
      return s;
    },
    setKey: async (key) => {
      if (typeof key !== 'string' || key.length > 600 || (key && !/^sk-[A-Za-z0-9_-]+$/.test(key)))
        throw Error('Enter a valid OpenAI API key.');
      const c = await credentials();
      await vault.write('credentials', { ...c, openaiKey: key });
      void processQueue();
      return { configured: !!key };
    },
    extractImage: async (image) => {
      if (!policy().allowCloudAI) throw Error('Cloud AI is disabled by managed policy.');
      return extractImageText((await credentials()).openaiKey, image, fetcher);
    },
    transcribe: speech,
    profileGet,
    profileSave: async (p) => {
      const v = validateBackup(p);
      if (!v) throw Error('Invalid dictation profile.');
      await vault.write('profile', { version: 2, ...v });
      return true;
    },
    clearAudio: async () =>
      mutate(async () => {
        const q = await vault.read('queue', []);
        for (const x of q) await vault.remove('audio_' + x.id);
        await vault.write('queue', []);
        emit('queue-changed', {});
        return true;
      }),
    close: () => {
      closed = true;
      semantic.cancel();
    },
  };
}
