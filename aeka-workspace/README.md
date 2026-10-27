# Aeka Workspace

The workspace of Aeka Advisors India LLP. Version 0.8.0.

Aeka Workspace is a modular application: a core (sign-in, firm members and roles, permissions, one
API entry point and a firm activity trail) with independent modules on top. The architecture and the
steps for adding a module are in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

| Module        | Where              | What it does                                                                                                                                                                                                                                                             |
| ------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Assistant** | Web (and WhatsApp) | A personal executive assistant: Ask Aeka chat, a morning brief with calendar, follow-ups and patterns, meeting preparation, schedule health, natural-language to-dos with lists, repeats and a board, reminders, notifications, memory, and an optional WhatsApp channel |
| **Mail**      | Web                | Outlook inbox triage by priority and handling, "Draft a reply?" on request only, reviewed sending, follow-ups and commitments, VIPs and archiving, a learned writing style, rules learned from corrections, emails turned into Workflow tasks                            |
| **Chats**     | Web and Android    | WhatsApp, WhatsApp Business, LinkedIn, Gmail, SMS, Teams and Slack messages read from the phone's notifications by the Aeka Android app, triaged like email, with nudges to reply, quiet hours, drafts on request and Send through WhatsApp's own notification reply     |
| **Workflow**  | Web                | Clients and mandates, tasks with maker-checker sign-off, deadlines, the deal tracker, engagements and billing, timesheets with export, team access, meeting notes linked from Scribe, and import from the earlier Google Sheet workflow app                              |
| **Scribe**    | Web and Windows    | Dictation, meeting capture, notes, summaries, sharing and Ask your notes                                                                                                                                                                                                 |

The Windows companion app (`desktop/`, Electron) is named **Aeka Scribe**: global dictation shortcuts
with guarded insertion into the focused field, meeting capture (microphone and system audio), an
encrypted local vault, calendar sign-in, reviewed actions to email and collaboration tools, signed
updates and administrator policy. The web workspace (`app/`, `core/`, `modules/`, `lib/`) runs on
Vinext on Cloudflare Workers with a D1 database.

The setup guide and feature status are in [`public/desktop-guide.html`](public/desktop-guide.html)
(packaged with the Windows build as `START-HERE.html`). Administrator and publisher setup is in
[`desktop/admin/ADMIN-SETUP.txt`](desktop/admin/ADMIN-SETUP.txt). Reviews: [`docs/REVIEW-0.6.md`](docs/REVIEW-0.6.md)
(Scribe), [`docs/REVIEW-0.7.md`](docs/REVIEW-0.7.md) (Workflow) and [`docs/REVIEW-0.8.md`](docs/REVIEW-0.8.md)
(Assistant and Mail); comparison with alfred_: [`docs/ALFRED-PARITY.md`](docs/ALFRED-PARITY.md). Setting up Mail and the Assistant: [`docs/SETUP-ASSISTANT-MAIL.md`](docs/SETUP-ASSISTANT-MAIL.md).

The Android app (`android/`, Kotlin) is named **Aeka**: it reads notifications from the chosen apps,
sends them to Chats and shows the workspace. Build, install and setup: [`android/README.md`](android/README.md);
the phone and workspace protocol: [`docs/ANDROID-PROTOCOL.md`](docs/ANDROID-PROTOCOL.md).

## Development

Node.js 22.13 or later; the project pins pnpm 11.25.0.

```sh
pnpm install --frozen-lockfile
npm --prefix desktop ci
npm --prefix desktop run build:ui
npm --prefix desktop start          # Windows only
```

Checks:

```sh
npm test                            # web and shared logic
npm --prefix desktop test           # desktop services
node node_modules/typescript/bin/tsc --noEmit
pnpm lint
pnpm format:check
pnpm build                          # web workspace
```

Package the Windows x64 ZIP and NSIS installer (output in `desktop/release`):

```sh
npm --prefix desktop run build:ui
npm --prefix desktop run package:win
```

Continuous integration (`.github/workflows/aeka-scribe.yml` at the repository root) runs the checks
above on Linux, and on Windows runs the desktop tests against the real PowerShell helper, a smoke
launch of the application and the unsigned packaging, uploading the ZIP and installer as an
artifact.

`desktop/generated/` is produced from `lib/` by `desktop/build-shared.mjs` (run as part of
`build:ui`); edit the `lib/` sources, not the generated copies.

## Brand

The interface follows the Aeka house format: Aeka red `#991B1E` for titles and primary actions,
black body text, gray `#595959` captions, tint `#F5EDED` for highlighted panels and the Muli
(Mulish, SIL Open Font License) typeface bundled in `app/fonts/`. Brand tokens are defined at the
top of `app/globals.css`. Icons are generated from the Aeka mark (`desktop/assets/`, `public/`).

## Upgrading from Flow Desktop 0.5

- On first launch, data in `%APPDATA%\Flow Desktop` is copied to `%APPDATA%\Aeka Scribe`; the
  original folder is left in place.
- A managed policy at `%ProgramData%\Flow Desktop\policy.json` is still honoured when
  `%ProgramData%\Aeka Scribe\policy.json` is absent.
- Backups are now written as `.aekabackup`; earlier `.flowbackup` files and folder snapshots can
  still be restored.
- The hosted web workspace address (`cloudOrigin` in `desktop/main.cjs`) is unchanged. Rename it
  only after the Site is redeployed under a new address.

## Hosting

The web workspace identifies users from `oai-authenticated-user-*` headers set by the OpenAI Sites
edge. When deploying anywhere else, set `AEKA_SELF_HOSTED=true` (the worker then removes those headers
from incoming requests) and place your own authentication in front of the application.

## Credentials and data

No API keys, OAuth client secrets, tokens, signing keys, user notes or recordings are stored in this
repository. Each user enters their own OpenAI key in Desktop settings, where it is encrypted with
Windows DPAPI.
