// Feedback per member per matter: the member's own self-reflection and a review (with rating) written by
// Manager+. Members read their own records, and peers' self-reflections when the matter allows it.
import { CloudError } from '../../../lib/cloud-store.ts';
import type { ModuleAction } from '../../../core/server/module.ts';
import type { Feedback } from '../shared/types.ts';
import { all, conflict, feedback, insert, one, saveRevision, write } from './db.ts';
import { loadPeople } from './people.ts';
import { forbidden, isManager, me, visibleMatter } from './permissions.ts';
import { baseRevision, int, oneOf, personShape, text } from './validate.ts';

export const feedbackActions: Record<string, ModuleAction> = {
  'feedback.list': {
    handler: async (ctx, p) => {
      const matter = await visibleMatter(ctx, p.matterId);
      const m = me(ctx);
      const rows = await all(ctx.db, feedback, 'matter_id = ? ORDER BY member, kind', matter.id);
      if (isManager(m)) return rows;
      const peers = matter.peerFeedbackVisible && matter.team.includes(m.email);
      return rows.filter((f) => f.member === m.email || (peers && f.kind === 'self'));
    },
  },
  'feedback.save': {
    handler: async (ctx, p) => {
      const matter = await visibleMatter(ctx, p.matterId);
      const m = me(ctx);
      const kind = oneOf(p.kind, ['self', 'review'] as const, 'feedback type');
      const member = personShape(p.member, 'member');
      if (!matter.team.includes(member))
        throw new CloudError('Feedback can be recorded only for members of the matter team.');
      if (kind === 'self' && member !== m.email)
        throw forbidden('Only the member can write their own self-reflection.');
      if (kind === 'review' && !isManager(m)) throw forbidden('Only a Manager or above can write reviews.');
      if (kind === 'review' && member === m.email) throw forbidden('You cannot review your own work.');
      if (kind === 'self' && p.rating != null) throw new CloudError('Only reviews carry a rating.');
      const rating = p.rating == null ? null : int(p.rating, 'the rating', 1, 5);
      const body = text(p.text, 'the feedback', 5000);
      const base = baseRevision(p);
      const current = await one(
        ctx.db,
        feedback,
        'matter_id = ? AND member = ? AND kind = ?',
        matter.id,
        member,
        kind,
      );
      if ((current?.revision ?? 0) !== base) throw conflict('feedback');
      const record: Feedback = {
        id: current?.id ?? crypto.randomUUID(),
        matterId: matter.id,
        member,
        kind,
        text: body,
        rating,
        author: m.email,
        updatedAt: ctx.now,
        revision: base + 1,
      };
      if (current) await saveRevision(ctx.db, ctx.now, feedback, record, base, 'feedback');
      else if (!(await write(ctx.db, ctx.now, [insert(ctx.db, feedback, record, true)]))[0])
        throw conflict('feedback');
      const summary =
        kind === 'self'
          ? `Saved a self-reflection on ${matter.title}`
          : `Saved a review of ${(await loadPeople(ctx.db)).name(member)} on ${matter.title}`;
      await ctx.log('feedback.saved', record.id, summary);
      return record;
    },
  },
};
