'use client';
// Form inputs: money (rupees in, paise out), dates (YYYY-MM-DD), hours (0.25 steps, minutes out).
import { useState, type ReactNode } from 'react';

const toText = (paise: number | null) => (paise == null ? '' : String(paise / 100));
// null for empty, NaN for text that is not an amount.
const parseRupees = (text: string) => {
  const t = text.replace(/[,₹\s]/g, '');
  if (!t) return null;
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return NaN;
  return Math.round(Number(t) * 100);
};

export function MoneyInput({
  value,
  onChange,
  label,
  hideLabel,
  disabled,
  required,
}: {
  value: number | null;
  onChange: (paise: number | null) => void;
  label: string;
  hideLabel?: boolean;
  disabled?: boolean;
  required?: boolean;
}) {
  const [text, setText] = useState(() => toText(value));
  const parsed = parseRupees(text);
  // Follow the value when it changes from outside (for example after a save or a reload).
  const shown = Number.isNaN(parsed) || parsed === value ? text : toText(value);
  const input = (
    <span className="wf-money">
      <span aria-hidden="true">₹</span>
      <input
        inputMode="decimal"
        value={shown}
        disabled={disabled}
        required={required}
        aria-label={hideLabel ? label + ' in rupees' : undefined}
        aria-invalid={Number.isNaN(parseRupees(shown)) || undefined}
        placeholder="0"
        onChange={(e) => {
          setText(e.target.value);
          const p = parseRupees(e.target.value);
          if (!Number.isNaN(p)) onChange(p);
        }}
      />
    </span>
  );
  if (hideLabel) return input;
  return (
    <label className="wf-field">
      <span>{label} (₹)</span>
      {input}
      {Number.isNaN(parseRupees(shown)) && <small className="wf-error">Enter an amount in rupees.</small>}
    </label>
  );
}

export function DateInput({
  value,
  onChange,
  label,
  hideLabel,
  required,
  disabled,
  min,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  label: string;
  hideLabel?: boolean;
  required?: boolean;
  disabled?: boolean;
  min?: string;
}) {
  const input = (
    <input
      type="date"
      value={value ?? ''}
      min={min}
      required={required}
      disabled={disabled}
      aria-label={hideLabel ? label : undefined}
      onChange={(e) => onChange(e.target.value || null)}
    />
  );
  if (hideLabel) return input;
  return (
    <label className="wf-field">
      <span>{label}</span>
      {input}
    </label>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="wf-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
