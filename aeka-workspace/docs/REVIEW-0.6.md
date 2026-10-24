# Aeka Scribe 0.6.0: Review of Flow 0.5.0 and Changes Made

Aeka Advisors India LLP · 21 October 2026

## Scope

The Flow 0.5.0 source export (Windows Electron application, web workspace, server routes, database
schema, tests and build scripts) was reviewed for security, correctness, reliability,
maintainability and fit with the Aeka house format. The application was then renamed Aeka Scribe
and the improvements below were made. The review was conducted on Linux: the Electron application
was not launched and no Windows, microphone, calendar or paid AI path was exercised.

## Overall assessment

- **Security posture is sound in the areas that matter most.** Every server query is scoped to its
  owner, grant expiry and viewer/ editor roles are enforced, trashed notes are excluded from every
  shared path, SQL is parameterised, revision checks are atomic and the web routes check the
  request origin. In the desktop application, the IPC sender check, preload allowlist, navigation
  lock-down, CSP, PKCE OAuth, DPAPI vault and signed-update checks are correct.
- **The principal defects were in reliability.** Automatic insertion of dictated text could not have
  worked with the pinned Electron 44 clipboard API, and the PowerShell helper that powers insertion,
  focus checks, hold-to-talk and call detection would have been blocked by the default Windows
  script policy. Both are fixed.
- **Maintainability was the largest structural weakness.** The source was written as compressed
  single lines (one 41 KB component in 90 lines), lint failed with 135 errors and three components
  exceed 1,400 lines each. The code is now formatted, lint is a usable gate and the remaining debt is
  recorded below.

## Changes made

### Rebrand and Aeka house format

- Product name Aeka Scribe throughout the interface, Windows shell, installer, exports, MCP server
  and administrator notes; identifiers `aeka-scribe` and `com.aekaadvisors.scribe`; version 0.6.0.
- Aeka red `#991B1E` titles and primary actions, black body text, gray captions, tint `#F5EDED`
  panels, the bundled Muli (Mulish) typeface, squarer cards, the red edge bar and icons generated
  from the Aeka mark.
- Formal page titles and descriptors in place of slogans ("Be there for the conversation." is now
  "Record a Meeting").
- Setup guide rewritten by topic in the house format, without competitor references. The page
  analysing the Wispr Flow Windows installer was removed: a published reverse-engineering analysis of
  a competitor's client is a legal and reputational exposure for an Aeka-branded product.
- Upgrade path from Flow Desktop 0.5: data copied on first launch (staged, vault last, stops with an
  explanation where the earlier application holds files open), a managed policy at the old location
  still honoured, `.flowbackup` files and legacy folder snapshots still restorable.

### Desktop fixes

| Area                 | Defect                                                                                                                                             | Change                                                                                                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auto-paste           | Called `clipboard.availableFormats/readBuffer/writeBuffer`, which Electron 44 does not provide; insertion would fail on every dictation            | Async `ClipboardItem` snapshot and restore; a second paste inside the restore window keeps the user's original clipboard                                              |
| Windows helper       | `-File` obeys the default Restricted policy and mark-of-the-web; helper never restarted; EPIPE could crash the main process; split UTF-8 corrupted | Process-scoped `-ExecutionPolicy Bypass` (Group Policy still applies), restart with backoff, stdin error handler, stream decoding, 120 s timeout for installer checks |
| Quit and crashes     | A crashed or hung renderer left quit blocked indefinitely and recording state stuck                                                                | Renderer-crash handler resets state; two-minute watchdog offers to quit; log-off asks the renderer to save                                                            |
| Scheduled recordings | Any resume from sleep marked Windows as locked, so scheduled recordings were skipped                                                               | Lock state read from Windows; scheduler failures reported once                                                                                                        |
| Policy               | `policy.json` saved with a UTF-8 BOM (Windows PowerShell 5.1 default) prevented start-up for every user                                            | BOM accepted                                                                                                                                                          |
| Shortcuts            | Defaults took Ctrl+Shift+Esc (Task Manager) and Ctrl+Shift+V (paste as plain text)                                                                 | Ctrl+Shift+Backspace and Ctrl+Alt+V; saved 0.5 defaults move automatically                                                                                            |

### Web and shared-logic fixes

| Area                | Defect                                                                                                                                         | Change                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Dictation cleanup   | "So, um, we agreed" became "So,, we agreed"; "the UM team" lost "UM"; vocabulary could break snippet triggers and cleanup rewrote snippet text | Hesitation pattern rewritten; snippets expand first and keep their exact text |
| Escape key          | Escape pressed for a menu or dialog during transcription discarded the recording                                                               | Escape cancels only an active capture, outside fields and dialogs             |
| ChatGPT note search | Matched raw JSON, so words such as "meeting" or "draft" matched every note                                                                     | Searches title, body, summary and transcript only                             |
| Sharing             | An editor could set a note to "recording", exempting it from retention and blocking the owner from trashing it                                 | Status, kind and creation time stay the owner's                               |
| Error handling      | Database and runtime errors (including SQL fragments) were returned to the client                                                              | Logged and replaced with a generic message; validation messages unchanged     |
| Request size        | Bodies were buffered in full before the size check                                                                                             | Rejected from `Content-Length` first                                          |
| Transcription limit | Six requests a minute stalled meeting capture, which uploads up to eight chunks a minute                                                       | Twenty a minute                                                               |
| Exports             | Bare carriage returns could inject iCalendar properties; long lines unfolded; non-ASCII email subjects garbled                                 | Escaping, RFC 5545 folding and RFC 2047 subjects                              |
| Interface           | Unhandled rejection when the AI status check failed; style toggle state not announced; mobile header hid the logo                              | Fixed                                                                         |

### Second round: recommendations implemented

| Recommendation                 | Change                                                                                                                                                                                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows verification           | GitHub Actions workflow: Linux checks, and on Windows the desktop tests (including the real PowerShell helper), a smoke launch with a throwaway profile and unsigned ZIP/ NSIS packaging uploaded as an artifact                                                    |
| Identity headers outside Sites | `AEKA_SELF_HOSTED=true` makes the worker drop client-supplied `oai-authenticated-user-*` headers                                                                                                                                                                    |
| Update trust anchors           | Feed, Ed25519 key and publisher thumbprint can be pinned in `policy.json`; unpinned changes and every installation need a native confirmation; a pending installer verified under different anchors is refused; a cached verified installer is not downloaded again |
| Managed policy hardening       | Policy location read from `HKLM` through `reg.exe`, not the `%ProgramData%` variable; per-machine NSIS installer; Electron fuses (no run-as-node, no `NODE_OPTIONS` or inspector flags, ASAR integrity, load only from ASAR, cookie encryption)                     |
| Performance                    | `notes.get` and `notes.index`; meeting audio, saves and the 15-second poll fetch only what changed; retention purge at most every five minutes per owner (migration 0003, `workspace_maintenance`), with expired notes hidden from every read in between            |
| Interrupted recordings         | A recording not saved for six hours is served as interrupted, can be trashed and is subject to retention                                                                                                                                                            |
| Smaller items                  | Team panel prompt only on real edits; cloud-AI switch governs transcription; hold-to-talk key selectable (F1 to F12); audit actor recorded as email                                                                                                                 |
| Internal names                 | `window.aekaScribe`, IPC and DOM event names, `lib/scribe-core.ts`, native helper class names and the Zapier event (`aeka_scribe.note.reviewed`) renamed; browser settings migrate from the old keys                                                                |

### Verification

134 automated tests pass on Linux (63 web and shared, 71 desktop), with one further test that runs
only on Windows against the real PowerShell helper. TypeScript, Prettier and ESLint (0 errors)
pass, and the web and desktop interface builds succeed.

## Remaining items

1. **Run the Windows workflow and a manual check before distribution.** The workflow runs on the
   next push; its smoke launch, helper test and packaging have not yet run. A person should still
   test on a clean Windows 11 machine: dictation insertion, meeting audio, calendar sign-in, the two
   update confirmation dialogs, per-machine installation over an existing per-user Flow Desktop, and
   start-up with the new Electron fuses.
2. **Code signing.** Builds remain unsigned. Obtain the firm's Windows code-signing certificate and an
   Ed25519 release key, then follow `desktop/admin/ADMIN-SETUP.txt`.
3. **Hosted address.** `flow-voice-workspace.amithraj123.chatgpt.site` is unchanged. Redeploy the Site
   under an Aeka address, then update `cloudOrigin` in `desktop/main.cjs` and the ChatGPT plugin.
4. **Database migration.** Apply migration 0003 to the hosted D1 database before deploying this
   release; every request reads the new table.
5. **Known limits of the hardening.** The portable ZIP is user-writable, so policy and update pinning
   are effective only with the per-machine installer. On a machine where Windows is not on `C:`, a
   user could still redirect `%SystemRoot%`. Policy through `HKLM\SOFTWARE\Policies\Aeka Scribe`
   registry values is not implemented. The `grantFileProtocolExtraPrivileges` fuse stays enabled
   because the interface loads ES modules from `file://`; moving to a custom protocol would allow
   disabling it.
6. **Code structure.** `workspace-panel.tsx`, `page.tsx` and `meeting-studio.tsx` remain large and 132
   lint warnings remain. Splitting them without interface tests risks regressions; add interface
   tests first, then split by page and adopt zod for validation.
7. **Storage names kept on purpose.** The vault file extension, the browser audio store and the web
   sign-in partition keep their 0.5 names so existing data and sign-ins survive the upgrade.
