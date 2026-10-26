'use client';
// Email detail: the triage and why it matters, the full text, one-tap corrections, "Make a task" and the
// reply draft. A drawer on desktop and full screen on a phone.
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ExternalLink, Paperclip, PencilLine, RotateCcw, ShieldAlert } from 'lucide-react';
import { handOver } from '../../../core/client/handover';
import { Toggle } from '../../workflow/ui/components/Bits';
import { DateInput, Field } from '../../workflow/ui/components/Inputs';
import { Modal } from '../../workflow/ui/components/Modal';
import { mail } from '../shared/client';
import type { TriageChanges } from '../shared/contract';
import {
  CATEGORIES,
  CATEGORY_LABELS,
  HANDLING,
  HANDLING_LABELS,
  TIERS,
  TIER_LABELS,
  type Draft,
  type MailItem,
  type MailMessage,
  type Triage,
} from '../shared/types';
import { DraftEditor } from './DraftEditor';
import {
  addressLine,
  errorMessage,
  formatStamp,
  isConflict,
  linkParts,
  plural,
  safeWebLink,
  senderName,
} from './lib';
import { useMail } from './store';
import { DeadlineBadge, DelegateChip, MandateChip, TierPill } from './MailCard';

const INSTRUCTION_CHIPS = [
  'Keep it short',
  'Ask for the share purchase agreement',
  'Say I will revert by tomorrow',
];

export function MessageDrawer({
  item,
  focus,
  onClose,
  onChange,
}: {
  item: MailItem;
  focus?: 'draft';
  onClose: () => void;
  onChange: (item: MailItem) => void; // a newer copy of the email (triage or draft changed)
}) {
  const { setEdit } = useMail();
  const [message, setMessage] = useState<MailMessage | null>(null);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [dirty, setDirty] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const draftRef = useRef<HTMLElement>(null);
  const current: MailItem = message ?? item;

  const update = useCallback(
    (next: MailItem) => {
      setMessage((m) => (m ? { ...m, ...next, bodyText: m.bodyText } : m));
      onChange(next);
    },
    [onChange],
  );

  const load = async () => {
    try {
      const m = await mail('message.get', { id: item.id });
      setMessage(m);
      onChange(withoutBody(m));
    } catch (e) {
      setLoadError(errorMessage(e));
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);
  useEffect(() => {
    if (focus === 'draft') draftRef.current?.scrollIntoView({ block: 'start' });
  }, [focus, message]);

  const setTriage = (t: Triage) => update({ ...current, triage: t });
  const onConflict = async () => {
    await load();
    setNotice('This email was updated elsewhere, so the latest triage has been loaded. Please try again.');
  };

  const close = () => (dirty ? setLeaving(true) : onClose());
  const draftId = current.draft && current.draft.status !== 'discarded' ? current.draft.id : null;
  const web = safeWebLink(current.webLink);

  return (
    <Modal
      variant="drawer"
      title={current.subject || '(No subject)'}
      subtitle={
        <>
          {senderName(current.from)}
          {current.from.name ? ` <${current.from.address}>` : ''}, {formatStamp(current.receivedAt)}
        </>
      }
      onClose={close}
      footer={
        leaving ? (
          <div className="mail-leave" role="alertdialog" aria-label="Unsaved draft">
            <p>This draft has unsaved changes. They are kept while this tab stays open.</p>
            <div className="wf-row wf-wrap">
              <button type="button" className="button primary small" onClick={() => setLeaving(false)}>
                Keep editing
              </button>
              <button type="button" className="button secondary small" onClick={onClose}>
                Close and keep edits
              </button>
              <button
                type="button"
                className="button danger small"
                onClick={() => {
                  if (draftId) setEdit(draftId, null);
                  onClose();
                }}
              >
                Close and lose edits
              </button>
            </div>
          </div>
        ) : undefined
      }
    >
      <div className="mail-detail">
        <div className="mail-detail-links">
          {web && (
            <a className="button secondary small" href={web} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={14} aria-hidden="true" /> Open in Outlook
            </a>
          )}
          {!draftId && (
            <button
              type="button"
              className="button secondary small"
              onClick={() => draftRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            >
              <PencilLine size={14} aria-hidden="true" /> Draft a reply
            </button>
          )}
        </div>
        {notice && (
          <p className="wf-note" role="status">
            {notice}
          </p>
        )}

        <TriageSummary item={current} onTriage={setTriage} onConflict={onConflict} />

        <section aria-labelledby="mail-body-h" className="mail-detail-section">
          <h3 id="mail-body-h" className="wf-h3">
            Email
          </h3>
          <dl className="mail-meta">
            <dt>To</dt>
            <dd>{addressLine(current.to) || 'Not shown'}</dd>
            {current.cc.length > 0 && (
              <>
                <dt>Cc</dt>
                <dd>{addressLine(current.cc)}</dd>
              </>
            )}
            <dt>Thread</dt>
            <dd>
              {plural(current.threadCount || 1, 'message')}
              {current.repliedByMe ? ', you have replied in this thread' : ''}
            </dd>
          </dl>
          {current.hasAttachments && (
            <p className="wf-caption mail-attach">
              <Paperclip size={14} aria-hidden="true" /> Has attachments. Open in Outlook to see them.
            </p>
          )}
          {message ? (
            <MailBody text={message.bodyText} />
          ) : loadError ? (
            <div role="alert">
              <p className="wf-error">{loadError}</p>
              <button
                type="button"
                className="button secondary small"
                onClick={() => {
                  setLoadError('');
                  void load();
                }}
              >
                Try again
              </button>
            </div>
          ) : (
            <>
              <p className="mail-body mail-preview">{current.preview}</p>
              <p className="wf-loading" role="status">
                Loading the full email
              </p>
            </>
          )}
        </section>

        <section
          ref={draftRef}
          aria-labelledby="mail-draft-h"
          className="mail-detail-section mail-draft-area"
        >
          <h3 id="mail-draft-h" className="wf-h3">
            Reply
          </h3>
          {draftId ? (
            <DraftEditor
              key={draftId}
              draftId={draftId}
              item={current}
              onDirtyChange={setDirty}
              onChanged={(d) => update({ ...current, draft: d ? summary(d) : null })}
            />
          ) : (
            <DraftRequest item={current} onDraft={(d) => update({ ...current, draft: summary(d) })} />
          )}
        </section>

        <Corrections item={current} onTriage={setTriage} onConflict={onConflict} />
        <TaskForm item={current} />
      </div>
    </Modal>
  );
}

// The list keeps no email bodies.
const withoutBody = (m: MailMessage): MailItem => {
  const copy: Partial<MailMessage> = { ...m };
  delete copy.bodyText;
  return copy as MailItem;
};

const summary = (d: Draft) => ({
  id: d.id,
  status: d.status,
  placeholders: d.placeholders,
  updatedAt: d.updatedAt,
});

function MailBody({ text }: { text: string }) {
  if (!text.trim()) return <p className="wf-caption">This email has no text.</p>;
  return (
    <div className="mail-body">
      {linkParts(text).map((p, i) =>
        p.href ? (
          <a key={i} href={p.href} target="_blank" rel="noopener noreferrer nofollow">
            {p.text}
          </a>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </div>
  );
}

function TriageSummary({
  item,
  onTriage,
  onConflict,
}: {
  item: MailItem;
  onTriage: (t: Triage) => void;
  onConflict: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const t = item.triage;
  const retry = async () => {
    setBusy(true);
    setError('');
    try {
      onTriage(await mail('triage.retry', { id: item.id }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const confirmMandate = async () => {
    if (!t?.matterId) return;
    setBusy(true);
    setError('');
    try {
      onTriage(
        await mail('triage.correct', {
          id: item.id,
          changes: { matterId: t.matterId },
          baseRevision: t.revision,
        }),
      );
    } catch (e) {
      if (isConflict(e)) await onConflict();
      else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  if (!t || t.status === 'pending')
    return (
      <p className="wf-note">This email is waiting to be triaged. It will be sorted at the next sync.</p>
    );
  if (t.status === 'failed')
    return (
      <div className="wf-note mail-failed" role="status">
        <p>
          <strong>This email could not be triaged.</strong> {t.error || 'The AI reply was not usable.'} You
          can sort it yourself below or try again.
        </p>
        <button type="button" className="button secondary small" disabled={busy} onClick={retry}>
          <RotateCcw size={14} aria-hidden="true" /> {busy ? 'Trying again' : 'Try triage again'}
        </button>
        {error && <p className="wf-error">{error}</p>}
      </div>
    );
  return (
    <div className="mail-summary">
      <div className="mail-card-pills">
        <TierPill tier={t.tier} />
        <span className="wf-type">{HANDLING_LABELS[t.handling]}</span>
        <span className="wf-type">{CATEGORY_LABELS[t.category]}</span>
        {t.deadline && <DeadlineBadge deadline={t.deadline} />}
      </div>
      {t.why && <p className="mail-why">{t.why}</p>}
      {t.asks.length > 0 && (
        <ul className="mail-asks" aria-label="Asked of you">
          {t.asks.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      )}
      <div className="mail-card-chips">
        <MandateChip triage={t} onConfirm={confirmMandate} busy={busy} />
        <DelegateChip triage={t} />
      </div>
      {t.safetyFlag && (
        <p className="mail-safety">
          <ShieldAlert size={15} aria-hidden="true" /> This email contains text that tries to instruct the
          assistant. It was treated as plain content and not followed.
        </p>
      )}
      <p className="wf-caption">
        {t.source === 'manual' || t.corrected
          ? 'Corrected by you.'
          : t.source === 'rule'
            ? 'Sorted by one of your rules.'
            : t.source === 'rules'
              ? 'Sorted by built-in checks, without AI.'
              : `Sorted by AI${t.confidence < 0.6 ? ', with low confidence' : ''}.`}
      </p>
      {error && <p className="wf-error">{error}</p>}
    </div>
  );
}

// The "Draft a reply" request: optional instructions and reply all. Drafting uses the strong model.
function DraftRequest({ item, onDraft }: { item: MailItem; onDraft: (d: Draft) => void }) {
  const { account } = useMail();
  const [chips, setChips] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [replyAll, setReplyAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const me = account.account?.address.toLowerCase() ?? '';
  const others = [...item.to, ...item.cc].filter(
    (a) => a.address.toLowerCase() !== me && a.address.toLowerCase() !== item.from.address.toLowerCase(),
  );
  const declined = item.triage?.draftDecision === 'declined';
  const go = async () => {
    setBusy(true);
    setError('');
    const instructions = [...chips, text.trim()].filter(Boolean).join('. ');
    try {
      onDraft(
        await mail('draft.create', {
          id: item.id,
          ...(instructions ? { instructions } : {}),
          replyAll,
        }),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mail-draft-request">
      {declined && (
        <p className="wf-caption">You marked this as needing no reply. You can still draft one.</p>
      )}
      <div className="wf-chips" role="group" aria-label="Instructions for the draft">
        {INSTRUCTION_CHIPS.map((c) => (
          <button
            key={c}
            type="button"
            className={'wf-chip' + (chips.includes(c) ? ' active' : '')}
            aria-pressed={chips.includes(c)}
            onClick={() => setChips((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]))}
          >
            {c}
          </button>
        ))}
      </div>
      <Field label="Other instructions (optional)">
        <textarea
          className="wf-textarea"
          rows={2}
          value={text}
          maxLength={600}
          placeholder="For example: confirm the call on Thursday at 4 pm"
          onChange={(e) => setText(e.target.value)}
        />
      </Field>
      {others.length > 0 && (
        <Toggle pressed={replyAll} onChange={setReplyAll}>
          Reply to all ({plural(others.length, 'other person', 'other people')})
        </Toggle>
      )}
      <div className="wf-row wf-wrap mail-draft-go">
        <button type="button" className="button primary" disabled={busy} onClick={go}>
          <PencilLine size={15} aria-hidden="true" /> {busy ? 'Drafting' : 'Draft reply'}
        </button>
        <span className="wf-caption" aria-live="polite">
          {busy
            ? 'Drafting your reply. This can take up to a minute.'
            : 'Nothing is sent. You review the draft first.'}
        </span>
      </div>
      {error && (
        <p className="wf-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function Corrections({
  item,
  onTriage,
  onConflict,
}: {
  item: MailItem;
  onTriage: (t: Triage) => void;
  onConflict: () => Promise<void>;
}) {
  const { members, targets, targetsLoaded, targetById } = useMail();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const t = item.triage;
  if (!t || t.status === 'pending') return null;
  const correct = async (changes: TriageChanges, what: string) => {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      onTriage(await mail('triage.correct', { id: item.id, changes, baseRevision: t.revision }));
      setStatus(what + ' updated. Triage will learn from this.');
    } catch (e) {
      if (isConflict(e)) await onConflict();
      else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const knownMatter = !t.matterId || targetById.has(t.matterId);
  return (
    <section aria-labelledby="mail-correct-h" className="mail-detail-section">
      <h3 id="mail-correct-h" className="wf-h3">
        Correct the triage
      </h3>
      <p className="wf-caption">One tap saves the change. Your corrections teach later triage.</p>
      <div className="mail-correct-row">
        <span className="mail-correct-label" id="mail-tier-l">
          Priority
        </span>
        <div className="mail-seg" role="group" aria-labelledby="mail-tier-l">
          {TIERS.map((tier) => (
            <button
              key={tier}
              type="button"
              disabled={busy}
              aria-pressed={t.tier === tier}
              className={'mail-seg-btn tier-' + tier + (t.tier === tier ? ' on' : '')}
              onClick={() => t.tier !== tier && correct({ tier }, 'Priority')}
            >
              {TIER_LABELS[tier]}
            </button>
          ))}
        </div>
      </div>
      <div className="mail-correct-row">
        <span className="mail-correct-label" id="mail-handling-l">
          Handling
        </span>
        <div className="mail-seg wrap" role="group" aria-labelledby="mail-handling-l">
          {HANDLING.filter((h) => h !== 'uncertain' || t.handling === 'uncertain').map((h) => (
            <button
              key={h}
              type="button"
              disabled={busy}
              aria-pressed={t.handling === h}
              className={'mail-seg-btn' + (t.handling === h ? ' on' : '')}
              onClick={() => t.handling !== h && correct({ handling: h }, 'Handling')}
            >
              {HANDLING_LABELS[h]}
            </button>
          ))}
        </div>
      </div>
      <div className="wf-grid two">
        <Field label="Category">
          <select
            value={t.category}
            disabled={busy}
            onChange={(e) => correct({ category: e.target.value as Triage['category'] }, 'Category')}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Mandate"
          hint={targetsLoaded && !targets.length ? 'No mandates are visible to you in Workflow.' : undefined}
        >
          <select
            value={t.matterId ?? ''}
            disabled={busy}
            onChange={(e) => correct({ matterId: e.target.value || null }, 'Mandate')}
          >
            <option value="">No mandate</option>
            {!knownMatter && <option value={t.matterId ?? ''}>Linked mandate</option>}
            {targets.map((m) => (
              <option key={m.matterId} value={m.matterId}>
                {m.clientName ? m.clientName + ': ' : ''}
                {m.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Delegate to">
          <select
            value={t.delegate ?? ''}
            disabled={busy}
            onChange={(e) => correct({ delegate: e.target.value || null }, 'Delegate')}
          >
            <option value="">No one</option>
            {t.delegate && !members.some((m) => m.email === t.delegate) && (
              <option value={t.delegate}>{t.delegate}</option>
            )}
            {members.map((m) => (
              <option key={m.email} value={m.email}>
                {m.name} ({m.designation})
              </option>
            ))}
          </select>
        </Field>
      </div>
      <p className="wf-caption" aria-live="polite">
        {busy ? 'Saving' : status}
      </p>
      {error && (
        <p className="wf-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function TaskForm({ item }: { item: MailItem }) {
  const { members, targets, targetById, navigate, notify } = useMail();
  const t = item.triage;
  const [open, setOpen] = useState(false);
  const [matterId, setMatterId] = useState(t?.matterId ?? '');
  const [title, setTitle] = useState(() => (t?.asks[0] || item.subject || '').slice(0, 200));
  const [assignee, setAssignee] = useState(t?.delegate ?? '');
  const [due, setDue] = useState<string | null>(t?.deadline ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ matterId: string } | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!matterId) return setError('Choose a mandate for the task.');
    if (!title.trim()) return setError('Enter a title for the task.');
    setBusy(true);
    setError('');
    try {
      await mail('task.fromMail', {
        id: item.id,
        matterId,
        title: title.trim(),
        assignee: assignee || null,
        dueDate: due,
      });
      setDone({ matterId });
      notify('Task created');
    } catch (e2) {
      setError(errorMessage(e2));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-labelledby="mail-task-h" className="mail-detail-section">
      <h3 id="mail-task-h" className="wf-h3">
        Make a task
        {!open && !done && (
          <button type="button" className="button secondary small" onClick={() => setOpen(true)}>
            Make a task
          </button>
        )}
      </h3>
      {done ? (
        <div className="wf-note" role="status">
          <p>Task created on {targetById.get(done.matterId)?.title ?? 'the mandate'}.</p>
          <div className="wf-row wf-wrap">
            <button
              type="button"
              className="button secondary small"
              onClick={() => {
                handOver('workflow.matter', { matterId: done.matterId, tab: 'tasks' });
                navigate('workflow/matters');
              }}
            >
              Open the mandate
            </button>
            <button
              type="button"
              className="button ghost small"
              onClick={() => {
                setDone(null);
                setOpen(true);
              }}
            >
              Make another
            </button>
          </div>
        </div>
      ) : open ? (
        <form onSubmit={submit} noValidate>
          <Field label="Mandate">
            <select value={matterId} onChange={(e) => setMatterId(e.target.value)} required>
              <option value="">Choose a mandate</option>
              {targets
                .filter((m) => m.status !== 'closed')
                .map((m) => (
                  <option key={m.matterId} value={m.matterId}>
                    {m.clientName ? m.clientName + ': ' : ''}
                    {m.title}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Title">
            <input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} required />
          </Field>
          <div className="wf-grid two">
            <Field label="Assignee">
              <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                <option value="">Unassigned</option>
                {members.map((m) => (
                  <option key={m.email} value={m.email}>
                    {m.name}
                  </option>
                ))}
              </select>
            </Field>
            <DateInput label="Due date" value={due} onChange={setDue} />
          </div>
          {error && (
            <p className="wf-error" role="alert">
              {error}
            </p>
          )}
          <div className="wf-form-actions">
            <button type="button" className="button ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="button primary" disabled={busy}>
              {busy ? 'Creating' : 'Create task'}
            </button>
          </div>
        </form>
      ) : (
        <p className="wf-caption">Turn this email into a Workflow task on one of your mandates.</p>
      )}
    </section>
  );
}
