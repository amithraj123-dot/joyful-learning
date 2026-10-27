// A module context for background work (ticks, WhatsApp) acting for one member. There is no sign-in
// id in the background, so services keyed by it (Scribe notes) are skipped there.
import { recordActivity } from '../../../core/server/activity.ts';
import type { SystemContext } from '../../../core/server/env.ts';
import type { Member } from '../../../core/server/members.ts';
import type { ModuleContext } from '../../../core/server/module.ts';

export function memberContext(sys: SystemContext, member: Member): ModuleContext {
  return {
    db: sys.db,
    user: { userId: '', email: member.email, name: member.name },
    member,
    now: sys.now,
    env: sys.env,
    fetch: sys.fetch,
    log: (action, target, summary) =>
      recordActivity(
        sys.db,
        { actor: member.email, actorName: member.name, module: 'assistant', action, target, summary },
        sys.now,
      ),
  };
}
