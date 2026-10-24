// Firm membership: who may use the shared (team) modules, with what designation and admin rights.
// Identity comes from the hosting platform's sign-in (an email); membership is held in org_members.
import { CloudError } from '../../lib/cloud-store.ts';

export const DESIGNATIONS = [
  'Article',
  'Associate',
  'Assistant Manager',
  'Manager',
  'Director',
  'Partner',
] as const;
export type Designation = (typeof DESIGNATIONS)[number];

export interface Member {
  email: string;
  name: string;
  initials: string;
  designation: Designation;
  isAdmin: boolean;
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SignedInUser {
  userId: string;
  email: string;
  name?: string | null;
}

// Seniority used by permission rules: Article 1 ... Partner 6.
export const seniority = (m: Pick<Member, 'designation'>) => DESIGNATIONS.indexOf(m.designation) + 1;
export const atLeast = (m: Pick<Member, 'designation'>, designation: Designation) =>
  seniority(m) >= DESIGNATIONS.indexOf(designation) + 1;

type Row = {
  email: string;
  name: string;
  initials: string;
  designation: string;
  is_admin: number;
  active: number;
  created_at: number;
  updated_at: number;
};
const fromRow = (r: Row): Member => ({
  email: r.email,
  name: r.name,
  initials: r.initials,
  designation: (DESIGNATIONS as readonly string[]).includes(r.designation)
    ? (r.designation as Designation)
    : 'Associate',
  isAdmin: !!r.is_admin,
  active: !!r.active,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const normaliseEmail = (email: string) => email.trim().toLowerCase();

export function initialsFor(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export async function listMembers(db: D1Database) {
  const r = await db
    .prepare('SELECT * FROM org_members ORDER BY active DESC, name COLLATE NOCASE')
    .bind()
    .all<Row>();
  return r.results.map(fromRow);
}

export async function getMember(db: D1Database, email: string) {
  const r = await db
    .prepare('SELECT * FROM org_members WHERE email = ?')
    .bind(normaliseEmail(email))
    .first<Row>();
  return r ? fromRow(r) : null;
}

// The signed-in user's membership. The very first person to open the team modules becomes the admin
// partner, so a new deployment can be set up without editing the database.
export async function resolveMember(db: D1Database, user: SignedInUser): Promise<Member | null> {
  const email = normaliseEmail(user.email || '');
  if (!email) return null;
  const existing = await getMember(db, email);
  if (existing) return existing.active ? existing : null;
  const count = await db.prepare('SELECT count(*) AS n FROM org_members').bind().first<{ n: number }>();
  if ((count?.n || 0) > 0) return null;
  const name = (user.name || email.split('@')[0]).trim().slice(0, 120);
  const now = Date.now();
  await db
    .prepare(
      'INSERT INTO org_members(email,name,initials,designation,is_admin,active,created_at,updated_at) VALUES(?,?,?,?,1,1,?,?) ON CONFLICT(email) DO NOTHING',
    )
    .bind(email, name, initialsFor(name) || 'AD', 'Partner', now, now)
    .run();
  return getMember(db, email);
}

export function validMemberInput(value: unknown) {
  const v = (value || {}) as Record<string, unknown>;
  const email = typeof v.email === 'string' ? normaliseEmail(v.email) : '';
  if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(email))
    throw new CloudError('Enter a valid email address.');
  const name = typeof v.name === 'string' ? v.name.trim() : '';
  if (!name || name.length > 120) throw new CloudError('Enter a name of up to 120 characters.');
  const initials = (typeof v.initials === 'string' && v.initials.trim() ? v.initials : initialsFor(name))
    .trim()
    .toUpperCase();
  if (!/^[A-Z0-9]{1,4}$/.test(initials)) throw new CloudError('Initials must be 1 to 4 letters or digits.');
  if (!(DESIGNATIONS as readonly unknown[]).includes(v.designation))
    throw new CloudError('Choose a valid designation.');
  return {
    email,
    name,
    initials,
    designation: v.designation as Designation,
    isAdmin: v.isAdmin === true,
    active: v.active !== false,
  };
}

export async function saveMember(db: D1Database, input: ReturnType<typeof validMemberInput>) {
  const clash = await db
    .prepare('SELECT email FROM org_members WHERE initials = ? AND email != ? AND active = 1')
    .bind(input.initials, input.email)
    .first<{ email: string }>();
  if (clash) throw new CloudError(`Initials ${input.initials} are already used by ${clash.email}.`, 409);
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO org_members(email,name,initials,designation,is_admin,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)
       ON CONFLICT(email) DO UPDATE SET name=excluded.name, initials=excluded.initials, designation=excluded.designation,
       is_admin=excluded.is_admin, active=excluded.active, updated_at=excluded.updated_at`,
    )
    .bind(
      input.email,
      input.name,
      input.initials,
      input.designation,
      input.isAdmin ? 1 : 0,
      input.active ? 1 : 0,
      now,
      now,
    )
    .run();
  return getMember(db, input.email);
}

// Keeps at least one active admin so the firm can never lock itself out.
export async function assertAdminRemains(db: D1Database, changingEmail: string, willBeAdmin: boolean) {
  if (willBeAdmin) return;
  const r = await db
    .prepare('SELECT count(*) AS n FROM org_members WHERE is_admin = 1 AND active = 1 AND email != ?')
    .bind(normaliseEmail(changingEmail))
    .first<{ n: number }>();
  if (!r?.n) throw new CloudError('Keep at least one active administrator.', 409);
}
