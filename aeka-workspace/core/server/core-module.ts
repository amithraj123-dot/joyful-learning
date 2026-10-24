// Actions every deployment has: the caller's identity and membership, firm members and the activity trail.
import { CloudError } from '../../lib/cloud-store.ts';
import { listActivity } from './activity.ts';
import {
  assertAdminRemains,
  getMember,
  listMembers,
  normaliseEmail,
  saveMember,
  validMemberInput,
} from './members.ts';
import type { Permission, ServerModule } from './module.ts';

export const isAdmin: Permission = (ctx) => !!ctx.member?.isAdmin;

export const coreModule: ServerModule = {
  id: 'core',
  actions: {
    me: {
      permission: 'personal',
      handler: (ctx) => ({ email: ctx.user.email, member: ctx.member }),
    },
    'members.list': { handler: (ctx) => listMembers(ctx.db) },
    'members.save': {
      permission: isAdmin,
      handler: async (ctx, p) => {
        const input = validMemberInput(p.member);
        const existing = await getMember(ctx.db, input.email);
        if (existing?.isAdmin && existing.active)
          await assertAdminRemains(ctx.db, input.email, input.isAdmin && input.active);
        const saved = await saveMember(ctx.db, input);
        await ctx.log(
          existing ? 'member.updated' : 'member.added',
          input.email,
          `${existing ? 'Updated' : 'Added'} ${input.name} (${input.designation}${input.isAdmin ? ', admin' : ''}${
            input.active ? '' : ', inactive'
          })`,
        );
        return saved;
      },
    },
    'members.deactivate': {
      permission: isAdmin,
      handler: async (ctx, p) => {
        const email = normaliseEmail(String(p.email || ''));
        const existing = await getMember(ctx.db, email);
        if (!existing) throw new CloudError('That member does not exist.', 404);
        if (email === ctx.member?.email) throw new CloudError('You cannot deactivate your own account.', 409);
        if (existing.isAdmin) await assertAdminRemains(ctx.db, email, false);
        await ctx.db
          .prepare('UPDATE org_members SET active = 0, updated_at = ? WHERE email = ?')
          .bind(ctx.now, email)
          .run();
        await ctx.log('member.deactivated', email, `Deactivated ${existing.name}`);
        return true;
      },
    },
    'activity.list': {
      handler: (ctx, p) =>
        listActivity(ctx.db, {
          module: typeof p.filterModule === 'string' ? p.filterModule : undefined,
          target: typeof p.target === 'string' ? p.target : undefined,
          before: typeof p.before === 'number' ? p.before : undefined,
          limit: typeof p.limit === 'number' ? p.limit : 100,
        }),
    },
  },
};
