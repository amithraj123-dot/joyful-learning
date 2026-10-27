'use client';
// One chat: its messages, why it matters, quick actions, and a reply drafted on request. Send goes
// through the chat's own notification Reply on the phone; without one, the reply is copied and the
// chat opened, and the member confirms once they have sent it.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BellOff,
  Check,
  Clock,
  Copy,
  ExternalLink,
  ListTodo,
  PenLine,
  Send,
  ShieldOff,
  Star,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { Modal } from '../../workflow/ui/components/Modal';
import { chats } from '../shared/client';
import type { ChatsActions } from '../shared/contract';
import {
  APP_LABELS,
  TIER_LABELS,
  TIERS,
  type ChatDraft,
  type ChatMessage,
  type ChatThread,
  type ReplyNeeded,
  type Tier,
} from '../shared/types';
import { copyText, inAndroidApp, openChatOnPhone, phoneStatus, replyOnPhone } from './android';
import { errorMessage, fullTime, isConflict, waitedLabel } from './lib';

type Op = ChatsActions['thread.update']['payload']['op'];
const PLACEHOLDER = /\[INPUT REQUIRED[^\]]*\]/i;
const REPLY_LABELS: Record<ReplyNeeded, string> = {
  yes: 'Needs reply',
  maybe: 'Maybe',
  no: 'No reply needed',
};

export function ThreadDrawer({
  threadId,
  onClose,
  onChanged,
  notify,
  navigate,
}: {
  threadId: string;
  onClose: () => void;
  onChanged: () => void;
  notify: (m: string) => void;
  navigate: (p: string) => void;
}) {
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState<ChatDraft | null>(null);
  const [text, setText] = useState('');
  const [instructions, setInstructions] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [manual, setManual] = useState(false); // the reply was copied; waiting for "I have sent it"

  const load = useCallback(async () => {
    try {
      const r = await chats('thread.get', { id: threadId });
      setThread(r.thread);
      setMessages(r.messages);
      setDraft(r.draft);
      setText(r.draft?.text ?? '');
      setError('');
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [threadId]);

  // The first load runs after the effect (never setting state within it).
  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load]);

  const run = async (label: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(label);
    setError('');
    try {
      await fn();
      if (done) notify(done);
      onChanged();
    } catch (e) {
      if (isConflict(e)) await load();
      setError(isConflict(e) ? 'This changed elsewhere. It has been reloaded.' : errorMessage(e));
    } finally {
      setBusy('');
    }
  };

  const update = (op: Op, done: string, hours?: number) =>
    run(
      op,
      async () => {
        const t = await chats('thread.update', { id: threadId, op, ...(hours ? { hours } : {}) });
        setThread(t);
        if (op === 'done' || op === 'replied' || op === 'snooze') onClose();
      },
      done,
    );

  const correct = (changes: { tier?: Tier; replyNeeded?: ReplyNeeded }) =>
    thread &&
    run('correct', async () => {
      setThread(await chats('thread.correct', { id: threadId, ...changes, baseRevision: thread.revision }));
    });

  const makeDraft = () =>
    run('draft', async () => {
      const d = await chats('draft.create', {
        threadId,
        ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
      });
      setDraft(d);
      setText(d.text);
      setManual(false);
    });

  // Saves run one after another (typing then tapping Send saves on blur first), each on the latest
  // revision, so Send never races the save.
  const latest = useRef<ChatDraft | null>(null);
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    latest.current = draft;
  }, [draft]);
  const saveText = () => {
    const next = saving.current.then(async () => {
      const d = latest.current;
      if (!d || d.status !== 'draft' || text.trim() === d.text) return;
      const saved = await chats('draft.update', { draftId: d.id, text, baseRevision: d.revision });
      latest.current = saved;
      setDraft(saved);
    });
    saving.current = next.catch(() => {});
    return next;
  };

  const send = () =>
    draft &&
    run('send', async () => {
      await saving.current;
      const current = latest.current ?? draft;
      const ready = await chats('draft.prepareSend', {
        draftId: current.id,
        text,
        baseRevision: current.revision,
      });
      latest.current = ready.draft;
      setDraft(ready.draft);
      if (inAndroidApp()) {
        const r = replyOnPhone(ready.chat, ready.draft.text);
        if (r.ok) {
          await chats('draft.markSent', {
            draftId: ready.draft.id,
            how: 'notification',
            baseRevision: ready.draft.revision,
          });
          notify(`Sent to ${thread?.title ?? 'the chat'} on ${APP_LABELS[ready.app]}.`);
          onClose();
          return;
        }
        if (r.reason === 'not_paired') throw new Error('Connect this phone first (Chats, Phone app).');
      }
      // No live notification (or not on the phone): copy and open the chat instead.
      await copyText(ready.draft.text);
      if (inAndroidApp()) openChatOnPhone(ready.chat, ready.address);
      setManual(true);
    });

  const confirmManual = () =>
    draft &&
    run(
      'sent',
      async () => {
        await saving.current;
        const d = latest.current ?? draft;
        await chats('draft.markSent', { draftId: d.id, how: 'manual', baseRevision: d.revision });
        onClose();
      },
      'Marked as sent.',
    );

  if (!thread)
    return (
      <Modal title="Chat" variant="drawer" onClose={onClose}>
        {error ? (
          <p className="ch-error" role="alert">
            {error}
          </p>
        ) : (
          <p className="ch-note">Loading…</p>
        )}
      </Modal>
    );

  const t = thread;
  const tier = t.triage?.tier ?? 3;
  const app = APP_LABELS[t.app];
  const placeholder = PLACEHOLDER.test(text);
  const onPhone = inAndroidApp();
  // The phone knows best whether the chat's notification (and its Reply) is still there.
  const live = onPhone ? (phoneStatus()?.live.includes(t.chat) ?? t.live) : false;

  return (
    <Modal
      title={t.title}
      subtitle={
        <span className="ch-sub">
          {app}
          {t.group ? ', group' : ''}
          {t.needsMe && t.waitingSince != null ? `, waiting ${waitedLabel(t.waitingSince)}` : ''}
          {live ? ', can reply from here' : ''}
        </span>
      }
      variant="drawer"
      onClose={onClose}
    >
      <div className="ch-thread">
        {error && (
          <p className="ch-error" role="alert">
            <TriangleAlert size={16} aria-hidden="true" /> {error}
          </p>
        )}

        {t.triage && (
          <section className="ch-triage" aria-label="Triage">
            <div className="ch-row-meta">
              <span className={'ch-tier t' + tier}>{TIER_LABELS[tier]}</span>
              <span className="ch-tag">{REPLY_LABELS[t.triage.replyNeeded]}</span>
              {t.triage.replyBy && <span className="ch-tag">Reply by {t.triage.replyBy}</span>}
              <span className="ch-tag">
                {t.triage.source === 'ai' ? 'AI' : t.triage.source === 'manual' ? 'You' : 'Rules'}
              </span>
            </div>
            {t.triage.summary && <p className="ch-summary">{t.triage.summary}</p>}
            {t.triage.why && <p className="ch-why">{t.triage.why}</p>}
            <div className="ch-correct" role="group" aria-label="Correct the triage">
              <label>
                <span>Priority</span>
                <select
                  value={tier}
                  disabled={!!busy}
                  onChange={(e) => void correct({ tier: Number(e.target.value) as Tier })}
                >
                  {TIERS.map((x) => (
                    <option key={x} value={x}>
                      {TIER_LABELS[x]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Reply</span>
                <select
                  value={t.triage.replyNeeded}
                  disabled={!!busy}
                  onChange={(e) => void correct({ replyNeeded: e.target.value as ReplyNeeded })}
                >
                  {(['yes', 'maybe', 'no'] as const).map((x) => (
                    <option key={x} value={x}>
                      {REPLY_LABELS[x]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>
        )}

        <ol className="ch-messages" aria-label="Messages">
          {messages.map((m) => (
            <li key={m.id} className={m.fromMe ? 'me' : ''}>
              {t.group && !m.fromMe && <span className="ch-sender">{m.sender}</span>}
              <span className="ch-bubble">{m.text}</span>
              <time dateTime={new Date(m.at).toISOString()}>{fullTime(m.at)}</time>
            </li>
          ))}
          {!messages.length && (
            <li className="ch-note">No messages kept for this chat (they are deleted after 30 days).</li>
          )}
        </ol>

        <div className="ch-actions" role="group" aria-label="Chat actions">
          <button
            type="button"
            className="button secondary small"
            disabled={!!busy}
            onClick={() => void update('replied', 'Marked as replied.')}
          >
            <Check size={15} aria-hidden="true" /> Replied
          </button>
          <button
            type="button"
            className="button secondary small"
            disabled={!!busy}
            onClick={() => void update('done', 'Done until the next message.')}
          >
            <Check size={15} aria-hidden="true" /> Done
          </button>
          <button
            type="button"
            className="button secondary small"
            disabled={!!busy}
            onClick={() => void update('snooze', 'Snoozed for 3 hours.', 3)}
          >
            <Clock size={15} aria-hidden="true" /> 3 hours
          </button>
          <button
            type="button"
            className="button secondary small"
            disabled={!!busy}
            onClick={() => void update('snooze', 'Snoozed until tomorrow.', 18)}
          >
            <Clock size={15} aria-hidden="true" /> Tomorrow
          </button>
          <button
            type="button"
            className="button secondary small"
            disabled={!!busy}
            onClick={() =>
              void run(
                'todo',
                async () => {
                  await chats('thread.toTodo', { id: threadId });
                },
                'Added to your to-dos.',
              )
            }
          >
            <ListTodo size={15} aria-hidden="true" /> To-do
          </button>
          {onPhone && (
            <button
              type="button"
              className="button secondary small"
              onClick={() => openChatOnPhone(t.chat, t.address)}
            >
              <ExternalLink size={15} aria-hidden="true" /> Open in {app}
            </button>
          )}
        </div>

        <section className="ch-reply" aria-label="Reply">
          {t.neverAi ? (
            <p className="ch-note">
              This chat is kept from AI by your choice, so Aeka does not draft replies for it.
            </p>
          ) : !draft ? (
            <div className="ch-draft-ask">
              <label className="ch-field">
                <span>Instructions for the draft (optional)</span>
                <input
                  type="text"
                  value={instructions}
                  maxLength={1000}
                  placeholder="For example: agree, and say I will send it by Friday"
                  onChange={(e) => setInstructions(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="button primary"
                disabled={!!busy || !messages.length}
                onClick={() => void makeDraft()}
              >
                <PenLine size={16} aria-hidden="true" /> {busy === 'draft' ? 'Drafting…' : 'Draft a reply'}
              </button>
            </div>
          ) : (
            <div className="ch-draft">
              <label className="ch-field">
                <span>Reply to {t.title}</span>
                <textarea
                  value={text}
                  rows={5}
                  maxLength={4000}
                  onChange={(e) => setText(e.target.value)}
                  onBlur={() => void saveText().catch(() => {})}
                />
              </label>
              {placeholder && (
                <p className="ch-warn">
                  <TriangleAlert size={15} aria-hidden="true" /> Fill in or remove every [INPUT REQUIRED: ...]
                  before sending.
                </p>
              )}
              {!manual ? (
                <div className="ch-draft-actions">
                  <button
                    type="button"
                    className="button primary"
                    disabled={!!busy || placeholder || !text.trim()}
                    onClick={() => void send()}
                  >
                    <Send size={16} aria-hidden="true" />{' '}
                    {busy === 'send'
                      ? 'Sending…'
                      : onPhone
                        ? live
                          ? `Send on ${app}`
                          : `Copy and open ${app}`
                        : 'Copy reply'}
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={!!busy}
                    onClick={() => void makeDraft()}
                  >
                    <PenLine size={16} aria-hidden="true" /> Redraft
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={!!busy}
                    onClick={() =>
                      void run('discard', async () => {
                        await saving.current;
                        const d = latest.current ?? draft;
                        await chats('draft.discard', { draftId: d.id, baseRevision: d.revision });
                        setDraft(null);
                        setText('');
                      })
                    }
                  >
                    <Trash2 size={16} aria-hidden="true" /> Discard
                  </button>
                </div>
              ) : (
                <div className="ch-manual" role="status">
                  <p>
                    <Copy size={15} aria-hidden="true" /> The reply is copied.{' '}
                    {onPhone
                      ? `Paste it in ${app} and send it, then come back.`
                      : `Paste it in ${app} on your phone and send it.`}
                  </p>
                  <button
                    type="button"
                    className="button primary"
                    disabled={!!busy}
                    onClick={() => void confirmManual()}
                  >
                    <Check size={16} aria-hidden="true" /> I have sent it
                  </button>
                </div>
              )}
              {!onPhone && !manual && (
                <p className="ch-note">
                  To send straight through {app}, open Chats in the Aeka app on your phone.
                </p>
              )}
            </div>
          )}
        </section>

        <div className="ch-actions subtle" role="group" aria-label="Chat settings">
          <button
            type="button"
            className="button secondary small"
            disabled={!!busy}
            onClick={() =>
              void update(t.vip ? 'unvip' : 'vip', t.vip ? 'No longer a VIP.' : 'Marked as VIP.')
            }
          >
            <Star size={15} aria-hidden="true" /> {t.vip ? 'Remove VIP' : 'VIP'}
          </button>
          <button
            type="button"
            className="button secondary small"
            disabled={!!busy}
            onClick={() =>
              void update(
                t.neverAi ? 'allowAi' : 'neverAi',
                t.neverAi ? 'This chat may be triaged by AI.' : 'This chat is kept from AI.',
              )
            }
          >
            <ShieldOff size={15} aria-hidden="true" /> {t.neverAi ? 'Allow AI' : 'Never send to AI'}
          </button>
          <button
            type="button"
            className="button secondary small"
            disabled={!!busy}
            onClick={() =>
              void update(
                t.muted ? 'unmute' : 'mute',
                t.muted ? 'Unmuted.' : 'Muted. It will not be triaged or nudged.',
              )
            }
          >
            <BellOff size={15} aria-hidden="true" /> {t.muted ? 'Unmute' : 'Mute'}
          </button>
          <button type="button" className="button secondary small" onClick={() => navigate('chats/phone')}>
            Settings
          </button>
        </div>
      </div>
    </Modal>
  );
}
