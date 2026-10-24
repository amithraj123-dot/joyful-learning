// Clients and matters (Manager+), and the trash of soft-deleted records.
import { CloudError } from '../../../lib/cloud-store.ts';
import type { ModuleAction, ModuleContext } from '../../../core/server/module.ts';
import type { MatterInput } from '../shared/contract.ts';
import type { Client, Matter } from '../shared/types.ts';
import { all, clients, conflict, insert, matters, notFound, one, saveRevision, tasks, write } from './db.ts';
import { loadPeople } from './people.ts';
import { canSee, isManager, managerOnly, me, visibleMatter } from './permissions.ts';
import { baseRevision, id, matterFields, obj, teamList, validClient } from './validate.ts';

async function liveClient(db: D1Database, clientId: unknown) {
  const c = await one(db, clients, 'id = ? AND deleted_at IS NULL', id(clientId));
  if (!c) throw notFound('client');
  return c;
}

async function assertClientNameFree(db: D1Database, name: string, exceptId = '') {
  const clash = await db
    .prepare('SELECT 1 FROM wf_clients WHERE deleted_at IS NULL AND lower(name) = lower(?) AND id != ?')
    .bind(name, exceptId)
    .first();
  if (clash) throw new CloudError(`A client named "${name}" already exists.`, 409);
}

async function assertMatterTitleFree(db: D1Database, clientId: string, title: string, exceptId = '') {
  const clash = await db
    .prepare(
      'SELECT 1 FROM wf_matters WHERE deleted_at IS NULL AND client_id = ? AND lower(title) = lower(?) AND id != ?',
    )
    .bind(clientId, title, exceptId)
    .first();
  if (clash) throw new CloudError(`This client already has a matter titled "${title}".`, 409);
}

async function matterInput(ctx: ModuleContext, value: unknown, current?: Matter): Promise<MatterInput> {
  const m = obj(value, 'matter');
  const client = await liveClient(ctx.db, m.clientId);
  const fields = matterFields(m);
  const people = await loadPeople(ctx.db);
  const team: string[] = [];
  for (const key of teamList(m.team)) team.push(await people.check(key, 'team member', current?.team));
  await assertMatterTitleFree(ctx.db, client.id, fields.title, current?.id);
  return { ...fields, clientId: client.id, team };
}

const checkRevision = (record: { revision: number }, base: number, label: string) => {
  if (record.revision !== base) throw conflict(label);
};

export const matterActions: Record<string, ModuleAction> = {
  'client.create': {
    permission: managerOnly,
    handler: async (ctx) => {
      const input = validClient(ctxPayload(ctx).client);
      await assertClientNameFree(ctx.db, input.name);
      const client: Client = {
        id: crypto.randomUUID(),
        ...input,
        createdAt: ctx.now,
        updatedAt: ctx.now,
        revision: 1,
        deletedAt: null,
      };
      await write(ctx.db, ctx.now, [insert(ctx.db, clients, client)]);
      await ctx.log('client.created', client.id, `Created client "${client.name}"`);
      return client;
    },
  },
  'client.update': {
    permission: managerOnly,
    handler: async (ctx, p) => {
      const current = await liveClient(ctx.db, p.id);
      const base = baseRevision(p);
      checkRevision(current, base, 'client');
      const input = validClient(p.client);
      await assertClientNameFree(ctx.db, input.name, current.id);
      const client = { ...current, ...input, revision: base + 1, updatedAt: ctx.now };
      await saveRevision(ctx.db, ctx.now, clients, client, base, 'client');
      await ctx.log('client.updated', client.id, `Updated client "${client.name}"`);
      return client;
    },
  },
  'client.delete': {
    permission: managerOnly,
    handler: async (ctx, p) => {
      const current = await liveClient(ctx.db, p.id);
      const base = baseRevision(p);
      checkRevision(current, base, 'client');
      const client = { ...current, deletedAt: ctx.now, revision: base + 1, updatedAt: ctx.now };
      await saveRevision(ctx.db, ctx.now, clients, client, base, 'client');
      await ctx.log('client.deleted', client.id, `Deleted client "${client.name}" and hid its matters`);
      return true;
    },
  },
  'client.restore': {
    permission: managerOnly,
    handler: async (ctx, p) => {
      const current = await one(ctx.db, clients, 'id = ? AND deleted_at IS NOT NULL', id(p.id));
      if (!current) throw notFound('client');
      await assertClientNameFree(ctx.db, current.name);
      const client = { ...current, deletedAt: null, revision: current.revision + 1, updatedAt: ctx.now };
      await saveRevision(ctx.db, ctx.now, clients, client, current.revision, 'client');
      await ctx.log('client.restored', client.id, `Restored client "${client.name}"`);
      return client;
    },
  },
  'matter.create': {
    permission: managerOnly,
    handler: async (ctx, p) => {
      const input = await matterInput(ctx, p.matter);
      const matter: Matter = {
        id: crypto.randomUUID(),
        ...input,
        createdAt: ctx.now,
        updatedAt: ctx.now,
        revision: 1,
        deletedAt: null,
      };
      await write(ctx.db, ctx.now, [insert(ctx.db, matters, matter)]);
      await ctx.log('matter.created', matter.id, `Created matter "${matter.title}"`);
      return matter;
    },
  },
  'matter.update': {
    permission: managerOnly,
    handler: async (ctx, p) => {
      const current = await visibleMatter(ctx, p.id);
      const base = baseRevision(p);
      checkRevision(current, base, 'matter');
      const input = await matterInput(ctx, p.matter, current);
      const matter = { ...current, ...input, revision: base + 1, updatedAt: ctx.now };
      await saveRevision(ctx.db, ctx.now, matters, matter, base, 'matter');
      await ctx.log('matter.updated', matter.id, `Updated matter "${matter.title}"`);
      return matter;
    },
  },
  'matter.delete': {
    permission: managerOnly,
    handler: async (ctx, p) => {
      const current = await visibleMatter(ctx, p.id);
      const base = baseRevision(p);
      checkRevision(current, base, 'matter');
      const matter = { ...current, deletedAt: ctx.now, revision: base + 1, updatedAt: ctx.now };
      await saveRevision(ctx.db, ctx.now, matters, matter, base, 'matter');
      await ctx.log('matter.deleted', matter.id, `Deleted matter "${matter.title}"`);
      return true;
    },
  },
  'matter.restore': {
    permission: managerOnly,
    handler: async (ctx, p) => {
      const current = await one(ctx.db, matters, 'id = ? AND deleted_at IS NOT NULL', id(p.id));
      if (!current || !canSee(me(ctx), current)) throw notFound('matter');
      const client = await one(ctx.db, clients, 'id = ? AND deleted_at IS NULL', current.clientId);
      if (!client) throw new CloudError('Restore the client of this matter first.', 409);
      await assertMatterTitleFree(ctx.db, current.clientId, current.title);
      const matter = { ...current, deletedAt: null, revision: current.revision + 1, updatedAt: ctx.now };
      await saveRevision(ctx.db, ctx.now, matters, matter, current.revision, 'matter');
      await ctx.log('matter.restored', matter.id, `Restored matter "${matter.title}"`);
      return matter;
    },
  },
  // Soft-deleted records the caller may restore.
  trash: {
    handler: async (ctx) => {
      const m = me(ctx);
      const manager = isManager(m);
      const deletedMatters = manager
        ? (await all(ctx.db, matters, 'deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 500')).filter(
            (x) => canSee(m, x),
          )
        : [];
      const live = new Map(
        (await all(ctx.db, matters, 'deleted_at IS NULL')).filter((x) => canSee(m, x)).map((x) => [x.id, x]),
      );
      const deletedTasks = (
        await all(ctx.db, tasks, 'deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 500')
      ).filter((t) => live.has(t.matterId) && (manager || t.createdBy === m.email));
      return {
        clients: manager
          ? await all(ctx.db, clients, 'deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 500')
          : [],
        matters: deletedMatters,
        tasks: deletedTasks,
      };
    },
  },
};
