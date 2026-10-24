'use client';
// Dialog with focus on open, a focus trap, Esc to close and focus returned to the opener on close.
// variant "drawer" slides in from the right and becomes full width on phones.
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  variant = 'dialog',
  wide,
  onKeyDown,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  variant?: 'dialog' | 'drawer';
  wide?: boolean;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const first =
      node?.querySelector<HTMLElement>('[data-autofocus]') ??
      node?.querySelector<HTMLElement>('.wf-modal-body ' + FOCUSABLE.split(', ').join(', .wf-modal-body '));
    (first ?? node)?.focus();
    return () => opener?.focus?.();
  }, []);
  const keydown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === 'Tab' && ref.current) {
      const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null,
      );
      if (!items.length) return;
      const first = items[0],
        last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    onKeyDown?.(e);
  };
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className={'wf-overlay ' + variant} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
        className={'wf-modal ' + variant + (wide ? ' wide' : '')}
        onKeyDown={keydown}
      >
        <div className="wf-modal-head">
          <div>
            <h2 id={id}>{title}</h2>
            {subtitle && <p className="wf-caption">{subtitle}</p>}
          </div>
          <button type="button" className="wf-icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="wf-modal-body">{children}</div>
        {footer && <div className="wf-modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
