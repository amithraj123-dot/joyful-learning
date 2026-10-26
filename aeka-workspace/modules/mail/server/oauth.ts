// Connecting Outlook: Microsoft sign-in with PKCE (S256) and a single-use state bound to the
// signed-in member. The token set is sealed with the member's email as record id. The routes in
// app/api/mail/{connect,callback} call these with the platform's sign-in and environment.
import { configured, type ServerEnv } from '../../../core/server/env.ts';
import { recordActivity } from '../../../core/server/activity.ts';
import { resolveMember, type SignedInUser } from '../../../core/server/members.ts';
import { seal, sealingAvailable, unseal } from '../../../core/server/secrets.ts';
import { readMe, SCOPES, tenantOf, TOKEN_PURPOSE, tokenRequest, tokenSetFrom } from './graph.ts';
import { DEFAULT_SETTINGS, loadAccount, type Sys } from './store.ts';
import { deleteMailData } from './sync.ts';

const STATE_LIFE_MS = 10 * 60000;
const VERIFIER_PURPOSE = 'mail-oauth';

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const random = (n: number) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const challengeFor = async (verifier: string) =>
  b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));

const originOf = (request: Request, env: ServerEnv) => {
  const configuredOrigin = env.AEKA_PUBLIC_ORIGIN?.trim();
  if (configuredOrigin) {
    try {
      return new URL(configuredOrigin).origin;
    } catch {
      // fall back to the request origin
    }
  }
  return new URL(request.url).origin;
};
const back = (origin: string, query: string) =>
  new Response(null, {
    status: 302,
    headers: { Location: `${origin}/?page=mail/connect&${query}`, 'Cache-Control': 'no-store' },
  });
const fail = (origin: string, code: string) => back(origin, `mail_error=${code}`);

export interface ConnectDeps {
  db: D1Database | undefined;
  user: SignedInUser | null;
  env: ServerEnv;
  fetch: typeof fetch;
  now?: number;
}

async function precheck(request: Request, d: ConnectDeps) {
  const origin = originOf(request, d.env);
  if (!d.user) return { error: fail(origin, 'signin'), origin };
  if (!d.db) return { error: fail(origin, 'storage'), origin };
  if (!configured(d.env.MS_CLIENT_ID, d.env.MS_CLIENT_SECRET)) return { error: fail(origin, 'not_configured'), origin };
  if (!sealingAvailable(d.env)) return { error: fail(origin, 'no_encryption_key'), origin };
  const member = await resolveMember(d.db, d.user);
  if (!member) return { error: fail(origin, 'not_member'), origin };
  return { origin, member, db: d.db };
}

// GET /api/mail/connect
export async function startConnect(request: Request, d: ConnectDeps): Promise<Response> {
  const p = await precheck(request, d);
  if (p.error) return p.error;
  const { origin, member, db } = p;
  const now = d.now ?? Date.now();
  const state = random(32);
  const verifier = random(48);
  await db.prepare('DELETE FROM mail_oauth_states WHERE created_at < ?').bind(now - STATE_LIFE_MS).run();
  await db
    .prepare('INSERT INTO mail_oauth_states(state,member,verifier_sealed,created_at) VALUES(?,?,?,?)')
    .bind(state, member.email, await seal(d.env, VERIFIER_PURPOSE, state, verifier), now)
    .run();
  const q = new URLSearchParams({
    client_id: d.env.MS_CLIENT_ID!.trim(),
    response_type: 'code',
    redirect_uri: `${origin}/api/mail/callback`,
    response_mode: 'query',
    scope: SCOPES,
    state,
    code_challenge: await challengeFor(verifier),
    code_challenge_method: 'S256',
    prompt: 'select_account',
    login_hint: member.email,
  });
  return new Response(null, {
    status: 302,
    headers: {
      Location: `https://login.microsoftonline.com/${encodeURIComponent(tenantOf(d.env))}/oauth2/v2.0/authorize?${q}`,
      'Cache-Control': 'no-store',
    },
  });
}

// GET /api/mail/callback
export async function finishConnect(request: Request, d: ConnectDeps): Promise<Response> {
  const p = await precheck(request, d);
  if (p.error) return p.error;
  const { origin, member, db } = p;
  const now = d.now ?? Date.now();
  const url = new URL(request.url);
  const state = url.searchParams.get('state') || '';
  const code = url.searchParams.get('code') || '';
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(state)) return fail(origin, 'state');
  const row = await db
    .prepare('SELECT * FROM mail_oauth_states WHERE state = ?')
    .bind(state)
    .first<{ state: string; member: string; verifier_sealed: string; created_at: number }>();
  if (!row || row.member !== member.email) return fail(origin, 'state');
  // Single use: only the request that deletes the state may continue.
  const taken = await db.prepare('DELETE FROM mail_oauth_states WHERE state = ?').bind(state).run();
  if (!taken.meta.changes) return fail(origin, 'state');
  if (row.created_at < now - STATE_LIFE_MS) return fail(origin, 'expired');
  if (url.searchParams.get('error')) return fail(origin, 'denied');
  if (!code || code.length > 4000) return fail(origin, 'state');

  const sys: Sys = { db, env: d.env, fetch: d.fetch, now };
  const verifier = await unseal(d.env, VERIFIER_PURPOSE, state, row.verifier_sealed);
  const { status, data } = await tokenRequest(sys, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: `${origin}/api/mail/callback`,
    code_verifier: verifier,
  });
  const tokens = status === 200 ? tokenSetFrom(data, now) : null;
  if (!tokens) return fail(origin, 'token');
  const me = await readMe(sys, tokens.access_token);
  if (!me) return fail(origin, 'profile');
  const other = await db
    .prepare('SELECT member FROM mail_accounts WHERE address = ? AND member != ?')
    .bind(me.address, member.email)
    .first();
  if (other) return fail(origin, 'mailbox_in_use');

  const existing = await loadAccount(db, member.email);
  // A different mailbox starts afresh, so two mailboxes are never mixed.
  const sameMailbox = existing?.address === me.address;
  if (existing && !sameMailbox) await deleteMailData(db, member.email, false);
  await db
    .prepare(
      `INSERT INTO mail_accounts(member,address,display_name,token_sealed,access_expires,status,inbox_delta,sent_delta,
       last_sync_at,last_error,settings,created_at,updated_at) VALUES(?,?,?,?,?,'connected',?,?,?,'',?,?,?)
       ON CONFLICT(member) DO UPDATE SET address = excluded.address, display_name = excluded.display_name,
       token_sealed = excluded.token_sealed, access_expires = excluded.access_expires, status = 'connected',
       inbox_delta = excluded.inbox_delta, sent_delta = excluded.sent_delta, last_sync_at = excluded.last_sync_at,
       last_error = '', settings = excluded.settings, created_at = excluded.created_at, updated_at = excluded.updated_at`,
    )
    .bind(
      member.email,
      me.address,
      me.displayName || member.name,
      await seal(d.env, TOKEN_PURPOSE, member.email, JSON.stringify(tokens)),
      tokens.expires_at,
      sameMailbox ? existing.inbox_delta : null,
      sameMailbox ? existing.sent_delta : null,
      sameMailbox ? existing.last_sync_at : null,
      existing && sameMailbox ? existing.settings : JSON.stringify(DEFAULT_SETTINGS),
      now,
      now,
    )
    .run();
  await recordActivity(
    db,
    {
      actor: member.email,
      actorName: member.name,
      module: 'mail',
      action: 'account.connected',
      target: member.email,
      summary: 'Connected Outlook',
    },
    now,
  );
  return back(origin, 'mail=connected');
}
