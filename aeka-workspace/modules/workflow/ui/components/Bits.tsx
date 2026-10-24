'use client';
// Small shared pieces: status pill, empty state, tabs, chips and a dirty-state indicator.
import { useRef, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

type Tone = 'red' | 'amber' | 'green' | 'grey' | 'blue' | 'tint';
const TONES: Record<string, Tone> = {
  // mandate status
  active: 'blue',
  urgent: 'red',
  on_hold: 'amber',
  closed: 'grey',
  // task status
  'Awaiting Data': 'amber',
  Preparing: 'blue',
  'In Review': 'tint',
  'Sent to Client': 'green',
  Completed: 'green',
  'On Hold': 'grey',
  // EL and invoices
  'Not Started': 'grey',
  Drafting: 'amber',
  'Sent for Signature': 'blue',
  'Fully Executed': 'green',
  'Not Invoiced': 'grey',
  'Partially Invoiced': 'amber',
  Invoiced: 'blue',
  Paid: 'green',
  'Written Off': 'red',
  // deal documents
  'Draft Pending': 'amber',
  'Comments Shared': 'tint',
  Finalised: 'blue',
  Executed: 'green',
  'Not Applicable': 'grey',
  overdue: 'red',
};

export function StatusPill({ value, label, tone }: { value: string; label?: string; tone?: Tone }) {
  return <span className={'wf-pill ' + (tone ?? TONES[value] ?? 'grey')}>{label ?? value}</span>;
}

export function Empty({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state wf-empty">
      {Icon && <Icon size={30} aria-hidden="true" />}
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: { id: T; label: string; count?: number }[];
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (i: number) => {
    const n = (i + tabs.length) % tabs.length;
    onChange(tabs[n].id);
    refs.current[n]?.focus();
  };
  return (
    <div className="wf-tabs" role="tablist" aria-label={label}>
      {tabs.map((t, i) => (
        <button
          key={t.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="tab"
          id={'wf-tab-' + t.id}
          aria-selected={value === t.id}
          tabIndex={value === t.id ? 0 : -1}
          className={value === t.id ? 'active' : ''}
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') move(i + 1);
            if (e.key === 'ArrowLeft') move(i - 1);
            if (e.key === 'Home') move(0);
            if (e.key === 'End') move(tabs.length - 1);
          }}
        >
          {t.label}
          {t.count != null && <span className="wf-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div role="tabpanel" aria-labelledby={'wf-tab-' + id} className="wf-tabpanel">
      {children}
    </div>
  );
}

export function Chips<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { id: T; label: string; count?: number }[];
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <div className="wf-chips" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          className={'wf-chip' + (value === o.id ? ' active' : '')}
          onClick={() => onChange(o.id)}
        >
          {o.label}
          {o.count != null && <span className="wf-count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Dirty({ dirty }: { dirty: boolean }) {
  return (
    <span className={'wf-dirty' + (dirty ? ' on' : '')} aria-live="polite">
      {dirty ? 'Unsaved changes' : 'All changes saved'}
    </span>
  );
}

export function Toggle({
  pressed,
  onChange,
  children,
  disabled,
  label,
}: {
  pressed: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      className={'wf-toggle' + (pressed ? ' on' : '')}
      aria-pressed={pressed}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!pressed)}
    >
      <span className="wf-toggle-track" aria-hidden="true">
        <span />
      </span>
      {children}
    </button>
  );
}

export function TableWrap({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="wf-table-wrap" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}
