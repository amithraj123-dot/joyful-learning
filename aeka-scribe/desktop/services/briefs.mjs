import crypto from 'node:crypto';
import { noteDetails, isTrashed } from '../generated/note-details.mjs';
export const briefDefaults = { enabled: false, hour: 6, lookAheadHours: 24, folder: 'Briefs', maxPerDay: 20 };
export function validBriefSettings(p) {
  if (
    !p ||
    typeof p.enabled !== 'boolean' ||
    !Number.isInteger(p.hour) ||
    p.hour < 0 ||
    p.hour > 23 ||
    ![12, 24, 48].includes(p.lookAheadHours) ||
    typeof p.folder !== 'string' ||
    p.folder.length > 100 ||
    ![5, 10, 20].includes(p.maxPerDay)
  )
    throw Error('Invalid briefing schedule.');
  return {
    enabled: p.enabled,
    hour: p.hour,
    lookAheadHours: p.lookAheadHours,
    folder: p.folder.trim(),
    maxPerDay: p.maxPerDay,
  };
}
export function createBriefs({ vault, workspace, emit = () => {}, now = Date.now, permitted = () => true }) {
  let running = false,
    closed = false;
  const settings = () => vault.read('brief-settings', { ...briefDefaults });
  const status = async () => ({
    settings: await settings(),
    running,
    history: (await vault.read('brief-history', [])).slice(0, 50),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  const configure = async (p) => {
    const s = validBriefSettings(p);
    await vault.write('brief-settings', s);
    return status();
  };
  const key = (e) =>
    crypto
      .createHash('sha256')
      .update(e.id + '\n' + e.start)
      .digest('hex')
      .slice(0, 40);
  const recover = async () => {
    const all = await vault.read('brief-history', []);
    for (const h of all)
      if (h.state === 'generating') {
        h.state = 'interrupted';
        h.error = 'Aeka Scribe closed during generation. Retry explicitly if needed.';
      }
    await vault.write('brief-history', all);
  };
  const tick = async ({ events = [], fresh = false, busy = false, force = false } = {}) => {
    if (running || closed || busy) return status();
    running = true;
    try {
      const s = await settings();
      if ((!s.enabled && !force) || !fresh || !permitted()) return status();
      const time = now(),
        date = new Date(time),
        day = date.toLocaleDateString('en-CA');
      if (!force && date.getHours() < s.hour) return status();
      const configured = await workspace.status();
      if (!configured.openaiConfigured) {
        return status();
      }
      let all = await vault.read('brief-history', []);
      const today = all.filter((x) => x.day === day).length;
      if (today >= s.maxPerDay) return status();
      const candidates = events
        .filter(
          (e) =>
            (e.url || e.attendees?.length) &&
            Number.isFinite(Date.parse(e.start)) &&
            Date.parse(e.start) > time &&
            Date.parse(e.start) <= time + s.lookAheadHours * 3600000 &&
            Date.parse(e.end) > Date.parse(e.start) &&
            !all.some((h) => h.key === key(e)),
        )
        .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
      // One generation per minute tick: bound cost and keep the recorder responsive.
      const event = candidates[0];
      if (!event) return status();
      const id = 'brief_' + key(event),
        old = (await workspace.list()).find((n) => n.eventId === event.id && !isTrashed(n));
      const h = {
        key: key(event),
        eventId: event.id,
        noteId: old?.id || id,
        title: event.title.slice(0, 300),
        start: event.start,
        at: time,
        day,
        state: 'generating',
        error: '',
      };
      all = [h, ...all].slice(0, 500);
      await vault.write('brief-history', all);
      try {
        const latest = await settings();
        if (closed || (!latest.enabled && !force) || !permitted())
          throw Error('Brief generation was disabled.');
        let note = old;
        if (note && (noteDetails(note).brief || note.status === 'recording')) {
          h.state = 'skipped';
          h.error = noteDetails(note).brief ? 'A brief already exists.' : 'Meeting is recording.';
        } else {
          if (!note) {
            const studio = (await workspace.studioGet()).config;
            note = await workspace.save(
              {
                id,
                title: event.title,
                kind: 'meeting',
                createdAt: time,
                updatedAt: time,
                folder: s.folder,
                body: '',
                summary: '',
                segments: [],
                speakers: {},
                eventId: event.id,
                status: 'draft',
                duration: 0,
                details: {
                  ...noteDetails({}),
                  attendees: event.attendees || [],
                  eventStart: event.start,
                  eventEnd: event.end,
                  eventUrl: event.url || '',
                  templateId: studio.defaultTemplate,
                },
              },
              0,
            );
          }
          const result = await workspace.ai({ kind: 'brief', noteIds: [note.id] });
          if (closed || (!force && !(await settings()).enabled) || !permitted())
            throw Error('Brief generation stopped before saving.');
          await workspace.save(
            { ...note, details: { ...noteDetails(note), brief: result.text.slice(0, 30000) } },
            note.updatedAt,
          );
          h.state = 'ready';
          emit('brief-ready', { noteId: note.id, title: note.title });
        }
      } catch (e) {
        h.state = 'failed';
        h.error = String(e.message || 'Brief generation failed.').slice(0, 300);
      }
      await vault.write('brief-history', all);
      emit('briefs-changed', {});
      return status();
    } finally {
      running = false;
    }
  };
  const retry = async (id) => {
    if (running) throw Error('Wait for the current brief to finish.');
    const all = await vault.read('brief-history', []),
      h = all.find((x) => x.key === id);
    if (!h || !['failed', 'interrupted'].includes(h.state))
      throw Error('Only failed or interrupted briefs can be retried.');
    await vault.write(
      'brief-history',
      all.filter((x) => x.key !== id),
    );
    return status();
  };
  return {
    status,
    configure,
    tick,
    retry,
    recover,
    close: () => {
      closed = true;
    },
  };
}
