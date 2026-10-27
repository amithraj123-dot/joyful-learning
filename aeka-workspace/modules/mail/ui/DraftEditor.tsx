'use client';
// Draft editor: recipients, body, placeholders and the reviewed actions (save, save to Outlook, send,
// discard). Send is possible only with no placeholders left and opens a confirmation first.
import { useEffect, useId, useRef, useState } from 'react';
import { CircleCheck, Send, TriangleAlert, X } from 'lucide-react';
import { ConfirmButton } from '../../workflow/ui/components/ConfirmButton';
import { Dirty, Toggle } from '../../workflow/ui/components/Bits';
import { Modal } from '../../workflow/ui/components/Modal';
import { mail } from '../shared/client';
import { PLACEHOLDER, type Address, type Draft, type MailItem } from '../shared/types';
import {
  DRAFT_STATUS_LABELS,
  errorMessage,
  formatStamp,
  isConflict,
  isEmail,
  plural,
  senderName,
} from './lib';
import { useMail, type DraftEdit } from './store';

const fromDraft = (d: Draft): DraftEdit => ({
  body: d.body,
  to: d.to,
  cc: d.cc,
  replyAll: d.replyAll,
  revision: d.revision,
});
const sameList = (a: Address[], b: Address[]) =>
  a.length === b.length && a.every((x, i) => x.address.toLowerCase() === b[i].address.toLowerCase());
const isDirty = (e: DraftEdit, d: Draft) =>
  e.body !== d.body || e.replyAll !== d.replyAll || !sameList(e.to, d.to) || !sameList(e.cc, d.cc);

export function DraftEditor({
  draftId,
  item,
  onChanged,
  onDirtyChange,
  followUp,
}: {
  draftId: string;
  item?: MailItem; // the email being answered, for the subject and reply-all recipients
  followUp?: boolean; // a follow-up to my own sent email: it already goes to everyone on it
  onChanged?: (draft: Draft | null) => void; // null once discarded
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { getEdit, setEdit, notify, account } = useMail();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadError, setLoadError] = useState('');
  const [local, setLocal] = useState<DraftEdit | null>(null);
  const [busy, setBusy] = useState<'' | 'save' | 'outlook' | 'send' | 'discard'>('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [conflictText, setConflictText] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [stale, setStale] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const bodyId = useId();
  const me = account.account?.address ?? '';

  // Unsaved edits kept in memory win over the stored draft; a newer stored revision is flagged.
  const apply = (d: Draft) => {
    setDraft(d);
    const kept = getEdit(draftId);
    if (kept && isDirty(kept, d)) {
      setLocal(kept);
      setStale(kept.revision !== d.revision);
    } else {
      if (kept) setEdit(draftId, null);
      setLocal(fromDraft(d));
    }
  };
  const fail = (e: unknown) => setLoadError(errorMessage(e));
  useEffect(() => {
    let alive = true;
    mail('draft.get', { id: draftId }).then(
      (d) => alive && apply(d),
      (e) => alive && fail(e),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);
  const load = () => mail('draft.get', { id: draftId }).then(apply, fail);

  const dirty = !!(draft && local && isDirty(local, draft));
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  if (loadError)
    return (
      <div className="mail-editor" role="alert">
        <p className="wf-error">{loadError}</p>
        <button
          type="button"
          className="button secondary"
          onClick={() => {
            setLoadError('');
            void load();
          }}
        >
          Try again
        </button>
      </div>
    );
  if (!draft || !local)
    return (
      <p className="wf-loading" role="status">
        Loading the draft
      </p>
    );

  const readOnly = draft.status === 'sent' || draft.status === 'discarded';
  const marks = [...local.body.matchAll(PLACEHOLDER)].map((m) => ({
    text: m[0],
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
  }));
  const badRecipients = [...local.to, ...local.cc].filter((a) => !isEmail(a.address));
  const sendBlock = marks.length
    ? `Fill ${plural(marks.length, 'placeholder')} before sending.`
    : !local.to.length
      ? 'Add at least one recipient in To.'
      : badRecipients.length
        ? 'Correct the recipient addresses marked in red.'
        : '';

  const change = (patch: Partial<DraftEdit>) => {
    const next = { ...local, ...patch };
    setLocal(next);
    setEdit(draftId, isDirty(next, draft) ? next : null);
  };

  // Reply all adds the other people on the original email to Cc, and removes them again.
  const others =
    item && !followUp
      ? [...item.to, ...item.cc].filter(
          (a) =>
            a.address.toLowerCase() !== me.toLowerCase() &&
            a.address.toLowerCase() !== item.from.address.toLowerCase(),
        )
      : [];
  const toggleReplyAll = (on: boolean) => {
    const known = new Set([...local.to, ...local.cc].map((a) => a.address.toLowerCase()));
    const otherSet = new Set(others.map((a) => a.address.toLowerCase()));
    const cc = on
      ? [...local.cc, ...others.filter((a) => !known.has(a.address.toLowerCase()))]
      : local.cc.filter((a) => !otherSet.has(a.address.toLowerCase()));
    change({ replyAll: on, cc });
  };

  const accept = (d: Draft) => {
    setDraft(d);
    setLocal(fromDraft(d));
    setEdit(draftId, null);
    setStale(false);
    onChanged?.(d);
  };
  // A 409 reloads the latest version and keeps the member's text aside, never overwriting silently.
  const onConflict = async () => {
    const mine = local.body;
    try {
      const d = await mail('draft.get', { id: draftId });
      accept(d);
      if (mine !== d.body) setConflictText(mine);
    } catch {}
    setError('This draft was changed elsewhere, so the latest version has been loaded.');
  };

  const persist = async (): Promise<Draft> => {
    if (!dirty) return draft;
    const d = await mail('draft.update', {
      draftId,
      body: local.body,
      to: local.to,
      cc: local.cc,
      replyAll: local.replyAll,
      baseRevision: local.revision,
    });
    accept(d);
    return d;
  };

  const run = async (kind: typeof busy, fn: () => Promise<void>) => {
    setBusy(kind);
    setError('');
    setStatus('');
    try {
      await fn();
    } catch (e) {
      if (isConflict(e)) await onConflict();
      else setError(errorMessage(e));
    } finally {
      setBusy('');
    }
  };

  const save = () =>
    run('save', async () => {
      await persist();
      setStatus('Draft saved in the workspace.');
    });
  const saveToOutlook = () =>
    run('outlook', async () => {
      const d = await persist();
      const r = await mail('draft.saveToOutlook', { draftId, baseRevision: d.revision });
      accept(r);
      setStatus(r.outlookSaved ? 'Saved to your Outlook Drafts folder.' : 'Saved.');
    });
  const send = () =>
    run('send', async () => {
      const d = await persist();
      const r = await mail('draft.send', { draftId, confirm: true, baseRevision: d.revision });
      setConfirming(false);
      accept(r);
      const what = followUp ? 'Follow-up' : 'Reply';
      if (r.status === 'sent') {
        setStatus(what + ' sent from your mailbox.');
        notify(`${what} sent from ${me || 'your mailbox'}`);
      } else setStatus(`The ${what.toLowerCase()} was not sent. Please check the draft and try again.`);
    });
  const discard = () =>
    run('discard', async () => {
      await mail('draft.discard', { draftId, baseRevision: draft.revision });
      setEdit(draftId, null);
      notify('Draft discarded');
      onChanged?.(null);
    });

  const jump = (target?: { start: number; end: number }) => {
    const ta = bodyRef.current;
    if (!ta || !marks.length) return;
    const next = target ?? marks.find((m) => m.start >= ta.selectionEnd) ?? marks[0];
    ta.focus();
    // Measure the height of the text up to the placeholder to scroll it into view.
    const full = ta.value;
    ta.value = full.slice(0, next.end);
    const h = ta.scrollHeight;
    ta.value = full;
    ta.scrollTop = Math.max(0, h - ta.clientHeight / 2);
    ta.setSelectionRange(next.start, next.end);
  };

  return (
    <div className="mail-editor">
      <div className="mail-editor-head">
        <span
          className={'wf-pill ' + (draft.status === 'sent' ? 'green' : draft.outlookSaved ? 'blue' : 'tint')}
        >
          {DRAFT_STATUS_LABELS[draft.status]}
        </span>
        <span className="wf-caption">
          {draft.status === 'sent' && draft.sentAt
            ? 'Sent ' + formatStamp(draft.sentAt)
            : 'Updated ' + formatStamp(draft.updatedAt)}
        </span>
        {!readOnly && <Dirty dirty={dirty} />}
      </div>
      {!readOnly && (
        <p className="mail-from">
          Sends from your own mailbox{me ? ':' : '.'} {me && <strong>{me}</strong>}
        </p>
      )}
      {stale && (
        <p className="wf-note" role="status">
          This draft changed after you started editing. Your unsaved edits are shown. Saving will check for
          changes first.
        </p>
      )}
      {conflictText && (
        <div className="wf-note" role="status">
          <p>Your unsaved text was kept aside. You can use it instead of the version loaded.</p>
          <div className="wf-row wf-wrap">
            <button
              type="button"
              className="button secondary small"
              onClick={() => {
                change({ body: conflictText });
                setConflictText('');
              }}
            >
              Use my text
            </button>
            <button type="button" className="button ghost small" onClick={() => setConflictText('')}>
              Keep the loaded version
            </button>
          </div>
        </div>
      )}

      <RecipientField label="To" list={local.to} disabled={readOnly} onChange={(to) => change({ to })} />
      <RecipientField label="Cc" list={local.cc} disabled={readOnly} onChange={(cc) => change({ cc })} />
      {!readOnly && item && others.length > 0 && (
        <Toggle pressed={local.replyAll} onChange={toggleReplyAll}>
          Reply to all ({plural(others.length, 'other person', 'other people')} on the email)
        </Toggle>
      )}

      <div className="wf-field">
        <label htmlFor={bodyId}>{followUp ? 'Follow-up' : 'Reply'}</label>
        <textarea
          id={bodyId}
          ref={bodyRef}
          className="mail-body-input"
          value={local.body}
          readOnly={readOnly}
          rows={14}
          onChange={(e) => change({ body: e.target.value })}
        />
      </div>

      {!readOnly && (
        <div className={'mail-placeholders' + (marks.length ? ' open' : ' done')} aria-live="polite">
          {marks.length ? (
            <>
              <div className="wf-row wf-between wf-wrap">
                <strong>
                  <TriangleAlert size={15} aria-hidden="true" /> {plural(marks.length, 'placeholder')} to fill
                </strong>
                <button type="button" className="button secondary small" onClick={() => jump()}>
                  Next placeholder
                </button>
              </div>
              <ol>
                {marks.map((m, i) => (
                  <li key={i + ':' + m.start}>
                    <button type="button" className="wf-link" onClick={() => jump(m)}>
                      {m.text.replace(/^\[INPUT REQUIRED:\s*/i, '').replace(/\]$/, '') || 'Missing detail'}
                    </button>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <span>
              <CircleCheck size={15} aria-hidden="true" /> No placeholders remain.
            </span>
          )}
        </div>
      )}

      <p className="wf-sr" aria-live="polite">
        {status}
      </p>
      {status && <p className="mail-ok">{status}</p>}
      {error && (
        <p className="wf-error" role="alert">
          {error}
        </p>
      )}

      {!readOnly && (
        <div className="mail-editor-actions">
          <button
            type="button"
            className="button primary mail-send"
            disabled={!!busy || !!sendBlock}
            aria-describedby={sendBlock ? bodyId + '-block' : undefined}
            onClick={() => setConfirming(true)}
          >
            <Send size={15} aria-hidden="true" /> Send
          </button>
          <button type="button" className="button secondary" disabled={!!busy} onClick={saveToOutlook}>
            {busy === 'outlook'
              ? 'Saving to Outlook'
              : draft.outlookSaved
                ? 'Update in Outlook'
                : 'Save to Outlook'}
          </button>
          <button type="button" className="button secondary" disabled={!!busy || !dirty} onClick={save}>
            {busy === 'save' ? 'Saving' : 'Save'}
          </button>
          <span className="mail-editor-discard">
            <ConfirmButton
              className="button danger"
              question="Discard this draft?"
              confirmLabel="Discard"
              disabled={!!busy}
              onConfirm={discard}
            >
              Discard
            </ConfirmButton>
          </span>
          {sendBlock && (
            <small id={bodyId + '-block'} className="mail-send-block">
              {sendBlock}
            </small>
          )}
        </div>
      )}

      {confirming && (
        <SendConfirm
          draft={local}
          subject={item?.subject}
          from={me}
          followUp={followUp}
          busy={busy === 'send'}
          error={error}
          onCancel={() => setConfirming(false)}
          onSend={send}
        />
      )}
    </div>
  );
}

function SendConfirm({
  draft,
  subject,
  from,
  busy,
  error,
  onCancel,
  onSend,
  followUp,
}: {
  draft: DraftEdit;
  subject?: string;
  from: string;
  followUp?: boolean;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onSend: () => void;
}) {
  const lines = draft.body
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 5);
  const list = (a: Address[]) => a.map((x) => (x.name ? `${x.name} <${x.address}>` : x.address)).join(', ');
  return (
    <Modal
      title={followUp ? 'Send this follow-up?' : 'Send this reply?'}
      subtitle="It goes out now from your own Outlook mailbox and cannot be recalled from here."
      onClose={busy ? () => {} : onCancel}
      footer={
        <div className="wf-row wf-between">
          <button type="button" className="button ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="button primary" onClick={onSend} disabled={busy} data-autofocus>
            <Send size={15} aria-hidden="true" /> {busy ? 'Sending' : 'Send now'}
          </button>
        </div>
      }
    >
      <dl className="mail-confirm">
        <dt>From</dt>
        <dd>{from || 'Your mailbox'}</dd>
        <dt>To</dt>
        <dd>{list(draft.to)}</dd>
        {draft.cc.length > 0 && (
          <>
            <dt>Cc</dt>
            <dd>{list(draft.cc)}</dd>
          </>
        )}
        {subject && (
          <>
            <dt>Subject</dt>
            <dd>{/^re:/i.test(subject) ? subject : 'Re: ' + subject}</dd>
          </>
        )}
      </dl>
      <blockquote className="mail-quote">
        {lines.map((l, i) => (
          <p key={i}>{l}</p>
        ))}
        {draft.body.split('\n').filter((l) => l.trim()).length > lines.length && (
          <p className="wf-caption">…</p>
        )}
      </blockquote>
      {busy && (
        <p className="wf-caption" role="status">
          Sending
        </p>
      )}
      {error && (
        <p className="wf-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}

// Recipients as chips. Type or paste addresses; Enter, comma, semicolon or leaving the field adds them.
export function RecipientField({
  label,
  list,
  onChange,
  disabled,
}: {
  label: string;
  list: Address[];
  onChange: (list: Address[]) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState('');
  const [bad, setBad] = useState('');
  const add = (raw: string) => {
    const parts = raw
      .split(/[,;\s]+/)
      .map((p) => p.trim().replace(/^<|>$/g, ''))
      .filter(Boolean);
    if (!parts.length) return;
    const invalid = parts.filter((p) => !isEmail(p));
    const known = new Set(list.map((a) => a.address.toLowerCase()));
    const fresh = parts
      .filter((p) => isEmail(p) && !known.has(p.toLowerCase()))
      .map((p) => ({ name: '', address: p.toLowerCase() }));
    if (fresh.length) onChange([...list, ...fresh]);
    setText(invalid.join(', '));
    setBad(invalid.length ? 'Enter a valid email address, such as name@firm.com.' : '');
  };
  return (
    <div className="wf-field mail-recipients">
      <label htmlFor={id}>{label}</label>
      <div className={'mail-chipbox' + (disabled ? ' disabled' : '')}>
        {list.map((a) => (
          <span
            key={a.address}
            className={'mail-rcpt' + (isEmail(a.address) ? '' : ' bad')}
            title={a.address}
          >
            <span>{senderName(a)}</span>
            {!disabled && (
              <button
                type="button"
                aria-label={`Remove ${a.address} from ${label}`}
                onClick={() => onChange(list.filter((x) => x !== a))}
              >
                <X size={13} aria-hidden="true" />
              </button>
            )}
          </span>
        ))}
        {!disabled && (
          <input
            id={id}
            type="email"
            inputMode="email"
            autoComplete="off"
            value={text}
            aria-invalid={bad ? true : undefined}
            aria-describedby={bad ? id + '-err' : undefined}
            placeholder={list.length ? '' : 'Add an address'}
            onChange={(e) => {
              setBad('');
              if (/[,;]/.test(e.target.value)) add(e.target.value);
              else setText(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add(text);
              } else if (e.key === 'Backspace' && !text && list.length) onChange(list.slice(0, -1));
            }}
            onBlur={() => add(text)}
            onPaste={(e) => {
              const pasted = e.clipboardData.getData('text');
              if (/[,;\s]/.test(pasted.trim())) {
                e.preventDefault();
                add(text + ' ' + pasted);
              }
            }}
          />
        )}
      </div>
      {bad && (
        <small id={id + '-err'} className="wf-error">
          {bad}
        </small>
      )}
    </div>
  );
}
