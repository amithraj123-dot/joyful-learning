'use client';
// Shared state for the Assistant pages: the signed-in member, background tick and link opening.
import { createContext, useContext, useEffect, useRef } from 'react';
import type { MeInfo } from './lib';

export interface AssistantCtx {
  me: MeInfo | null;
  notify: (message: string) => void;
  navigate: (page: string) => void;
  // Opens a stored link ("page" or "page#id") in the right module.
  open: (link: string) => void;
  // Runs core tick (or joins the one in flight); never rejects.
  tick: () => Promise<void>;
  // Increases after each tick, so pages can refresh what background work may have changed.
  tickCount: number;
}

export const Ctx = createContext<AssistantCtx | null>(null);

export function useAssistant() {
  const c = useContext(Ctx);
  if (!c) throw new Error('Assistant context is missing.');
  return c;
}

// A question typed on Today, sent when Ask Aeka opens (read once).
let pendingAsk: string | null = null;
export const askLater = (text: string) => void (pendingAsk = text);
export const peekAsk = () => pendingAsk;
export const clearAsk = () => void (pendingAsk = null);

// Calls back each time a tick finishes after the component mounted.
export function useTickChange(callback: () => unknown) {
  const { tickCount } = useAssistant();
  const first = useRef(tickCount);
  const cb = useRef(callback);
  useEffect(() => {
    cb.current = callback;
  });
  useEffect(() => {
    if (tickCount !== first.current) void cb.current();
  }, [tickCount]);
}
