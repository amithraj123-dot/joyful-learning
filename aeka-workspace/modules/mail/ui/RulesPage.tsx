'use client';
// Rules and learning: how corrections shape triage, AI use today, proposed rules to accept or reject,
// the member's active rules, and a form to add one.
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Check, Pencil, Plus, SlidersHorizontal, TriangleAlert, X } from 'lucide-react';
import { ConfirmButton } from '../../workflow/ui/components/ConfirmButton';
import { Chips, Empty, Toggle } from '../../workflow/ui/components/Bits';
import { Field } from '../../workflow/ui/components/Inputs';
import { Modal } from '../../workflow/ui/components/Modal';
import { mail } from '../shared/client';
import type { MailActions } from '../shared/contract';
import {
  CATEGORIES,
  CATEGORY_LABELS,
  HANDLING,
  HANDLING_LABELS,
  TIERS,
  TIER_LABELS,
  type MailRule,
  type RuleEffect,
  type Tier,
} from '../shared/types';
import { onlyVip } from './actions';
import { errorMessage, formatWhen, isEmail, plural } from './lib';
import { useMail } from './store';
import { StyleCard } from './StyleCard';
import { DOMAIN, VipCard } from './VipCard';

type Stats = MailActions['stats']['result'];
const KIND_LABELS: Record<MailRule['kind'], string> = {
  sender: 'Sender',
  domain: 'Domain',
  subject: 'Subject phrase',
};
const FIELD_LABELS: Record<string, string> = {
  tier: 'Priority',
  category: 'Category',
  handling: 'Handling',
  matterId: 'Mandate',
  matter: 'Mandate',
  delegate: 'Delegate',
};

function useRuleText() {
  const { targetById } = useMail();
  return {
    when: (r: Pick<MailRule, 'kind' | 'pattern'>) =>
      r.kind === 'sender'
        ? `Email from ${r.pattern}`
        : r.kind === 'domain'
          ? `Email from anyone at ${r.pattern}`
          : `Subject contains "${r.pattern}"`,
    effects: (e: RuleEffect) =>
      [
        e.tier && `priority ${TIER_LABELS[e.tier]}`,
        e.category && `category ${CATEGORY_LABELS[e.category]}`,
        e.handling && `handling ${HANDLING_LABELS[e.handling]}`,
        e.matterId && `mandate ${targetById.get(e.matterId)?.title ?? 'linked'}`,
        e.neverAi && 'never sent to AI',
        e.vip && 'VIP',
      ].filter(Boolean) as string[],
  };
}

export function RulesPage() {
  const { notify } = useMail();
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsError, setStatsError] = useState('');
  const [rules, setRules] = useState<MailRule[]>([]);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<MailRule | 'new' | null>(null);
  const text = useRuleText();

  const load = useCallback(async () => {
    setPhase('loading');
    mail('stats', {})
      .then((s) => {
        setStats(s);
        setStatsError('');
      })
      .catch((e) => setStatsError(errorMessage(e)));
    try {
      setRules(await mail('rules.list', {}));
      setPhase('ready');
    } catch (e) {
      setError(errorMessage(e));
      setPhase('error');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const save = async (r: MailRule, status: MailRule['status']) => {
    setBusy(r.id);
    setRowError((m) => ({ ...m, [r.id]: '' }));
    try {
      const saved = await mail('rules.save', {
        rule: { id: r.id, kind: r.kind, pattern: r.pattern, effect: r.effect, status },
      });
      setRules((old) => old.map((x) => (x.id === saved.id ? saved : x)));
      notify(status === 'active' ? 'Rule accepted. It applies to new email.' : 'Suggestion rejected');
    } catch (e) {
      setRowError((m) => ({ ...m, [r.id]: errorMessage(e) }));
    } finally {
      setBusy('');
    }
  };
  const remove = async (r: MailRule) => {
    setRowError((m) => ({ ...m, [r.id]: '' }));
    try {
      await mail('rules.delete', { id: r.id });
      setRules((old) => old.filter((x) => x.id !== r.id));
      notify('Rule deleted');
    } catch (e) {
      setRowError((m) => ({ ...m, [r.id]: errorMessage(e) }));
    }
  };

  const proposed = rules.filter((r) => r.status === 'proposed').sort((a, b) => b.evidence - a.evidence);
  // Rules that only mark a VIP are listed in the VIP card.
  const active = rules
    .filter((r) => r.status === 'active' && !(r.effect.vip && onlyVip(r.effect)))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const upsert = (saved: MailRule) =>
    setRules((old) =>
      old.some((x) => x.id === saved.id) ? old.map((x) => (x.id === saved.id ? saved : x)) : [saved, ...old],
    );
  const rejected = rules.filter((r) => r.status === 'rejected');

  return (
    <div className="wf-stack mail-rules">
      <p className="mail-lead">
        Rules are suggested from your corrections and apply only once you accept them. They affect new email.
      </p>

      <section className="card wf-section" aria-labelledby="mail-stats-h">
        <h2 id="mail-stats-h">Last 30 days</h2>
        {stats ? (
          <StatsView stats={stats} />
        ) : statsError ? (
          <p className="wf-error">{statsError}</p>
        ) : (
          <p className="wf-loading" role="status">
            Loading
          </p>
        )}
      </section>

      {phase === 'loading' ? (
        <p className="wf-loading" role="status">
          Loading your rules
        </p>
      ) : phase === 'error' ? (
        <Empty
          icon={TriangleAlert}
          title="Rules could not be loaded"
          action={
            <button type="button" className="button primary" onClick={load}>
              Try again
            </button>
          }
        >
          {error}
        </Empty>
      ) : (
        <>
          <section className="card wf-section tinted" aria-labelledby="mail-proposed-h">
            <h2 id="mail-proposed-h">Suggested rules ({proposed.length})</h2>
            {proposed.length ? (
              <ul className="mail-rule-list">
                {proposed.map((r) => (
                  <li key={r.id} className="mail-rule">
                    <div className="mail-rule-text">
                      <strong>{text.when(r)}</strong>
                      <span>Set {text.effects(r.effect).join(', ') || 'no change'}.</span>
                      <span className="wf-caption">
                        Based on {plural(r.evidence, 'correction')} you made.
                      </span>
                    </div>
                    <div className="mail-rule-actions">
                      <button
                        type="button"
                        className="button primary small"
                        disabled={busy === r.id}
                        onClick={() => save(r, 'active')}
                      >
                        <Check size={14} aria-hidden="true" /> Accept
                      </button>
                      <button
                        type="button"
                        className="button secondary small"
                        disabled={busy === r.id}
                        onClick={() => save(r, 'rejected')}
                      >
                        <X size={14} aria-hidden="true" /> Reject
                      </button>
                    </div>
                    {rowError[r.id] && <p className="wf-error">{rowError[r.id]}</p>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="wf-caption">
                No suggestions yet. When you correct the same sender or domain a few times, a rule is
                suggested here.
              </p>
            )}
          </section>

          <StyleCard />

          <VipCard
            rules={rules}
            effects={(r) => text.effects(r.effect)}
            onSaved={upsert}
            onRemoved={(id, rest) =>
              setRules((old) =>
                rest ? old.map((x) => (x.id === id ? rest : x)) : old.filter((x) => x.id !== id),
              )
            }
          />

          <section className="card wf-section" aria-labelledby="mail-active-h">
            <div className="wf-row wf-between wf-wrap">
              <h2 id="mail-active-h">Your rules ({active.length})</h2>
              <button type="button" className="button primary" onClick={() => setEditing('new')}>
                <Plus size={15} aria-hidden="true" /> Add a rule
              </button>
            </div>
            {active.length ? (
              <ul className="mail-rule-list">
                {active.map((r) => (
                  <li key={r.id} className="mail-rule">
                    <div className="mail-rule-text">
                      <strong>{text.when(r)}</strong>
                      <span>Set {text.effects(r.effect).join(', ') || 'no change'}.</span>
                      <span className="wf-caption">Updated {formatWhen(r.updatedAt)}</span>
                    </div>
                    <div className="mail-rule-actions">
                      <button type="button" className="button secondary small" onClick={() => setEditing(r)}>
                        <Pencil size={14} aria-hidden="true" /> Edit
                      </button>
                      <ConfirmButton
                        className="button danger small"
                        question="Delete this rule?"
                        onConfirm={() => remove(r)}
                      >
                        Delete
                      </ConfirmButton>
                    </div>
                    {rowError[r.id] && <p className="wf-error">{rowError[r.id]}</p>}
                  </li>
                ))}
              </ul>
            ) : (
              <Empty icon={SlidersHorizontal} title="No rules yet">
                Add a rule for a sender, a domain or a subject phrase, or accept a suggestion above.
              </Empty>
            )}
          </section>

          {rejected.length > 0 && (
            <details className="mail-details">
              <summary>Rejected suggestions ({rejected.length})</summary>
              <ul className="mail-rule-list">
                {rejected.map((r) => (
                  <li key={r.id} className="mail-rule">
                    <div className="mail-rule-text">
                      <span>{text.when(r)}</span>
                      <span className="wf-caption">Set {text.effects(r.effect).join(', ')}.</span>
                    </div>
                    <div className="mail-rule-actions">
                      <button
                        type="button"
                        className="button secondary small"
                        disabled={busy === r.id}
                        onClick={() => save(r, 'active')}
                      >
                        Accept after all
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      {editing && (
        <RuleForm
          rule={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            upsert(saved);
            setEditing(null);
            notify('Rule saved. It applies to new email.');
          }}
        />
      )}
    </div>
  );
}

function StatsView({ stats }: { stats: Stats }) {
  const rate = stats.triaged30d ? Math.round((stats.corrected30d / stats.triaged30d) * 100) : 0;
  const fields = Object.entries(stats.correctionsByField)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  const used = stats.aiLimit ? Math.min(100, Math.round((stats.aiCallsToday / stats.aiLimit) * 100)) : 0;
  return (
    <>
      <div className="mail-stats">
        <div>
          <strong>{stats.triaged30d}</strong>
          <span>Emails triaged</span>
        </div>
        <div>
          <strong>{stats.corrected30d}</strong>
          <span>Corrected by you</span>
        </div>
        <div>
          <strong>{rate}%</strong>
          <span>Correction rate</span>
        </div>
        <div>
          <strong>
            {stats.aiCallsToday}
            <small> of {stats.aiLimit}</small>
          </strong>
          <span>AI calls today</span>
          <span
            className="wf-progress"
            role="progressbar"
            aria-label="AI calls used today"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={used}
          >
            <span style={{ width: used + '%' }} />
          </span>
        </div>
      </div>
      {fields.length > 0 && (
        <>
          <h3 className="wf-h4">Corrections by field</h3>
          <ul className="mail-fields">
            {fields.map(([f, n]) => (
              <li key={f}>
                <span>{FIELD_LABELS[f] ?? f}</span>
                <span className="mail-bar" aria-hidden="true">
                  <span style={{ width: Math.round((n / Math.max(1, stats.corrected30d)) * 100) + '%' }} />
                </span>
                <strong>
                  {n}
                  {stats.triaged30d ? <small> ({Math.round((n / stats.triaged30d) * 100)}%)</small> : null}
                </strong>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="wf-caption">
        The AI limit is per member per day, in India time. Built-in checks and your rules use no AI.
      </p>
    </>
  );
}

function RuleForm({
  rule,
  onClose,
  onSaved,
}: {
  rule: MailRule | null;
  onClose: () => void;
  onSaved: (r: MailRule) => void;
}) {
  const { targets } = useMail();
  const [kind, setKind] = useState<MailRule['kind']>(rule?.kind ?? 'sender');
  const [pattern, setPattern] = useState(rule?.pattern ?? '');
  const [effect, setEffect] = useState<RuleEffect>(rule?.effect ?? {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (patch: Partial<RuleEffect>) => {
    const next: RuleEffect = { ...effect, ...patch };
    (Object.keys(next) as (keyof RuleEffect)[]).forEach((k) => {
      if (next[k] === undefined || next[k] === '' || next[k] === false) delete next[k];
    });
    setEffect(next);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const p = pattern.trim().toLowerCase().replace(/^@/, '');
    if (!p) return setError('Enter the ' + KIND_LABELS[kind].toLowerCase() + '.');
    if (kind === 'sender' && !isEmail(p))
      return setError('Enter a full email address, such as name@client.com.');
    if (kind === 'domain' && !DOMAIN.test(p)) return setError('Enter a domain, such as client.com.');
    if (kind === 'subject' && p.length < 3) return setError('Enter a phrase of at least 3 characters.');
    if (!Object.keys(effect).length) return setError('Choose at least one effect.');
    setBusy(true);
    setError('');
    try {
      onSaved(
        await mail('rules.save', {
          rule: { ...(rule ? { id: rule.id } : {}), kind, pattern: p, effect, status: 'active' },
        }),
      );
    } catch (e2) {
      setError(errorMessage(e2));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={rule ? 'Edit rule' : 'Add a rule'}
      subtitle="Applies to new email from now on."
      onClose={onClose}
      footer={
        <div className="wf-row wf-between">
          <button type="button" className="button ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="mail-rule-form" className="button primary" disabled={busy}>
            {busy ? 'Saving' : 'Save rule'}
          </button>
        </div>
      }
    >
      <form id="mail-rule-form" onSubmit={submit} noValidate>
        <div className="wf-field">
          <span>Match on</span>
          <Chips
            label="Match on"
            value={kind}
            onChange={setKind}
            options={(Object.keys(KIND_LABELS) as MailRule['kind'][]).map((k) => ({
              id: k,
              label: KIND_LABELS[k],
            }))}
          />
        </div>
        <Field
          label={KIND_LABELS[kind]}
          hint={
            kind === 'sender'
              ? 'The full email address.'
              : kind === 'domain'
                ? 'Everything after the @, such as client.com.'
                : 'Matches when the subject contains this phrase.'
          }
        >
          <input
            value={pattern}
            maxLength={200}
            inputMode={kind === 'subject' ? 'text' : 'email'}
            autoComplete="off"
            onChange={(e) => setPattern(e.target.value)}
          />
        </Field>
        <h3 className="wf-h4">Effects</h3>
        <div className="wf-grid two">
          <Field label="Priority">
            <select
              value={effect.tier ?? ''}
              onChange={(e) => set({ tier: e.target.value ? (Number(e.target.value) as Tier) : undefined })}
            >
              <option value="">No change</option>
              {TIERS.map((t) => (
                <option key={t} value={t}>
                  {TIER_LABELS[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Category">
            <select
              value={effect.category ?? ''}
              onChange={(e) => set({ category: (e.target.value || undefined) as RuleEffect['category'] })}
            >
              <option value="">No change</option>
              {CATEGORIES.filter((c) => c !== 'unknown').map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Handling">
            <select
              value={effect.handling ?? ''}
              onChange={(e) => set({ handling: (e.target.value || undefined) as RuleEffect['handling'] })}
            >
              <option value="">No change</option>
              {HANDLING.filter((h) => h !== 'uncertain').map((h) => (
                <option key={h} value={h}>
                  {HANDLING_LABELS[h]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Mandate">
            <select
              value={effect.matterId ?? ''}
              onChange={(e) => set({ matterId: e.target.value || undefined })}
            >
              <option value="">No change</option>
              {effect.matterId && !targets.some((t) => t.matterId === effect.matterId) && (
                <option value={effect.matterId}>Linked mandate</option>
              )}
              {targets.map((m) => (
                <option key={m.matterId} value={m.matterId}>
                  {m.clientName ? m.clientName + ': ' : ''}
                  {m.title}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Toggle pressed={!!effect.neverAi} onChange={(v) => set({ neverAi: v })}>
          Never send to AI (for confidential senders; triaged by rules only)
        </Toggle>
        <Toggle pressed={!!effect.vip} onChange={(v) => set({ vip: v })}>
          VIP (never archived, at least Important, marked with a star)
        </Toggle>
        {error && (
          <p className="wf-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
