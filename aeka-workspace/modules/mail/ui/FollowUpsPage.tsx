'use client';
// Follow-ups: threads where I am waiting on someone, and people chasing me. Worked out from stored
// mail without AI. A follow-up draft is made only on request and is reviewed like any other draft.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlarmClock,
  Briefcase,
  Check,
  MailOpen,
  PencilLine,
  Plug,
  RotateCcw,
  TriangleAlert,
} from 'lucide-react';
import { Empty, Toggle } from '../../workflow/ui/components/Bits';
import { mail } from '../shared/client';
import type { Address, FollowUp, MailItem } from '../shared/types';
import { errorMessage, formatStamp, formatWhen, plural, senderName } from './lib';
import { MessageDrawer, nudgeDrafts } from './MessageDrawer';
import { useMail } from './store';

const DAY = 24 * 3600 * 1000;
const SNOOZE_DAYS = [1, 3, 7];
const key = (f: Pick<FollowUp, 'kind' | 'conversationId'>) => f.kind + ':' + f.conversationId;

// Marked done in this tab, so they can be reopened from "Show done or snoozed". The list from the
// server leaves done threads out.
const doneHere = new Map<string, FollowUp>();

const WAITING_LEVEL: Record<FollowUp['level'], string> = { 1: '2+ days', 2: '5+ days', 3: '10+ days' };
const LEVEL_TONE: Record<FollowUp['level'], string> = { 1: 'grey', 2: 'amber', 3: 'red' };

const levelText = (f: FollowUp) =>
  f.kind === 'waiting' ? 'Waiting ' + WAITING_LEVEL[f.level] : `Chased ${f.count} times`;
const ageText = (days: number) => (days < 1 ? 'Today' : days === 1 ? '1 day' : `${days} days`);
const snoozedNow = (f: FollowUp) => !!f.snoozedUntil && f.snoozedUntil > Date.now();
const shortDate = (ms: number) =>
  new Date(ms).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });

// Enough of the email to open the drawer, which then loads the full message.
const toItem = (f: FollowUp, me: Address, draftId?: string): MailItem => ({
  id: f.mailId,
  conversationId: f.conversationId,
  subject: f.subject,
  from: f.kind === 'waiting' ? me : f.counterpart,
  to: f.kind === 'waiting' ? [f.counterpart] : [me],
  cc: [],
  receivedAt: f.since,
  preview: '',
  hasAttachments: false,
  isRead: true,
  importance: 'normal',
  webLink: '',
  repliedByMe: false,
  threadCount: 1,
  triage: null,
  draft: draftId ? { id: draftId, status: 'draft', placeholders: 0, updatedAt: Date.now() } : null,
  vip: false,
  chased: f.kind === 'chasing' ? f.count : 0,
  meetingClash: null,
});

type Busy = '' | 'nudge' | 'snooze' | 'done' | 'reopen';

export function FollowUpsPage() {
  const { account, navigate, notify } = useMail();
  const [list, setList] = useState<FollowUp[]>([]);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [showClosed, setShowClosed] = useState(false);
  const [busy, setBusy] = useState<Record<string, Busy>>({});
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});
  const [, setDoneCount] = useState(doneHere.size); // re-render when the tab's done list changes
  const [open, setOpen] = useState<{ item: MailItem; followUp: FollowUp; focus?: 'draft' } | null>(null);
  const seq = useRef(0);

  const acct = account.account;
  const connected = !!acct && acct.status !== 'disconnected';
  const me: Address = { name: acct?.displayName ?? '', address: acct?.address ?? '' };

  const load = useCallback(async (quiet = false) => {
    const mine = ++seq.current;
    if (!quiet) setPhase('loading');
    try {
      const r = await mail('followups.list', {});
      if (mine !== seq.current) return;
      // A thread that is open again on the server is no longer "done here".
      for (const f of r) doneHere.delete(key(f));
      setDoneCount(doneHere.size);
      setList(r);
      setPhase('ready');
      setError('');
    } catch (e) {
      if (mine !== seq.current) return;
      setError(errorMessage(e));
      setPhase('error');
    }
  }, []);
  useEffect(() => {
    if (account.phase === 'ready' && connected) void load();
  }, [account.phase, connected, load]);

  const act = async (f: FollowUp, kind: Busy, fn: () => Promise<void>) => {
    const k = key(f);
    setBusy((b) => ({ ...b, [k]: kind }));
    setCardErrors((c) => ({ ...c, [k]: '' }));
    try {
      await fn();
    } catch (e) {
      setCardErrors((c) => ({ ...c, [k]: errorMessage(e) }));
    } finally {
      setBusy((b) => ({ ...b, [k]: '' }));
    }
  };
  const update = (f: FollowUp, action: 'snooze' | 'done' | 'reopen', days?: number) =>
    mail('followups.update', {
      conversationId: f.conversationId,
      kind: f.kind,
      action,
      ...(days ? { days } : {}),
    });

  const snooze = (f: FollowUp, days: number) =>
    act(f, 'snooze', async () => {
      await update(f, 'snooze', days);
      const until = Date.now() + days * DAY;
      setList((old) => old.map((x) => (key(x) === key(f) ? { ...x, snoozedUntil: until } : x)));
      notify(`Snoozed until ${shortDate(until)}. It comes back then if there is still no answer.`);
    });
  const done = (f: FollowUp) =>
    act(f, 'done', async () => {
      await update(f, 'done');
      doneHere.set(key(f), f);
      setDoneCount(doneHere.size);
      setList((old) => old.filter((x) => key(x) !== key(f)));
      notify('Marked done. Turn on Show done or snoozed to reopen it.');
    });
  const reopen = (f: FollowUp) =>
    act(f, 'reopen', async () => {
      await update(f, 'reopen');
      doneHere.delete(key(f));
      setDoneCount(doneHere.size);
      setList((old) => {
        const rest = old.filter((x) => key(x) !== key(f));
        return [...rest, { ...f, snoozedUntil: null }];
      });
      notify('Reopened');
      void load(true);
    });
  const nudge = (f: FollowUp) => {
    const existing = nudgeDrafts.get(f.conversationId);
    if (existing) return setOpen({ item: toItem(f, me, existing), followUp: f, focus: 'draft' });
    return act(f, 'nudge', async () => {
      const d = await mail('followups.draftNudge', { conversationId: f.conversationId });
      nudgeDrafts.set(f.conversationId, d.id);
      const item = toItem(f, me, d.id);
      setOpen({
        item: {
          ...item,
          draft: { id: d.id, status: d.status, placeholders: d.placeholders, updatedAt: d.updatedAt },
        },
        followUp: f,
        focus: 'draft',
      });
    });
  };

  if (account.phase === 'ready' && !connected)
    return (
      <Empty
        icon={Plug}
        title="Connect Outlook to see follow-ups"
        action={
          <button type="button" className="button primary" onClick={() => navigate('mail/connect')}>
            Set up the Outlook connection
          </button>
        }
      >
        Follow-ups are worked out from your own inbox and sent mail once Outlook is connected.
      </Empty>
    );
  if (account.phase === 'loading' || (phase === 'loading' && !list.length))
    return (
      <p className="wf-loading" role="status">
        Loading your follow-ups
      </p>
    );
  if (phase === 'error')
    return (
      <Empty
        icon={TriangleAlert}
        title="Follow-ups could not be loaded"
        action={
          <button type="button" className="button primary" onClick={() => load()}>
            Try again
          </button>
        }
      >
        {error}
      </Empty>
    );

  const openNow = list.filter((f) => !snoozedNow(f));
  const waiting = openNow.filter((f) => f.kind === 'waiting');
  const chasing = openNow.filter((f) => f.kind === 'chasing');
  const closed = [
    ...list.filter(snoozedNow),
    ...[...doneHere.values()].filter((d) => !list.some((f) => key(f) === key(d))),
  ];

  const card = (f: FollowUp, closedCard = false) => (
    <FollowUpCard
      key={key(f)}
      f={f}
      closed={closedCard}
      busy={busy[key(f)] ?? ''}
      error={cardErrors[key(f)]}
      isDone={doneHere.has(key(f))}
      onOpen={() =>
        setOpen({
          item: toItem(f, me, f.kind === 'waiting' ? nudgeDrafts.get(f.conversationId) : undefined),
          followUp: f,
        })
      }
      onReply={() => setOpen({ item: toItem(f, me), followUp: f, focus: 'draft' })}
      onNudge={() => nudge(f)}
      onSnooze={(d) => snooze(f, d)}
      onDone={() => done(f)}
      onReopen={() => reopen(f)}
    />
  );

  return (
    <div className="mail-followups">
      <div className="mail-fu-head">
        <p className="mail-lead">
          Worked out from your inbox and sent mail, without AI.{' '}
          {acct?.lastSyncAt ? `Mail last synced ${formatWhen(acct.lastSyncAt)}.` : ''}
        </p>
        <Toggle pressed={showClosed} onChange={setShowClosed}>
          Show done or snoozed{closed.length ? ` (${closed.length})` : ''}
        </Toggle>
      </div>

      <section className="mail-fu-section" aria-labelledby="mail-fu-waiting-h">
        <h2 id="mail-fu-waiting-h" className="mail-fu-h">
          Waiting on others <span className="wf-count">{waiting.length}</span>
        </h2>
        <p className="wf-caption">You wrote last and have had no answer for 2 days or more.</p>
        {waiting.length ? (
          <ul className="mail-list">{waiting.map((f) => card(f))}</ul>
        ) : (
          <p className="mail-fu-empty">No one owes you a reply right now.</p>
        )}
      </section>

      <section className="mail-fu-section" aria-labelledby="mail-fu-chasing-h">
        <h2 id="mail-fu-chasing-h" className="mail-fu-h">
          Chasing you <span className="wf-count">{chasing.length}</span>
        </h2>
        <p className="wf-caption">Someone has written 2 or more times since your last reply.</p>
        {chasing.length ? (
          <ul className="mail-list">{chasing.map((f) => card(f))}</ul>
        ) : (
          <p className="mail-fu-empty">No one is chasing you.</p>
        )}
      </section>

      {showClosed && (
        <section className="mail-fu-section" aria-labelledby="mail-fu-closed-h">
          <h2 id="mail-fu-closed-h" className="mail-fu-h">
            Done or snoozed <span className="wf-count">{closed.length}</span>
          </h2>
          <p className="wf-caption">
            Snoozed threads come back by themselves. Threads you mark done here can be reopened while this tab
            stays open.
          </p>
          {closed.length ? (
            <ul className="mail-list">{closed.map((f) => card(f, true))}</ul>
          ) : (
            <p className="mail-fu-empty">Nothing is done or snoozed.</p>
          )}
        </section>
      )}

      {open && (
        <MessageDrawer
          key={open.item.id}
          item={open.item}
          focus={open.focus}
          followUp={open.followUp}
          onClose={() => {
            setOpen(null);
            void load(true);
          }}
          onChange={(next) =>
            setOpen((o) => (o && o.item.id === next.id ? { ...o, item: { ...o.item, ...next } } : o))
          }
        />
      )}
    </div>
  );
}

function FollowUpCard({
  f,
  closed,
  busy,
  error,
  isDone,
  onOpen,
  onReply,
  onNudge,
  onSnooze,
  onDone,
  onReopen,
}: {
  f: FollowUp;
  closed: boolean;
  busy: Busy;
  error?: string;
  isDone: boolean;
  onOpen: () => void;
  onReply: () => void;
  onNudge: () => void;
  onSnooze: (days: number) => void;
  onDone: () => void;
  onReopen: () => void;
}) {
  const [snoozing, setSnoozing] = useState(false);
  const titleId = 'mail-fu-' + f.kind + '-' + f.conversationId;
  const who = senderName(f.counterpart);
  const detail =
    f.kind === 'waiting'
      ? `You wrote ${formatWhen(f.since)}` +
        (f.count > 1 ? `, ${plural(f.count, 'email')} without an answer` : ', no answer yet')
      : `${plural(f.count, 'unanswered email')} since ${formatWhen(f.since)}`;
  return (
    <li className={'mail-card mail-fu level-' + f.level} aria-labelledby={titleId}>
      <div className="mail-card-top">
        <div className="mail-card-pills">
          <span className={'wf-pill ' + LEVEL_TONE[f.level]}>{levelText(f)}</span>
          {f.matterLabel && (
            <span className="mail-chip">
              <Briefcase size={13} aria-hidden="true" />
              <span className="mail-chip-text">{f.matterLabel}</span>
            </span>
          )}
          {closed && (
            <span className="wf-pill tint">
              {isDone ? 'Done' : f.snoozedUntil ? 'Snoozed until ' + shortDate(f.snoozedUntil) : 'Snoozed'}
            </span>
          )}
        </div>
        <span className="mail-time" title={formatStamp(f.since)}>
          {ageText(f.ageDays)}
        </span>
      </div>
      <button type="button" className="mail-card-open" onClick={onOpen}>
        <span id={titleId} className="mail-fu-who">
          {who}
          {f.counterpart.name && <span className="mail-fu-address"> {f.counterpart.address}</span>}
        </span>
        <span className="mail-subject">{f.subject || '(No subject)'}</span>
        <span className="mail-why muted">{detail}</span>
      </button>

      {closed ? (
        <div className="mail-fu-actions">
          <button type="button" className="button secondary" disabled={!!busy} onClick={onReopen}>
            <RotateCcw size={15} aria-hidden="true" /> {busy === 'reopen' ? 'Reopening' : 'Reopen'}
          </button>
          <button type="button" className="button ghost" onClick={onOpen}>
            <MailOpen size={15} aria-hidden="true" /> Open
          </button>
        </div>
      ) : snoozing ? (
        <div
          className="mail-fu-actions mail-fu-snooze"
          role="group"
          aria-label={'Snooze ' + (f.subject || who)}
        >
          <span className="mail-question-label">Snooze for</span>
          {SNOOZE_DAYS.map((d, i) => (
            <button
              key={d}
              type="button"
              className="button secondary"
              autoFocus={i === 0}
              disabled={!!busy}
              onClick={() => {
                setSnoozing(false);
                onSnooze(d);
              }}
            >
              {plural(d, 'day')}
            </button>
          ))}
          <button type="button" className="button ghost" onClick={() => setSnoozing(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="mail-fu-actions">
          {f.kind === 'waiting' ? (
            <button type="button" className="button primary mail-fu-main" disabled={!!busy} onClick={onNudge}>
              <PencilLine size={15} aria-hidden="true" />{' '}
              {busy === 'nudge' ? 'Drafting' : 'Draft a follow-up'}
            </button>
          ) : (
            <button type="button" className="button primary mail-fu-main" disabled={!!busy} onClick={onReply}>
              <PencilLine size={15} aria-hidden="true" /> Draft a reply
            </button>
          )}
          <button type="button" className="button secondary" onClick={onOpen}>
            <MailOpen size={15} aria-hidden="true" /> Open
          </button>
          {f.kind === 'waiting' && (
            <button
              type="button"
              className="button secondary"
              disabled={!!busy}
              onClick={() => setSnoozing(true)}
            >
              <AlarmClock size={15} aria-hidden="true" /> {busy === 'snooze' ? 'Snoozing' : 'Snooze'}
            </button>
          )}
          <button type="button" className="button secondary" disabled={!!busy} onClick={onDone}>
            <Check size={15} aria-hidden="true" /> {busy === 'done' ? 'Saving' : 'Done'}
          </button>
        </div>
      )}
      {busy === 'nudge' && (
        <p className="wf-caption" role="status">
          Drafting your follow-up. This can take up to a minute.
        </p>
      )}
      {error && (
        <p className="wf-error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}
