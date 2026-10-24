'use client';
// Form inputs: money (rupees in, paise out), dates (YYYY-MM-DD), hours (0.25 steps, minutes out).
import { cloneElement, isValidElement, useId, useState, type ReactElement, type ReactNode } from 'react';

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
  const id = useId();
  const [text, setText] = useState(() => toText(value));
  const parsed = parseRupees(text);
  // Follow the value when it changes from outside (for example after a save or a reload).
  const shown = Number.isNaN(parsed) || parsed === value ? text : toText(value);
  const input = (
    <span className="wf-money">
      <span aria-hidden="true">₹</span>
      <input
        id={id}
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
    <div className="wf-field">
      <label htmlFor={id}>{label} (₹)</label>
      {input}
      {Number.isNaN(parseRupees(shown)) && <small className="wf-error">Enter an amount in rupees.</small>}
    </div>
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
  max,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  label: string;
  hideLabel?: boolean;
  required?: boolean;
  disabled?: boolean;
  min?: string;
  max?: string;
}) {
  const id = useId();
  const input = (
    <input
      id={id}
      type="date"
      value={value ?? ''}
      min={min}
      max={max}
      required={required}
      disabled={disabled}
      aria-label={hideLabel ? label : undefined}
      onChange={(e) => onChange(e.target.value || null)}
    />
  );
  if (hideLabel) return input;
  return (
    <div className="wf-field">
      <label htmlFor={id}>{label}</label>
      {input}
    </div>
  );
}

// A labelled control: the label is tied to the single child control by id, so the control's name is the
// label alone (a wrapping label would also read out a select's options).
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  const generated = useId();
  const hintId = generated + '-hint';
  if (!isValidElement(children))
    return (
      <div className="wf-field">
        <span>{label}</span>
        {children}
        {hint && <small>{hint}</small>}
      </div>
    );
  const child = children as ReactElement<{ id?: string; 'aria-describedby'?: string }>;
  const id = child.props.id ?? generated;
  return (
    <div className="wf-field">
      <label htmlFor={id}>{label}</label>
      {cloneElement(child, { id, ...(hint ? { 'aria-describedby': hintId } : {}) })}
      {hint && <small id={hintId}>{hint}</small>}
    </div>
  );
}
