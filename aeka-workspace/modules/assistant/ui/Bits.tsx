'use client';
// Small Assistant pieces: loading and error states, card sections and plain-text rendering.
import type { ReactNode } from 'react';
import { CircleUserRound, TriangleAlert } from 'lucide-react';
import { Empty } from '../../workflow/ui/components/Bits';

export function Loading({ children }: { children: ReactNode }) {
  return (
    <div className="as-loading" role="status">
      <span className="as-spinner" aria-hidden="true" />
      {children}
    </div>
  );
}

export function LoadError({
  title,
  message,
  status,
  onRetry,
}: {
  title: string;
  message: string;
  status?: number;
  onRetry: () => void;
}) {
  if (status === 403 && /not a member/i.test(message))
    return (
      <Empty icon={CircleUserRound} title="Access has not been granted yet">
        {message}
      </Empty>
    );
  return (
    <Empty
      icon={TriangleAlert}
      title={title}
      action={
        <button type="button" className="button primary" onClick={onRetry}>
          Try again
        </button>
      }
    >
      {message}
    </Empty>
  );
}

// Inline error under a control or a list, with an optional retry.
export function InlineError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  if (!message) return null;
  return (
    <p className="as-inline-error" role="alert">
      <TriangleAlert size={14} aria-hidden="true" />
      <span>{message}</span>
      {onRetry && (
        <button type="button" className="wf-link" onClick={onRetry}>
          Try again
        </button>
      )}
    </p>
  );
}

export function Card({
  title,
  count,
  action,
  children,
  className = '',
  id,
}: {
  title: ReactNode;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section className={'card as-card ' + className} aria-labelledby={id}>
      <div className="as-card-head">
        <h2 id={id}>
          {title}
          {count != null && <span className="as-count">{count}</span>}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

// Assistant replies may use light Markdown: paragraphs, "-" or "1." lists and **bold**. Rendered as
// React elements, so nothing in the text is ever treated as HTML.
function inline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**') && p.length > 4 ? <strong key={i}>{p.slice(2, -2)}</strong> : p,
  );
}
export function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push(<p key={blocks.length}>{inline(para.join('\n'))}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{inline(it)}</li>);
    blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const number = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || number) {
      flushPara();
      const ordered = !!number;
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push((bullet ?? number)![1]);
    } else if (!line.trim()) {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line.replace(/^#{1,6}\s+/, ''));
    }
  }
  flushPara();
  flushList();
  return <div className="as-rich">{blocks}</div>;
}
