export function createAutomation({ vault, emit, join = async () => {}, now = Date.now }) {
  let lock = Promise.resolve();
  const mutate = (fn) => {
    const p = lock.then(fn);
    lock = p.catch(() => {});
    return p;
  };
  const list = async () => {
    await lock;
    return vault.read('automation', []);
  };
  const arm = (event) =>
    mutate(async () => {
      if (
        !event?.participantsInformed ||
        !event?.id ||
        typeof event.id !== 'string' ||
        event.id.length > 500 ||
        !Number.isFinite(Date.parse(event.start)) ||
        !Number.isFinite(Date.parse(event.end)) ||
        Date.parse(event.end) <= now() ||
        Date.parse(event.end) > now() + 15 * 86400000
      )
        throw Error('Choose an upcoming meeting and confirm participants know it will be recorded.');
      const entries = await vault.read('automation', []);
      const entry = {
        id: event.id,
        title: String(event.title).slice(0, 300),
        start: event.start,
        end: event.end,
        join: event.join === true,
        systemAudio: event.systemAudio !== false,
        grace: [0, 5, 10, 15].includes(event.grace) ? event.grace : 5,
        state: 'armed',
        noteId: '',
        updatedAt: now(),
      };
      await vault.write('automation', [entry, ...entries.filter((x) => x.id !== event.id)].slice(0, 100));
      emit('automation-changed', {});
      return entry;
    });
  const change = (id, fn) =>
    mutate(async () => {
      const entries = await vault.read('automation', []),
        e = entries.find((x) => x.id === id);
      if (e) fn(e);
      await vault.write('automation', entries);
      emit('automation-changed', {});
      return e;
    });
  const cancel = (id) =>
    change(id, (e) => {
      if (['running', 'starting'].includes(e.state)) emit('automation-stop', { id: e.id, noteId: e.noteId });
      e.state = 'cancelled';
    });
  const tick = ({ events = [], busy = false, fresh = false, locked = false }) =>
    mutate(async () => {
      const entries = await vault.read('automation', []),
        at = now();
      let changed = false;
      for (const e of entries) {
        if (e.state === 'running') {
          if (at >= Date.parse(e.end) + e.grace * 60000) {
            e.state = 'finished';
            emit('automation-stop', { id: e.id, noteId: e.noteId });
            changed = true;
          }
          continue;
        }
        if (e.state === 'starting') {
          if (at - e.updatedAt > 45000) {
            e.state = 'failed';
            e.reason = 'The recording did not start.';
            changed = true;
          }
          continue;
        }
        if (!['armed', 'countdown'].includes(e.state)) continue;
        const live = events.find((x) => x.id === e.id);
        if (fresh && !live) {
          e.state = 'cancelled';
          e.reason = 'Calendar event was removed.';
          changed = true;
          continue;
        }
        if (live && e.start !== live.start) {
          e.start = live.start;
          e.end = live.end;
          e.state = 'armed';
          delete e.deadline;
          changed = true;
        } else if (live && e.end !== live.end) {
          e.end = live.end;
          changed = true;
        }
        const delta = at - Date.parse(e.start);
        if (delta < 0) continue;
        if (!fresh || !live || locked || busy || delta > 120000) {
          e.state = 'skipped';
          e.reason = locked
            ? 'Windows is locked.'
            : busy
              ? 'Another recording is active.'
              : !fresh
                ? 'Calendar refresh is unavailable.'
                : 'The scheduled start was missed.';
          changed = true;
          continue;
        }
        if (e.state === 'armed') {
          e.state = 'countdown';
          e.deadline = at + 20000;
          changed = true;
          emit('automation-countdown', { entry: e });
          continue;
        }
        if (at >= e.deadline) {
          e.state = 'starting';
          e.updatedAt = at;
          changed = true;
          await vault.write('automation', entries);
          if (e.join && live.url)
            try {
              await join(live);
            } catch {
              emit('notice', { message: 'The meeting link could not open. Recording will still start.' });
            }
          emit('automation-start', { entry: e, event: live });
        }
      }
      if (changed) {
        await vault.write('automation', entries);
        emit('automation-changed', {});
      }
    });
  return {
    list,
    arm,
    cancel,
    tick,
    started: (id, noteId, success) =>
      change(id, (e) => {
        if (e.state !== 'starting') throw Error('This automatic start was cancelled.');
        e.state = success ? 'running' : 'failed';
        e.noteId = String(noteId || '');
        e.updatedAt = now();
      }),
    extend: (id) =>
      change(id, (e) => {
        if (e.state === 'running') e.end = new Date(Date.parse(e.end) + 15 * 60000).toISOString();
      }),
    finish: (noteId) =>
      mutate(async () => {
        const entries = await vault.read('automation', []);
        for (const e of entries) if (e.noteId === noteId && e.state === 'running') e.state = 'finished';
        await vault.write('automation', entries);
        emit('automation-changed', {});
      }),
    recover: () =>
      mutate(async () => {
        const entries = await vault.read('automation', []);
        for (const e of entries)
          if (['running', 'starting', 'countdown'].includes(e.state)) {
            e.state = 'interrupted';
            e.reason = 'Flow restarted; start recording manually.';
          }
        await vault.write('automation', entries);
      }),
  };
}
