# Aeka Workspace 0.8: Setting up Mail triage and the Assistant

Aeka Advisors India LLP · For the administrator

Mail triage and the Assistant need a few server secrets. They are set in the hosting platform's secret
settings, never in the repository, the database or a browser. Until a secret is set, the related
feature says so on screen and does nothing. **Assistant settings > Integrations** (administrators
only) shows which are ready.

## 1. Secure storage (required for Mail)

| Secret                | Value                                                                    |
| --------------------- | ------------------------------------------------------------------------ |
| `AEKA_ENCRYPTION_KEY` | 32 random bytes, hex or base64. Generate with `openssl rand -base64 32`. |

It seals each member's Outlook sign-in token. Keep a copy in the firm's password manager: if it is lost
or changed, every member must connect Outlook again (their mail data is unaffected in Outlook).

## 2. The firm AI service (LiteLLM proxy)

| Secret                | Value                                                                            |
| --------------------- | -------------------------------------------------------------------------------- |
| `LITELLM_BASE_URL`    | The proxy address, for example `https://litellm-proxy-....azurecontainerapps.io` |
| `LITELLM_API_KEY`     | A key issued by the proxy for Aeka Workspace (not a personal key)                |
| `LITELLM_MODEL`       | Optional. Drafting and chat model; default `claude-sonnet-4.6`                   |
| `LITELLM_FAST_MODEL`  | Optional. Triage model; default the same as `LITELLM_MODEL`                      |
| `AEKA_AI_DAILY_LIMIT` | Optional. Model calls per member per day; default 400                            |
| `AEKA_AI_DISABLED`    | Optional. `true` stops every AI call at once                                     |

Before real client mail is sent, confirm in writing the proxy's and the model provider's data retention
and training terms (the earlier Aeka Twin review left this open). Every call, including failed ones, is
recorded with its token counts; Integrations shows today's use by member.

What is sent to the AI: for triage, the sender, recipients, date, subject and up to 2,500 characters of
the email body (quoted history removed), plus candidate mandate names; for a draft (only when a member
asks), the email, up to four earlier messages of the thread, the mandate's client and title and the
member's style notes; for chat, the conversation and the results of the tools it uses (which can include meeting titles,
times and attendee names from the calendar). Attachments are
never sent. With commitments switched on, up to 20 of the member's own sent emails a run are checked
for promises (only those containing promise-like words go to the AI); learning the writing style sends
up to 40 sent emails once, when the member asks. A member can keep a sender's mail away from AI with a "Never send to AI" rule, or switch AI
triage off for their mailbox.

## 3. Outlook (Microsoft Entra app registration)

1. In the Microsoft Entra admin centre, open **App registrations > New registration**. Name: "Aeka
   Workspace". Supported account types: this organisation only.
2. Redirect URI (platform **Web**): `https://<workspace address>/api/mail/callback`.
3. **Certificates and secrets > New client secret**; copy the value once.
4. **API permissions > Microsoft Graph > Delegated**: `offline_access`, `openid`, `email`, `User.Read`,
   `Mail.ReadWrite`, `Mail.Send`, `Calendars.Read`. Grant admin consent for the organisation.
5. Set the secrets:

| Secret               | Value                                                |
| -------------------- | ---------------------------------------------------- |
| `MS_CLIENT_ID`       | Application (client) ID                              |
| `MS_CLIENT_SECRET`   | The client secret value                              |
| `MS_TENANT_ID`       | Directory (tenant) ID                                |
| `AEKA_PUBLIC_ORIGIN` | `https://<workspace address>`, exactly as registered |

The workspace never sends an email by itself. `Mail.Send` is used only when a member presses **Send**
on a draft they have reviewed. Each member connects their own mailbox under **Mail > Outlook
connection**; nobody, administrators included, can see another member's mail in the workspace.

If the Aeka Twin registration is reused, add the new redirect URI and the `Mail.Send` permission, and
rotate its client secret (the earlier secret was pasted into a chat and was never confirmed rotated).

## 4. Background work (scheduler)

The hosting has no built-in timer. Without one, reminders, the morning brief, mail sync and WhatsApp
alerts run only while someone has the workspace open.

| Secret            | Value                        |
| ----------------- | ---------------------------- |
| `AEKA_TICK_TOKEN` | 32 or more random characters |

Configure any scheduler (for example an Azure Logic App, a GitHub Actions schedule or cron-job.org) to
call, every 5 minutes:

```
POST https://<workspace address>/api/tick
Authorization: Bearer <AEKA_TICK_TOKEN>
```

## 5. WhatsApp (optional)

Requires a WhatsApp Business Platform (Cloud API) account in the firm's name. Confirm the intended use
is permitted under Meta's current terms.

| Secret                           | Value                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `WHATSAPP_ENABLED`               | `true`                                                                                                       |
| `WHATSAPP_APP_SECRET`            | The Meta app secret (verifies webhook signatures)                                                            |
| `WHATSAPP_VERIFY_TOKEN`          | Any long random value, also entered in the Meta dashboard                                                    |
| `WHATSAPP_ACCESS_TOKEN`          | A system-user access token for the business number                                                           |
| `WHATSAPP_PHONE_NUMBER_ID`       | The business phone number ID                                                                                 |
| `WHATSAPP_DISPLAY_NUMBER`        | The business number as members should see it, for example `+91 98200 00000`                                  |
| `WHATSAPP_GRAPH_VERSION`         | For example `v23.0`                                                                                          |
| `WHATSAPP_NOTIFICATION_TEMPLATE` | An approved template with one body parameter, for alerts sent more than 24 hours after the member last wrote |
| `WHATSAPP_TEMPLATE_LANGUAGE`     | The template's language code, for example `en`                                                               |

In the Meta dashboard set the webhook to `https://<workspace address>/api/whatsapp` with the verify
token, and subscribe to `messages`. Each member links their own number under **Assistant settings**
by sending the code shown there; STOP unlinks it. Only text messages are handled.

## 6. Chats and the Android app

Chats needs no new secret: it uses the firm AI service (section 2) and the background scheduler. The
Aeka Android app is built by GitHub Actions (artifact `aeka-android-debug`) and installed on each
phone by hand; see [`android/README.md`](../android/README.md). Each member connects their own phone
from **Chats, Phone app**; the phone receives its own device key, stored in the workspace only as a
hash, which the member or a new pairing can revoke at any time.

What leaves the phone: the text, sender, chat name and time of each notification from the apps the
member switched on (bank one-time passwords are dropped on the phone). What is sent to AI: the last
12 messages of a chat with something new, unless the member keeps that chat from AI or switches AI
triage off. Messages are deleted from the workspace after 30 days.

## 7. Deploying

Apply migrations `0006` to `0013` to the hosted database before deploying this version. Agents need
no new secret: they use the firm AI service and the background scheduler (see `docs/AGENTS.md`).
