// The Aeka Android app's bridge (window.AekaAndroid), present only when the workspace runs inside the
// app. See docs/ANDROID-PROTOCOL.md. Every helper here is safe to call in a browser: it then reports
// that the phone is not available.
import type { AppId } from '../shared/types';

interface Bridge {
  version(): string;
  status(): string;
  pair(code: string): void;
  unpair(): void;
  syncNow(): void;
  openSettings(which: string): void;
  reply(chat: string, text: string): string;
  openChat(chat: string, address: string): string;
  copy(text: string): string;
}

declare global {
  interface Window {
    AekaAndroid?: Bridge;
  }
}

export interface PhoneStatus {
  paired: boolean;
  deviceName: string;
  notificationAccess: boolean;
  postNotifications: boolean;
  batteryUnrestricted: boolean;
  apps: Partial<Record<AppId, boolean>>;
  previewsHidden: AppId[];
  live: string[];
  pending: number;
  lastSyncAt: number | null;
  lastError: string;
}

export type AndroidEvent =
  | { type: 'paired'; ok: boolean; error?: string }
  | { type: 'synced'; ok: boolean; error?: string }
  | { type: 'open'; link: string }
  | { type: 'status' };

const bridge = () => (typeof window !== 'undefined' ? (window.AekaAndroid ?? null) : null);
export const inAndroidApp = () => !!bridge();

function parse<T>(raw: unknown): T | null {
  try {
    return typeof raw === 'string' ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function phoneStatus(): PhoneStatus | null {
  const b = bridge();
  if (!b) return null;
  try {
    const s = parse<Partial<PhoneStatus>>(b.status());
    if (!s) return null;
    return {
      paired: s.paired === true,
      deviceName: s.deviceName ?? '',
      notificationAccess: s.notificationAccess === true,
      postNotifications: s.postNotifications === true,
      batteryUnrestricted: s.batteryUnrestricted === true,
      apps: s.apps ?? {},
      previewsHidden: Array.isArray(s.previewsHidden) ? s.previewsHidden : [],
      live: Array.isArray(s.live) ? s.live : [],
      pending: Number(s.pending ?? 0),
      lastSyncAt: typeof s.lastSyncAt === 'number' && s.lastSyncAt > 0 ? s.lastSyncAt : null,
      lastError: s.lastError ?? '',
    };
  } catch {
    return null;
  }
}

export function onAndroidEvent(handler: (e: AndroidEvent) => void) {
  const listener = (e: Event) => {
    const d = (e as CustomEvent).detail as AndroidEvent | undefined;
    if (d && typeof d === 'object' && typeof d.type === 'string') handler(d);
  };
  window.addEventListener('aeka-android', listener);
  return () => window.removeEventListener('aeka-android', listener);
}

// Waits for one event of a type from the phone, or gives up after `ms`.
function waitFor(type: 'paired' | 'synced', ms: number) {
  return new Promise<{ ok: boolean; error?: string }>((resolve) => {
    const timer = setTimeout(() => {
      off();
      resolve({ ok: false, error: 'The phone did not answer. Check the connection and try again.' });
    }, ms);
    const off = onAndroidEvent((e) => {
      if (e.type !== type) return;
      clearTimeout(timer);
      off();
      resolve({ ok: e.ok, error: e.error });
    });
  });
}

export async function pairPhone(code: string) {
  const b = bridge();
  if (!b) return { ok: false, error: 'Open this page in the Aeka app on your phone.' };
  const done = waitFor('paired', 30000);
  b.pair(code);
  return done;
}

export async function syncPhone() {
  const b = bridge();
  if (!b) return { ok: false };
  const done = waitFor('synced', 30000);
  b.syncNow();
  return done;
}

export function unpairPhone() {
  bridge()?.unpair();
}

export type SettingsTarget = 'notifications' | 'battery' | 'app' | 'post';
export function openPhoneSettings(which: SettingsTarget) {
  bridge()?.openSettings(which);
}

// Sends through the chat's live notification Reply action.
export function replyOnPhone(chat: string, text: string): { ok: boolean; reason?: string } {
  const b = bridge();
  if (!b) return { ok: false, reason: 'not_app' };
  return parse<{ ok: boolean; reason?: string }>(b.reply(chat, text)) ?? { ok: false, reason: 'failed' };
}

export function openChatOnPhone(chat: string, address: string) {
  const b = bridge();
  if (!b) return { ok: false };
  return parse<{ ok: boolean; how?: string }>(b.openChat(chat, address)) ?? { ok: false };
}

export async function copyText(text: string) {
  const b = bridge();
  if (b) return parse<{ ok: boolean }>(b.copy(text))?.ok === true;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
