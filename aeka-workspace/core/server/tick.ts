// Runs every module's background work. Called by POST /api/tick (an external scheduler, every few
// minutes, for all members) and, for one member, when they use the workspace. Each module's tick is
// isolated: one failing does not stop the others.
import type { SystemContext } from './env.ts';
import { listMembers, type Member } from './members.ts';
import type { ServerModule } from './module.ts';
import { releaseLease, takeLease } from './notifications.ts';

const TICK_LEASE_MS = 4 * 60000;

export async function runTicks(sys: SystemContext, modules: ServerModule[], member?: Member) {
  const name = member ? `tick:${member.email}` : 'tick:all';
  // A member's own tick runs at most once a minute; the firm-wide tick never overlaps itself.
  if (!(await takeLease(sys.db, name, sys.now, member ? 60000 : TICK_LEASE_MS))) return { ran: false };
  const failures: string[] = [];
  try {
    const members = member ? [member] : (await listMembers(sys.db)).filter((m) => m.active);
    for (const mod of modules) {
      if (!mod.tick) continue;
      for (const m of members) {
        try {
          await mod.tick(sys, { member: m });
        } catch (e) {
          failures.push(mod.id);
          console.error(`Background work for ${mod.id} failed`, e);
        }
      }
    }
  } finally {
    if (!member) await releaseLease(sys.db, name);
  }
  return { ran: true, failures: [...new Set(failures)] };
}
