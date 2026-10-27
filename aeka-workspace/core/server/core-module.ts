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
import { aiStatus } from './ai.ts';
import { configured } from './env.ts';
import { listNotices, markRead, unreadCount } from './notifications.ts';
import { sealingAvailable } from './secrets.ts';

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
    // The caller's notifications from every module.
    'notifications.list': {
      handler: async (ctx, p) => ({
        items: await listNotices(ctx.db, ctx.member!.email, typeof p.limit === 'number' ? p.limit : 50),
        unread: await unreadCount(ctx.db, ctx.member!.email),
      }),
    },
    'notifications.read': {
      handler: async (ctx, p) => {
        const ids =
          p.ids === 'all'
            ? 'all'
            : Array.isArray(p.ids)
              ? p.ids.filter((x): x is string => typeof x === 'string')
              : [];
        await markRead(ctx.db, ctx.member!.email, ids, ctx.now);
        return true;
      },
    },
    // Runs the caller's own background work (due reminders, mail sync) while they use the workspace.
    tick: {
      handler: async (ctx) => {
        const { runTicks } = await import('./tick.ts');
        const { serverModules } = await import('./registry.ts');
        const r = await runTicks(
          { db: ctx.db, env: ctx.env, fetch: ctx.fetch, now: ctx.now },
          serverModules,
          ctx.member!,
        );
        return { ran: r.ran };
      },
    },
    // Which integrations are configured (never their values) and today's AI use, for administrators.
    'integrations.status': {
      permission: isAdmin,
      handler: async (ctx) => {
        const e = ctx.env;
        const since =
          Date.UTC(
            new Date(ctx.now + 330 * 60000).getUTCFullYear(),
            new Date(ctx.now + 330 * 60000).getUTCMonth(),
            new Date(ctx.now + 330 * 60000).getUTCDate(),
          ) -
          330 * 60000;
        const usage = await ctx.db
          .prepare(
            'SELECT actor, count(*) AS calls, sum(1 - ok) AS failed, sum(prompt_tokens) AS prompt, sum(completion_tokens) AS completion FROM ai_usage WHERE at >= ? GROUP BY actor ORDER BY calls DESC',
          )
          .bind(since)
          .all<{ actor: string; calls: number; failed: number; prompt: number; completion: number }>();
        return {
          ai: aiStatus(e),
          aiDailyLimit: Number(e.AEKA_AI_DAILY_LIMIT) > 0 ? Number(e.AEKA_AI_DAILY_LIMIT) : 400,
          secureStorage: sealingAvailable(e),
          outlook: configured(e.MS_CLIENT_ID, e.MS_CLIENT_SECRET),
          publicOrigin: e.AEKA_PUBLIC_ORIGIN || '',
          scheduler: configured(e.AEKA_TICK_TOKEN),
          whatsapp:
            e.WHATSAPP_ENABLED === 'true' &&
            configured(
              e.WHATSAPP_APP_SECRET,
              e.WHATSAPP_VERIFY_TOKEN,
              e.WHATSAPP_ACCESS_TOKEN,
              e.WHATSAPP_PHONE_NUMBER_ID,
            ),
          usageToday: usage.results,
        };
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
