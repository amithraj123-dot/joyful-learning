# Aeka Workspace 0.7.0: Review of the Team Workflow App and the Workflow Module

Aeka Advisors India LLP · 24 October 2026

## Scope

The "Aeka - Team Workflow" application built in Google AI Studio (React, about 7,800 lines, data held in
a Google Sheet through an Apps Script web app) was reviewed in full. Its functions were re-implemented,
with the defects below corrected, as the **Workflow** module of Aeka Workspace. The web app is now a
modular platform; Scribe (dictation and meetings) is its second module. See `ARCHITECTURE.md`.

## Principal findings on the earlier app

| Severity | Finding                                                                                                                                                                                                                                                          | Consequence                                                                                                                                               |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Critical | The whole firm's data was one JSON value in one Sheet cell; every edit re-sent everything and the last write won                                                                                                                                                 | Two people editing at once erased each other's work, including on unrelated clients; a pull and a save in one browser could also lose the user's own edit |
| Critical | No sign-in: identity was a name picked from a list, switchable at any time; admin rights depended on the display name "Devang Shah"                                                                                                                              | Anyone could act as anyone, including the administrator                                                                                                   |
| Critical | The Apps Script was deployed with "Anyone" access                                                                                                                                                                                                                | Anyone holding the link could read every deal, fee and performance review, or overwrite the data                                                          |
| Critical | No permission checks outside the browser; the billing screen ignored its own edit flag                                                                                                                                                                           | Every user, including Articles, could see and change fees, billing and invoices                                                                           |
| Critical | A Sheet cell holds 50,000 characters; a malformed reply loaded as an empty dataset                                                                                                                                                                               | Saves would fail permanently as data grew, and one bad reply could wipe the Sheet                                                                         |
| High     | The member's self-reflection and the manager's review were one record; a rating of 5 was saved on any blur                                                                                                                                                       | Members could read and overwrite their reviews                                                                                                            |
| High     | Every keystroke in any notes field saved the full dataset; offline retries looped without backoff                                                                                                                                                                | Slow typing, quota exhaustion                                                                                                                             |
| High     | Initials were used as identifiers; deletes were permanent, some without confirmation; the activity log was never shown                                                                                                                                           | Renames orphaned records; no audit trail                                                                                                                  |
| Medium   | "Urgent" could not be set after creation; task status and "done" diverged; two unlinked deal trackers with different status lists; assigning a task silently added the person to the mandate team; dates calculated in UTC; CSV export open to formula injection | Inconsistent records and misleading reports                                                                                                               |

The AI Studio template's Gemini, Express and dotenv dependencies were unused; the app had no AI
features and no server code.

## What the Workflow module provides

| Earlier function                | Now                                                                                                                                                                                                                                                                     |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stats grid                      | **Overview**: open and urgent mandates, outstanding engagement letters (non-closed only), invoices awaiting payment, overdue tasks, my open tasks, deadlines in 14 days; my tasks, upcoming deadlines and recent activity                                               |
| Client Portfolios               | **Clients and Mandates**: editable clients and mandates (title, type, all four statuses, stage, team, priority, restricted, deal); mandate detail with tasks, timesheet, deal tracker, team and reviews, billing, deadlines and activity; soft delete with a Trash view |
| All To-dos                      | **Tasks**: list, by client and by person views; filters; quick add; task drawer with steps, due date, preparer and reviewer (maker-checker enforced), move between mandates, explicit save with conflict handling                                                       |
| Deal Calendar                   | **Deadlines**: overdue and month views in India time, kinds, owners, editing (Manager and above)                                                                                                                                                                        |
| Deal Room and Live Deal Tracker | **Deal Tracker**: one tracker per deal with one status list; target and counterparty documents; residency-driven suggestions (Form 10F/ TRC, withholding and Form 15CA/CB, FEMA pricing, Form FC-TRS)                                                                   |
| Compliance Ledger               | **Engagements and Billing** (Manager and above): engagement letter and invoicing status, fee, billed (from invoices) and outstanding; invoice log                                                                                                                       |
| Timesheet tab and Export Hours  | **Timesheets**: own entries with description and billable flag, daily limit, 30-day edit window; firm export (Manager and above) grouped by entry, client, mandate or person                                                                                            |
| Team Admin                      | **Team and Access**: members by email with designation and admin rights; import from the Google Sheet                                                                                                                                                                   |
| Activity log (unused)           | **Activity**: firm-wide, paged, by module                                                                                                                                                                                                                               |

### Controls now enforced on the server

- Sign-in through the hosting platform; access only for active firm members added by an administrator.
- Manager and above (Assistant Manager upwards) for mandates, deadlines, billing and reviews; admins for
  members and import.
- Restricted mandates are invisible to anyone outside the team, other than Directors, Partners and
  admins; work on them can be assigned only to people inside that wall.
- Every record carries a revision; a stale edit is refused and the user reloads instead of overwriting.
- Separate self-reflection and review records; members read their own reviews but cannot change them.
- All changes are recorded in the firm activity trail without fees or feedback text.

## Moving the team across

1. Apply migrations `0004` and `0005` to the hosted database, then deploy.
2. Expand the Site's audience to the firm, then open Aeka Workspace: the first person becomes the
   administrator partner.
3. In **Team and Access**, add colleagues by email, then use **Import from Google Sheet** with the Apps
   Script URL: review the preview, map each set of initials to an email and run the import. Running it
   again does not create duplicates.
4. Retire the Sheet: change the Apps Script deployment to "Only myself", or delete it, because the
   earlier link remains readable by anyone who has it.

## Verification

- 90 web and shared tests (24 for Workflow: permissions, restricted mandates, conflicts, maker-checker,
  time rules, export, feedback visibility, deal tracker and import) and 72 desktop tests pass; types,
  formatting and lint (0 errors) pass; the web and desktop builds succeed.
- The module was exercised end to end on the local runtime (Workers with D1): client, mandate, task,
  sign-off, time, review, deadline, fee, invoice, deal tracker, export and import preview. Every page
  was checked at desktop and phone widths.

## Recommended next layers

1. **Scribe to Workflow link**: attach meeting notes and transcripts to a mandate and turn their action
   items into tasks.
2. **Statutory compliance calendar**: recurring due dates (advance tax, TDS returns, Form 3CEB, Form
   15CA/CB, FC-GPR, FLA return, DPT-3) generated per client, with owners.
3. **Reminders**: email digests for tasks due, items awaiting review, unsigned engagement letters and
   overdue invoices.
4. **Time cost and realisation**: rates by grade, time cost against fee, approvals.
5. **Firm dashboards**: pipeline by stage, workload by person and receivables ageing.
