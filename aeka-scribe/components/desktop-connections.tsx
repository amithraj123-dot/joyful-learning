'use client';
import { useEffect, useState } from 'react';
import { runtime } from '../lib/desktop-runtime';
const labels: Record<string, string> = {
  slack: 'Slack',
  notion: 'Notion',
  hubspot: 'HubSpot',
  attio: 'Attio',
  affinity: 'Affinity',
  zapier: 'Zapier',
};
const setup: Record<string, string> = {
  slack:
    'Use a Slack bot token with chat:write and channels:read. For private channels add groups:read. Invite the bot to the destination channel.',
  notion:
    'Use an internal integration token with Read content and Insert content. Add that integration to the parent page in Notion.',
  hubspot:
    'Use a HubSpot private app token with read/write access for the CRM records and notes you intend to use.',
  attio: 'Use an Attio token with note:read-write, record_permission:read and object_configuration:read.',
  affinity: 'Use an Affinity API key belonging to the account that should create the notes.',
  zapier:
    'Paste a Catch Hook URL from Webhooks by Zapier. Your Zap defines all downstream actions. Flow only sends after review.',
};
export function DesktopConnections() {
  const [states, setStates] = useState<any[]>([]),
    [provider, setProvider] = useState('slack'),
    [secret, setSecret] = useState(''),
    [label, setLabel] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [calendar, setCalendar] = useState<any[]>([]),
    [calProvider, setCalProvider] = useState('google'),
    [features, setFeatures] = useState<string[]>([]),
    [brief, setBrief] = useState<any>(null);
  const load = async () => {
    const [s, c, b] = await Promise.all([
      runtime('integrations.status'),
      runtime('calendar.status'),
      runtime('briefs.status'),
    ]);
    setStates(s);
    setCalendar(c);
    setBrief(b);
  };
  useEffect(() => {
    void load().catch((e) => setError(e.message));
    const off = window.flowDesktop?.on((e) => {
      if (e.type === 'briefs-changed' || e.type === 'brief-ready')
        void runtime('briefs.status')
          .then(setBrief)
          .catch(() => {});
    });
    return () => off?.();
  }, []);
  useEffect(
    () => setFeatures(calendar.find((x) => x.provider === calProvider)?.features || []),
    [calendar, calProvider],
  );
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <SemanticSettings />
      <section className="card form-card">
        <span className="eyebrow">CONNECTED WORKFLOWS</span>
        <h2>Email, collaboration & CRM</h2>
        <p>
          Prepare actions from a meeting note, review the exact account and destination, then send. Secrets
          stay in this Windows account’s encrypted vault.
        </p>
        {error && (
          <p className="notice warning" role="alert">
            {error}
          </p>
        )}
        <div className="capability-chips">
          {states.map((s) => (
            <span key={s.provider}>
              {labels[s.provider]} ·{' '}
              {s.configured
                ? s.verifiedAt
                  ? 'target verified previously'
                  : 'configured; unverified'
                : 'not connected'}
            </span>
          ))}
        </div>
        <div className="studio-grid">
          <label className="field">
            <span>Connection</span>
            <select
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value);
                setSecret('');
                setLabel('');
              }}
            >
              {Object.entries(labels).map(([id, name]) => (
                <option value={id} key={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Account or workflow label</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={100}
              placeholder={
                states.find((x) => x.provider === provider)?.label || 'For example: Acme sales workspace'
              }
            />
          </label>
        </div>
        <p className="small-print">{setup[provider]}</p>
        <label className="field">
          <span>{provider === 'zapier' ? 'Catch Hook URL' : 'API token or key'}</span>
          <input
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            maxLength={4000}
          />
        </label>
        <div className="inline-actions wrap">
          <button
            className="button secondary"
            disabled={busy || !secret || !label.trim()}
            onClick={() =>
              void run(async () => {
                await runtime('integrations.configure', { provider, secret, label });
                setSecret('');
              })
            }
          >
            Save encrypted connection
          </button>
          <button
            className="button ghost"
            disabled={busy || !states.find((s) => s.provider === provider)?.configured}
            onClick={() => {
              if (
                confirm(
                  'Remove this connection from Flow? Revoke its token at the provider if it should no longer work elsewhere.',
                )
              )
                void run(() => runtime('integrations.configure', { provider, disconnect: true }));
            }}
          >
            Disconnect
          </button>
        </div>
        <p className="small-print">
          Saving a token does not verify it. Preparing an action reads the selected channel, page or CRM
          record to verify the target. Zapier has no read-only verification. No test messages are sent.
        </p>
        <hr />
        <h3>Google & Microsoft permissions</h3>
        <p>
          First register and connect a desktop calendar account above. Choose additional permissions here only
          for the workflows you want.
        </p>
        <label className="field">
          <span>Account provider</span>
          <select value={calProvider} onChange={(e) => setCalProvider(e.target.value)}>
            <option value="google">Google · Gmail & Calendar</option>
            <option value="microsoft">Microsoft · Outlook</option>
          </select>
        </label>
        {[
          ['mailSend', 'Send reviewed email'],
          ['mailRead', 'Read message previews for selected participants'],
          ['calendarWrite', 'Create reviewed events and invitations'],
        ].map(([id, name]) => (
          <label className="toggle-row" key={id}>
            <span>{name}</span>
            <input
              type="checkbox"
              checked={features.includes(id)}
              onChange={(e) =>
                setFeatures(e.target.checked ? [...features, id] : features.filter((x) => x !== id))
              }
            />
          </label>
        ))}
        <p className="small-print">
          Account: {calendar.find((x) => x.provider === calProvider)?.email || 'not connected'}. Granted
          optional permissions:{' '}
          {calendar.find((x) => x.provider === calProvider)?.permissions?.join(', ') || 'none'}.
        </p>
        <button
          className="button secondary"
          disabled={busy || !calendar.find((x) => x.provider === calProvider)?.clientId}
          onClick={() =>
            void run(async () => {
              const c = calendar.find((x) => x.provider === calProvider);
              await runtime('calendar.config', { provider: calProvider, clientId: c.clientId, features });
              await runtime('calendar.connect', { provider: calProvider });
            })
          }
        >
          Save permissions & reconnect
        </button>
        <p className="small-print">
          The provider’s consent screen grants access. Changing permissions invalidates existing previews.
          ChatGPT plugin connections are separate from the desktop app’s accounts.
        </p>
      </section>
      {brief && (
        <section className="card form-card">
          <span className="eyebrow">READY BEFORE THE MEETING</span>
          <h2>Automatic meeting briefs</h2>
          <p>
            Prepare upcoming calendar notes from earlier related meetings. Keep Flow running in the tray,
            Windows awake and your calendar connected.
          </p>
          <label className="toggle-row">
            <span>Enable automatic briefs · uses your OpenAI API credits</span>
            <input
              type="checkbox"
              checked={brief.settings.enabled}
              onChange={(e) =>
                setBrief({ ...brief, settings: { ...brief.settings, enabled: e.target.checked } })
              }
            />
          </label>
          <div className="studio-grid">
            <label className="field">
              <span>Start checking each day · {brief.timezone}</span>
              <select
                value={brief.settings.hour}
                onChange={(e) =>
                  setBrief({ ...brief, settings: { ...brief.settings, hour: Number(e.target.value) } })
                }
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>
                    {String(i).padStart(2, '0')}:00
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Look ahead</span>
              <select
                value={brief.settings.lookAheadHours}
                onChange={(e) =>
                  setBrief({
                    ...brief,
                    settings: { ...brief.settings, lookAheadHours: Number(e.target.value) },
                  })
                }
              >
                {[12, 24, 48].map((x) => (
                  <option key={x} value={x}>
                    {x} hours
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Daily generation limit</span>
              <select
                value={brief.settings.maxPerDay}
                onChange={(e) =>
                  setBrief({ ...brief, settings: { ...brief.settings, maxPerDay: Number(e.target.value) } })
                }
              >
                {[5, 10, 20].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Folder for new meeting notes</span>
              <input
                value={brief.settings.folder}
                maxLength={100}
                onChange={(e) =>
                  setBrief({ ...brief, settings: { ...brief.settings, folder: e.target.value } })
                }
              />
            </label>
          </div>
          <div className="inline-actions wrap">
            <button
              className="button primary"
              disabled={busy}
              onClick={() => void run(() => runtime('briefs.configure', brief.settings))}
            >
              Save briefing schedule
            </button>
            <button
              className="button secondary"
              disabled={busy || brief.running}
              onClick={() => void run(() => runtime('briefs.run'))}
            >
              Prepare next upcoming brief now
            </button>
          </div>
          <p className="small-print">
            Checks every minute after the chosen hour; one generation per check. Missed runs catch up for
            future meetings when Flow resumes. Existing briefs and recordings are left intact. Failed
            generations require an explicit retry. This is a local scheduler, not an overnight cloud service;
            it does not read your inbox automatically.
          </p>
          <div className="automation-list">
            {brief.history.slice(0, 15).map((h: any) => (
              <article className="automation-entry" key={h.key}>
                <div>
                  <strong>{h.title}</strong>
                  <p>
                    {h.state} · {new Date(h.start).toLocaleString()}
                    {h.error ? ' · ' + h.error : ''}
                  </p>
                </div>
                {['failed', 'interrupted'].includes(h.state) && (
                  <button
                    className="button ghost"
                    disabled={busy}
                    onClick={() => void run(() => runtime('briefs.retry', { id: h.key }))}
                  >
                    Allow retry
                  </button>
                )}
              </article>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
export function SemanticSettings() {
  const [state, setState] = useState<any>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const load = () => runtime('semantic.status').then(setState);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
    const off = window.flowDesktop?.on((e) => {
      if (e.type === 'semantic-progress') void load().catch(() => {});
    });
    return () => off?.();
  }, []);
  const run = async (action: string, p = {}) => {
    setBusy(true);
    setError('');
    try {
      await runtime(action, p);
      await load();
    } catch (e: any) {
      setError(e.message);
      await load().catch(() => {});
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card form-card">
      <span className="eyebrow">FIND RELATED IDEAS</span>
      <h2>Semantic meeting search</h2>
      <p>Combine meaning-based matches with keywords when asking questions across meetings.</p>
      {error && (
        <p className="notice warning" role="alert">
          {error}
        </p>
      )}
      {state && (
        <>
          <p>
            {state.indexed} of {state.total} notes have a current index.{' '}
            {state.running
              ? 'Indexing…'
              : state.updatedAt
                ? 'Last update: ' + new Date(state.updatedAt).toLocaleString()
                : ''}
          </p>
          <label className="toggle-row">
            <span>Use semantic search for meeting chat and recipes</span>
            <input
              type="checkbox"
              checked={state.enabled}
              disabled={busy}
              onChange={(e) => void run('semantic.configure', { enabled: e.target.checked })}
            />
          </label>
          <p className="small-print">
            Building the index sends up to the first 6,000 characters of each saved note’s title, notes,
            transcript and attached context to OpenAI ({state.model}). Asking a question also sends that
            question for matching. API charges apply. Vectors stay encrypted locally and are excluded from
            portable backups. New or edited notes need an explicit refresh.
          </p>
          <div className="inline-actions wrap">
            <button
              className="button secondary"
              disabled={busy || state.running}
              onClick={() => void run('semantic.build')}
            >
              Build / refresh index
            </button>
            {state.running && (
              <button
                className="button ghost"
                onClick={() => void runtime('semantic.cancel').catch((e) => setError(e.message))}
              >
                Stop after current batch
              </button>
            )}
            <button
              className="button ghost"
              disabled={busy || state.running}
              onClick={() => {
                if (
                  confirm(
                    'Delete the local semantic index and turn semantic search off? Your notes will stay intact.',
                  )
                )
                  void run('semantic.clear');
              }}
            >
              Clear index
            </button>
          </div>
          <p className="small-print">
            Trash and active recordings are excluded. Answers still use bounded note excerpts and citations.
            This improves retrieval; it does not guarantee that every relevant passage was included.
          </p>
        </>
      )}
    </section>
  );
}
