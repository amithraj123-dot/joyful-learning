# Aeka Workspace: Architecture

Aeka Workspace is one application made of a small **core** and independent **modules**. The core owns
identity, firm membership, permissions, navigation, the activity trail and the single API entry point.
Each module owns its pages, its server actions and its database tables. New capabilities are added as
new modules (or new pages and actions within a module) without changing the others.

```
aeka-workspace/
  core/
    client/   module.ts (manifest and slot contracts), registry.ts (modules in the app, slotsFor),
              Slot.tsx (renders slot contributions), handover.ts (open a record in another module),
              api.ts (callModule)
    server/   module.ts (server contract), router.ts (POST /api/modules), registry.ts,
              members.ts (firm members and designations), activity.ts (firm activity trail),
              core-module.ts (me, members, activity, notifications, tick, integration status),
              env.ts (server secrets), secrets.ts (sealed credentials), ai.ts (the firm AI service),
              notifications.ts (member notifications, leases), tick.ts (background work)
  modules/
    scribe/   manifest.ts: dictation, meetings and personal notes (pages rendered by app/page.tsx);
              server/notes.ts: the read service other modules use for a user's own note
    workflow/ manifest.ts, shared/ (types and action contract), server/ (actions), ui/ (pages)
    mail/     Outlook triage, drafts and sending (same layout; server/service.ts for other modules)
    assistant/ chat with tools, to-dos, reminders, memory, brief, WhatsApp (same layout)
  app/        the shell (app/page.tsx), API routes, styles
  lib/        Scribe libraries (notes, transcription, AI) shared by web and desktop
  desktop/    Windows companion app (Aeka Scribe), which loads the same shell
  db/, drizzle/  database schema and migrations (one migration per change, never edited once deployed)
```

## Layers

1. **Identity.** The hosting platform signs the user in and supplies an email. Nothing in a module
   reads request headers; the router passes the identity in a context object.
2. **Membership and roles (core).** `org_members` lists the firm's members with designation (Article,
   Associate, Assistant Manager, Manager, Director, Partner) and admin rights. The first person to use
   the workspace becomes the admin partner; admins add colleagues by email. Deactivated members lose
   access immediately.
3. **Router (core).** `POST /api/modules` with `{ module, action, ...payload }`. It checks sign-in,
   same-origin request, body size, the action's existence and its permission, then calls the handler
   with `{ db, user, member, now, log }`. Errors written for users are returned; internal errors are
   logged and replaced with a generic message.
4. **Modules.** Each module registers a browser manifest (pages, icons, headings, a lazily loaded
   view) and a server definition (named actions with permissions). Modules never read each other's
   tables: on the server, a module calls another module's service (for example
   `modules/scribe/server/notes.ts`), which returns only what may be shared.
5. **Activity trail (core).** Every module records who did what (`ctx.log`) in `org_activity`. Entries
   never contain confidential content such as fees or feedback text.

## Extension points between modules

- **Slots.** A module can add a panel to another module's screen. The screen's owner declares the slot
  and its props in `SlotProps` (`core/client/module.ts`) and renders `<Slot name=… surface=… props=…/>`;
  a contributing module lists a lazily loaded component under `slots` in its manifest. Contributions
  load only on the surfaces the contributing module supports, and one that fails shows nothing rather
  than breaking the page. Slots today: `scribe.note` (under the title of an open note).
- **Hand-over.** To open a record in another module, call `handOver(key, value)` from
  `core/client/handover.ts` and navigate; the receiving module reads it once. Keys today:
  `workflow.matter` (a mandate and tab), `scribe.note` (one of the user's notes) and `mail.item` (one
  of the user's emails).
- **Services.** Server code of one module may import another module's `server/` service, never its
  tables or its action handlers.

Example: Scribe meeting notes linked to Workflow mandates. Workflow fills the `scribe.note` slot with
the mandate link panel; its `meetings.*` actions read the caller's own note through Scribe's service and
keep a shared copy in `wf_meeting_links`; the mandate's Meetings tab hands over to `scribe.note` to
reopen the note for its owner.

## Shared services in the core

- **Configuration.** Secrets come from the hosting platform as `ctx.env` (`core/server/env.ts`); they
  are never stored in the database or sent to browsers. `integrations.status` tells administrators
  what is configured, never the values.
- **Sealed credentials.** `seal`/`unseal` (AES-GCM, key derived per purpose from
  `AEKA_ENCRYPTION_KEY`, bound to the record) protect stored tokens such as Outlook sign-ins.
- **AI.** `chat()` in `core/server/ai.ts` is the only way to call a model: the firm's LiteLLM proxy.
  Every call, including failures, is recorded in `ai_usage`; a daily limit per member and a firm-wide
  switch apply before anything is sent. Content from email, notes or memory is always sent as data,
  and prompts tell the model never to follow instructions inside it.
- **Notifications.** `notify()` writes a member's notice once per dedupe key; the Assistant delivers
  chosen kinds to WhatsApp.
- **Background work.** A module may export `tick(sys, { member })`. `POST /api/tick` (with
  `AEKA_TICK_TOKEN`, called by an external scheduler) runs every module for every active member;
  each member's own tick also runs, at most once a minute, while they use the workspace. Ticks are
  idempotent and take leases so they never overlap.
- **Outbound requests** go through `ctx.fetch`, so tests replace the network.

## Data rules

- Every shared record is stored separately (one row per client, mandate, task, time entry), with a
  `revision`. Updates send the revision they started from; a mismatch returns 409 and the user reloads,
  so two people editing at once can never overwrite each other silently.
- Deletes of business records are soft (`deleted_at`) and restorable; the activity trail records them.
- Permissions are enforced on the server for every action. The browser receives a capabilities object
  only to hide controls the user cannot use.
- Money is stored in integer paise; dates that are calendar dates (due dates, timesheets) are
  `YYYY-MM-DD` in India time.

## Adding a module

1. Create `modules/<id>/shared/` with the record types and an action contract (see
   `modules/workflow/shared/contract.ts`).
2. Server: create `modules/<id>/server/index.ts` exporting a `ServerModule` (`core/server/module.ts`).
   Give each action a permission (default: any active member). Add it to `core/server/registry.ts`.
3. Database: add tables to `db/schema.ts` with a module prefix, then run
   `npx drizzle-kit generate --name <id>`; apply the new migration to the hosted database before
   deploying.
4. Browser: create `modules/<id>/manifest.ts` exporting a `ClientModule` (`core/client/module.ts`) with
   page ids prefixed `<id>/`, headings, icons, the surfaces it runs on (`web`, `desktop`) and a view
   loaded with `React.lazy`. Add it to `core/client/registry.ts`; the sidebar group, headings and routing
   follow automatically.
5. Tests: exercise actions through `moduleRequest` (see `tests/core.platform.test.mjs`) so permission
   checks are always covered.

## Current modules

| Module    | Surfaces      | Purpose                                                                                                                                                               |
| --------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workflow  | Web           | Clients, mandates, tasks with maker-checker sign-off, deadlines, deal tracker, engagements and billing, timesheets, team and import from the earlier Google Sheet app |
| Scribe    | Web, Windows  | Dictation, meeting capture, personal notes, sharing, Ask your notes                                                                                                   |
| Mail      | Web           | Outlook triage of the member's own mailbox, drafts on request, reviewed sending, rules from corrections, tasks from email                                             |
| Assistant | Web, WhatsApp | Chat with tools, to-dos, reminders, memory, morning brief, notifications, WhatsApp                                                                                    |

Scribe meeting notes link to Workflow mandates (see Extension points). Mail and the Assistant use the
Workflow and Scribe services (mandates, tasks, deadlines, note search) and each other's (mail queue
and drafting; style notes). Natural next layers: a recurring statutory compliance calendar feeding
reminders; calendar awareness in the brief; firm dashboards (pipeline, workload, realisation).
