// The member's assistant settings (morning brief, WhatsApp alerts) and WhatsApp linking.
import { CloudError } from '../../../lib/cloud-store.ts';
import { configured, type ServerEnv } from '../../../core/server/env.ts';
import type { ModuleContext } from '../../../core/server/module.ts';
import type { AlertSettings, AssistantSettings, WhatsAppStatus } from '../shared/types.ts';
import { HOUR, MINUTE } from './recurrence.ts';
import { HHMM, bad, bool, obj, owner } from './validate.ts';

// Stored in as_settings.settings. linkedAt marks when the current number was linked, so only notices
// from then on go to WhatsApp.
export interface StoredSettings {
  briefEnabled: boolean;
  briefTime: string;
  alerts: AlertSettings;
  linkedAt?: number | null;
}
export interface SettingsRow {
  member: string;
  settings: StoredSettings;
  phone: string | null;
  lastInboundAt: number | null;
  lastBriefDate: string | null;
}

export const DEFAULT_SETTINGS: StoredSettings = {
  briefEnabled: true,
  briefTime: '08:30',
  alerts: { reminders: true, brief: true, urgentMail: true },
};
const LINK_MINUTES = 15;
export const REPLY_WINDOW = 24 * HOUR;

export const whatsappReady = (env: ServerEnv) =>
  env.WHATSAPP_ENABLED === 'true' &&
  configured(
    env.WHATSAPP_APP_SECRET,
    env.WHATSAPP_VERIFY_TOKEN,
    env.WHATSAPP_ACCESS_TOKEN,
    env.WHATSAPP_PHONE_NUMBER_ID,
  );

export const maskPhone = (phone: string | null) => (phone ? '•••• ' + phone.slice(-4) : '');

function parseSettings(text: unknown): StoredSettings {
  let v: Partial<StoredSettings> = {};
  try {
    v = JSON.parse(String(text || '{}'));
  } catch {
    v = {};
  }
  const a: Partial<AlertSettings> = v.alerts ?? {};
  return {
    briefEnabled: typeof v.briefEnabled === 'boolean' ? v.briefEnabled : DEFAULT_SETTINGS.briefEnabled,
    briefTime:
      typeof v.briefTime === 'string' && HHMM.test(v.briefTime) ? v.briefTime : DEFAULT_SETTINGS.briefTime,
    alerts: {
      reminders: typeof a.reminders === 'boolean' ? a.reminders : true,
      brief: typeof a.brief === 'boolean' ? a.brief : true,
      urgentMail: typeof a.urgentMail === 'boolean' ? a.urgentMail : true,
    },
    linkedAt: typeof v.linkedAt === 'number' ? v.linkedAt : null,
  };
}

export async function readSettings(db: D1Database, member: string): Promise<SettingsRow> {
  const r = await db
    .prepare('SELECT * FROM as_settings WHERE member = ?')
    .bind(member)
    .first<Record<string, unknown>>();
  return {
    member,
    settings: parseSettings(r?.settings),
    phone: (r?.whatsapp_phone as string | null) ?? null,
    lastInboundAt: (r?.last_inbound_at as number | null) ?? null,
    lastBriefDate: (r?.last_brief_date as string | null) ?? null,
  };
}

// Creates the member's settings row with defaults if it does not exist yet.
export const ensureSettingsRow = (db: D1Database, member: string, now: number) =>
  db
    .prepare(
      'INSERT INTO as_settings(member,settings,updated_at) VALUES(?,?,?) ON CONFLICT(member) DO NOTHING',
    )
    .bind(member, JSON.stringify(DEFAULT_SETTINGS), now);

const publicSettings = (row: SettingsRow): AssistantSettings => ({
  briefEnabled: row.settings.briefEnabled,
  briefTime: row.settings.briefTime,
  whatsapp: { phone: row.phone, alerts: row.settings.alerts },
});

export function whatsappStatus(
  env: ServerEnv,
  row: SettingsRow,
  now: number,
  businessNumber = '',
): WhatsAppStatus {
  return {
    available: whatsappReady(env),
    businessNumber,
    linked: !!row.phone,
    phoneMasked: maskPhone(row.phone),
    replyWindowOpen: !!row.phone && row.lastInboundAt != null && now - row.lastInboundAt < REPLY_WINDOW,
  };
}

export async function getSettings(ctx: ModuleContext) {
  const row = await readSettings(ctx.db, owner(ctx));
  return {
    settings: publicSettings(row),
    whatsapp: whatsappStatus(
      ctx.env,
      row,
      ctx.now,
      (ctx.env.WHATSAPP_DISPLAY_NUMBER || '').trim().slice(0, 40),
    ),
  };
}

export async function saveSettings(ctx: ModuleContext, value: unknown) {
  const s = obj(value, 'settings');
  const a = obj(s.alerts, 'alert');
  if (typeof s.briefTime !== 'string' || !HHMM.test(s.briefTime))
    throw bad('Enter the brief time as HH:MM (24-hour, India time).');
  const member = owner(ctx);
  const current = await readSettings(ctx.db, member);
  const next: StoredSettings = {
    briefEnabled: bool(s.briefEnabled, 'the morning brief'),
    briefTime: s.briefTime,
    alerts: {
      reminders: bool(a.reminders, 'reminder alerts'),
      brief: bool(a.brief, 'brief alerts'),
      urgentMail: bool(a.urgentMail, 'urgent mail alerts'),
    },
    linkedAt: current.settings.linkedAt ?? null,
  };
  await ctx.db.batch([
    ensureSettingsRow(ctx.db, member, ctx.now),
    ctx.db
      .prepare('UPDATE as_settings SET settings = ?, updated_at = ? WHERE member = ?')
      .bind(JSON.stringify(next), ctx.now, member),
  ]);
  return publicSettings(await readSettings(ctx.db, member));
}

export async function sha256(text: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Link codes: 8 characters without look-alikes (about 40 bits), valid for 15 minutes, stored hashed.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const normaliseCode = (code: string) => code.toUpperCase().replace(/[\s-]/g, '');

// The firm's WhatsApp display number: WHATSAPP_DISPLAY_NUMBER, else read from the Cloud API (best effort).
async function businessNumber(ctx: ModuleContext) {
  const e = ctx.env;
  if (e.WHATSAPP_DISPLAY_NUMBER?.trim()) return e.WHATSAPP_DISPLAY_NUMBER.trim().slice(0, 40);
  try {
    const res = await ctx.fetch(
      `https://graph.facebook.com/${encodeURIComponent(e.WHATSAPP_GRAPH_VERSION || 'v23.0')}/${encodeURIComponent(
        e.WHATSAPP_PHONE_NUMBER_ID!,
      )}?fields=display_phone_number`,
      { headers: { Authorization: `Bearer ${e.WHATSAPP_ACCESS_TOKEN}` }, signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) return '';
    const body = (await res.json()) as { display_phone_number?: unknown };
    return typeof body.display_phone_number === 'string' ? body.display_phone_number.slice(0, 40) : '';
  } catch {
    return '';
  }
}

export async function startLink(ctx: ModuleContext) {
  if (!whatsappReady(ctx.env))
    throw new CloudError('WhatsApp is not set up for the firm. Ask an administrator.', 409);
  const member = owner(ctx);
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const code = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
  const expiresAt = ctx.now + LINK_MINUTES * MINUTE;
  await ctx.db.batch([
    ensureSettingsRow(ctx.db, member, ctx.now),
    ctx.db
      .prepare('UPDATE as_settings SET link_code = ?, link_expires = ?, updated_at = ? WHERE member = ?')
      .bind(await sha256(code), expiresAt, ctx.now, member),
  ]);
  return { code, expiresAt, businessNumber: await businessNumber(ctx) };
}

// Unlinks the member's number and cancels anything still waiting to be sent to it.
export function unlinkStatements(db: D1Database, member: string, now: number, reason: string) {
  return [
    db
      .prepare(
        "UPDATE as_settings SET whatsapp_phone = NULL, link_code = NULL, link_expires = NULL, settings = json_set(settings, '$.linkedAt', NULL), updated_at = ? WHERE member = ?",
      )
      .bind(now, member),
    db
      .prepare(
        "UPDATE as_outbox SET status = 'failed', error = ?, updated_at = ? WHERE member = ? AND status = 'queued'",
      )
      .bind(reason, now, member),
  ];
}

export async function unlink(ctx: ModuleContext) {
  await ctx.db.batch(unlinkStatements(ctx.db, owner(ctx), ctx.now, 'Not sent: WhatsApp was unlinked.'));
  return true as const;
}
