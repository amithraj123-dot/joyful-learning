// One-shot hand-over between modules: a module leaves what the next page should open (for example a
// mandate, or a note), then navigates; the receiving module takes it once.
const pending = new Map<string, unknown>();

export interface Handovers {
  'workflow.matter': { matterId: string; tab?: string };
  'scribe.note': { noteId: string };
  'mail.item': { itemId: string };
  'chats.thread': { threadId: string };
}

export function handOver<K extends keyof Handovers>(key: K, value: Handovers[K]) {
  pending.set(key, value);
}

// Reads without taking, so it is safe in a React state initialiser; call clear() once received.
export const peek = <K extends keyof Handovers>(key: K) => pending.get(key) as Handovers[K] | undefined;
export const clear = (key: keyof Handovers) => void pending.delete(key);

// Leaves the hand-over for a notification link ("<page id>#<record id>") and returns the page id.
export function handOverLink(link: string) {
  const [page, ref] = link.split('#');
  if (ref && page.startsWith('chats/')) handOver('chats.thread', { threadId: ref });
  if (ref && page.startsWith('mail/')) handOver('mail.item', { itemId: ref });
  if (ref && page === 'workflow/matters') handOver('workflow.matter', { matterId: ref });
  if (ref && (page === 'notes' || page === 'meetings')) handOver('scribe.note', { noteId: ref });
  return page;
}
