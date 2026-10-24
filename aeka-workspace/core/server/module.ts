// Contract every server-side module implements. A module is a set of named actions; the core router
// authenticates the caller, resolves their firm membership, checks the action's permission and passes a
// context. Modules never read request headers or identity themselves.
import type { Member, SignedInUser } from './members.ts';

export interface ModuleContext {
  db: D1Database;
  user: SignedInUser;
  // Firm membership; null for a signed-in person who is not (or no longer) a member.
  member: Member | null;
  now: number;
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
}
