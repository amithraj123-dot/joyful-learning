'use client';
// Two-step button for destructive actions: the first press asks, the second confirms.
import { useState, type ReactNode } from 'react';

export function ConfirmButton({
  children,
  onConfirm,
  question = 'Are you sure?',
  confirmLabel = 'Delete',
  className = 'button danger',
  disabled,
  ariaLabel,
}: {
  children: ReactNode;
  onConfirm: () => void | Promise<unknown>;
  question?: string;
  confirmLabel?: string;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!asking)
    return (
      <button
        type="button"
        className={className}
        disabled={disabled}
        aria-label={ariaLabel}
        onClick={() => setAsking(true)}
      >
        {children}
      </button>
    );
  return (
    <span className="wf-confirm" role="group" aria-label={question}>
      <span>{question}</span>
      <button
        type="button"
        className="button danger small"
        autoFocus
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onConfirm();
          } finally {
            setBusy(false);
            setAsking(false);
          }
        }}
      >
        {confirmLabel}
      </button>
      <button type="button" className="button ghost small" onClick={() => setAsking(false)}>
        Cancel
      </button>
    </span>
  );
}
