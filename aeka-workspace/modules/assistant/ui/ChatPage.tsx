'use client';
// Ask Aeka: conversations, messages with the actions taken, and a composer. A reply can take up to a
// minute; while it runs, sending is disabled but the conversation stays readable.
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  Check,
  ChevronRight,
  List,
  MessageSquarePlus,
  MessageSquareText,
  Pencil,
  RotateCcw,
  SendHorizontal,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { assistant } from '../shared/client';
import type { ChatMessage, Conversation, ToolNote } from '../shared/types';
import { Modal } from '../../workflow/ui/components/Modal';
import { ConfirmButton } from '../../workflow/ui/components/ConfirmButton';
import { clearAsk, peekAsk, useAssistant } from './context';
import { InlineError, LoadError, Loading, RichText } from './Bits';
import { errorMessage, errorStatus, formatAgo, formatClock, useLoad, useMedia } from './lib';

const SUGGESTIONS = [
  'What needs me today?',
  'Remind me to call Rahul at 4 pm',
  'Draft a reply to the latest email from Vista Earth',
  "What did we agree in yesterday's meeting?",
];
const STORE_KEY = 'aeka-assistant-chat';
const MAX_TEXT = 4000;

type Thread =
  | { phase: 'new' }
  | { phase: 'loading'; id: string }
  | { phase: 'error'; id: string; error: string }
  | { phase: 'ready'; conversation: Conversation; messages: ChatMessage[] };

interface Pending {
  convId: string | null; // null while starting a new conversation
  text: string;
  startedAt: number;
  error: string;
}

const readStored = () => {
  try {
    return sessionStorage.getItem(STORE_KEY);
  } catch {
    return null;
  }
};
const store = (id: string | null) => {
  try {
    if (id) sessionStorage.setItem(STORE_KEY, id);
    else sessionStorage.removeItem(STORE_KEY);
  } catch {}
};
const threadId = (t: Thread) => (t.phase === 'ready' ? t.conversation.id : t.phase === 'new' ? null : t.id);

function ToolChips({ tools }: { tools: ToolNote[] }) {
  const { open } = useAssistant();
  if (!tools.length) return null;
  return (
    <ul className="as-tools" aria-label="Actions taken">
      {tools.map((t, i) => {
        const icon = t.ok ? (
          <Check size={13} aria-hidden="true" />
        ) : (
          <TriangleAlert size={13} aria-hidden="true" />
        );
        const label = (
          <>
            {icon}
            <span>{t.summary || t.name}</span>
            {!t.ok && <span className="wf-sr">(did not complete)</span>}
          </>
        );
        return (
          <li key={i}>
            {t.ref ? (
              <button
                type="button"
                className={'as-tool' + (t.ok ? '' : ' failed')}
                onClick={() => open(t.ref!)}
              >
                {label}
                <ChevronRight size={13} aria-hidden="true" />
              </button>
            ) : (
              <span className={'as-tool' + (t.ok ? '' : ' failed')}>{label}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Message({ m }: { m: ChatMessage }) {
  if (m.role === 'notice')
    return (
      <li className="as-msg notice">
        <p>{m.content}</p>
      </li>
    );
  const mine = m.role === 'user';
  return (
    <li className={'as-msg ' + (mine ? 'user' : 'assistant')}>
      {!mine && (
        <span className="as-avatar" aria-hidden="true">
          A
        </span>
      )}
      <div className="as-msg-body">
        <span className="wf-sr">{mine ? 'You said' : 'Aeka replied'}</span>
        <div className="as-bubble">
          {mine ? <p className="wf-pre">{m.content}</p> : <RichText text={m.content} />}
        </div>
        {!mine && <ToolChips tools={m.tools} />}
        <time className="as-msg-time" dateTime={new Date(m.createdAt).toISOString()}>
          {formatClock(m.createdAt)}
        </time>
      </div>
    </li>
  );
}

function Working({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(startedAt);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const secs = Math.max(0, Math.round((now - startedAt) / 1000));
  return (
    <li className="as-msg assistant">
      <span className="as-avatar" aria-hidden="true">
        A
      </span>
      <div className="as-msg-body">
        <div className="as-bubble as-working" role="status">
          <span className="as-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>{secs < 8 ? 'Working' : 'Working. This can take up to a minute.'}</span>
        </div>
      </div>
    </li>
  );
}

function ConversationList({
  items,
  current,
  busyId,
  onSelect,
  onNew,
}: {
  items: Conversation[];
  current: string | null;
  busyId: string | null | undefined;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <div className="as-convs">
      <button type="button" className="button primary as-new" onClick={onNew} aria-pressed={current === null}>
        <MessageSquarePlus size={15} aria-hidden="true" /> New chat
      </button>
      {items.length === 0 ? (
        <p className="as-quiet small">Your conversations will be listed here.</p>
      ) : (
        <ul aria-label="Conversations">
          {items.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className={'as-conv' + (c.id === current ? ' active' : '')}
                aria-current={c.id === current ? 'true' : undefined}
                onClick={() => onSelect(c.id)}
              >
                <span className="as-conv-title">{c.title || 'Untitled conversation'}</span>
                <span className="as-conv-meta">
                  {c.channel === 'whatsapp' && <span className="as-tag">WhatsApp</span>}
                  {busyId === c.id ? 'Working' : formatAgo(c.updatedAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ChatPage() {
  const { notify } = useAssistant();
  const phone = useMedia('(max-width: 760px)');
  const convs = useLoad(() => assistant('chat.list', {}));
  const [thread, setThread] = useState<Thread>(() => {
    const id = peekAsk() ? null : readStored();
    return id ? { phase: 'loading', id } : { phase: 'new' };
  });
  const [pending, setPending] = useState<Pending | null>(null);
  const [text, setText] = useState('');
  const [drawer, setDrawer] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameError, setRenameError] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // The conversation on screen, for replies that arrive after the member moved elsewhere.
  const viewing = useRef<string | null>(threadId(thread));
  const loadSeq = useRef(0);

  const currentId = threadId(thread);
  const busy = !!pending && !pending.error;

  const load = (id: string) => {
    const n = ++loadSeq.current;
    assistant('chat.get', { id }).then(
      (r) => {
        if (n === loadSeq.current) setThread({ phase: 'ready', ...r });
      },
      (e: unknown) => {
        if (n !== loadSeq.current) return;
        if (errorStatus(e) === 404 && !/unknown workspace action/i.test(errorMessage(e))) {
          store(null);
          viewing.current = null;
          setThread({ phase: 'new' });
        } else setThread({ phase: 'error', id, error: errorMessage(e) });
      },
    );
  };

  const select = (id: string | null) => {
    setDrawer(false);
    setRenaming(null);
    store(id);
    viewing.current = id;
    loadSeq.current++;
    if (!id) {
      setThread({ phase: 'new' });
      queueMicrotask(() => inputRef.current?.focus());
      return;
    }
    setThread({ phase: 'loading', id });
    load(id);
  };

  // Load the remembered conversation once.
  useEffect(() => {
    const id = threadId(thread);
    if (thread.phase === 'loading' && id) load(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const upsertConv = (c: Conversation) => convs.set((list) => [c, ...list.filter((x) => x.id !== c.id)]);

  const send = (raw: string, convId: string | null) => {
    const body = raw.trim().slice(0, MAX_TEXT);
    if (!body) return;
    setPending({ convId, text: body, startedAt: Date.now(), error: '' });
    setText('');
    if (inputRef.current) inputRef.current.style.height = '';
    assistant('chat.send', convId ? { conversationId: convId, text: body } : { text: body }).then(
      (r) => {
        setPending(null);
        upsertConv(r.conversation);
        if (viewing.current === convId) {
          viewing.current = r.conversation.id;
          store(r.conversation.id);
          setThread((t) => ({
            phase: 'ready',
            conversation: r.conversation,
            messages: [...(t.phase === 'ready' ? t.messages : []), ...r.messages],
          }));
        } else notify(`Aeka replied in "${r.conversation.title || 'a conversation'}".`);
      },
      (e: unknown) => setPending((p) => (p ? { ...p, error: errorMessage(e) } : p)),
    );
  };

  // A question typed on Today starts a new conversation.
  useEffect(() => {
    const q = peekAsk();
    if (!q) return;
    clearAsk();
    queueMicrotask(() => send(q, null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const messages = thread.phase === 'ready' ? thread.messages : [];
  const showPending = !!pending && pending.convId === currentId;
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [messages.length, showPending, pending?.error]);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (busy || !text.trim()) return;
    send(text, currentId);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };
  const grow = (el: HTMLTextAreaElement) => {
    el.style.height = '';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  };

  const rename = async (c: Conversation, title: string) => {
    const t = title.trim();
    if (!t || t === c.title) return setRenaming(null);
    try {
      const saved = await assistant('chat.rename', { id: c.id, title: t.slice(0, 120) });
      upsertConv(saved);
      setThread((th) =>
        th.phase === 'ready' && th.conversation.id === c.id ? { ...th, conversation: saved } : th,
      );
      setRenaming(null);
      setRenameError('');
    } catch (e) {
      setRenameError(errorMessage(e));
    }
  };
  const remove = async (c: Conversation) => {
    try {
      await assistant('chat.delete', { id: c.id });
      convs.set((list) => list.filter((x) => x.id !== c.id));
      notify('Conversation deleted');
      select(null);
    } catch (e) {
      notify(errorMessage(e));
    }
  };

  const list = convs.data ?? [];
  const busyId = pending && !pending.error ? pending.convId : undefined;
  const listPane =
    convs.phase === 'loading' ? (
      <Loading>Loading conversations</Loading>
    ) : convs.phase === 'error' ? (
      <InlineError message={convs.error} onRetry={convs.retry} />
    ) : (
      <ConversationList
        items={list}
        current={currentId}
        busyId={busyId}
        onSelect={select}
        onNew={() => select(null)}
      />
    );

  const conv = thread.phase === 'ready' ? thread.conversation : null;
  const title = conv?.title || (thread.phase === 'new' ? 'New chat' : 'Conversation');

  return (
    <div className="as-chat">
      {!phone && <aside className="as-chat-side">{listPane}</aside>}
      {phone && drawer && (
        <Modal title="Conversations" variant="drawer" onClose={() => setDrawer(false)}>
          {listPane}
        </Modal>
      )}
      <section className="as-chat-main" aria-label={title}>
        <header className="as-chat-head">
          {phone && (
            <button
              type="button"
              className="wf-icon-btn as-tap"
              aria-label="Show conversations"
              onClick={() => setDrawer(true)}
            >
              <List size={18} />
            </button>
          )}
          {conv && renaming === conv.id ? (
            <form
              className="as-rename"
              onSubmit={(e) => {
                e.preventDefault();
                void rename(conv, new FormData(e.currentTarget).get('title') as string);
              }}
            >
              <label htmlFor="as-rename-input" className="wf-sr">
                Conversation name
              </label>
              <input
                id="as-rename-input"
                name="title"
                className="wf-input"
                defaultValue={conv.title}
                maxLength={120}
                autoFocus
              />
              <button type="submit" className="button primary small">
                Save
              </button>
              <button type="button" className="button ghost small" onClick={() => setRenaming(null)}>
                Cancel
              </button>
            </form>
          ) : (
            <h2 className="as-chat-title">{title}</h2>
          )}
          {conv && renaming !== conv.id && (
            <div className="as-chat-actions">
              <button
                type="button"
                className="wf-icon-btn as-tap"
                aria-label="Rename conversation"
                onClick={() => {
                  setRenameError('');
                  setRenaming(conv.id);
                }}
              >
                <Pencil size={16} />
              </button>
              <ConfirmButton
                className="wf-icon-btn as-tap"
                ariaLabel="Delete conversation"
                question="Delete this conversation?"
                onConfirm={() => remove(conv)}
              >
                <Trash2 size={16} />
              </ConfirmButton>
            </div>
          )}
          {phone && thread.phase !== 'new' && (
            <button
              type="button"
              className="wf-icon-btn as-tap"
              aria-label="New chat"
              onClick={() => select(null)}
            >
              <MessageSquarePlus size={18} />
            </button>
          )}
        </header>
        <InlineError message={renameError} />

        <div className="as-thread">
          {thread.phase === 'loading' && <Loading>Loading the conversation</Loading>}
          {thread.phase === 'error' && (
            <LoadError
              title="This conversation could not be loaded"
              message={thread.error}
              onRetry={() => select(thread.id)}
            />
          )}
          {thread.phase === 'new' && !showPending && (
            <div className="as-hello">
              <MessageSquareText size={28} aria-hidden="true" />
              <h3>How can I help?</h3>
              <p>
                Ask about your mail, tasks, deadlines and notes, or ask for a reminder, a to-do or a draft
                reply. Anything it creates is listed under the reply for you to check.
              </p>
              <div className="as-suggestions" role="group" aria-label="Suggestions">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="as-suggestion"
                    onClick={() => {
                      setText(s);
                      queueMicrotask(() => inputRef.current?.focus());
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {thread.phase === 'ready' && messages.length === 0 && !showPending && (
            <p className="as-quiet">No messages yet.</p>
          )}
          <ol className="as-messages" aria-live="polite" aria-relevant="additions">
            {messages.map((m) => (
              <Message key={m.id} m={m} />
            ))}
            {showPending && (
              <li className="as-msg user pending">
                <div className="as-msg-body">
                  <span className="wf-sr">You said</span>
                  <div className="as-bubble">
                    <p className="wf-pre">{pending!.text}</p>
                  </div>
                </div>
              </li>
            )}
            {showPending && !pending!.error && <Working startedAt={pending!.startedAt} />}
          </ol>
          {showPending && pending!.error && (
            <div className="as-send-error" role="alert">
              <p>
                <TriangleAlert size={15} aria-hidden="true" /> {pending!.error}
              </p>
              <div className="wf-row wf-wrap">
                <button
                  type="button"
                  className="button primary small"
                  onClick={() => send(pending!.text, pending!.convId)}
                >
                  <RotateCcw size={14} aria-hidden="true" /> Try again
                </button>
                <button
                  type="button"
                  className="button ghost small"
                  onClick={() => {
                    setText(pending!.text);
                    setPending(null);
                    queueMicrotask(() => inputRef.current?.focus());
                  }}
                >
                  Edit message
                </button>
              </div>
            </div>
          )}
          <div ref={endRef} className="as-end" />
        </div>

        <form className="as-composer" onSubmit={submit}>
          <label htmlFor="as-composer-input" className="wf-sr">
            Message Aeka
          </label>
          <textarea
            id="as-composer-input"
            ref={inputRef}
            rows={1}
            value={text}
            maxLength={MAX_TEXT}
            placeholder={busy ? 'Aeka is working on your last message' : 'Ask Aeka'}
            onChange={(e) => {
              setText(e.target.value);
              grow(e.target);
            }}
            onKeyDown={onKey}
            aria-describedby="as-composer-hint"
          />
          <button
            type="submit"
            className="button primary as-send"
            disabled={busy || !text.trim()}
            aria-label="Send"
          >
            <SendHorizontal size={17} aria-hidden="true" />
          </button>
          <p id="as-composer-hint" className="as-composer-hint">
            {busy
              ? 'Working on your message. You can keep reading.'
              : 'Enter to send, Shift and Enter for a new line.'}
          </p>
        </form>
      </section>
    </div>
  );
}
