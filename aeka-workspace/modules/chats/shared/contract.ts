// Chats module: action contract (POST /api/modules, module "chats"). Every action works on the
// caller's own chats only; nobody else, administrators included, can read them.
//
// The phone sends messages to POST /api/device (docs/ANDROID-PROTOCOL.md), authenticated by a device
// token obtained with a one-time pairing code from 'phone.pairingCode'.
//
// Triage (server, after each phone sync and on background ticks), per chat rather than per message:
//   1. Muted chats are stored but never triaged or nudged.
//   2. Built-in checks without AI: bank and service SMS senders, missed calls, and chats the member
//      keeps from AI (one-to-one chats then ask for a reply as "maybe").
//   3. The rest goes to the AI in batches of up to 8 chats, with the last messages of each, after a
//      short pause so a burst of messages is triaged once. Replies are validated; an invalid one is
//      retried with backoff and fails after 3 attempts.
//   4. Nothing is drafted automatically. A draft is made only when the member asks, and sent only when
//      the member presses Send on the phone (through the chat's notification Reply, or by opening the
//      chat with the text copied).
// Nudges: a chat that needs a reply is nudged up to three times, sooner for higher tiers, never during
// quiet hours (urgent ones excepted).
import type {
  AppId,
  Category,
  ChatDraft,
  ChatMessage,
  ChatSettings,
  ChatThread,
  ChatView,
  PhoneDevice,
  QueueCounts,
  ReplyNeeded,
  Tier,
} from './types';

type Rev = { baseRevision: number };

export interface ChatsActions {
  'threads.list': {
    payload: { view: ChatView; app?: AppId; search?: string; limit?: number }; // most recent first
    result: { threads: ChatThread[]; counts: QueueCounts };
  };
  // The chat with its last 100 messages (oldest first) and its open draft, if any.
  'thread.get': {
    payload: { id: string };
    result: { thread: ChatThread; messages: ChatMessage[]; draft: ChatDraft | null };
  };
  // done: handled for now (a new message reopens it); replied: I replied outside Aeka; snooze: hours 1
  // to 168. mute, neverAi and vip (and their opposites) apply to every later message of the chat.
  // `op`, not `action`: the request envelope already uses the `module` and `action` keys.
  'thread.update': {
    payload: {
      id: string;
      op:
        | 'done'
        | 'reopen'
        | 'replied'
        | 'snooze'
        | 'mute'
        | 'unmute'
        | 'neverAi'
        | 'allowAi'
        | 'vip'
        | 'unvip';
      hours?: number;
    };
    result: ChatThread;
  };
  // A one-tap correction of the triage (source becomes manual; later messages are triaged again).
  'thread.correct': {
    payload: { id: string; tier?: Tier; replyNeeded?: ReplyNeeded; category?: Category } & Rev;
    result: ChatThread;
  };
  'thread.retriage': { payload: { id: string }; result: ChatThread };
  // A to-do in the Assistant from the chat (once per wait), linked back to it.
  'thread.toTodo': { payload: { id: string }; result: { todoId: string } };

  // Drafting (AI, on request only). Refused for chats kept from AI. Missing facts become
  // [INPUT REQUIRED: ...], which must be resolved before sending.
  'draft.create': { payload: { threadId: string; instructions?: string }; result: ChatDraft };
  'draft.update': { payload: { draftId: string; text: string } & Rev; result: ChatDraft };
  'draft.discard': { payload: { draftId: string } & Rev; result: true };
  // Checks the text before the phone sends it: not empty, no placeholder left, at most 4,000
  // characters. Saves the final text and returns what the phone needs.
  'draft.prepareSend': {
    payload: { draftId: string; text: string } & Rev;
    result: { draft: ChatDraft; chat: string; address: string; app: AppId };
  };
  // After the phone sent it (notification) or the member confirmed sending it themselves (manual).
  'draft.markSent': { payload: { draftId: string; how: 'notification' | 'manual' } & Rev; result: ChatDraft };

  // Runs triage now for a bounded batch (the background work does the same every few minutes).
  run: { payload: Record<string, never>; result: { triaged: number; pending: number } };

  'settings.get': { payload: Record<string, never>; result: ChatSettings };
  'settings.update': { payload: { settings: ChatSettings }; result: ChatSettings };

  'phone.status': { payload: Record<string, never>; result: { devices: PhoneDevice[]; aiReady: boolean } };
  // A one-time code (valid 10 minutes) to connect the Android app.
  'phone.pairingCode': { payload: Record<string, never>; result: { code: string; expiresAt: number } };
  // Disconnects a phone: its token stops working at once.
  'phone.revoke': { payload: { deviceId: string }; result: true };
  // Deletes every chat, message and draft held for me (phones stay connected unless revoked).
  'data.delete': { payload: { confirm: true }; result: true };
}

export type ChatsAction = keyof ChatsActions;
