import crypto from 'node:crypto';
const canonical = (v) =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical(v[k])]),
        )
      : v;
export const noteHash = (n) =>
  crypto
    .createHash('sha256')
    .update(JSON.stringify(canonical({ ...n, updatedAt: 0 })))
    .digest('hex');
export function syncDecision(local, remote, baseline) {
  if (!baseline) {
    if (local && remote) return 'compare';
    return local ? 'push' : remote ? 'pull' : 'none';
  }
  const changed = !!local && noteHash(local) !== baseline.hash,
    remoteChanged = !!remote && remote.updated_at !== baseline.remote;
  if (!local && !remote) return 'forget';
  if (!local) return remoteChanged ? 'pull' : 'delete-remote';
  if (!remote) return changed ? 'conflict-deleted' : 'delete-local';
  if (changed && remoteChanged) return 'compare';
  return changed ? 'push' : remoteChanged ? 'pull' : 'none';
}
export function createSync({ vault, workspace, request, emit, permitted = () => true }) {
  let running = false,
    error = '',
    lastSync = 0,
    closed = false;
  const status = async () => {
    const s = await vault.read('cloud-sync', {});
    return { enabled: !!s.enabled, account: s.email || '', lastSync, running, error };
  };
  const tick = async () => {
    const config = await vault.read('cloud-sync', {});
    if (!config.enabled || running || closed) return;
    if (!permitted()) {
      error = 'Sync is disabled by your managed policy.';
      return;
    }
    running = true;
    error = '';
    try {
      const identity = await request({ action: 'status' });
      if (config.account && config.account !== identity.account)
        throw Error(
          'A different account is signed in. Sign back in to ' +
            config.email +
            '; sync has stopped to protect your notes.',
        );
      config.account = identity.account;
      config.email = identity.email;
      const state = await vault.read('sync-baseline', {}),
        remote = new Map((await request({ action: 'sync.index' })).map((x) => [x.id, x])),
        local = new Map((await workspace.list()).map((x) => [x.id, x])),
        pending = new Set((await workspace.queueStatus()).map((x) => x.noteId));
      let operations = 0;
      for (const id of new Set([...local.keys(), ...remote.keys(), ...Object.keys(state)])) {
        if (closed || !(await vault.read('cloud-sync', {})).enabled) break;
        if (operations >= 25) break;
        const l = local.get(id),
          r = remote.get(id),
          base = state[id];
        if (pending.has(id) || l?.status === 'recording' || (await workspace.isBusy?.(id))) continue;
        const decision = syncDecision(l, r, base);
        if (decision === 'none') continue;
        operations++;
        if (decision === 'forget') {
          delete state[id];
          continue;
        }
        if (decision === 'delete-remote') {
          await request({ action: 'sync.delete', id, baseUpdatedAt: base.remote });
          delete state[id];
          continue;
        }
        if (decision === 'delete-local') {
          if (await workspace.syncApply(null, l.updatedAt, id)) delete state[id];
          continue;
        }
        if (decision === 'conflict-deleted') {
          await workspace.syncConflict(l);
          if (await workspace.syncApply(null, l.updatedAt, id)) delete state[id];
          continue;
        }
        if (decision === 'push') {
          try {
            const saved = await request({ action: 'sync.save', note: l, baseUpdatedAt: r?.updated_at || 0 });
            await workspace.syncApply(saved, l.updatedAt, id);
            state[id] = { remote: saved.updatedAt, hash: noteHash(saved) };
          } catch (e) {
            if (e.status === 410) {
              await workspace.syncConflict(l);
              await workspace.syncApply(null, l.updatedAt, id);
              delete state[id];
            } else if (e.status === 409) {
              error = 'A note changed during sync. It will be checked again on the next pass.';
            } else throw e;
          }
          continue;
        }
        const incoming = await request({ action: 'sync.get', id });
        if (!incoming || incoming.status === 'recording') continue;
        if (decision === 'compare' && l && noteHash(l) !== noteHash(incoming))
          await workspace.syncConflict(l);
        if (await workspace.syncApply(incoming, l?.updatedAt, id))
          state[id] = { remote: incoming.updatedAt, hash: noteHash(incoming) };
      }
      // A checkpoint is written only after acknowledged operations. Replays are safe.
      await vault.write('sync-baseline', state);
      const latest = await vault.read('cloud-sync', {});
      await vault.write('cloud-sync', { ...config, enabled: !!latest.enabled });
      lastSync = Date.now();
      emit('sync-changed', await status());
    } catch (e) {
      error = e.message || 'Sync could not connect. Local notes are safe.';
      emit('sync-changed', { error });
    } finally {
      running = false;
    }
  };
  return {
    status,
    tick,
    enable: async () => {
      if (!permitted()) throw Error('Sync is disabled by your managed policy.');
      const s = await vault.read('cloud-sync', {});
      await vault.write('cloud-sync', { ...s, enabled: true });
      return status();
    },
    disable: async () => {
      const s = await vault.read('cloud-sync', {});
      await vault.write('cloud-sync', { ...s, enabled: false });
      return status();
    },
    close: () => {
      closed = true;
    },
  };
}
