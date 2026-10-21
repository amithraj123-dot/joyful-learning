'use client';
import { useEffect, useState } from 'react';
import { runtime } from '../lib/desktop-runtime';
import type { CalendarEvent } from '../lib/workspace-core';
export function DesktopAdvanced({
  settings,
  setSettings,
  onStatusChange,
}: {
  settings: any;
  setSettings: (v: any) => void;
  onStatusChange: () => void;
}) {
  const [sync, setSync] = useState<any>(null),
    [local, setLocal] = useState<any>(null),
    [policy, setPolicy] = useState<any>(null),
    [update, setUpdate] = useState<any>(null),
    [feed, setFeed] = useState(''),
    [publicKey, setPublicKey] = useState(''),
    [publisher, setPublisher] = useState(''),
    [automatic, setAutomatic] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [syncConsent, setSyncConsent] = useState(false);
  const load = async () => {
    const [s, l, p, u] = await Promise.all([
      runtime('cloud.status'),
      runtime('local.status'),
      runtime('status'),
      runtime('updates.status'),
    ]);
    setSync(s);
    setLocal(l);
    setPolicy(p.policy);
    setUpdate(u);
  };
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await load();
      onStatusChange();
    } catch (e: any) {
      setError(e.message || 'The action could not finish.');
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void run(async () => {});
    const timer = setInterval(() => void load().catch(() => {}), 15000);
    return () => clearInterval(timer);
  }, []);
  return (
    <>
      {error && (
        <div className="notice warning" role="alert">
          {error}
        </div>
      )}
      <section className="card form-card">
        <h2>Continuous web sync</h2>
        <p>
          Keep meeting notes, scratchpads and transcripts in your signed-in web workspace. Flow checks every
          15 seconds while open. Active recordings and pending audio wait until they are complete.
        </p>
        <p>
          {sync?.enabled ? 'Sync enabled' : 'Sync is off'}
          {sync?.account ? ' · ' + sync.account : ''}
          {sync?.lastSync ? ' · Last sync ' + new Date(sync.lastSync).toLocaleTimeString() : ''}
        </p>
        {sync?.error && <p className="inline-error">{sync.error}</p>}
        <label className="toggle-row">
          <span>I want my saved notes and transcripts copied to my web account.</span>
          <input type="checkbox" checked={syncConsent} onChange={(e) => setSyncConsent(e.target.checked)} />
        </label>
        <div className="inline-actions wrap">
          <button
            className="button primary"
            disabled={busy || !syncConsent || policy?.values.allowSync === false}
            onClick={() =>
              void run(async () => {
                await runtime('cloud.connect', { enableSync: true });
              })
            }
          >
            Connect account & enable sync
          </button>
          <button
            className="button secondary"
            disabled={busy || !sync?.enabled}
            onClick={() => void run(() => runtime('cloud.sync'))}
          >
            Sync now
          </button>
          <button
            className="button ghost"
            disabled={busy}
            onClick={() => void run(() => runtime('cloud.disconnect'))}
          >
            Disconnect & clear web session
          </button>
        </div>
        <p className="small-print">
          Sign in in the separate web window, then close it. Conflicts become separate notes. Synced deletions
          propagate, while edits to a deleted note are preserved as a conflict copy. Disconnect keeps existing
          local and web notes. Raw audio, history, API keys and calendar credentials are never synced. The
          original account remains pinned to this vault.
        </p>
      </section>
      <section className="card form-card">
        <h2>Speech, entirely on this PC</h2>
        <p>
          Use a trusted Windows build of whisper.cpp and a compatible ggml model. Audio remains on this
          computer when Local Whisper is selected. Summaries, Ask and transforms still require cloud AI.
        </p>
        <label className="field">
          <span>Desktop speech engine</span>
          <select
            value={settings.asrEngine}
            onChange={(e) => setSettings({ ...settings, asrEngine: e.target.value })}
          >
            <option value="openai">OpenAI · gpt-transcribe</option>
            <option value="local">Local Whisper · offline</option>
          </select>
        </label>
        <div className="inline-actions wrap">
          <button
            className="button secondary"
            disabled={busy || policy?.values.allowLocalASR === false}
            onClick={() => void run(() => runtime('local.configure'))}
          >
            Choose Whisper executable & model
          </button>
          <button className="button ghost" onClick={() => void runtime('help.open', { topic: 'whisper' })}>
            Official whisper.cpp project
          </button>
        </div>
        <p className="small-print">
          {local?.configured
            ? 'Model: ' + local.model
            : 'No local executable or model selected. These are not bundled with this release.'}{' '}
          A multilingual small or medium model is a starting point; speed and accuracy depend on your Windows
          hardware. Only choose an executable from a source you trust.
        </p>
        <label className="toggle-row">
          <span>
            <strong>Speaker separation for meeting chunks</strong>
            <small>
              Uses OpenAI when the cloud speech engine is selected. Speaker labels are local to each chunk;
              review and rename them. It does not track a person across the entire call.
            </small>
          </span>
          <input
            type="checkbox"
            checked={settings.liveSpeakers}
            disabled={settings.asrEngine === 'local'}
            onChange={(e) => setSettings({ ...settings, liveSpeakers: e.target.checked })}
          />
        </label>
        <label className="toggle-row">
          <span>
            <strong>Draft a summary when transcription finishes</strong>
            <small>
              Creates a reviewable draft after a completed meeting. This sends its transcript to OpenAI.
            </small>
          </span>
          <input
            type="checkbox"
            checked={settings.autoSummary}
            onChange={(e) => setSettings({ ...settings, autoSummary: e.target.checked })}
          />
        </label>
        <label className="field">
          <span>Local note retention after the last update</span>
          <select
            value={settings.retentionDays}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (
                n &&
                !confirm(
                  'After saving preferences, notes older than this period will be deleted. Synced deletions also reach your web account. Continue?',
                )
              )
                return;
              setSettings({ ...settings, retentionDays: n });
            }}
          >
            {[0, 7, 30, 90, 365].map((n) => (
              <option value={n} key={n}>
                {n ? n + ' days' : 'Keep until I delete them'}
              </option>
            ))}
          </select>
        </label>
        <p className="small-print">
          Retention runs while Flow is open. Active recordings and pending audio are protected. Use Save
          desktop preferences below to apply speech and retention changes.
        </p>
      </section>
      <section className="card form-card">
        <h2>Updates</h2>
        <p>
          {update?.configured
            ? 'Trusted feed configured.'
            : 'No trusted publisher feed is configured for this development build.'}{' '}
          {update?.phase === 'ready'
            ? 'A verified update is ready to install.'
            : update?.phase === 'available'
              ? 'Version ' + update.version + ' is available.'
              : update?.phase === 'current'
                ? 'This build is current.'
                : ''}
        </p>
        {update?.notes && <p>{update.notes}</p>}
        {update?.error && <p className="inline-error">{update.error}</p>}
        <div className="inline-actions wrap">
          <button
            className="button secondary"
            disabled={busy || !update?.configured}
            onClick={() => void run(() => runtime('updates.check'))}
          >
            Check for updates
          </button>
          <button
            className="button secondary"
            disabled={busy || !update?.configured}
            onClick={() => void run(() => runtime('updates.download'))}
          >
            Download & verify
          </button>
          <button
            className="button primary"
            disabled={busy || update?.phase !== 'ready'}
            onClick={() => {
              if (confirm('Install the verified update and close Flow? Save your edits first.'))
                void run(() => runtime('updates.install'));
            }}
          >
            Install update
          </button>
        </div>
        <details>
          <summary>Publisher setup</summary>
          <p>
            Use the feed URL, Ed25519 public key and Windows certificate thumbprint supplied by your trusted
            publisher. A release must pass the signed manifest, file hash, size and Windows publisher checks.
            Never paste a private key here.
          </p>
          <label className="field">
            <span>HTTPS manifest URL</span>
            <input
              value={feed}
              onChange={(e) => setFeed(e.target.value)}
              placeholder={update?.feed || 'https://publisher.example/flow/updates.json'}
            />
          </label>
          <label className="field">
            <span>Ed25519 public key (PEM)</span>
            <textarea
              value={publicKey}
              onChange={(e) => setPublicKey(e.target.value)}
              rows={3}
              maxLength={1000}
            />
          </label>
          <label className="field">
            <span>Windows publisher certificate thumbprint</span>
            <input
              value={publisher}
              onChange={(e) => setPublisher(e.target.value.replace(/\s/g, ''))}
              maxLength={40}
            />
          </label>
          <label className="toggle-row">
            <span>Automatically check and download verified updates every six hours</span>
            <input type="checkbox" checked={automatic} onChange={(e) => setAutomatic(e.target.checked)} />
          </label>
          <button
            className="button secondary"
            disabled={busy || !feed || !publicKey || publisher.length !== 40}
            onClick={() =>
              void run(() =>
                runtime('updates.configure', { feed, publicKey, publisherThumbprint: publisher, automatic }),
              )
            }
          >
            Trust this publisher
          </button>
        </details>
        <p className="small-print">
          Installation is blocked during recordings or pending transcription. This release is unsigned, so it
          cannot be accepted by the automatic updater as a signed production update.
        </p>
      </section>
      <section className="card form-card">
        <h2>Managed device controls</h2>
        <p>
          {policy?.managed
            ? 'This device is governed by an administrator policy.'
            : 'No administrator policy is installed on this device.'}
        </p>
        {policy?.managed && (
          <div className="capability-chips">
            {Object.entries(policy.values).map(([k, v]) => (
              <span key={k}>
                {k}: {String(v)}
              </span>
            ))}
          </div>
        )}
        <details>
          <summary>Administrator deployment</summary>
          <p>
            Administrators can deploy a read-only policy at{' '}
            <code>%ProgramData%\Flow Desktop\policy.json</code> and restart Flow. It can disable recording,
            cloud AI, cloud sync, calendar access, exports, retained audio or local ASR, and set a maximum
            retention period. Protect that file with Windows administrator permissions.
          </p>
          <p className="small-print">
            These application controls are not SSO, SCIM, MDM enrollment or a data-loss-prevention guarantee.
            They do not prevent a user with access to visible text from copying it.
          </p>
        </details>
      </section>
    </>
  );
}
export function MeetingAutomation({ events }: { events: CalendarEvent[] }) {
  const [entries, setEntries] = useState<any[]>([]),
    [id, setId] = useState(''),
    [consent, setConsent] = useState(false),
    [join, setJoin] = useState(false),
    [systemAudio, setSystemAudio] = useState(true),
    [grace, setGrace] = useState(5),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [now, setNow] = useState(Date.now());
  const load = async () => setEntries(await runtime('automation.list'));
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
  useEffect(() => {
    void load();
    const off = window.flowDesktop?.on((e) => {
      if (e.type.startsWith('automation-')) void load();
    });
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      off?.();
      clearInterval(timer);
    };
  }, []);
  return (
    <section className="card form-card">
      <h2>Schedule a recording</h2>
      <p>
        Choose each meeting explicitly. Flow starts with a visible 20-second countdown, can open its call
        link, and stops after its scheduled end plus your grace period. Keep Flow running and Windows
        unlocked.
      </p>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <label className="field">
        <span>Upcoming calendar meeting</span>
        <select
          value={id}
          onChange={(e) => {
            setId(e.target.value);
            setConsent(false);
          }}
        >
          <option value="">Choose a meeting</option>
          {events
            .filter((e) => Date.parse(e.end) > Date.now())
            .map((e) => (
              <option value={e.id} key={e.id}>
                {new Date(e.start).toLocaleString()} · {e.title}
              </option>
            ))}
        </select>
      </label>
      <div className="meeting-controls">
        <label>
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />{' '}
          Participants know this meeting will be recorded
        </label>
        <label>
          <input type="checkbox" checked={join} onChange={(e) => setJoin(e.target.checked)} /> Open the call
          link automatically
        </label>
        <label>
          <input type="checkbox" checked={systemAudio} onChange={(e) => setSystemAudio(e.target.checked)} />{' '}
          Include system audio
        </label>
      </div>
      <label className="field">
        <span>Stop after the scheduled end</span>
        <select value={grace} onChange={(e) => setGrace(Number(e.target.value))}>
          {[0, 5, 10, 15].map((n) => (
            <option value={n} key={n}>
              {n ? n + ' minutes later' : 'At the scheduled end'}
            </option>
          ))}
        </select>
      </label>
      <button
        className="button primary"
        disabled={busy || !id || !consent}
        onClick={() =>
          void run(async () => {
            await runtime('automation.arm', { id, participantsInformed: consent, join, systemAudio, grace });
            setId('');
            setConsent(false);
          })
        }
      >
        Schedule this recording
      </button>
      <div className="automation-list">
        {entries.slice(0, 20).map((e) => (
          <article className={'automation-entry ' + (e.state === 'countdown' ? 'countdown' : '')} key={e.id}>
            <div>
              <strong>{e.title}</strong>
              <p>
                {e.state === 'countdown'
                  ? 'Recording starts in ' + Math.max(0, Math.ceil((e.deadline - now) / 1000)) + ' seconds'
                  : e.state}{' '}
                · {new Date(e.start).toLocaleString()}
                {e.reason ? ' · ' + e.reason : ''}
              </p>
            </div>
            <div className="inline-actions">
              {e.state === 'running' && (
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void run(() => runtime('automation.extend', { id: e.id }))}
                >
                  Extend 15 min
                </button>
              )}
              {['armed', 'countdown', 'starting', 'running'].includes(e.state) && (
                <button
                  className="button ghost"
                  disabled={busy}
                  onClick={() => void run(() => runtime('automation.cancel', { id: e.id }))}
                >
                  {e.state === 'running' ? 'Stop' : 'Cancel'}
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      <p className="small-print">
        Missed starts, locked Windows, stale calendars and overlapping recordings are skipped. Automatic
        recording never signs in to a meeting or bypasses admission. After a restart, any interrupted
        countdown or recording requires a manual restart.
      </p>
    </section>
  );
}
