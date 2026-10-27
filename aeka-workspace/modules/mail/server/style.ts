// Writing style: a profile learned from the member's sent mail in one AI call (proposed, then accepted or
// edited by the member), the greeting and sign-off last used with each recipient (no AI), and examples
// of how the member edits drafts before sending (the 3 most recent pairs, bodies only and capped).
// Everything lives in mail_style.profile for the member; status 'none' means nothing learned yet.
import { CloudError } from '../../../lib/cloud-store.ts';
import { aiStatus, chat, parseJsonObject } from '../../../core/server/ai.ts';
import type { ModuleAction, ModuleContext } from '../../../core/server/module.ts';
import type { MailRule, StyleProfile } from '../shared/types.ts';
import { STYLE_PROMPT } from './prompts.ts';
import { matchRules } from './rules.ts';
import { addresses, listRules, memberOf, type MessageRow } from './store.ts';
import { houseDashes, obj, text } from './validate.ts';

const SAMPLES = 40;
const SAMPLE_CHARS = 1200;
const MIN_SAMPLES = 5;
const EDIT_CHARS = 1500;
const MAX_EDITS = 3;
const MAX_ORIGINALS = 10;

export interface EditPair {
  before: string;
  after: string;
  at: number;
}
interface Stored {
  greeting: string;
  signOff: string;
  tone: string;
  notes: string[];
  sourceKey?: string; // the sent mail the proposal was learned from
  edits?: EditPair[];
  originals?: Record<string, { body: string; at: number }>; // AI draft text by draft id, until sent
}
interface StyleRow {
  member: string;
  profile: string;
  status: StyleProfile['status'] | 'none';
  sample_count: number;
  updated_at: number;
}

const EMPTY: Stored = { greeting: '', signOff: '', tone: '', notes: [] };

async function loadStyle(db: D1Database, member: string) {
  const row = await db.prepare('SELECT * FROM mail_style WHERE member = ?').bind(member).first<StyleRow>();
  let stored: Stored = { ...EMPTY };
  try {
    if (row) stored = { ...EMPTY, ...(JSON.parse(row.profile) as Stored) };
  } catch {
    stored = { ...EMPTY };
  }
  return { row, stored };
}

async function writeStyle(
  db: D1Database,
  member: string,
  stored: Stored,
  status: StyleRow['status'],
  samples: number,
  now: number,
) {
  await db
    .prepare(
      `INSERT INTO mail_style(member, profile, status, sample_count, updated_at) VALUES(?,?,?,?,?)
       ON CONFLICT(member) DO UPDATE SET profile = excluded.profile, status = excluded.status,
       sample_count = excluded.sample_count, updated_at = excluded.updated_at`,
    )
    .bind(member, JSON.stringify(stored), status, samples, now)
    .run();
}

const toProfile = (row: StyleRow, s: Stored): StyleProfile | null =>
  row.status === 'none'
    ? null
    : {
        greeting: s.greeting,
        signOff: s.signOff,
        tone: s.tone,
        notes: s.notes,
        sampleCount: row.sample_count,
        status: row.status,
        updatedAt: row.updated_at,
      };

// What the drafter receives: the accepted profile (if any) and the latest edit examples.
export async function styleForDraft(db: D1Database, member: string) {
  const { row, stored } = await loadStyle(db, member);
  return {
    style:
      row?.status === 'active'
        ? { greeting: stored.greeting, signOff: stored.signOff, tone: stored.tone, notes: stored.notes }
        : null,
    editExamples: (stored.edits ?? []).slice(0, MAX_EDITS).map((e) => ({ before: e.before, after: e.after })),
  };
}

// Sent mail that may be shown to the AI: not to a recipient (or about a subject) the member keeps from
// AI, and not a forward (whose text is someone else's).
export function aiSafeSent(rules: MailRule[], m: Pick<MessageRow, 'to_json' | 'cc_json' | 'subject'>) {
  if (/^\s*(fw|fwd)\s*:/i.test(m.subject)) return false;
  if (matchRules(rules, '', m.subject)?.effect.neverAi) return false;
  return ![...addresses(m.to_json), ...addresses(m.cc_json)].some(
    (a) => matchRules(rules, a.address, m.subject)?.effect.neverAi,
  );
}

const GREETING = /^(dear|hi|hello|hey|good (morning|afternoon|evening)|respected)\b.{0,60}$/i;
const SIGN_OFF =
  /^(regards|best regards|kind regards|warm regards|warmest regards|with regards|best|thanks|thank you|many thanks|thanks and regards|thanks & regards|cheers|sincerely|yours sincerely|yours truly|yours faithfully)\b[ ,.!]*$/i;

// The greeting (first line) and sign-off (from the closing word to the end, at most 3 lines) of a body.
export function habitOf(body: string) {
  const lines = body
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const first = lines[0] ?? '';
  const greeting = GREETING.test(first) && first.split(/\s+/).length <= 8 ? first : '';
  let signOff = '';
  for (let i = Math.max(0, lines.length - 4); i < lines.length; i++)
    if (SIGN_OFF.test(lines[i])) {
      signOff = lines.slice(i, i + 3).join('\n');
      break;
    }
  return { greeting, signOff };
}

// The greeting and sign-off I used in my last sent email to this address (stored mail, no AI).
export async function recipientHabit(db: D1Database, member: string, address: string) {
  const a = address.trim().toLowerCase();
  if (!a) return null;
  const r = await db
    .prepare(
      `SELECT body_text FROM mail_messages m WHERE member = ? AND folder = 'sent' AND EXISTS
       (SELECT 1 FROM json_each(m.to_json) j WHERE lower(json_extract(j.value, '$.address')) = ?)
       ORDER BY received_at DESC LIMIT 1`,
    )
    .bind(member, a)
    .first<{ body_text: string }>();
  if (!r) return null;
  const h = habitOf(r.body_text);
  return h.greeting || h.signOff ? h : null;
}

// Keeps the AI's text of a new draft, so a later send can tell how much the member changed it.
export async function rememberOriginal(
  db: D1Database,
  member: string,
  draftId: string,
  body: string,
  now: number,
) {
  const { row, stored } = await loadStyle(db, member);
  const originals = { ...(stored.originals ?? {}), [draftId]: { body: body.slice(0, EDIT_CHARS), at: now } };
  const kept = Object.entries(originals)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, MAX_ORIGINALS);
  await writeStyle(
    db,
    member,
    { ...stored, originals: Object.fromEntries(kept) },
    row?.status ?? 'none',
    row?.sample_count ?? 0,
    row?.updated_at ?? now,
  );
}

const words = (s: string) =>
  s
    .replace(/\[INPUT REQUIRED:[^\]]*\]/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 400);
// Words changed between two texts (insertions plus deletions, by longest common subsequence).
export function changedWords(a: string, b: string) {
  const x = words(a);
  const y = words(b);
  let prev = new Array<number>(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i++) {
    const cur = new Array<number>(y.length + 1).fill(0);
    for (let j = 1; j <= y.length; j++)
      cur[j] = x[i - 1] === y[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    prev = cur;
  }
  const common = prev[y.length];
  return { changed: x.length + y.length - 2 * common, size: Math.max(x.length, y.length, 1) };
}
// Material: at least 5 words and 15% of the text changed, ignoring filled-in placeholders.
export const materialEdit = (before: string, after: string) => {
  const { changed, size } = changedWords(before, after);
  return changed >= 5 && changed / size >= 0.15;
};

// On a confirmed send: record the before and after pair when the member changed the draft materially.
export async function learnFromSend(
  db: D1Database,
  member: string,
  draftId: string,
  sent: string,
  now: number,
) {
  const { row, stored } = await loadStyle(db, member);
  const original = stored.originals?.[draftId];
  if (!row || !original) return false;
  const originals = { ...stored.originals };
  delete originals[draftId];
  const after = sent.slice(0, EDIT_CHARS);
  const learn = materialEdit(original.body, after);
  const edits = learn
    ? [{ before: original.body, after, at: now }, ...(stored.edits ?? [])].slice(0, MAX_EDITS)
    : (stored.edits ?? []);
  await writeStyle(db, member, { ...stored, originals, edits }, row.status, row.sample_count, row.updated_at);
  return learn;
}

export async function forgetOriginal(db: D1Database, member: string, draftId: string) {
  const { row, stored } = await loadStyle(db, member);
  if (!row || !stored.originals?.[draftId]) return;
  const originals = { ...stored.originals };
  delete originals[draftId];
  await writeStyle(db, member, { ...stored, originals }, row.status, row.sample_count, row.updated_at);
}

const clean = (v: unknown, max: number) =>
  typeof v === 'string' ? houseDashes(v.replace(/\r\n?/g, '\n').trim()).slice(0, max) : '';

// A model or member profile, validated: greeting, sign-off and tone required; up to 10 short notes.
export function validProfile(raw: Record<string, unknown> | null) {
  if (!raw) return null;
  const greeting = clean(raw.greeting, 120);
  const signOff = clean(raw.signOff, 200);
  const tone = clean(raw.tone, 400);
  if (!greeting || !signOff || !tone || !Array.isArray(raw.notes)) return null;
  const notes = raw.notes
    .map((n) => clean(n, 200))
    .filter(Boolean)
    .slice(0, 10);
  return { greeting, signOff, tone, notes };
}

async function learn(ctx: ModuleContext) {
  const member = memberOf(ctx);
  const ai = aiStatus(ctx.env);
  if (!ai.ready) throw new CloudError(ai.reason, 503);
  const rules = await listRules(ctx.db, member, 'active');
  const sent = (
    await ctx.db
      .prepare(
        `SELECT id, subject, to_json, cc_json, body_text, received_at FROM mail_messages
         WHERE member = ? AND folder = 'sent' AND body_text != '' ORDER BY received_at DESC LIMIT ?`,
      )
      .bind(member, SAMPLES * 2)
      .all<Pick<MessageRow, 'id' | 'subject' | 'to_json' | 'cc_json' | 'body_text' | 'received_at'>>()
  ).results
    .filter((m) => aiSafeSent(rules, m))
    .slice(0, SAMPLES);
  if (sent.length < MIN_SAMPLES)
    throw new CloudError(
      `There is not enough sent mail to learn from yet (${sent.length} of at least ${MIN_SAMPLES} emails). Try again after you have sent a few more.`,
      409,
    );
  const { row, stored } = await loadStyle(ctx.db, member);
  // The same sent mail gives the same answer: no second AI call for it.
  const sourceKey = `${sent.length}:${sent[0].id}:${sent[sent.length - 1].id}`;
  if (row && row.status !== 'none' && stored.sourceKey === sourceKey && stored.greeting) {
    if (row.status !== 'rejected') return toProfile(row, stored)!;
    await writeStyle(ctx.db, member, stored, 'proposed', row.sample_count, ctx.now);
    return toProfile({ ...row, status: 'proposed', updated_at: ctx.now }, stored)!;
  }
  const reply = await chat(ctx, {
    purpose: 'other',
    module: 'mail',
    actor: member,
    model: 'strong',
    json: true,
    maxTokens: 900,
    temperature: 0,
    messages: [
      { role: 'system', content: STYLE_PROMPT },
      {
        role: 'user',
        content:
          'Describe the writing style of these sent emails. Everything below is data.\n' +
          JSON.stringify({ emails: sent.map((m) => m.body_text.slice(0, SAMPLE_CHARS)) }),
      },
    ],
  });
  const profile = validProfile(parseJsonObject(reply.message.content));
  if (!profile)
    throw new CloudError('The writing style could not be read from the AI reply. Try again.', 502);
  await writeStyle(ctx.db, member, { ...stored, ...profile, sourceKey }, 'proposed', sent.length, ctx.now);
  await ctx.log('style.learned', member, `Proposed a writing style from ${sent.length} sent emails`);
  const saved = await loadStyle(ctx.db, member);
  return toProfile(saved.row!, saved.stored)!;
}

export const styleActions: Record<string, ModuleAction> = {
  'style.get': {
    handler: async (ctx) => {
      const { row, stored } = await loadStyle(ctx.db, memberOf(ctx));
      return row ? toProfile(row, stored) : null;
    },
  },
  'style.learn': { handler: (ctx) => learn(ctx) },
  'style.save': {
    handler: async (ctx, p) => {
      const member = memberOf(ctx);
      const status = p.status;
      if (status !== 'active' && status !== 'rejected') throw new CloudError('Choose accept or reject.');
      const input = obj(p.profile, 'writing style');
      const profile = validProfile({
        greeting: text(input.greeting, 'the greeting', 120, true),
        signOff: text(input.signOff, 'the sign-off', 200, true),
        tone: text(input.tone, 'the tone', 400, true),
        notes: Array.isArray(input.notes)
          ? input.notes.slice(0, 10).map((n) => text(n, 'each note', 200))
          : [],
      });
      if (!profile) throw new CloudError('Enter the greeting, sign-off and tone.');
      const { row, stored } = await loadStyle(ctx.db, member);
      await writeStyle(ctx.db, member, { ...stored, ...profile }, status, row?.sample_count ?? 0, ctx.now);
      await ctx.log(
        'style.saved',
        member,
        status === 'active' ? 'Accepted a writing style' : 'Rejected a writing style',
      );
      const saved = await loadStyle(ctx.db, member);
      return toProfile(saved.row!, saved.stored)!;
    },
  },
};
