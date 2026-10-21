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

### Verification

120 automated tests pass (57 web and shared, 63 desktop; 8 new tests cover the clean-up, snippet,
search, sharing, error, helper and migration fixes). TypeScript, Prettier and ESLint (0 errors)
pass, and the web and desktop interface builds succeed.

## Open recommendations

Each item lists options; the first is the recommended course.

1. **Windows smoke test before distribution.** Nothing in the Windows path was run in this review.
   - Run the checklist in the setup guide on a clean Windows 11 machine, including an upgrade over
     Flow Desktop 0.5 with notes in the vault.
   - Alternatively, add a Windows CI job (GitHub Actions `windows-latest`) that launches the app and
     runs the helper and migration tests on Windows.
2. **Identity headers in a self-hosted deployment.** The server trusts `oai-authenticated-user-*`
   request headers, which the OpenAI Sites edge sets. Behind any other host, anyone could send them.
   - Keep the Sites deployment; do not host elsewhere without the next step.
   - Before moving hosts, strip those headers in `build/sites-worker.ts` and verify a signed
     assertion instead (for example Cloudflare Access).
3. **Update trust anchors.** The renderer can set the update feed, Ed25519 key and publisher
   thumbprint; any renderer compromise would then become code execution.
   - Pin the key and thumbprint in `policy.json` or at build time, and confirm configuration and
     installation in a native dialog.
   - Alternatively, keep the current behaviour and only confirm in a native dialog.
4. **Managed policy hardening.** A standard user can redirect `%ProgramData%` through an environment
   variable, and the per-user install allows editing the application archive.
   - Read the policy location from `HKLM` (or `HKLM\SOFTWARE\Policies\Aeka Scribe`), ship a
     per-machine installer and enable Electron fuses (ASAR integrity, only-load-from-ASAR).
   - Alternatively, document that the policy is advisory for unmanaged machines.
5. **Performance at scale.** Every poll, save and meeting chunk downloads all notes (up to 2,000 notes
   or 16 MB), and every request rescans notes for retention.
   - Add `notes.get` and `notes.index` actions and a stored `last_retention_at` per owner (one D1
     migration).
   - Alternatively, lower the poll frequency only, which reduces load without changing the API.
6. **Notes left in "recording" after a browser crash.** Such notes cannot be trashed and are exempt
   from retention.
   - Mark a "recording" note older than six hours as interrupted, on the server.
   - Alternatively, offer a "Mark as finished" button on the note.
7. **Code structure.** `workspace-panel.tsx`, `page.tsx` and `meeting-studio.tsx` hold most of the
   interface; 133 lint warnings (mostly `any` and effect patterns) remain.
   - Split by page into smaller components and adopt a schema validator (zod is already a
     dependency) for note, settings and request validation.
   - Alternatively, tighten types file by file as features change.
8. **Remaining "flow" names that users do not see.** Internal identifiers (`window.flowDesktop`,
   `flow-core.ts`, IPC channel and storage keys) and the hosted address
   `flow-voice-workspace.amithraj123.chatgpt.site` are unchanged, so existing installs and data keep
   working.
   - Redeploy the Site under an Aeka address, then update `cloudOrigin` in `desktop/main.cjs` and the
     ChatGPT plugin registration.
   - Rename internal identifiers in the same release, with a storage-key migration.
9. **Smaller items.** The Team panel warns about unsaved edits when there are none; the workspace
   cloud-AI switch does not govern `/api/transcribe`; hold-to-talk is fixed to F8; automatic updates
   re-download an installer that is already verified; audit entries mix user IDs and emails.
