'use client';
// VIPs: people and domains whose mail is never archived and is at least Important. Stored as rules with
// the effect `vip`, so they sit with the member's other rules.
import { useState, type FormEvent } from 'react';
import { Star } from 'lucide-react';
import { Field } from '../../workflow/ui/components/Inputs';
import type { MailRule } from '../shared/types';
import { clearVip, isVipRule, markVip, onlyVip } from './actions';
import { errorMessage, isEmail } from './lib';
import { useMail } from './store';

export const DOMAIN = /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i;
// Shared by many unrelated people: a VIP there must be a person.
const PUBLIC =
  /^(gmail|googlemail|yahoo|ymail|outlook|hotmail|live|msn|icloud|me|aol|proton|protonmail|rediffmail|zoho)\.[a-z.]+$/i;

export function VipCard({
  rules,
  effects,
  onSaved,
  onRemoved,
}: {
  rules: MailRule[];
  effects: (r: MailRule) => string[];
  onSaved: (r: MailRule) => void;
  onRemoved: (id: string, rest: MailRule | null) => void;
}) {
  const { notify } = useMail();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const vips = rules.filter(isVipRule).sort((a, b) => a.pattern.localeCompare(b.pattern));

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const p = value.trim().toLowerCase().replace(/^@/, '');
    const kind = p.includes('@') ? 'sender' : 'domain';
    if (!p) return setError('Enter an email address or a domain.');
    if (kind === 'sender' && !isEmail(p))
      return setError('Enter a full email address, such as name@client.com.');
    if (kind === 'domain' && !DOMAIN.test(p)) return setError('Enter a domain, such as client.com.');
    if (kind === 'domain' && PUBLIC.test(p))
      return setError(`Many unrelated people use ${p}. Add the person's full address instead.`);
    setBusy('add');
    setError('');
    try {
      const saved = await markVip(kind, p, rules);
      onSaved(saved);
      setValue('');
      notify(kind === 'sender' ? `${p} is now a VIP` : `Everyone at ${p} is now a VIP`);
    } catch (e2) {
      setError(errorMessage(e2));
    } finally {
      setBusy('');
    }
  };
  const remove = async (r: MailRule) => {
    setBusy(r.id);
    setError('');
    try {
      onRemoved(r.id, await clearVip(r));
      notify(`${r.pattern} is no longer a VIP`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="card wf-section" aria-labelledby="mail-vip-h">
      <h2 id="mail-vip-h">VIPs ({vips.length})</h2>
      <p className="wf-caption">
        Mail from a VIP is never archived, is at least Important and is marked with a star. Being a VIP alone
        never makes an email Urgent.
      </p>
      <form className="mail-vip-form" onSubmit={add} noValidate>
        <Field label="Add a person or a domain">
          <input
            value={value}
            maxLength={200}
            inputMode="email"
            autoComplete="off"
            placeholder="name@client.com or client.com"
            onChange={(e) => {
              setValue(e.target.value);
              setError('');
            }}
          />
        </Field>
        <button type="submit" className="button primary" disabled={busy === 'add'}>
          <Star size={15} aria-hidden="true" /> {busy === 'add' ? 'Adding' : 'Add VIP'}
        </button>
      </form>
      {error && (
        <p className="wf-error" role="alert">
          {error}
        </p>
      )}
      {vips.length ? (
        <ul className="mail-rule-list">
          {vips.map((r) => {
            const other = onlyVip(r.effect) ? [] : effects(r).filter((x) => x !== 'VIP');
            return (
              <li key={r.id} className="mail-rule">
                <div className="mail-rule-text">
                  <strong className="mail-vip-name">
                    <Star size={14} aria-hidden="true" className="mail-vip-star" /> {r.pattern}
                  </strong>
                  <span className="wf-caption">
                    {r.kind === 'sender' ? 'Person' : 'Everyone at this domain'}
                    {other.length ? `. Also sets ${other.join(', ')}.` : ''}
                  </span>
                </div>
                <div className="mail-rule-actions">
                  <button
                    type="button"
                    className="button secondary small"
                    disabled={busy === r.id}
                    onClick={() => remove(r)}
                    aria-label={`Remove ${r.pattern} from VIPs`}
                  >
                    {busy === r.id ? 'Removing' : 'Remove'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="wf-caption mail-vip-empty">
          No VIPs yet. Add the clients and counterparts who matter most, or choose Mark sender as VIP on an
          email.
        </p>
      )}
    </section>
  );
}
