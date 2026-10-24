// Person keys: a member email, or "legacy:XX" for imported initials not yet mapped to a member.
import { CloudError } from '../../../lib/cloud-store.ts';
import { listMembers, type Member } from '../../../core/server/members.ts';
import type { PersonKey } from '../shared/types.ts';
import { personShape } from './validate.ts';

// A legacy key is accepted only where it already appears in workflow data (it came from an import).
const LEGACY_IN_DATA = `SELECT 1 FROM wf_matters m, json_each(m.team) j WHERE j.value = ?
  UNION ALL SELECT 1 FROM wf_tasks WHERE assignee = ? OR prepared_by = ? OR reviewed_by = ?
  UNION ALL SELECT 1 FROM wf_time WHERE person = ?
  UNION ALL SELECT 1 FROM wf_feedback WHERE member = ?
  UNION ALL SELECT 1 FROM wf_milestones WHERE owner = ? LIMIT 1`;

export type People = Awaited<ReturnType<typeof loadPeople>>;

export async function loadPeople(db: D1Database) {
  const members = new Map((await listMembers(db)).map((m) => [m.email, m]));
  const legacyKnown = new Map<string, boolean>();

  // Validates a person key. Keys already on the record (`current`) stay valid even if the member has
  // since been deactivated, so unrelated edits do not fail.
  async function check(value: unknown, label: string, current: readonly (string | null)[] = []) {
    const key = personShape(value, label);
    if (current.includes(key)) return key;
    if (key.startsWith('legacy:')) {
      if (!legacyKnown.has(key))
        legacyKnown.set(key, !!(await db.prepare(LEGACY_IN_DATA).bind(...Array(7).fill(key)).first()));
      if (legacyKnown.get(key)) return key;
    } else if (members.get(key)?.active) return key;
    throw new CloudError(`Choose an active firm member as the ${label}.`);
  }
  const optional = (value: unknown, label: string, current: readonly (string | null)[] = []) =>
    value == null || value === '' ? Promise.resolve(null) : check(value, label, current);

  const member = (key: PersonKey | null): Member | undefined => (key ? members.get(key) : undefined);
  const name = (key: PersonKey) => members.get(key)?.name || key.replace(/^legacy:/, '');
  const initials = (key: PersonKey) => members.get(key)?.initials || key.replace(/^legacy:/, '');
  return { members, check, optional, member, name, initials };
}
