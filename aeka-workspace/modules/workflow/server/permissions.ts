// Who may do what in Workflow (see the rules in shared/contract.ts). Admins have every right.
import { CloudError } from '../../../lib/cloud-store.ts';
import { atLeast, type Member } from '../../../core/server/members.ts';
import type { ModuleContext, Permission } from '../../../core/server/module.ts';
import type { Matter, PersonKey, WorkflowCapabilities } from '../shared/types.ts';
import { all, matters, notFound, one, type Table } from './db.ts';
import { id } from './validate.ts';
import type { People } from './people.ts';

// "Manager+": Assistant Manager and above.
export const isManager = (m: Member) => m.isAdmin || atLeast(m, 'Assistant Manager');
// Directors, Partners and admins see restricted matters without being on the team.
const seesEveryMatter = (m: Member) => m.isAdmin || atLeast(m, 'Director');

export const managerOnly: Permission = (ctx) => !!ctx.member && isManager(ctx.member);
export const adminOnly: Permission = (ctx) => !!ctx.member?.isAdmin;

// The router admits only active members to these actions, so the member is always present.
export const me = (ctx: ModuleContext) => {
  if (!ctx.member) throw new CloudError('You do not have permission for this action.', 403);
  return ctx.member;
};

export const forbidden = (message: string) => new CloudError(message, 403);

export function capabilities(m: Member): WorkflowCapabilities {
  const manager = isManager(m);
  return {
    manageMatters: manager,
    viewBilling: manager,
    editBilling: manager,
    reviewPeople: manager,
    logTimeForOthers: manager,
    exportFirmTime: manager,
    importData: m.isAdmin,
  };
}

export const canSee = (m: Member, matter: Pick<Matter, 'restricted' | 'team'>) =>
  !matter.restricted || seesEveryMatter(m) || matter.team.includes(m.email);

// Whether a person could see the matter, so work on a restricted matter goes only to people inside the wall.
export function personCanSee(people: People, key: PersonKey, matter: Matter) {
  if (!matter.restricted || matter.team.includes(key)) return true;
  const m = people.member(key);
  return !!m?.active && seesEveryMatter(m);
}
export function assertInsideWall(people: People, matter: Matter, keys: (PersonKey | null)[]) {
  for (const key of keys)
    if (key && !personCanSee(people, key, matter))
      throw new CloudError(
        `${people.name(key)} cannot see this restricted matter. Add them to the matter team first.`,
      );
}

const LIVE = 'deleted_at IS NULL AND client_id IN (SELECT id FROM wf_clients WHERE deleted_at IS NULL)';

// A live matter the caller may see. Restricted matters outside the caller's wall are reported as not
// found, never as forbidden, so their existence is not disclosed. `label` names the record reached
// through the matter, for the not-found message.
export async function visibleMatter(ctx: ModuleContext, matterId: unknown, label = 'matter') {
  const matter = await one(ctx.db, matters, `id = ? AND ${LIVE}`, id(matterId));
  if (!matter || !canSee(me(ctx), matter)) throw notFound(label);
  return matter;
}

// A record that belongs to a matter (task, time entry, milestone, invoice), found only through a
// matter the caller may see.
export async function visibleChild<T extends { matterId: string }>(
  ctx: ModuleContext,
  t: Table<T>,
  key: unknown,
  label: string,
  where = '1',
) {
  const record = await one(ctx.db, t, `id = ? AND ${where}`, id(key));
  if (!record) throw notFound(label);
  return { record, matter: await visibleMatter(ctx, record.matterId, label) };
}

export async function visibleMatters(ctx: ModuleContext) {
  const m = me(ctx);
  return (await all(ctx.db, matters, LIVE)).filter((x) => canSee(m, x));
}
