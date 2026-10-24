# Aeka Workspace: Architecture

Aeka Workspace is one application made of a small **core** and independent **modules**. The core owns
identity, firm membership, permissions, navigation, the activity trail and the single API entry point.
Each module owns its pages, its server actions and its database tables. New capabilities are added as
new modules (or new pages and actions within a module) without changing the others.

```
aeka-workspace/
  core/
    client/   module.ts (manifest contract), registry.ts (modules in the app), api.ts (callModule)
    server/   module.ts (server contract), router.ts (POST /api/modules), registry.ts,
              members.ts (firm members and designations), activity.ts (firm activity trail),
              core-module.ts (me, members, activity actions)
  modules/
    scribe/   manifest.ts: dictation, meetings and personal notes (pages rendered by app/page.tsx)
    workflow/ manifest.ts, shared/ (types and action contract), server/ (actions), ui/ (pages)
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
   view) and a server definition (named actions with permissions). Modules call each other only through
   their actions, never through each other's tables.
5. **Activity trail (core).** Every module records who did what (`ctx.log`) in `org_activity`. Entries
   never contain confidential content such as fees or feedback text.

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

| Module | Surfaces | Purpose |
| --- | --- | --- |
| Workflow | Web | Clients, mandates, tasks with maker-checker sign-off, deadlines, deal tracker, engagements and billing, timesheets, team and import from the earlier Google Sheet app |
| Scribe | Web, Windows | Dictation, meeting capture, personal notes, sharing, Ask your notes |

Natural next layers: link Scribe meeting notes and action items to Workflow mandates and tasks; a
recurring statutory compliance calendar with reminders; firm dashboards (pipeline, workload, realisation).
