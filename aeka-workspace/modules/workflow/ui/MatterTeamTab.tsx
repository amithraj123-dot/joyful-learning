'use client';
// Mandate team and reviews: the team, each member's self-reflection and the reviewer's review with a
// rating. Feedback is saved only with an explicit Save, and only when it has changed.
import { useState } from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';
import type { Feedback, Matter, PersonKey } from '../shared/types';
import { Dirty, Toggle } from './components/Bits';
import { PersonBadge, TeamPicker } from './components/People';
import { formatStamp, personLabel, rank } from './lib';
import { useRemote, useWF } from './store';

export function MatterTeamTab({
  matter,
  onUpdate,
}: {
  matter: Matter;
  onUpdate: (patch: Partial<Matter>) => Promise<Matter | undefined>;
}) {
  const { members, caps, meEmail, run } = useWF();
  const feedback = useRemote('feedback:' + matter.id, () => run('feedback.list', { matterId: matter.id }));
  const [team, setTeam] = useState<PersonKey[] | null>(null);
  const list = feedback.data ?? [];
  const find = (member: PersonKey, kind: 'self' | 'review') =>
    list.find((f) => f.member === member && f.kind === kind);
  const sorted = [...matter.team].sort(
    (a, b) =>
      rank(personLabel(b, members).member) - rank(personLabel(a, members).member) ||
      personLabel(a, members).name.localeCompare(personLabel(b, members).name),
  );
  const onTeam = matter.team.includes(meEmail);

  return (
    <div className="wf-stack">
      <section className="card wf-section" aria-labelledby="wf-team-h">
        <div className="wf-row wf-between wf-wrap">
          <h2 id="wf-team-h">Team</h2>
          {caps.manageMatters && team === null && (
            <button type="button" className="button secondary" onClick={() => setTeam(matter.team)}>
              Change the team
            </button>
          )}
        </div>
        {team !== null ? (
          <>
            <TeamPicker value={team} onChange={setTeam} legend="Team members on this mandate" />
            <div className="wf-form-actions">
              <button type="button" className="button secondary" onClick={() => setTeam(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="button primary"
                disabled={JSON.stringify(team) === JSON.stringify(matter.team)}
                onClick={async () => {
                  if (await onUpdate({ team })) setTeam(null);
                }}
              >
                Save team
              </button>
            </div>
          </>
        ) : (
          <ul className="wf-list">
            {sorted.map((p) => {
              const l = personLabel(p, members);
              return (
                <li key={p} className="wf-list-row">
                  <PersonBadge person={p} showName />
                  <span className="wf-caption">
                    {l.member?.designation ?? (l.legacy ? 'Imported initials' : '')}
                  </span>
                </li>
              );
            })}
            {!sorted.length && <li className="wf-empty-line">No one is on this mandate yet.</li>}
          </ul>
        )}
      </section>

      <section className="card wf-section" aria-labelledby="wf-reviews-h">
        <div className="wf-row wf-between wf-wrap">
          <h2 id="wf-reviews-h">Self-reflections and reviews</h2>
          {caps.manageMatters && (
            <Toggle
              pressed={matter.peerFeedbackVisible}
              onChange={(v) => void onUpdate({ peerFeedbackVisible: v })}
            >
              {matter.peerFeedbackVisible ? (
                <Eye size={15} aria-hidden="true" />
              ) : (
                <EyeOff size={15} aria-hidden="true" />
              )}
              Team members can read each other&apos;s self-reflections
            </Toggle>
          )}
        </div>
        <p className="wf-caption">
          Each member writes a self-reflection. Reviews and ratings are written by Assistant Managers and
          above; a member can read the review written about them.
        </p>
        {feedback.loading && !feedback.data && <p className="wf-loading">Loading feedback</p>}
        {feedback.data && (
          <div className="wf-feedback-grid">
            {onTeam && (
              <article className="wf-feedback mine">
                <h3>Your self-reflection</h3>
                <FeedbackEditor
                  key={'self' + (find(meEmail, 'self')?.revision ?? 0)}
                  matterId={matter.id}
                  member={meEmail}
                  kind="self"
                  existing={find(meEmail, 'self')}
                  onSaved={feedback.reload}
                />
                {!caps.reviewPeople && (
                  <ReadOnly title="Review of your work" item={find(meEmail, 'review')} rating />
                )}
              </article>
            )}
            {sorted
              .filter((p) => p !== meEmail)
              .map((p) => {
                const self = find(p, 'self');
                const review = find(p, 'review');
                return (
                  <article key={p} className="wf-feedback">
                    <h3>
                      <PersonBadge person={p} showName />
                    </h3>
                    {caps.reviewPeople ? (
                      <>
                        <ReadOnly title="Self-reflection" item={self} />
                        <h4 className="wf-h4">Review</h4>
                        <FeedbackEditor
                          key={'review' + (review?.revision ?? 0)}
                          matterId={matter.id}
                          member={p}
                          kind="review"
                          existing={review}
                          onSaved={feedback.reload}
                        />
                      </>
                    ) : self ? (
                      <ReadOnly title="Self-reflection" item={self} />
                    ) : (
                      <p className="wf-caption wf-row">
                        <Lock size={14} aria-hidden="true" /> Not shared with the team
                      </p>
                    )}
                  </article>
                );
              })}
            {!onTeam && !caps.reviewPeople && (
              <p className="wf-caption">
                You are not on this mandate&apos;s team, so there is nothing for you to write here.
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function ReadOnly({ title, item, rating }: { title: string; item?: Feedback; rating?: boolean }) {
  return (
    <div className="wf-readonly">
      <h4 className="wf-h4">{title}</h4>
      {item?.text ? (
        <p className="wf-pre">{item.text}</p>
      ) : (
        <p className="wf-caption">Nothing written yet.</p>
      )}
      {rating && item?.rating != null && <p className="wf-caption">Rating: {item.rating} of 5</p>}
      {item && (
        <p className="wf-caption">
          Written by <PersonBadge person={item.author} showName />, updated {formatStamp(item.updatedAt)}
        </p>
      )}
    </div>
  );
}

function FeedbackEditor({
  matterId,
  member,
  kind,
  existing,
  onSaved,
}: {
  matterId: string;
  member: PersonKey;
  kind: 'self' | 'review';
  existing?: Feedback;
  onSaved: () => void;
}) {
  const { run, notify } = useWF();
  const [text, setText] = useState(existing?.text ?? '');
  const [rating, setRating] = useState<number | null>(existing?.rating ?? null);
  const [busy, setBusy] = useState(false);
  const dirty =
    text !== (existing?.text ?? '') || (kind === 'review' && rating !== (existing?.rating ?? null));
  const save = async () => {
    setBusy(true);
    const saved = await run('feedback.save', {
      matterId,
      member,
      kind,
      text,
      rating: kind === 'review' ? rating : null,
      baseRevision: existing?.revision ?? 0,
    });
    setBusy(false);
    if (saved) {
      notify(kind === 'self' ? 'Self-reflection saved' : 'Review saved');
      onSaved();
    }
  };
  return (
    <div className="wf-feedback-editor">
      <textarea
        className="wf-textarea"
        rows={4}
        value={text}
        aria-label={kind === 'self' ? 'Your self-reflection' : 'Review'}
        placeholder={
          kind === 'self' ? 'What went well, what you would do differently' : 'Strengths, areas to develop'
        }
        onChange={(e) => setText(e.target.value)}
      />
      {kind === 'review' && (
        <div className="wf-rating" role="group" aria-label="Rating out of 5">
          <span className="wf-caption">Rating</span>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={rating === n}
              aria-label={`Rating ${n} of 5`}
              className={rating !== null && n <= rating ? 'on' : ''}
              onClick={() => setRating(rating === n ? null : n)}
            >
              {n}
            </button>
          ))}
        </div>
      )}
      <div className="wf-row wf-between">
        <Dirty dirty={dirty} />
        <button
          type="button"
          className="button primary"
          disabled={!dirty || busy}
          onClick={() => void save()}
        >
          Save
        </button>
      </div>
      {existing && <p className="wf-caption">Last saved {formatStamp(existing.updatedAt)}</p>}
    </div>
  );
}
