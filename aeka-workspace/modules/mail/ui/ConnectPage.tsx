'use client';
// Outlook connection: setup an administrator must complete, connecting the member's own mailbox, the
// AI and alert settings, and disconnecting. Also shows the result of returning from Microsoft sign-in.
import { useState } from 'react';
import { CircleCheck, CircleDashed, Copy, Plug, ShieldCheck, TriangleAlert } from 'lucide-react';
import { ConfirmButton } from '../../workflow/ui/components/ConfirmButton';
import { Empty, Toggle } from '../../workflow/ui/components/Bits';
import { mail } from '../shared/client';
import type { AccountSettings } from '../shared/types';
import { errorMessage, formatStamp, formatWhen } from './lib';
import { useMail } from './store';

export interface ReturnNotice {
  ok: boolean;
  text: string;
}

const ERROR_TEXT: Record<string, string> = {
  access_denied: 'Microsoft sign-in was cancelled, or the permissions were not granted.',
  consent_required: 'Your organisation must approve the permissions first. Ask an administrator.',
  state: 'The sign-in link expired. Please connect again.',
  expired: 'The sign-in link expired. Please connect again.',
  mismatch: 'You signed in to Microsoft with a different account from your workspace email.',
  account_mismatch: 'You signed in to Microsoft with a different account from your workspace email.',
  not_configured: 'Outlook is not set up for the firm yet. Ask an administrator.',
  storage: 'Secure storage is not set up for the firm yet. Ask an administrator.',
};

// Reads ?mail=connected or ?mail_error=<code> once, then removes them from the address bar.
export function takeReturnNotice(): ReturnNotice | null {
  if (typeof window === 'undefined') return null;
  try {
    const url = new URL(window.location.href);
    const ok = url.searchParams.get('mail');
    const err = url.searchParams.get('mail_error');
    if (!ok && !err) return null;
    url.searchParams.delete('mail');
    url.searchParams.delete('mail_error');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    if (err) {
      const code = /^[a-z0-9_]{1,40}$/i.test(err) ? err.toLowerCase() : '';
      return {
        ok: false,
        text:
          ERROR_TEXT[code] ?? 'Outlook could not be connected. Please try again, or ask an administrator.',
      };
    }
    return ok === 'connected'
      ? { ok: true, text: 'Outlook is connected. Your first sync starts now.' }
      : null;
  } catch {
    return null;
  }
}

function SetupRow({
  ready,
  title,
  vars,
  detail,
}: {
  ready: boolean | null;
  title: string;
  vars: string[];
  detail?: string;
}) {
  return (
    <li className={'mail-setup-row' + (ready ? ' ready' : '')}>
      {ready ? (
        <CircleCheck size={18} aria-hidden="true" className="wf-green" />
      ) : (
        <CircleDashed size={18} aria-hidden="true" />
      )}
      <div>
        <strong>{title}</strong>{' '}
        <span className={'wf-pill ' + (ready ? 'green' : ready === null ? 'grey' : 'amber')}>
          {ready ? 'Ready' : ready === null ? 'Required' : 'Not set up'}
        </span>
        <div className="mail-vars">
          {vars.map((v) => (
            <code key={v}>{v}</code>
          ))}
        </div>
        {detail && <p className="wf-caption">{detail}</p>}
      </div>
    </li>
  );
}

export function ConnectPage({ notice, onDismiss }: { notice: ReturnNotice | null; onDismiss: () => void }) {
  const { account: state, reloadAccount, setAccount, notify } = useMail();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const redirect = origin + '/api/mail/callback';

  if (state.phase === 'loading')
    return (
      <p className="wf-loading" role="status">
        Loading the Outlook connection
      </p>
    );
  if (state.phase === 'error' || !state.setup)
    return (
      <Empty
        icon={TriangleAlert}
        title="The Outlook connection could not be loaded"
        action={
          <button type="button" className="button primary" onClick={reloadAccount}>
            Try again
          </button>
        }
      >
        {state.error || 'The workspace did not respond.'}
      </Empty>
    );

  const { setup, account } = state;
  const setupDone = setup.outlookConfigured && setup.storageReady;

  const updateSettings = async (settings: AccountSettings) => {
    setBusy(true);
    setError('');
    try {
      setAccount(await mail('account.update', { settings }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const disconnect = async () => {
    setError('');
    try {
      await mail('account.disconnect', {});
      setAccount(null);
      notify('Outlook disconnected. Stored mail was removed from the workspace.');
      void reloadAccount();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(redirect);
      notify('Redirect address copied');
    } catch {
      notify('Copying was blocked. Select the address and copy it manually.');
    }
  };

  return (
    <div className="wf-stack mail-connect">
      {notice && (
        <div
          className={notice.ok ? 'mail-banner ok' : 'wf-note mail-banner'}
          role={notice.ok ? 'status' : 'alert'}
        >
          <span>{notice.text}</span>
          <button type="button" className="wf-link" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      )}

      {!setupDone && (
        <section className="card wf-section tinted" aria-labelledby="mail-setup-h">
          <h2 id="mail-setup-h">Setup needed from an administrator</h2>
          <p className="wf-caption">
            Outlook cannot be connected until these server settings are in place. Members cannot change them.
          </p>
          <ul className="mail-setup">
            <SetupRow
              ready={setup.outlookConfigured}
              title="Outlook app registration (Microsoft Entra)"
              vars={['MS_CLIENT_ID', 'MS_CLIENT_SECRET', 'MS_TENANT_ID']}
              detail="MS_TENANT_ID is the firm's tenant id, or organizations."
            />
            <SetupRow
              ready={setup.storageReady}
              title="Secure storage for sign-in tokens"
              vars={['AEKA_ENCRYPTION_KEY']}
            />
            <SetupRow
              ready={null}
              title="Public address of the workspace"
              vars={['AEKA_PUBLIC_ORIGIN']}
              detail="Used to build the sign-in return address below."
            />
            <SetupRow
              ready={setup.aiReady}
              title="Firm AI service (LiteLLM)"
              vars={['LITELLM_BASE_URL', 'LITELLM_API_KEY', 'LITELLM_MODEL', 'LITELLM_FAST_MODEL']}
              detail={
                setup.aiReady ? undefined : setup.aiReason || 'Without it, mail is sorted by rules only.'
              }
            />
          </ul>
          <h3 className="wf-h4">Register this redirect address in Entra</h3>
          <div className="mail-copy">
            <code>{redirect}</code>
            <button type="button" className="button secondary small" onClick={copy}>
              <Copy size={14} aria-hidden="true" /> Copy
            </button>
          </div>
          <p className="wf-caption">
            Use the public address of the workspace if it differs from this one. Delegated permissions:{' '}
            <code>offline_access</code>, <code>User.Read</code>, <code>Mail.ReadWrite</code>,{' '}
            <code>Mail.Send</code>.
          </p>
        </section>
      )}

      {setupDone && (!account || account.status === 'disconnected') && (
        <section className="card wf-section" aria-labelledby="mail-connect-h">
          <h2 id="mail-connect-h">Connect your Outlook mailbox</h2>
          <p>
            You sign in with Microsoft and approve access to your own mailbox. No one else in the firm can see
            your mail here, administrators included.
          </p>
          <a className="button primary mail-connect-btn" href="/api/mail/connect">
            <Plug size={16} aria-hidden="true" /> Connect Outlook
          </a>
        </section>
      )}

      {account && account.status !== 'disconnected' && (
        <section className="card wf-section" aria-labelledby="mail-account-h">
          <div className="wf-row wf-between wf-wrap">
            <h2 id="mail-account-h">Your mailbox</h2>
            <span className={'wf-pill ' + (account.status === 'connected' ? 'green' : 'amber')}>
              {account.status === 'connected' ? 'Connected' : 'Sign in again'}
            </span>
          </div>
          <dl className="mail-meta">
            <dt>Account</dt>
            <dd>
              {account.displayName ? account.displayName + ', ' : ''}
              {account.address}
            </dd>
            <dt>Connected</dt>
            <dd>{formatStamp(account.connectedAt)}</dd>
            <dt>Last sync</dt>
            <dd>{account.lastSyncAt ? formatWhen(account.lastSyncAt) : 'Not yet'}</dd>
            {account.lastError && (
              <>
                <dt>Last problem</dt>
                <dd className="wf-red">{account.lastError}</dd>
              </>
            )}
          </dl>
          {account.status === 'reauth' && (
            <div className="wf-note mail-banner">
              <span>Microsoft asks you to sign in again before mail can sync.</span>
              <a className="button primary small" href="/api/mail/connect">
                Reconnect
              </a>
            </div>
          )}
          <div className="wf-toggles">
            <Toggle
              pressed={account.settings.aiTriage}
              disabled={busy}
              onChange={(v) => updateSettings({ ...account.settings, aiTriage: v })}
            >
              Use AI to triage my mail{!setup.aiReady && ' (the firm AI service is not set up)'}
            </Toggle>
            <p className="wf-caption mail-toggle-help">
              When off, mail is sorted by built-in checks and your rules only, and no email content is sent to
              AI.
            </p>
            <Toggle
              pressed={account.settings.alertUrgent}
              disabled={busy}
              onChange={(v) => updateSettings({ ...account.settings, alertUrgent: v })}
            >
              Alert me about urgent email
            </Toggle>
            <p className="wf-caption mail-toggle-help">
              A workspace notification, and WhatsApp if you have linked it in the Assistant.
            </p>
          </div>
          <p className="wf-sr" aria-live="polite">
            {busy ? 'Saving' : ''}
          </p>
          {error && (
            <p className="wf-error" role="alert">
              {error}
            </p>
          )}
          <div className="mail-disconnect">
            <ConfirmButton
              className="button danger"
              question="Disconnect and remove stored mail, triage, drafts and rules from the workspace? Outlook itself is not changed."
              confirmLabel="Disconnect"
              onConfirm={disconnect}
            >
              Disconnect Outlook
            </ConfirmButton>
          </div>
        </section>
      )}

      <section className="card wf-section" aria-labelledby="mail-ai-h">
        <h2 id="mail-ai-h">
          <ShieldCheck size={17} aria-hidden="true" /> What is sent to AI
        </h2>
        <ul className="mail-ai-list">
          <li>
            For triage: the subject, sender, recipients, date and up to 2,500 characters of the body, through
            the firm&apos;s own AI service.
          </li>
          <li>For a draft, only when you ask for one: the email thread.</li>
          <li>Never attachments. Senders you mark as Never send to AI are sorted by rules only.</li>
          <li>Nothing is sent from your mailbox until you review a draft and press Send.</li>
        </ul>
      </section>
    </div>
  );
}
