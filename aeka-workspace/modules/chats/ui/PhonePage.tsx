'use client';
// The phone app: connecting the Aeka Android app, checking its permissions, choosing which apps it
// reads, nudges and AI, and deleting what is held.
import { useCallback, useEffect, useState } from 'react';
import {
  LayoutGrid,
  Bell,
  BellRing,
  CheckCircle2,
  Circle,
  KeyRound,
  ShieldCheck,
  Smartphone,
  TriangleAlert,
} from 'lucide-react';
import { ConfirmButton } from '../../workflow/ui/components/ConfirmButton';
import { Toggle } from '../../workflow/ui/components/Bits';
import { chats } from '../shared/client';
import { ALERT_LABELS, ALERTS, APP_LABELS, APPS, type ChatSettings, type PhoneDevice } from '../shared/types';
import {
  inAndroidApp,
  onAndroidEvent,
  openPhoneSettings,
  pairPhone,
  phoneStatus,
  syncPhone,
  unpairPhone,
  type PhoneStatus,
} from './android';
import { errorMessage, fullTime } from './lib';

export function PhonePage({ notify }: { notify: (m: string) => void }) {
  const [devices, setDevices] = useState<PhoneDevice[] | null>(null);
  const [aiReady, setAiReady] = useState(true);
  const [settings, setSettings] = useState<ChatSettings | null>(null);
  const [phone, setPhone] = useState<PhoneStatus | null>(() => phoneStatus());
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const onPhone = inAndroidApp();

  const load = useCallback(async () => {
    try {
      const [s, st] = await Promise.all([chats('phone.status', {}), chats('settings.get', {})]);
      setDevices(s.devices);
      setAiReady(s.aiReady);
      setSettings(st);
      setPhone(phoneStatus());
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  // The first load runs after the effect (never setting state within it).
  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load]);

  // Permissions change in Android settings; read them again when the page is shown again.
  useEffect(() => {
    if (!onPhone) return;
    const refresh = () => {
      if (document.visibilityState === 'visible') setPhone(phoneStatus());
    };
    document.addEventListener('visibilitychange', refresh);
    const off = onAndroidEvent((e) => {
      if (e.type === 'synced' || e.type === 'status') setPhone(phoneStatus());
    });
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      off();
    };
  }, [onPhone]);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy('');
    }
  };

  const connectThisPhone = () =>
    act('pair', async () => {
      const c = await chats('phone.pairingCode', {});
      const r = await pairPhone(c.code);
      if (!r.ok) throw new Error(r.error || 'The phone could not be connected. Try again.');
      notify('This phone is connected.');
      await syncPhone();
      await load();
    });

  const saveSettings = (next: ChatSettings) =>
    act('settings', async () => {
      setSettings(await chats('settings.update', { settings: next }));
      if (onPhone) await syncPhone();
    });

  const p = phone;
  const steps = p
    ? [
        { done: p.paired, label: 'Connected to your workspace' },
        {
          done: p.notificationAccess,
          label: 'Notification access allowed',
          action: (
            <>
              <button
                type="button"
                className="button primary small"
                onClick={() => openPhoneSettings('notifications')}
              >
                Allow
              </button>
              <button
                type="button"
                className="button secondary small"
                onClick={() => openPhoneSettings('app')}
              >
                App info
              </button>
            </>
          ),
          help: 'If Android says the setting is restricted: open App info, tap the three-dot menu, choose "Allow restricted settings", then try again.',
        },
        {
          done: p.postNotifications,
          label: 'Nudges can be shown',
          action: (
            <button type="button" className="button primary small" onClick={() => openPhoneSettings('post')}>
              Allow
            </button>
          ),
        },
        {
          done: p.batteryUnrestricted,
          label: 'Battery use unrestricted',
          action: (
            <button
              type="button"
              className="button secondary small"
              onClick={() => openPhoneSettings('battery')}
            >
              Change
            </button>
          ),
          help: 'Some phones (Xiaomi, Samsung, OnePlus, Vivo, Oppo) stop apps in the background; without this, messages may arrive late.',
        },
      ]
    : [];

  return (
    <div className="ch-phone">
      {error && (
        <p className="ch-error" role="alert">
          <TriangleAlert size={16} aria-hidden="true" /> {error}
        </p>
      )}

      {onPhone && p && (
        <section className="ch-card ch-section" aria-labelledby="ch-this-phone">
          <h2 id="ch-this-phone">
            <Smartphone size={18} aria-hidden="true" /> This phone
          </h2>
          {!p.paired ? (
            <>
              <p>
                Connect this phone so Aeka can read your WhatsApp, LinkedIn, SMS, Teams, Slack and Gmail
                notifications.
              </p>
              <button
                type="button"
                className="button primary"
                disabled={!!busy}
                onClick={() => void connectThisPhone()}
              >
                {busy === 'pair' ? 'Connecting…' : 'Connect this phone'}
              </button>
            </>
          ) : (
            <>
              <ul className="ch-steps">
                {steps.map((s) => (
                  <li key={s.label} className={s.done ? 'done' : ''}>
                    {s.done ? (
                      <CheckCircle2 size={18} aria-hidden="true" />
                    ) : (
                      <Circle size={18} aria-hidden="true" />
                    )}
                    <span>
                      <strong>{s.label}</strong>
                      {!s.done && s.help && <small>{s.help}</small>}
                    </span>
                    {!s.done && s.action && <span className="ch-step-actions">{s.action}</span>}
                  </li>
                ))}
              </ul>
              {p.previewsHidden.length > 0 && (
                <p className="ch-warn">
                  <TriangleAlert size={15} aria-hidden="true" /> Message previews are off in{' '}
                  {p.previewsHidden.map((a) => APP_LABELS[a]).join(', ')}. Turn on notification previews
                  there.
                </p>
              )}
              <p className="ch-note">
                {p.pending ? `${p.pending} messages waiting to be sent. ` : ''}
                {p.lastSyncAt
                  ? `Last sent to the workspace ${fullTime(p.lastSyncAt)}.`
                  : 'Not sent to the workspace yet.'}
                {p.lastError ? ` ${p.lastError}` : ''}
              </p>
              <div className="ch-actions">
                <button
                  type="button"
                  className="button secondary small"
                  disabled={!!busy}
                  onClick={() =>
                    void act('sync', async () => {
                      const r = await syncPhone();
                      if (!r.ok) throw new Error(r.error || 'The phone could not reach the workspace.');
                      setPhone(phoneStatus());
                      notify('Up to date.');
                    })
                  }
                >
                  Send now
                </button>
                <ConfirmButton
                  className="button secondary small"
                  question="Stop reading notifications on this phone?"
                  confirmLabel="Disconnect"
                  onConfirm={() => {
                    unpairPhone();
                    setPhone(phoneStatus());
                  }}
                >
                  Disconnect this phone
                </ConfirmButton>
              </div>
            </>
          )}
        </section>
      )}

      {!onPhone && (
        <section className="ch-card ch-section" aria-labelledby="ch-setup">
          <h2 id="ch-setup">
            <Smartphone size={18} aria-hidden="true" /> Set up the Aeka app on Android
          </h2>
          <ol className="ch-howto">
            <li>Install the Aeka app on your Android phone (your administrator shares the file).</li>
            <li>Open it and sign in to the workspace, as you do here.</li>
            <li>Go to Chats, Phone app, and tap Connect this phone.</li>
            <li>Allow notification access, nudges and unrestricted battery use when the app asks.</li>
            <li>In WhatsApp, keep notification previews on, so there is something to read.</li>
          </ol>
          <p className="ch-note">
            If the app asks for a code instead, show one here. It works once, for 10 minutes.
          </p>
          <div className="ch-actions">
            <button
              type="button"
              className="button secondary small"
              disabled={!!busy}
              onClick={() => void act('code', async () => setCode(await chats('phone.pairingCode', {})))}
            >
              <KeyRound size={15} aria-hidden="true" /> Show a code
            </button>
            {code && (
              <span className="ch-code" aria-live="polite">
                {code.code}{' '}
                <small>
                  until{' '}
                  {new Date(code.expiresAt).toLocaleTimeString('en-IN', {
                    hour: 'numeric',
                    minute: '2-digit',
                    timeZone: 'Asia/Kolkata',
                  })}
                </small>
              </span>
            )}
          </div>
        </section>
      )}

      <section className="ch-card ch-section" aria-labelledby="ch-devices">
        <h2 id="ch-devices">Connected phones</h2>
        {devices == null ? (
          <p className="ch-note">Loading…</p>
        ) : devices.length === 0 ? (
          <p className="ch-note">No phone is connected yet.</p>
        ) : (
          <ul className="ch-devices">
            {devices.map((d) => (
              <li key={d.id}>
                <span>
                  <strong>{d.name}</strong>
                  <small>
                    {[
                      d.model,
                      d.android ? `Android ${d.android}` : '',
                      d.appVersion ? `app ${d.appVersion}` : '',
                    ]
                      .filter(Boolean)
                      .join(', ')}
                  </small>
                  <small>
                    {d.lastSeenAt ? `Last seen ${fullTime(d.lastSeenAt)}` : 'Not seen yet'}
                    {d.access && !d.access.notifications ? '. Notification access is off' : ''}
                    {d.access && !d.access.batteryUnrestricted ? '. Battery use is restricted' : ''}
                  </small>
                </span>
                <ConfirmButton
                  className="button secondary small"
                  question="Disconnect this phone? It stops sending messages at once."
                  confirmLabel="Disconnect"
                  onConfirm={() =>
                    act('revoke', async () => {
                      await chats('phone.revoke', { deviceId: d.id });
                      await load();
                    })
                  }
                >
                  Disconnect
                </ConfirmButton>
              </li>
            ))}
          </ul>
        )}
      </section>

      {settings && (
        <>
          <section className="ch-card ch-section" aria-labelledby="ch-apps">
            <h2 id="ch-apps">
              <LayoutGrid size={18} aria-hidden="true" /> Apps to read
            </h2>
            <p className="ch-note">
              Only notifications from these apps are read. Outlook is not needed here: Mail reads it in full.
            </p>
            <div className="ch-toggles">
              {APPS.map((a) => (
                <Toggle
                  key={a}
                  pressed={settings.apps[a]}
                  disabled={!!busy}
                  onChange={(v) => void saveSettings({ ...settings, apps: { ...settings.apps, [a]: v } })}
                >
                  {APP_LABELS[a]}
                </Toggle>
              ))}
            </div>
          </section>

          <section className="ch-card ch-section" aria-labelledby="ch-alerts">
            <h2 id="ch-alerts">
              <BellRing size={18} aria-hidden="true" /> Phone notifications
            </h2>
            <p className="ch-note">
              What the Aeka app shows as notifications on your phone. To-dos and reminders alert at their
              exact time, even without a connection at that moment. Everything also stays under Notifications
              in the workspace.
            </p>
            <div className="ch-toggles">
              {ALERTS.map((a) => (
                <Toggle
                  key={a}
                  pressed={settings.alerts[a]}
                  disabled={!!busy}
                  onChange={(v) => void saveSettings({ ...settings, alerts: { ...settings.alerts, [a]: v } })}
                >
                  {ALERT_LABELS[a]}
                </Toggle>
              ))}
            </div>
          </section>

          <section className="ch-card ch-section" aria-labelledby="ch-nudges">
            <h2 id="ch-nudges">
              <Bell size={18} aria-hidden="true" /> Nudges to reply
            </h2>
            <div className="ch-toggles">
              <Toggle
                pressed={settings.nudges}
                disabled={!!busy}
                onChange={(v) => void saveSettings({ ...settings, nudges: v })}
              >
                Remind me to reply
              </Toggle>
              <Toggle
                pressed={settings.quietHours}
                disabled={!!busy}
                onChange={(v) => void saveSettings({ ...settings, quietHours: v })}
              >
                Quiet hours, 10 pm to 7:30 am (urgent chats still alert)
              </Toggle>
            </div>
            <p className="ch-note">
              A chat that needs your reply is nudged up to three times: urgent ones after 15 minutes, 2 hours
              and 6 hours; important ones after 1, 6 and 24 hours; routine ones after 4, 24 and 72 hours. VIPs
              are nudged sooner.
            </p>
          </section>

          <section className="ch-card ch-section" aria-labelledby="ch-privacy">
            <h2 id="ch-privacy">
              <ShieldCheck size={18} aria-hidden="true" /> AI and privacy
            </h2>
            <div className="ch-toggles">
              <Toggle
                pressed={settings.ai}
                disabled={!!busy}
                onChange={(v) => void saveSettings({ ...settings, ai: v })}
              >
                Use AI for chats (triage and drafts)
              </Toggle>
            </div>
            {!aiReady && (
              <p className="ch-warn">
                The firm AI service is not available, so chats are triaged by rules for now.
              </p>
            )}
            <p className="ch-note">
              The last 12 messages of a chat with something new are sent to the firm AI service to decide
              whether it needs your reply. Chats you mark &ldquo;Never send to AI&rdquo; (for example family)
              are triaged by rules only and never drafted by AI. Muted chats are not triaged at all. Messages
              are deleted from the workspace after 30 days. Nobody else in the firm can see your chats. With
              AI off, no chat text is sent to AI at all: chats are triaged by rules, and the brief and Ask
              Aeka list them by name only.
            </p>
            <ConfirmButton
              className="button danger small"
              question="Delete every chat and message held for you? Your phone stays connected."
              confirmLabel="Delete all"
              onConfirm={() =>
                act('delete', async () => {
                  await chats('data.delete', { confirm: true });
                  notify('All chats were deleted from the workspace.');
                })
              }
            >
              Delete all chats from the workspace
            </ConfirmButton>
          </section>
        </>
      )}
    </div>
  );
}
