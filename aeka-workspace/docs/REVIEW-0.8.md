# Aeka Workspace 0.8.0: The Assistant and Mail Triage

Aeka Advisors India LLP · 26 October 2026

## Scope

Two earlier tools were reviewed and their useful parts brought into Aeka Workspace as two new modules:

- **The team's assistant clone** (a single-owner Node prototype inspired by Instinct: tasks,
  reminders, memory, an inbox, an AI tool loop and WhatsApp). It became the **Assistant** module.
- **Aeka Twin** (a Python tool run on the partner's laptop for Outlook triage and drafting). Its
  email triage became the **Mail** module. Its code was not in a repository; it was reconstructed
  from the build records, which also showed how it failed in use.

Setup for administrators is in `SETUP-ASSISTANT-MAIL.md`.

## What was wrong before

| Tool            | Finding                                                                                                                                         | Consequence                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Aeka Twin       | Triage saw only Outlook's 255-character preview, never the email body or thread                                                                 | Priorities and summaries were guesses                                        |
| Aeka Twin       | The prompt did not list the allowed categories or define the tiers; replies were not validated                                                  | Six of eleven categories could never appear; malformed replies broke runs    |
| Aeka Twin       | Outlook deletion entries were stored as failed emails; a drafting failure rolled back triage; degraded items re-ran every cycle                 | 1,010 false failures; 761 emails re-classified at full cost every 15 minutes |
| Aeka Twin       | When AI failed, every email was assumed to need a reply, and whole classes were drafted automatically                                           | Newsletters triggered drafts; tokens wasted                                  |
| Aeka Twin       | Corrections were recorded but never used; mandate matching was an exact sender lookup                                                           | It did not learn                                                             |
| Aeka Twin       | The AI key was dead from mid-August; failed calls were not counted; it ran only while the laptop was on; secrets nearly shipped in a demo image | Triage silently fell back to regular expressions for two months              |
| Assistant clone | One owner, its own database, its own sign-in, no team scope                                                                                     | Could not be shared or joined to the firm's records                          |
| Assistant clone | No email or calendar; reminders in UTC; approvals that could never execute                                                                      | Limited usefulness for the partner's day                                     |

## What the Mail module does

- **Connect once** with Microsoft sign-in (PKCE, single-use state bound to the member). The token is
  sealed with the workspace key. Each member sees only their own mailbox; administrators included.
- **Sync** Inbox and Sent Items by delta, with deletions recorded as removals, never as failures.
- **Triage in three stages.** Built-in rules handle bulk mail, no-reply notifications and calendar
  responses without AI. The member's approved rules come next, including "never send to AI" for
  confidential senders. Everything else goes to the firm's AI in small batches with the full body
  (to 2,500 characters, quoted history removed), the thread, the tier scale, the allowed values, the
  member's recent corrections and candidate mandates. Each answer is validated; a bad item is retried
  alone, three times at most; an AI outage pauses the queue instead of retrying in a loop.
- **Each email** gets a tier (Urgent to Low), a category, a handling (needs my reply, review, delegate,
  information, none), a one-line reason, a stated deadline, what is asked, a suggested delegate and
  mandate.
- **"Draft a reply?"** is asked only where a reply is expected. Nothing is drafted until the member
  says yes. The draft uses the thread, the mandate and the member's style notes, and marks missing
  facts as `[INPUT REQUIRED: ...]`. **Send** works only after review, with no placeholders left, and
  the result is recorded honestly (an unconfirmed send is never shown as sent).
- **Learning.** One-tap corrections feed later triage as examples; three matching corrections propose
  a rule, which applies only after the member accepts it. Confirmed mandates are remembered by sender
  and domain.
- **Make a task** turns an email into a Workflow task on a mandate.
- **Urgent alerts** notify once (and on WhatsApp, if linked), only for recent mail.

## What the Assistant does

- **Ask Aeka**: chat that uses tools to list the member's work (to-dos, Workflow tasks, reminders,
  deadlines), create to-dos and reminders, remember or forget facts, search to-dos, memory, Scribe
  notes, mandates and triaged mail, show the mail queue, and prepare a reply draft for review in Mail.
  It never sends anything. Each run is bounded (5 model calls, 8 actions); every action it took is
  shown under its reply.
- **To-dos and reminders**: one-time and recurring (daily, weekdays, weekly, monthly) in India time,
  snooze, pause, catch-up after downtime without bursts, and moving a to-do onto a mandate.
- **Today**: a morning brief assembled without AI from urgent mail, tasks, deadlines and reminders,
  and posted as a notification at the chosen time.
- **Memory**: facts and writing style the member asks it to keep; used in chat and drafting.
- **WhatsApp** (optional): a member links their own number with a one-time code; chat and chosen
  alerts then work on WhatsApp. Signed webhooks, duplicate suppression, STOP, the 24-hour window and
  delivery states are handled.

## Calendar awareness

With read-only access to the member's Outlook calendar (`Calendars.Read`, granted at the same
Microsoft sign-in), the workspace keeps a copy of yesterday to 14 days ahead, refreshed every 15
minutes in the background. Event bodies are never read, and nothing can be created, changed, accepted
or declined.

- **Brief:** "Your calendar today" lists the meetings with times, online or place, and the mandate
  linked to an attendee the member has confirmed before; it flags clashes and shows free time.
  Declined and cancelled meetings are left out.
- **Ask Aeka:** can read the calendar for up to a week and find free periods of a given length; it
  suggests times but the member sends the invitation.
- **Meeting alerts:** a notification 10 minutes before each meeting not declined, on by default, and
  on WhatsApp if chosen.
- A mailbox connected before calendar access existed keeps working; Outlook connection offers
  "Allow calendar access", and its token refreshes never ask for the new permission.

## Executive assistant features (alfred_ parity)

The features of alfred_ (get-alfred.ai) were reconstructed and matched or exceeded; see
`ALFRED-PARITY.md`. In short: follow-ups (waiting on others and people chasing you), commitments from
sent mail, to-dos created from email asks and meeting action items with source links, a learned
writing style with per-recipient greetings and learning from edits, VIPs, archiving, natural-language
to-dos with lists, repeats and a board, stale and critical flags, a seven-day schedule health strip,
meeting preparation packs with an AI briefing on request, clashes on incoming invitations, and a
Patterns section in the brief. Calendar writes (accepting invitations, creating events, focus blocks)
were left out because calendar access is read only by choice.

## Platform additions

Sealed credentials, a single metered AI client with a daily limit and a kill switch, member
notifications, background ticks with leases (`POST /api/tick`), an administrators' integrations
panel, `?page=` links, and a `mail.item` hand-over. See `ARCHITECTURE.md`.

## Verification

- 156 web and shared tests pass (22 for Mail, 33 for the Assistant, 6 for the new core services),
  with fake Microsoft, WhatsApp and AI services: isolation between members, OAuth state checks, sync
  idempotency, deletions, rules without AI, validation and retry limits, rule proposals, placeholders
  blocking Send, sends confirmed only on acceptance, recurrence across month ends, duplicate-free
  reminders and briefs, the bounded chat loop, and the WhatsApp signature, linking, STOP and window
  rules. 72 desktop tests pass; types, formatting and lint (0 errors) pass; both builds succeed.
- End to end on the local runtime with a stand-in AI service: a seeded mailbox was triaged (the
  newsletter without AI), a reply was drafted on request with a placeholder that blocked sending, a
  reminder was created from chat, and the brief showed the mail queue, at desktop and phone widths.
- Not verified here: a live Microsoft 365 mailbox, the firm's LiteLLM proxy and Meta's WhatsApp
  service. These need the secrets in `SETUP-ASSISTANT-MAIL.md` and a pilot with one mailbox first.

## Before real client mail is used

1. Confirm the LiteLLM proxy's and the model provider's retention and training terms in writing.
2. Rotate the Entra client secret used by Aeka Twin, and retire Twin's laptop copy of client mail
   once the workspace is in use.
3. Pilot with the partner's mailbox for two weeks: review urgent recall daily and correct freely, so
   rules are proposed from real patterns.

## Known limitations

- Attachments are not read.
- WhatsApp handles text only, and a linked phone can use the full assistant.
- Snoozing a recurring reminder moves the series.
- Without an external scheduler, background work runs only while someone has the workspace open.
