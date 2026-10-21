# Aeka Scribe

Dictation and meeting notes workspace of Aeka Advisors India LLP. Version 0.6.0.

Aeka Scribe has two parts that share one codebase:

- **Windows desktop application** (`desktop/`, Electron): global dictation shortcuts with guarded
  insertion into the focused field, meeting capture (microphone and system audio), an encrypted
  local vault, calendar sign-in, reviewed actions to email and collaboration tools, signed updates
  and administrator policy.
- **Web workspace** (`app/`, `components/`, `lib/`; Vinext on Cloudflare Workers with D1): notes,
  transcripts, summaries, sharing grants, comments, retention and read-only MCP note tools.

The setup guide and feature status are in [`public/desktop-guide.html`](public/desktop-guide.html)
(packaged with the Windows build as `START-HERE.html`). Administrator and publisher setup is in
[`desktop/admin/ADMIN-SETUP.txt`](desktop/admin/ADMIN-SETUP.txt). The review that produced this
release is in [`docs/REVIEW-0.6.md`](docs/REVIEW-0.6.md).

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
