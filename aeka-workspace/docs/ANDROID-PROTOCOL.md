# Aeka for Android: Phone and Workspace Protocol

Aeka Advisors India LLP · 27 October 2026

The Android app ("Aeka", package `in.aeka.workspace`) has two parts:

1. **Capture.** A `NotificationListenerService` reads notifications from the chosen apps, turns them
   into chat messages, keeps them in a small queue on the phone and sends them to the workspace.
   It also keeps, in memory, each live notification's "Reply" action, so a reply prepared in the
   workspace can be sent through WhatsApp's own notification reply.
2. **Screens.** A `WebView` shows the hosted workspace (sign-in by the hosting platform, as in a
   browser). The page talks to the phone through a JavaScript bridge, `window.AekaAndroid`.

Triage, nudges and drafts happen in the workspace (module `chats`). Nothing is triaged on the phone.

## Apps read

| App id              | Android packages                                                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `whatsapp`          | `com.whatsapp`                                                                                                                   |
| `whatsapp_business` | `com.whatsapp.w4b`                                                                                                               |
| `linkedin`          | `com.linkedin.android`                                                                                                           |
| `gmail`             | `com.google.android.gm`                                                                                                          |
| `sms`               | the default SMS app (`Telephony.Sms.getDefaultSmsPackage`), `com.google.android.apps.messaging`, `com.samsung.android.messaging` |
| `teams`             | `com.microsoft.teams`                                                                                                            |
| `slack`             | `com.Slack`                                                                                                                      |

Outlook is not read: Aeka Mail already reads the mailbox in full.

The workspace says which apps are switched on (`apps` in the sync reply). An app switched off is not
read at all; nothing from it is queued.

## What the phone drops before anything leaves it

- Group summaries (`FLAG_GROUP_SUMMARY`), ongoing and foreground-service notifications, and the
  app's own status notices ("Checking for new messages", "WhatsApp Web is currently active",
  "Backup in progress", "N messages from M chats").
- Notifications with previews switched off ("New message", "3 new messages"): the phone reports
  `previewsHidden` for that app in `status()` instead.
- SMS one-time passwords and verification codes.
- Calls in progress. Missed calls are kept, as a message whose text is "Missed voice call" or
  "Missed video call".

## Chat keys and message ids

- **Chat key** (`chat`): `<app>:<stable id>`. The stable id is the notification's `shortcutId`
  (WhatsApp uses the contact's or group's id, for example `919812345678@s.whatsapp.net`), else its
  `tag`, else the conversation title (lower case, spaces collapsed). For Gmail it is the sender.
  At most 200 characters.
- **Address** (`address`): digits of the phone number, when the stable id or SMS sender shows one
  (`919812345678`). Used to open the chat (`https://wa.me/<digits>`) and to recognise clients.
- **Message id** (`id`): lower-case hex of SHA-256 over `chat`, `sender`, `at` and `text` joined by
  newlines, first 32 characters. WhatsApp repeats earlier unread messages in each new notification;
  the same message always gets the same id, so the workspace stores it once.
- **Message time** (`at`): the `MessagingStyle` message timestamp, else `Notification.when`, else
  the post time.

## API

`POST /api/device` with a JSON body. Every operation except `pair` sends
`Authorization: Bearer <device token>`. Replies are `{ "value": ... }` on success and
`{ "error": "message for the person" }` otherwise. A `401` means the device was disconnected in the
workspace: the phone forgets its token, stops reading and shows "Connect this phone again".

### `pair`

The person asks the workspace for a pairing code (Chats, Phone app, "Connect a phone"); the code is
valid for 10 minutes and works once. Inside the app, the page passes it straight to the bridge.

```json
{
  "op": "pair",
  "code": "K7Q2-M9XD",
  "name": "Amith's Pixel",
  "model": "Google Pixel 8",
  "appVersion": "0.9.0",
  "android": 34
}
```

Reply: `{ "value": { "token": "aekad_...", "deviceId": "...", "member": { "name": "...", "email": "..." } } }`

The token is kept in the app's private storage only, never passed to the page.

### `sync`

Sent a few seconds after new notifications, after a reply, when the page asks (`syncNow`) and at
least every 15 minutes (JobScheduler, network required).

```json
{
  "op": "sync",
  "appVersion": "0.9.0",
  "android": 34,
  "access": { "notifications": true, "postNotifications": true, "batteryUnrestricted": false },
  "events": [
    {
      "type": "message",
      "id": "4f0c2e...",
      "app": "whatsapp",
      "chat": "whatsapp:919812345678@s.whatsapp.net",
      "title": "Rahul Mehta",
      "group": false,
      "sender": "Rahul Mehta",
      "fromMe": false,
      "text": "Can you send the revised valuation note today?",
      "at": 1793080000000,
      "address": "919812345678"
    },
    {
      "type": "cleared",
      "app": "whatsapp",
      "chat": "whatsapp:919812345678@s.whatsapp.net",
      "at": 1793080600000,
      "reason": "read"
    }
  ],
  "live": ["whatsapp:919812345678@s.whatsapp.net"]
}
```

- `events`: at most 200 per request, oldest first; texts at most 4,000 characters, titles at most 200,
  senders at most 120. The phone deletes events from its queue only after a 200 reply.
- `message.sender`: the person who wrote it; in a one-to-one chat, the chat's name. `fromMe` is true
  for messages the person sent (a reply sent from Aeka, or one WhatsApp shows in its notification).
- `cleared.reason`: `opened` (the person tapped the notification), `dismissed` (swiped away), `read`
  (the app removed it, usually because the chat was read there) or `other`.
- `live`: chat keys that have a notification with a Reply action right now.

Reply:

```json
{
  "value": {
    "accepted": 2,
    "apps": {
      "whatsapp": true,
      "whatsapp_business": true,
      "linkedin": true,
      "gmail": true,
      "sms": true,
      "teams": true,
      "slack": true
    },
    "notices": [
      {
        "id": "...",
        "key": "chats.nudge:<thread id>:1793080000000:1",
        "kind": "chats.nudge",
        "title": "Reply to Rahul Mehta",
        "body": "Asked for the revised valuation note today. Waiting 2 hours.",
        "link": "chats/inbox#<thread id>"
      }
    ],
    "upcoming": [
      {
        "key": "todo.due:<to-do id>:1793088000000",
        "at": 1793088000000,
        "title": "Due now: File the TDS return",
        "body": "Complete it, or give it a new date, in Aeka.",
        "link": "assistant/todos#<to-do id>"
      }
    ],
    "syncSeconds": 900
  }
}
```

`notices` are the person's workspace notifications not yet given to this phone (each phone gets its
own copy, once), of the kinds the person switched on in Chats, Phone app, Phone notifications:

| Switch             | Notice kinds                                                             |
| ------------------ | ------------------------------------------------------------------------ |
| New action needed  | `mail.urgent`, `mail.action`, `chats.urgent`, `chats.action`, `followup` |
| Reminders to reply | `chats.nudge`                                                            |
| To-dos             | `todo.due`, `todo.critical`                                              |
| Reminders          | `reminder`                                                               |
| Workflow tasks     | `task.assigned`                                                          |
| Meetings           | `meeting`                                                                |
| Morning brief      | `brief`                                                                  |
| (always)           | anything else, for example `mail.reauth` (sign in to Outlook again)      |

The phone shows each as an Android notification in the channel "Aeka nudges"; tapping it opens the
app at `link`. `key` is the notice's dedupe key; the phone shows a key once only.

`upcoming` lists the to-dos and reminders due in the next 24 hours (when those switches are on). The
phone replaces its alarms with this list and shows each at its time (`AlarmManager`,
`setAndAllowWhileIdle`, so a few minutes late at most in deep sleep), even without a connection then.
The workspace raises a notice with the same key when the time comes; whichever reaches the phone
first is shown, the other is skipped. Alarms are set again after a restart or an app update, and an
alert missed by up to an hour while the phone was off is shown then.

## JavaScript bridge (`window.AekaAndroid`)

Available only while the WebView shows the workspace origin; every method checks the current
origin and does nothing for any other page. Results are JSON strings.

| Method                    | Result                                                                                                                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version()`               | `"0.9.0"`                                                                                                                                                                    |
| `status()`                | `{ paired, deviceName, notificationAccess, postNotifications, batteryUnrestricted, apps: {app: bool}, previewsHidden: [app], live: [chat], pending, lastSyncAt, lastError }` |
| `pair(code)`              | nothing; then the event `{ type: "paired", ok, error? }`                                                                                                                     |
| `unpair()`                | nothing; the phone forgets its token and stops reading                                                                                                                       |
| `syncNow()`               | nothing; then the event `{ type: "synced", ok, error? }`                                                                                                                     |
| `openSettings(which)`     | `which`: `notifications` (notification access), `battery`, `app` (app info, for "Allow restricted settings"), `post` (permission to show notifications)                      |
| `reply(chat, text)`       | `{ ok: true }` or `{ ok: false, reason: "not_live" \| "failed" \| "not_paired" }`. Sends through the live notification's Reply action and queues a `fromMe` message          |
| `openChat(chat, address)` | `{ ok, how: "notification" \| "link" \| "app" }`: the live notification's own tap action, else `https://wa.me/<address>` for WhatsApp, else the app                          |
| `copy(text)`              | `{ ok: true }`                                                                                                                                                               |

Events reach the page as `window.dispatchEvent(new CustomEvent("aeka-android", { detail }))`.
`{ type: "open", link }` is sent when the person opens a nudge; the page navigates to `link`
(a page id, optionally `#id`).

## Setting up on the phone (what the app explains)

1. Install the APK (from the GitHub Actions run) and open it; sign in to the workspace.
2. Chats, Phone app: "Connect this phone". The app pairs itself.
3. Allow notification access. On Android 13 and later, a sideloaded app must first be allowed
   "restricted settings": App info, the three-dot menu, "Allow restricted settings".
4. Allow notifications (for nudges) and set battery use to "Unrestricted", or some phones stop the
   reader in the background.
5. In WhatsApp, keep notification previews on ("Show preview"); without them there is nothing to read.
