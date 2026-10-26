// Contract every server-side module implements. A module is a set of named actions; the core router
// authenticates the caller, resolves their firm membership, checks the action's permission and passes a
// context. Modules never read request headers or identity themselves.
import type { ServerEnv, SystemContext } from './env.ts';
import type { Member, SignedInUser } from './members.ts';

export interface ModuleContext {
  db: D1Database;
  user: SignedInUser;
  // Firm membership; null for a signed-in person who is not (or no longer) a member.
  member: Member | null;
  now: number;
  env: ServerEnv; // server configuration (secrets); never sent to browsers
  fetch: typeof fetch; // outbound requests (replaced in tests)
  // Adds a line to the firm activity trail, attributed to the caller.
  log: (action: string, target: string, summary: string) => Promise<void>;
}

export type Permission = (ctx: ModuleContext, payload: Record<string, unknown>) => boolean | Promise<boolean>;

export interface ModuleAction {
  // Default: any active firm member. Use `personal` for actions open to any signed-in user.
  permission?: Permission | 'member' | 'personal';
  handler: (ctx: ModuleContext, payload: Record<string, unknown>) => Promise<unknown> | unknown;
}

export interface ServerModule {
  id: string;
  actions: Record<string, ModuleAction>;
  // Background work (reminders, mail sync, deliveries). Runs from POST /api/tick for every member, or
  // for one member when they use the workspace. Must be idempotent and bounded in time.
  tick?: (sys: SystemContext, scope: { member?: Member }) => Promise<void>;
}
