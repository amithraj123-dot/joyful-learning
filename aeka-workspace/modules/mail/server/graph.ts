// The only path to Microsoft Graph. Requests are checked against a short allow-list: read messages,
// delta and conversation queries; read the calendar view; create a reply draft; and patch, send or delete only drafts this
// module created (recorded in mail_drafts). Tokens are refreshed before expiry and the rotated refresh
// token is always stored. 429 and 503 stop the batch; 401 refreshes once.
import { CloudError } from '../../../lib/cloud-store.ts';
import { notify } from '../../../core/server/notifications.ts';
import { seal, unseal } from '../../../core/server/secrets.ts';
import type { ServerEnv } from '../../../core/server/env.ts';
import { loadAccount, type AccountRow, type Sys } from './store.ts';

export const GRAPH = 'https://graph.microsoft.com/v1.0';
export const SCOPES = 'offline_access openid email User.Read Mail.ReadWrite Mail.Send Calendars.Read';
// What sign-ins made before calendar access was added were granted; their refreshes keep to it.
const EARLIER_SCOPES = 'offline_access openid email User.Read Mail.ReadWrite Mail.Send';
export const TOKEN_PURPOSE = 'mail-token';
const TIMEOUT_MS = 20000;
const REFRESH_MARGIN_MS = 2 * 60000;
// Immutable ids survive moves between folders; plain text bodies keep triage input small.
const PREFER = 'outlook.body-content-type="text", IdType="ImmutableId"';

export class GraphError extends Error {
  status: number; // 0: network or timeout
  retryAfter: number; // seconds, for 429 and 503
  constructor(message: string, status: number, retryAfter = 0) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
  get busy() {
    return this.status === 429 || this.status === 503 || this.status === 504;
  }
}
// The account needs the member to sign in again; syncing stops until they reconnect.
export class ReauthError extends CloudError {
  constructor() {
    super('Outlook needs you to sign in again. Open Outlook connection and reconnect.', 409);
  }
}

export interface TokenSet {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope?: string; // what Microsoft granted (absent for tokens stored before it was recorded)
}

// Whether the stored sign-in includes calendar access.
export const calendarGranted = (t: Pick<TokenSet, 'scope'>) =>
  /(^|\s|\/)Calendars\.Read(\s|$)/i.test(t.scope || '');
// Refresh with what was granted, so an account connected earlier is not asked for new permissions.
const refreshScope = (t: TokenSet) =>
  t.scope
    ? 'offline_access ' +
      t.scope
        .split(/\s+/)
        .filter((x) => x && x !== 'offline_access')
        .join(' ')
    : EARLIER_SCOPES;

export const tenantOf = (env: ServerEnv) => env.MS_TENANT_ID?.trim() || 'organizations';
export const tokenUrl = (env: ServerEnv) =>
  `https://login.microsoftonline.com/${encodeURIComponent(tenantOf(env))}/oauth2/v2.0/token`;

// Posts to the token endpoint; returns the parsed reply and status (never throws on HTTP errors).
export async function tokenRequest(sys: Sys, form: Record<string, string>) {
  let res: Response;
  try {
    res = await sys.fetch(tokenUrl(sys.env), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: sys.env.MS_CLIENT_ID || '',
        client_secret: sys.env.MS_CLIENT_SECRET || '',
        scope: SCOPES,
        ...form,
      }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { status: 0, data: {} as Record<string, unknown> };
  }
  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    data = {};
  }
  return { status: res.status, data };
}

export function tokenSetFrom(
  data: Record<string, unknown>,
  now: number,
  previousRefresh = '',
  previousScope = '',
): TokenSet | null {
  const access = typeof data.access_token === 'string' ? data.access_token : '';
  const refresh = typeof data.refresh_token === 'string' ? data.refresh_token : previousRefresh;
  const expiresIn = Number(data.expires_in);
  if (!access || !refresh) return null;
  const scope = typeof data.scope === 'string' ? data.scope.slice(0, 1000) : previousScope;
  return {
    access_token: access,
    refresh_token: refresh,
    expires_at: now + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600) * 1000,
    ...(scope ? { scope } : {}),
  };
}

async function markReauth(sys: Sys, account: AccountRow) {
  const r = await sys.db
    .prepare(
      "UPDATE mail_accounts SET status = 'reauth', last_error = ?, updated_at = ? WHERE member = ? AND status = 'connected'",
    )
    .bind('Outlook asked you to sign in again. Reconnect to resume triage.', sys.now, account.member)
    .run();
  if (r.meta.changes)
    await notify(
      sys.db,
      {
        recipient: account.member,
        module: 'mail',
        kind: 'mail.reauth',
        title: 'Reconnect Outlook',
        body: 'Outlook asked you to sign in again. Inbox triage is paused until you reconnect.',
        link: 'mail/connect',
        dedupeKey: `mail.reauth:${account.created_at}`,
      },
      sys.now,
    );
}

// A signed-in Graph session for one member's account.
export class GraphSession {
  sys: Sys;
  account: AccountRow;
  private tokens: TokenSet | null = null;
  calls = 0;
  constructor(sys: Sys, account: AccountRow) {
    this.sys = sys;
    this.account = account;
  }

  private async load() {
    if (!this.tokens) {
      const text = await unseal(this.sys.env, TOKEN_PURPOSE, this.account.member, this.account.token_sealed);
      try {
        this.tokens = JSON.parse(text) as TokenSet;
      } catch {
        throw new CloudError('A stored credential is unreadable. Reconnect.', 409);
      }
    }
    return this.tokens;
  }

  private async refresh() {
    const current = await this.load();
    const { status, data } = await tokenRequest(this.sys, {
      grant_type: 'refresh_token',
      refresh_token: current.refresh_token,
      scope: refreshScope(current),
    });
    if (status === 400 && (data.error === 'invalid_grant' || data.error === 'interaction_required')) {
      await markReauth(this.sys, this.account);
      throw new ReauthError();
    }
    const next =
      status === 200 ? tokenSetFrom(data, Date.now(), current.refresh_token, current.scope || '') : null;
    if (!next)
      throw new GraphError('Outlook sign-in could not be renewed. Will try again shortly.', status || 0);
    this.tokens = next;
    // Refresh tokens rotate: store the new one before using the access token.
    await this.sys.db
      .prepare(
        'UPDATE mail_accounts SET token_sealed = ?, access_expires = ?, updated_at = ? WHERE member = ?',
      )
      .bind(
        await seal(this.sys.env, TOKEN_PURPOSE, this.account.member, JSON.stringify(next)),
        next.expires_at,
        this.sys.now,
        this.account.member,
      )
      .run();
    return next;
  }

  private async accessToken() {
    if (this.account.status !== 'connected') throw new ReauthError();
    const t = await this.load();
    return t.expires_at - REFRESH_MARGIN_MS > Date.now()
      ? t.access_token
      : (await this.refresh()).access_token;
  }

  // The permissions of the stored sign-in.
  async granted() {
    return (await this.load()).scope || '';
  }

  // Whether this module created the draft (only those may be changed, sent or deleted).
  private async ownsDraft(graphId: string) {
    const r = await this.sys.db
      .prepare("SELECT 1 AS ok FROM mail_drafts WHERE member = ? AND graph_draft_id = ? AND status != 'sent'")
      .bind(this.account.member, graphId)
      .first();
    return !!r;
  }

  private async allowed(method: string, url: URL) {
    if (url.origin !== 'https://graph.microsoft.com' || !url.pathname.startsWith('/v1.0/')) return false;
    // Matched segment by segment, so an id can never smuggle in another path.
    let seg: string[];
    try {
      seg = url.pathname.slice(6).split('/').map(decodeURIComponent);
    } catch {
      return false;
    }
    const lower = seg.map((x) => x.toLowerCase());
    const messages = lower[0] === 'me' && lower[1] === 'messages';
    const id = messages && seg.length >= 3 ? seg[2] : '';
    if (method === 'GET') {
      const folder =
        (lower[0] === 'me' || lower[0] === 'users') &&
        lower.slice(-2).join('/') === 'messages/delta' &&
        lower.some((x) => x.startsWith('mailfolders'));
      const calendarView = seg.length === 2 && lower[0] === 'me' && lower[1] === 'calendarview';
      return (folder && seg.length <= 6) || (messages && seg.length <= 3) || calendarView;
    }
    if (method === 'POST' && id && seg.length === 4 && /^createreply(all)?$/.test(lower[3])) return true;
    if (method === 'POST' && id && seg.length === 4 && lower[3] === 'send') return this.ownsDraft(id);
    if ((method === 'PATCH' || method === 'DELETE') && id && seg.length === 3) return this.ownsDraft(id);
    return false;
  }

  // One Graph request. Throws GraphError for HTTP and network failures (status 0).
  async request(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    pathOrUrl: string,
    body?: unknown,
    extraPrefer = '',
  ): Promise<{ status: number; data: Record<string, unknown> }> {
    const url = new URL(pathOrUrl.startsWith('https://') ? pathOrUrl : GRAPH + pathOrUrl);
    if (!(await this.allowed(method, url)))
      throw new CloudError('This Outlook operation is not permitted for the workspace.', 403);
    for (let attempt = 0; ; attempt++) {
      const token = await this.accessToken();
      let res: Response;
      this.calls++;
      try {
        res = await this.sys.fetch(url.toString(), {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            Prefer: extraPrefer ? `${PREFER}, ${extraPrefer}` : PREFER,
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        throw new GraphError('Outlook could not be reached.', 0);
      }
      if (res.status === 401 && attempt === 0) {
        await this.refresh();
        continue;
      }
      let data: Record<string, unknown> = {};
      if (res.status !== 202 && res.status !== 204) {
        try {
          data = (await res.json()) as Record<string, unknown>;
        } catch {
          data = {};
        }
      }
      if (res.ok) return { status: res.status, data };
      const retry = Number(res.headers.get('Retry-After'));
      const code = (data.error as { code?: string } | undefined)?.code || '';
      throw new GraphError(
        res.status === 429 || res.status === 503
          ? 'Outlook asked the workspace to slow down. Mail will be checked again shortly.'
          : `Outlook returned an error (${res.status}${code ? ' ' + code.slice(0, 60) : ''}).`,
        res.status,
        Number.isFinite(retry) && retry > 0 ? Math.min(retry, 3600) : 60,
      );
    }
  }
}

// The signed-in mailbox, read once while connecting (before an account row exists).
export async function readMe(sys: Sys, accessToken: string) {
  try {
    const res = await sys.fetch(`${GRAPH}/me?$select=mail,userPrincipalName,displayName`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const me = (await res.json()) as { mail?: string; userPrincipalName?: string; displayName?: string };
    const address = (me.mail || me.userPrincipalName || '').trim().toLowerCase();
    return address ? { address, displayName: (me.displayName || '').trim().slice(0, 120) } : null;
  } catch {
    return null;
  }
}

export async function openSession(sys: Sys, member: string) {
  const account = await loadAccount(sys.db, member);
  if (!account) throw new CloudError('Connect Outlook first.', 409);
  if (account.status !== 'connected') throw new ReauthError();
  return new GraphSession(sys, account);
}

// For actions: Graph failures as messages for the member.
export function graphProblem(e: unknown): never {
  if (e instanceof GraphError)
    throw new CloudError(
      e.busy
        ? 'Outlook is busy just now. Try again in a minute.'
        : e.status === 0
          ? 'Outlook could not be reached. Try again shortly.'
          : e.status === 404
            ? 'Outlook could not find this message. It may have been deleted.'
            : e.message,
      e.status === 404 ? 404 : 502,
    );
  throw e;
}
