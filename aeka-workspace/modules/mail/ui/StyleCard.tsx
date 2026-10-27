'use client';
// Writing style: learned from the member's sent mail on request (one AI call), checked and edited by
// them, and used for every draft once accepted.
import { useEffect, useState } from 'react';
import { Check, Pencil, RefreshCw, X } from 'lucide-react';
import { Field } from '../../workflow/ui/components/Inputs';
import { mail } from '../shared/client';
import type { StyleProfile } from '../shared/types';
import { errorMessage, formatWhen, plural } from './lib';
import { useMail } from './store';

type Fields = Pick<StyleProfile, 'greeting' | 'signOff' | 'tone' | 'notes'>;
const MAX_NOTES = 10;

const STATUS: Record<StyleProfile['status'], { text: string; tone: string }> = {
  active: { text: 'In use', tone: 'green' },
  proposed: { text: 'Proposed, check it', tone: 'amber' },
  rejected: { text: 'Not used', tone: 'grey' },
};

const fieldsOf = (p: StyleProfile): Fields => ({
  greeting: p.greeting,
  signOff: p.signOff,
  tone: p.tone,
  notes: p.notes,
});

export function StyleCard() {
  const { notify } = useMail();
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [profile, setProfile] = useState<StyleProfile | null>(null);
  const [form, setForm] = useState<(Fields & { notesText: string }) | null>(null);
  const [busy, setBusy] = useState<'' | 'learn' | 'save' | 'reject'>('');
  const [error, setError] = useState('');
  const edit = (p: StyleProfile) => setForm({ ...fieldsOf(p), notesText: p.notes.join('\n') });

  useEffect(() => {
    let alive = true;
    mail('style.get', {}).then(
      (p) => {
        if (!alive) return;
        setProfile(p);
        if (p?.status === 'proposed') edit(p);
        setPhase('ready');
      },
      (e) => {
        if (!alive) return;
        setError(errorMessage(e));
        setPhase('error');
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  const learn = async () => {
    setBusy('learn');
    setError('');
    try {
      const p = await mail('style.learn', {});
      setProfile(p);
      edit(p);
      setPhase('ready');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy('');
    }
  };
  const save = async (status: 'active' | 'rejected') => {
    if (!form || !profile) return;
    const notes = form.notesText
      .split('\n')
      .map((n) => n.trim().replace(/^[-*•]\s*/, ''))
      .filter(Boolean);
    if (status === 'active' && !form.greeting.trim() && !form.signOff.trim() && !form.tone.trim())
      return setError('Add a greeting, a sign-off or a tone, or reject the proposal.');
    if (notes.length > MAX_NOTES) return setError(`Keep to ${MAX_NOTES} notes or fewer.`);
    setBusy(status === 'active' ? 'save' : 'reject');
    setError('');
    try {
      const p = await mail('style.save', {
        profile: {
          greeting: form.greeting.trim(),
          signOff: form.signOff.trim(),
          tone: form.tone.trim(),
          notes,
        },
        status,
      });
      setProfile(p);
      setForm(null);
      notify(status === 'active' ? 'Writing style saved. New drafts follow it.' : 'Proposal rejected');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy('');
    }
  };

  const status = profile ? STATUS[profile.status] : null;
  return (
    <section className="card wf-section" aria-labelledby="mail-style-h">
      <div className="wf-row wf-between wf-wrap">
        <h2 id="mail-style-h">Writing style</h2>
        {status && <span className={'wf-pill ' + status.tone}>{status.text}</span>}
      </div>
      <p className="wf-caption">
        Drafts follow your style once you accept it. It is learned from up to 40 of your recent sent emails in
        one AI call, only when you ask.
      </p>

      {phase === 'loading' ? (
        <p className="wf-loading" role="status">
          Loading
        </p>
      ) : form && profile ? (
        <div className="mail-style-form">
          {profile.status === 'proposed' && (
            <p className="wf-note">
              Proposed from {plural(profile.sampleCount, 'sent email')}. Check it and edit anything that is
              not quite you, then accept it.
            </p>
          )}
          <Field label="Greeting" hint="Use {first name} where the name goes, such as Dear {first name},">
            <input
              value={form.greeting}
              maxLength={120}
              onChange={(e) => setForm({ ...form, greeting: e.target.value })}
            />
          </Field>
          <Field label="Sign-off">
            <textarea
              className="wf-textarea"
              rows={3}
              value={form.signOff}
              maxLength={300}
              onChange={(e) => setForm({ ...form, signOff: e.target.value })}
            />
          </Field>
          <Field label="Tone">
            <textarea
              className="wf-textarea"
              rows={2}
              value={form.tone}
              maxLength={400}
              onChange={(e) => setForm({ ...form, tone: e.target.value })}
            />
          </Field>
          <Field label="Notes" hint={`One per line, up to ${MAX_NOTES}.`}>
            <textarea
              className="wf-textarea"
              rows={5}
              value={form.notesText}
              maxLength={2000}
              onChange={(e) => setForm({ ...form, notesText: e.target.value })}
            />
          </Field>
          <div className="wf-row wf-wrap mail-style-actions">
            <button type="button" className="button primary" disabled={!!busy} onClick={() => save('active')}>
              <Check size={15} aria-hidden="true" />{' '}
              {busy === 'save' ? 'Saving' : profile.status === 'active' ? 'Save' : 'Accept'}
            </button>
            {profile.status === 'active' ? (
              <button type="button" className="button ghost" disabled={!!busy} onClick={() => setForm(null)}>
                Cancel
              </button>
            ) : (
              <button
                type="button"
                className="button secondary"
                disabled={!!busy}
                onClick={() => save('rejected')}
              >
                <X size={15} aria-hidden="true" /> {busy === 'reject' ? 'Saving' : 'Reject'}
              </button>
            )}
          </div>
        </div>
      ) : profile && profile.status === 'active' ? (
        <>
          <dl className="mail-style">
            <dt>Greeting</dt>
            <dd>{profile.greeting || 'Not set'}</dd>
            <dt>Sign-off</dt>
            <dd className="mail-pre">{profile.signOff || 'Not set'}</dd>
            <dt>Tone</dt>
            <dd>{profile.tone || 'Not set'}</dd>
            {profile.notes.length > 0 && (
              <>
                <dt>Notes</dt>
                <dd>
                  <ul className="mail-asks">
                    {profile.notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </dd>
              </>
            )}
          </dl>
          <p className="wf-caption">
            Learned from {plural(profile.sampleCount, 'sent email')}, updated {formatWhen(profile.updatedAt)}.
          </p>
          <div className="wf-row wf-wrap mail-style-actions">
            <button
              type="button"
              className="button secondary"
              disabled={!!busy}
              onClick={() => edit(profile)}
            >
              <Pencil size={14} aria-hidden="true" /> Edit
            </button>
            <button type="button" className="button secondary" disabled={!!busy} onClick={learn}>
              <RefreshCw size={14} aria-hidden="true" className={busy === 'learn' ? 'mail-spin' : ''} />
              {busy === 'learn' ? 'Reading your sent mail' : 'Learn again'}
            </button>
          </div>
        </>
      ) : (
        <div className="mail-style-empty">
          <p>
            {profile?.status === 'rejected'
              ? 'You rejected the last proposal, so drafts use a plain, formal style.'
              : phase === 'error'
                ? ''
                : 'Not learned yet. Drafts use a plain, formal style until you accept one.'}
          </p>
          <button type="button" className="button primary" disabled={!!busy} onClick={learn}>
            <RefreshCw size={15} aria-hidden="true" className={busy === 'learn' ? 'mail-spin' : ''} />
            {busy === 'learn' ? 'Reading your sent mail' : 'Learn from my sent mail'}
          </button>
        </div>
      )}
      <p className="wf-sr" aria-live="polite">
        {busy === 'learn' ? 'Reading your sent mail. This can take up to a minute.' : ''}
      </p>
      {busy === 'learn' && <p className="wf-caption">This can take up to a minute.</p>}
      {error && (
        <p className="wf-error" role="alert">
          {error}
        </p>
      )}

      <div className="mail-style-more">
        <p>
          <strong>For each person.</strong> A draft also uses the greeting and sign-off you last used with
          that person, read from your sent mail without AI.
        </p>
        <p>
          <strong>From your edits.</strong> When you change a draft a good deal before sending it, the change
          is remembered, and your three most recent edits guide later drafts.
        </p>
      </div>
    </section>
  );
}
