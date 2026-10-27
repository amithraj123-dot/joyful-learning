'use client';
// A small "More actions" disclosure: a button that shows a short list of actions below it. Esc or a tap
// outside closes it; arrow keys move between the actions.
import { useEffect, useId, useRef, useState } from 'react';
import { Ellipsis, type LucideIcon } from 'lucide-react';

export interface MenuItem {
  label: string;
  icon?: LucideIcon;
  onSelect?: () => void;
  href?: string; // opens in a new tab
  disabled?: boolean;
}

export function MoreMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const list = () => [...(wrap.current?.querySelectorAll<HTMLElement>('.mail-menu-item') ?? [])];
    list()[0]?.focus();
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        button.current?.focus();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const all = list();
        const at = all.indexOf(document.activeElement as HTMLElement);
        const next = (at + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length;
        e.preventDefault();
        all[next]?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    const node = wrap.current;
    node?.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      node?.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const shown = items.filter((i) => i.onSelect || i.href);
  if (!shown.length) return null;
  return (
    <div className="mail-menu" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="mail-menu-btn"
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        title="More actions"
        onClick={() => setOpen((o) => !o)}
      >
        <Ellipsis size={18} aria-hidden="true" />
      </button>
      {open && (
        <div className="mail-menu-pop" id={id} role="group" aria-label={label}>
          {shown.map((i) => {
            const Icon = i.icon;
            const inner = (
              <>
                {Icon && <Icon size={15} aria-hidden="true" />}
                {i.label}
              </>
            );
            return i.href ? (
              <a
                key={i.label}
                className="mail-menu-item"
                href={i.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
              >
                {inner}
              </a>
            ) : (
              <button
                key={i.label}
                type="button"
                className="mail-menu-item"
                disabled={i.disabled}
                onClick={() => {
                  setOpen(false);
                  button.current?.focus();
                  i.onSelect?.();
                }}
              >
                {inner}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
