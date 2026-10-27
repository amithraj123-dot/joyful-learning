// Import from the earlier Google Sheet app (admins). The source is pasted JSON or the Apps Script web
// app address, which the server fetches. Re-running an import skips records it created before.
import { CloudError } from '../../../lib/cloud-store.ts';
import {
  DESIGNATIONS,
  initialsFor,
  listMembers,
  normaliseEmail,
  type Member,
} from '../../../core/server/members.ts';
import type { ModuleAction, ModuleContext } from '../../../core/server/module.ts';
import type { LegacyPreview } from '../shared/contract.ts';
import * as t from './db.ts';
import { legacyPeople, parseLegacy, planImport, type ImportPlan, type LegacyData } from './legacy.ts';
import { adminOnly, me } from './permissions.ts';
import { EMAIL } from './validate.ts';

const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 20000;
const MAX_REDIRECTS = 5;
const CHUNK = 50; // statements per D1 batch

// Only Apps Script web apps (and the host they redirect to) may be fetched.
export function sourceUrl(raw: string) {
  let url: URL | null = null;
  try {
    url = new URL(raw);
  } catch {}
  const allowed =
    url?.protocol === 'https:' &&
    !url.username &&
    !url.password &&
    !url.port &&
    ((url.hostname === 'script.google.com' && url.pathname.startsWith('/macros/s/')) ||
      url.hostname === 'script.googleusercontent.com');
  if (!url || !allowed)
    throw new CloudError(
      'Enter the address of the Apps Script web app (https://script.google.com/macros/s/...).',
    );
  return url;
}

async function readCapped(r: Response) {
  const tooLarge = new CloudError('The Apps Script data is larger than 5 MB.', 413);
  if (Number(r.headers.get('content-length') || 0) > MAX_BYTES) throw tooLarge;
  const reader = r.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let size = 0;
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out + decoder.decode();
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw tooLarge;
    }
    out += decoder.decode(value, { stream: true });
  }
}

// Fetches the web app's data. Redirects are followed by hand so each hop is checked against the allowed
// hosts. Nothing identifying the caller (cookies, authorisation) is sent.
export async function fetchLegacy(raw: string) {
  let url = sourceUrl(raw);
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const r = await fetch(url, { redirect: 'manual', signal, headers: { Accept: 'application/json' } });
      const location = r.headers.get('Location');
      if (r.status >= 300 && r.status < 400 && location) {
        url = sourceUrl(new URL(location, url).href);
        continue;
      }
      if (!r.ok)
        throw new CloudError(
          `The Apps Script web app answered with status ${r.status}. Check that it is deployed with access for anyone.`,
          502,
        );
      return await readCapped(r);
    }
    throw new CloudError('The Apps Script web app redirected too many times.', 502);
  } catch (e) {
    if (e instanceof CloudError) throw e;
    throw new CloudError(
      'The Apps Script web app could not be reached. Try again, or paste its data instead.',
      502,
    );
  }
}

async function loadSource(p: Record<string, unknown>): Promise<LegacyData> {
  if (typeof p.json === 'string' && p.json.trim()) return parseLegacy(p.json);
  if (typeof p.url === 'string' && p.url.trim()) return parseLegacy(await fetchLegacy(p.url.trim()));
  throw new CloudError('Paste the exported data or enter the Apps Script web app address.');
}

// An existing member with the same initials, preferring active members.
const suggestion = (members: Member[], initials: string) =>
  (members.find((m) => m.active && m.initials === initials) ?? members.find((m) => m.initials === initials))
    ?.email ?? null;

function readMapping(value: unknown, known: Set<string>) {
  if (!Array.isArray(value)) throw new CloudError('Send the mapping of initials to members.');
  const map = new Map<string, string | null>();
  for (const item of value) {
    const x = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const initials = typeof x.initials === 'string' ? x.initials : '';
    if (!known.has(initials)) throw new CloudError(`Initials "${initials}" do not appear in the data.`);
    if (x.email == null || x.email === '') map.set(initials, null);
    else if (typeof x.email === 'string' && EMAIL.test(normaliseEmail(x.email)))
      map.set(initials, normaliseEmail(x.email));
    else throw new CloudError(`Enter a valid email address for ${initials}, or leave it unmapped.`);
  }
  return map;
}

async function prepare(ctx: ModuleContext, p: Record<string, unknown>, mapping?: unknown) {
  const data = await loadSource(p);
  const members = await listMembers(ctx.db);
  const found = legacyPeople(data);
  const map =
    mapping === undefined
      ? new Map(found.map((x) => [x.initials, suggestion(members, x.initials)]))
      : readMapping(mapping, new Set(found.map((x) => x.initials)));
  const plan = planImport(data, (i) => map.get(i) ?? `legacy:${i}`, me(ctx).email, ctx.now);
  const orphans = found.filter((x) => x.used && !x.known).map((x) => x.initials);
  if (orphans.length)
    plan.warnings.unshift(
      data.roster.length
        ? `Initials ${orphans.join(', ')} appear in the data but not in its team roster.`
        : 'The data has no team roster. Map each set of initials to a member, or leave it unmapped.',
    );
  const people = found.map((x) => ({
    initials: x.initials,
    name: x.name,
    designation: x.designation,
    email: map.get(x.initials) ?? null,
  }));
  return { plan, members, people };
}

const preview = (plan: ImportPlan, people: LegacyPreview['people']): LegacyPreview => ({
  clients: plan.clients.length,
  matters: plan.matters.length,
  tasks: plan.tasks.length,
  timeEntries: plan.time.length,
  milestones: plan.milestones.length,
  invoices: plan.invoices.length,
  dealTrackers: plan.deals.length,
  people,
  warnings:
    plan.warnings.length > 60
      ? [...plan.warnings.slice(0, 60), `And ${plan.warnings.length - 60} more.`]
      : plan.warnings,
});

// Members to add for mapped emails that are not yet in the firm, with the roster name and designation.
function newMembers(people: LegacyPreview['people'], members: Member[], now: number) {
  const known = new Set(members.map((m) => m.email));
  const added: Member[] = [];
  for (const x of people) {
    if (!x.email || known.has(x.email)) continue;
    known.add(x.email);
    const name = x.name || x.initials;
    const initials = /^[A-Z0-9]{1,4}$/.test(x.initials) ? x.initials : initialsFor(name);
    const clash = members.find((m) => m.active && m.initials === initials);
    if (clash)
      throw new CloudError(
        `Initials ${initials} already belong to ${clash.email}. Map ${x.initials} to that member, or add the new member first.`,
        409,
      );
    const designation = DESIGNATIONS.find((d) => d === x.designation) ?? 'Associate';
    added.push({
      email: x.email,
      name,
      initials,
      designation,
      isAdmin: false,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
  }
  return added;
}

// Renames imported clients whose name is already used by a different client in the workspace.
async function avoidNameClashes(db: D1Database, plan: ImportPlan) {
  const live = await t.all(db, t.clients, 'deleted_at IS NULL');
  const taken = new Map(live.map((c) => [c.name.toLowerCase(), c.id]));
  for (const c of plan.clients) {
    const owner = taken.get(c.name.toLowerCase());
    if (owner && owner !== c.id && !live.some((x) => x.id === c.id)) {
      plan.warnings.push(
        `A client named "${c.name}" already exists; the imported one is named "${c.name} (imported)".`,
      );
      c.name += ' (imported)';
    }
  }
}

export const importActions: Record<string, ModuleAction> = {
  'import.preview': {
    permission: adminOnly,
    handler: async (ctx, p) => {
      const { plan, people } = await prepare(ctx, p);
      const first = plan.clients[0] && (await t.one(ctx.db, t.clients, 'id = ?', plan.clients[0].id));
      if (first)
        plan.warnings.unshift(
          'This data has been imported before; records that already exist will be skipped.',
        );
      return preview(plan, people);
    },
  },
  'import.run': {
    permission: adminOnly,
    handler: async (ctx, p) => {
      const { plan, people, members } = await prepare(ctx, p, p.people);
      const added = newMembers(people, members, ctx.now);
      await avoidNameClashes(ctx.db, plan);
      const db = ctx.db;
      const jobs: { kind?: keyof ImportPlan; statement: D1PreparedStatement }[] = [
        ...added.map((m) => ({
          statement: db
            .prepare(
              'INSERT INTO org_members(email,name,initials,designation,is_admin,active,created_at,updated_at) VALUES(?,?,?,?,0,1,?,?) ON CONFLICT(email) DO NOTHING',
            )
            .bind(m.email, m.name, m.initials, m.designation, m.createdAt, m.updatedAt),
        })),
      ];
      const queue = <T>(kind: keyof ImportPlan, table: t.Table<T>, records: T[]) =>
        records.forEach((r) => jobs.push({ kind, statement: t.insert(db, table, r, true) }));
      queue('clients', t.clients, plan.clients);
      queue('matters', t.matters, plan.matters);
      queue('billing', t.billing, plan.billing);
      queue('invoices', t.invoices, plan.invoices);
      queue('tasks', t.tasks, plan.tasks);
      queue('time', t.time, plan.time);
      queue('milestones', t.milestones, plan.milestones);
      queue('feedback', t.feedback, plan.feedback);
      queue('deals', t.deals, plan.deals);

      const counts = new Map<keyof ImportPlan, number>();
      for (let i = 0; i < jobs.length; i += CHUNK) {
        const chunk = jobs.slice(i, i + CHUNK);
        const changes = await t.write(
          db,
          ctx.now,
          chunk.map((j) => j.statement),
        );
        changes.forEach((n, k) => {
          const kind = chunk[k].kind;
          if (kind) counts.set(kind, (counts.get(kind) ?? 0) + n);
        });
      }
      const n = (k: keyof ImportPlan) => counts.get(k) ?? 0;
      const result: LegacyPreview = {
        ...preview(plan, people),
        clients: n('clients'),
        matters: n('matters'),
        tasks: n('tasks'),
        timeEntries: n('time'),
        milestones: n('milestones'),
        invoices: n('invoices'),
        dealTrackers: n('deals'),
      };
      await ctx.log(
        'import.completed',
        'legacy',
        `Imported data from the earlier Workflow app: ${result.clients} clients, ${result.matters} matters, ${result.tasks} tasks, ${result.timeEntries} time entries, ${result.milestones} milestones, ${result.invoices} invoices and ${result.dealTrackers} deal trackers; added ${added.length} members`,
      );
      return result;
    },
  },
};
