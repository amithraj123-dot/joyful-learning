'use client';
// Assistant settings: morning brief, WhatsApp linking and alerts, and for administrators the
// Integrations panel (what is configured, never the values) with today's AI use.
import { useEffect, useEffectEvent, useState } from 'react';
import { CircleCheck, CircleDashed, MessageCircle, ShieldCheck, Sunrise } from 'lucide-react';
import { assistant } from '../shared/client';
import type { AlertSettings, AssistantSettings, WhatsAppStatus } from '../shared/types';
import { Toggle } from '../../workflow/ui/components/Bits';
import { ConfirmButton } from '../../workflow/ui/components/ConfirmButton';
import { useAssistant } from './context';
import { Card, InlineError, LoadError, Loading } from './Bits';
import { core, errorMessage, formatClock, useLoad, type IntegrationsStatus, type Member } from './lib';

const POLL_MS = 4000;

interface Linking {
  code: string;
  expiresAt: number;
  businessNumber: string;
}

type Prefs = { briefEnabled: boolean; briefTime: string; alerts: AlertSettings };
const prefsOf = (s: AssistantSettings): Prefs => ({
  briefEnabled: s.briefEnabled,
  briefTime: s.briefTime,
  alerts: s.whatsapp.alerts,
});

function useNow(ms: number, on: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms, on]);
  return now;
}

function WhatsAppCard({
  status,
  prefs,
  onPrefs,
  onStatus,
}: {
  status: WhatsAppStatus;
  prefs: Prefs;
  onPrefs: (p: Prefs) => void;
  onStatus: (s: WhatsAppStatus) => void;
}) {
  const { notify } = useAssistant();
  const [linking, setLinking] = useState<Linking | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const now = useNow(1000, !!linking);
  const expired = !!linking && now >= linking.expiresAt;

  const linked = useEffectEvent((w: WhatsAppStatus) => {
    setLinking(null);
    onStatus(w);
    notify('WhatsApp linked');
  });
  // While a code is showing, check every few seconds whether the member has sent it.
  useEffect(() => {
    if (!linking || expired) return;
    const id = setInterval(() => {
      assistant('settings.get', {}).then(
        (r) => r.whatsapp.linked && linked(r.whatsapp),
        () => undefined,
      );
    }, POLL_MS);
    return () => clearInterval(id);
  }, [linking, expired]);

  const link = async () => {
    setBusy(true);
    setError('');
    try {
      setLinking(await assistant('whatsapp.link', {}));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const unlink = async () => {
    try {
      await assistant('whatsapp.unlink', {});
      onStatus({ ...status, linked: false, phoneMasked: '', replyWindowOpen: false });
      notify('WhatsApp unlinked');
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const alerts: { key: keyof AlertSettings; label: string; hint: string }[] = [
    { key: 'reminders', label: 'Reminders', hint: 'When a reminder is due' },
    { key: 'brief', label: 'Morning brief', hint: 'A short summary at your brief time' },
    { key: 'urgentMail', label: 'Urgent mail', hint: 'When an email is triaged as urgent' },
  ];

  if (!status.available)
    return (
      <Card title="WhatsApp" id="as-set-wa">
        <p className="as-quiet">
          <MessageCircle size={16} aria-hidden="true" /> The firm has not set up WhatsApp yet. Once an
          administrator does, you can link your number here to get reminders and ask Aeka from your phone.
        </p>
      </Card>
    );

  const left = linking ? Math.max(0, linking.expiresAt - now) : 0;
  const mins = Math.floor(left / 60000);
  const secs = Math.floor((left % 60000) / 1000);
  const business = linking?.businessNumber || status.businessNumber || 'the firm WhatsApp number';
  return (
    <Card title="WhatsApp" id="as-set-wa">
      {status.linked ? (
        <div className="as-wa-linked">
          <p>
            <CircleCheck size={16} aria-hidden="true" className="wf-green" /> Linked to{' '}
            <strong>{status.phoneMasked || 'your number'}</strong>
          </p>
          <p className="wf-caption">
            {status.replyWindowOpen
              ? 'You have written in the last 24 hours, so Aeka can reply to you freely.'
              : 'WhatsApp allows free replies only within 24 hours of your last message. Send any message to reopen the conversation; alerts still arrive.'}
          </p>
          <ConfirmButton
            className="button danger"
            question="Unlink WhatsApp?"
            confirmLabel="Unlink"
            onConfirm={unlink}
          >
            Unlink
          </ConfirmButton>
        </div>
      ) : linking && !expired ? (
        <div className="as-wa-code" aria-live="polite">
          <p className="wf-caption">Your code</p>
          <p className="as-code">{linking.code}</p>
          <p>
            Send <strong>LINK {linking.code}</strong> to <strong>{business}</strong> from your WhatsApp within
            15 minutes.
          </p>
          <p className="wf-caption" role="status">
            Waiting for your message. Code expires in {mins}:{String(secs).padStart(2, '0')}.
          </p>
          <button type="button" className="button ghost" onClick={() => setLinking(null)}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="as-wa-link">
          {expired && <p className="wf-error">That code has expired. Get a new one to try again.</p>}
          <p className="wf-caption">
            Link your WhatsApp to get alerts on your phone and to ask Aeka by message. Only the number you
            link can reach your assistant.
          </p>
          <button type="button" className="button primary" onClick={link} disabled={busy}>
            <MessageCircle size={15} aria-hidden="true" /> {expired ? 'Get a new code' : 'Link WhatsApp'}
          </button>
        </div>
      )}
      <InlineError message={error} />
      <fieldset className="wf-fieldset as-alerts" disabled={!status.linked}>
        <legend>Also send to WhatsApp</legend>
        {!status.linked && <p className="wf-caption">Available once your number is linked.</p>}
        {alerts.map((a) => (
          <div key={a.key} className="as-toggle-row">
            <Toggle
              pressed={prefs.alerts[a.key]}
              disabled={!status.linked}
              onChange={(v) => onPrefs({ ...prefs, alerts: { ...prefs.alerts, [a.key]: v } })}
            >
              <span>
                {a.label}
                <small>{a.hint}</small>
              </span>
            </Toggle>
          </div>
        ))}
      </fieldset>
    </Card>
  );
}

function Status({ ready, label }: { ready: boolean; label?: string }) {
  return ready ? (
    <span className="wf-pill green">
      <CircleCheck size={13} aria-hidden="true" /> {label ?? 'Ready'}
    </span>
  ) : (
    <span className="wf-pill amber">
      <CircleDashed size={13} aria-hidden="true" /> {label ?? 'Not set up'}
    </span>
  );
}

function Vars({ names, optional }: { names: string[]; optional?: string[] }) {
  return (
    <p className="as-vars">
      <span>Set:</span>{' '}
      {names.map((n) => (
        <code key={n}>{n}</code>
      ))}
      {optional?.length ? (
        <>
          <span>Optional:</span>{' '}
          {optional.map((n) => (
            <code key={n}>{n}</code>
          ))}
        </>
      ) : null}
    </p>
  );
}

function Integrations() {
  const data = useLoad(async () => {
    const [status, members] = await Promise.all([
      core<IntegrationsStatus>('integrations.status'),
      core<Member[]>('members.list').catch(() => [] as Member[]),
    ]);
    return { status, members };
  });
  if (data.phase === 'loading')
    return (
      <Card title="Integrations" id="as-set-int">
        <Loading>Checking integrations</Loading>
      </Card>
    );
  if (data.phase === 'error' || !data.data)
    return (
      <Card title="Integrations" id="as-set-int">
        <InlineError message={data.error} onRetry={data.retry} />
      </Card>
    );
  const { status: s, members } = data.data;
  const origin = s.publicOrigin || (typeof window !== 'undefined' ? window.location.origin : '');
  const names = new Map(members.map((m) => [m.email, m.name]));
  const rows = [
    {
      title: 'AI service',
      ready: s.ai.ready,
      body: s.ai.ready ? (
        <p className="wf-caption">
          Using {s.ai.model}
          {s.ai.fastModel && s.ai.fastModel !== s.ai.model ? `, and ${s.ai.fastModel} for triage` : ''}.
        </p>
      ) : (
        <>
          <p className="wf-caption">{s.ai.reason || 'The firm AI service is not configured.'}</p>
          <Vars
            names={['LITELLM_BASE_URL', 'LITELLM_API_KEY']}
            optional={['LITELLM_MODEL', 'LITELLM_FAST_MODEL', 'AEKA_AI_DAILY_LIMIT']}
          />
        </>
      ),
    },
    {
      title: 'Secure storage',
      ready: s.secureStorage,
      body: s.secureStorage ? (
        <p className="wf-caption">Stored credentials, such as Outlook tokens, are encrypted.</p>
      ) : (
        <>
          <p className="wf-caption">Needed before anyone can connect Outlook. Use 32 or more random bytes.</p>
          <Vars names={['AEKA_ENCRYPTION_KEY']} />
        </>
      ),
    },
    {
      title: 'Outlook app registration',
      ready: s.outlook && !!s.publicOrigin,
      body: (
        <>
          {!(s.outlook && s.publicOrigin) && (
            <Vars names={['MS_CLIENT_ID', 'MS_CLIENT_SECRET', 'MS_TENANT_ID', 'AEKA_PUBLIC_ORIGIN']} />
          )}
          <p className="wf-caption">
            Redirect URI to register in Entra: <code className="as-break">{origin}/api/mail/callback</code>.
            Delegated permissions: offline_access, User.Read, Mail.ReadWrite, Mail.Send.
          </p>
        </>
      ),
    },
    {
      title: 'Scheduler',
      ready: s.scheduler,
      body: (
        <>
          {!s.scheduler && <Vars names={['AEKA_TICK_TOKEN']} />}
          <p className="wf-caption">
            An external scheduler should POST <code>/api/tick</code> with the AEKA_TICK_TOKEN as a bearer
            token every 5 minutes, so reminders, briefs, mail sync and WhatsApp work while nobody has the
            workspace open.
          </p>
        </>
      ),
    },
    {
      title: 'WhatsApp',
      ready: s.whatsapp,
      body: s.whatsapp ? (
        <p className="wf-caption">Members can link their numbers under WhatsApp above.</p>
      ) : (
        <>
          <p className="wf-caption">Optional. Uses the WhatsApp Cloud API. Set WHATSAPP_ENABLED to true.</p>
          <Vars
            names={[
              'WHATSAPP_ENABLED',
              'WHATSAPP_APP_SECRET',
              'WHATSAPP_VERIFY_TOKEN',
              'WHATSAPP_ACCESS_TOKEN',
              'WHATSAPP_PHONE_NUMBER_ID',
            ]}
            optional={[
              'WHATSAPP_NOTIFICATION_TEMPLATE',
              'WHATSAPP_TEMPLATE_LANGUAGE',
              'WHATSAPP_GRAPH_VERSION',
            ]}
          />
        </>
      ),
    },
  ];
  const usage = [...s.usageToday].sort((a, b) => b.calls - a.calls);
  return (
    <Card
      title={
        <>
          <ShieldCheck size={17} aria-hidden="true" /> Integrations
        </>
      }
      id="as-set-int"
      className="as-integrations"
    >
      <p className="wf-caption as-pad">
        Visible to administrators only. Values are set in the hosting platform&apos;s secret settings and are
        never shown here.
      </p>
      <ul className="as-int-list">
        {rows.map((r) => (
          <li key={r.title}>
            <div className="as-int-head">
              <strong>{r.title}</strong>
              <Status ready={r.ready} />
            </div>
            {r.body}
          </li>
        ))}
      </ul>
      <h3 className="wf-h3 as-pad">AI use today</h3>
      <p className="wf-caption as-pad">
        Daily limit: {s.aiDailyLimit} model calls for each member (India time).
      </p>
      {usage.length === 0 ? (
        <p className="as-quiet as-pad">No AI calls yet today.</p>
      ) : (
        <ul className="as-usage" aria-label="AI use today by member">
          <li className="as-usage-head" aria-hidden="true">
            <span>Member</span>
            <span>Calls</span>
            <span>Failed</span>
            <span>Tokens</span>
          </li>
          {usage.map((u) => {
            const near = u.actor !== 'system' && u.calls >= s.aiDailyLimit * 0.8;
            return (
              <li key={u.actor}>
                <span className="as-usage-who">
                  {u.actor === 'system' ? 'Background work' : (names.get(u.actor) ?? u.actor)}
                </span>
                <span>
                  <span className="as-usage-label">Calls </span>
                  <span className={near ? 'wf-overdue' : ''}>
                    {u.actor === 'system' ? u.calls : `${u.calls} of ${s.aiDailyLimit}`}
                  </span>
                </span>
                <span>
                  <span className="as-usage-label">Failed </span>
                  {u.failed || 0}
                </span>
                <span>
                  <span className="as-usage-label">Tokens </span>
                  {((u.prompt || 0) + (u.completion || 0)).toLocaleString('en-IN')}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export function SettingsPage() {
  const { me, notify } = useAssistant();
  const data = useLoad(() => assistant('settings.get', {}));
  const [saveState, setSaveState] = useState<{
    phase: 'idle' | 'saving' | 'saved' | 'error';
    at?: number;
    error?: string;
  }>({
    phase: 'idle',
  });

  const save = async (prefs: Prefs) => {
    const before = data.data;
    // Show the change at once; put it back if the server refuses.
    data.set((d) => ({
      ...d,
      settings: {
        ...d.settings,
        briefEnabled: prefs.briefEnabled,
        briefTime: prefs.briefTime,
        whatsapp: { ...d.settings.whatsapp, alerts: prefs.alerts },
      },
    }));
    setSaveState({ phase: 'saving' });
    try {
      const saved = await assistant('settings.save', { settings: prefs });
      data.set((d) => ({ ...d, settings: saved }));
      setSaveState({ phase: 'saved', at: Date.now() });
    } catch (e) {
      if (before) data.set(() => before);
      setSaveState({ phase: 'error', error: errorMessage(e) });
      notify('Your settings could not be saved.');
    }
  };

  if (data.phase === 'loading') return <Loading>Loading your settings</Loading>;
  if (data.phase === 'error' || !data.data)
    return (
      <div className="as-stack">
        <LoadError
          title="Settings could not be loaded"
          message={data.error}
          status={data.status}
          onRetry={data.retry}
        />
        {me?.member?.isAdmin && <Integrations />}
      </div>
    );
  const { settings, whatsapp } = data.data;
  const prefs = prefsOf(settings);
  return (
    <div className="as-settings">
      <p className="as-save-state" aria-live="polite">
        {saveState.phase === 'saving'
          ? 'Saving'
          : saveState.phase === 'saved'
            ? `Saved at ${formatClock(saveState.at!)}`
            : saveState.phase === 'error'
              ? saveState.error
              : 'Changes are saved as you make them.'}
      </p>
      <Card
        title={
          <>
            <Sunrise size={17} aria-hidden="true" /> Morning brief
          </>
        }
        id="as-set-brief"
      >
        <p className="wf-caption as-pad">
          A short summary of urgent mail, tasks, deadlines and reminders, posted to your notifications each
          morning. It is put together without AI.
        </p>
        <div className="as-brief-settings">
          <Toggle pressed={prefs.briefEnabled} onChange={(v) => void save({ ...prefs, briefEnabled: v })}>
            Send me a morning brief
          </Toggle>
          <label className="as-mini">
            <span>Time (India time)</span>
            <input
              type="time"
              className="wf-input"
              value={prefs.briefTime}
              disabled={!prefs.briefEnabled}
              onChange={(e) => {
                if (/^\d{2}:\d{2}$/.test(e.target.value)) void save({ ...prefs, briefTime: e.target.value });
              }}
            />
          </label>
        </div>
      </Card>
      <WhatsAppCard
        status={whatsapp}
        prefs={prefs}
        onPrefs={(p) => void save(p)}
        onStatus={(w) => data.set((d) => ({ ...d, whatsapp: w }))}
      />
      {me?.member?.isAdmin && <Integrations />}
    </div>
  );
}
