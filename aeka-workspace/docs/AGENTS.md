# Aeka Agents

Aeka Advisors India LLP · 27 October 2026

Agents are automated workflows a member describes in plain words, for example "Every weekday at
6 pm, list my overdue to-dos and Workflow tasks and notify me", or "When an urgent email mentions
Kestrel, make a to-do and draft a holding reply". The workspace reads the command (one AI call) as a
name, an instruction and a trigger, which the member confirms or edits before saving.

## When agents run

| Trigger                | How                                                                                                                                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| On command             | "Run now" on an agent, or a one-off command typed in Agents                                                                                                                                          |
| On a schedule          | Once, every day, every weekday, every week or every month, in India time, from a first run; a monthly one on the 31st keeps to the 31st                                                              |
| When something happens | Workspace notices of chosen kinds (urgent or important email, a chat needing a reply, a task assigned, a to-do due, a reminder, a meeting, the brief), optionally only those mentioning chosen words |

Background work starts scheduled and event agents every few minutes: at most three runs per member at
a time, an event agent at most every 5 minutes (gathering what happened meanwhile), and any agent at
most 30 times a day. Old notices are never replayed when an agent is switched on.

## What an agent can do

A run is a bounded tool loop (6 model calls, 12 tool calls, 2.5 minutes) on the member's own data,
with the same tools as Ask Aeka: to-dos, reminders, memory, Scribe notes, triaged mail and email
drafts, the calendar (read only), phone chats (listed, never read in full), Workflow tasks, mandates
and deadlines. Agent tools add:

- **notify_me**: a notice in the workspace and on the phone (at most 3 per run);
- **update_notes**: what the agent keeps between runs (2,000 characters);
- **save_lesson**: a lasting lesson about how the member wants the work done;
- **list_mandates**;
- **draft_chat_reply**: a reply to a phone chat, prepared for the member to review and send from Chats
  on the phone (never for chats kept from AI);
- **request_send_email**, **request_task** and **request_task_update** (status, due date or
  assignee): proposals that wait for approval.

Agents do not create other agents. Calendar changes are not available: the Outlook calendar is read
only by the firm's choice.

Agents never send anything themselves. Sending an email draft, or creating or changing a Workflow task, waits in
"Waiting for your approval" (also in the brief and on the phone); approving carries it out as the
member with every check of Mail's Send and Workflow's task rules and ethical walls. Approvals expire
after 7 days. Content from mail, chats and notices is passed to the model as data, never as
instructions; chat notices are passed by their title only.

## Creating agents from Ask Aeka and WhatsApp

Asked for something recurring or automatic in Ask Aeka or on WhatsApp ("every Friday at 4 pm, remind me
to fill in my timesheet"), the assistant creates the agent (switched on) and says how it read the
command and when it first runs. "What agents do I have?" lists them.

## Limits and the weekly report

- Each agent has a monthly limit of AI calls (300 unless changed; 0 for no limit). A run makes about 2
  to 6 calls, and learning from it one more. When the limit is reached the agent stops until the 1st
  (India time) and the member is told once; Run now says so too. The agent's page shows the calls used
  this month.
- Every Monday from 9 am, members with agents get "Your agents last week": runs (and failures),
  ratings, approvals, lessons learnt and AI calls used, for each agent, without AI.

## Memory and learning

- **Memory**: the member's Assistant memory (shared with Ask Aeka) and each agent's own notes.
- **Learning is automatic.** Lessons come from the agent (save_lesson), and from one AI call after a
  poor rating, a comment, a rejected approval or a run whose steps failed. Each lesson is a short
  rule about how to work, never a copied fact; duplicates are dropped; at most 30 per agent and 30
  for every agent, the least used going first. Every later run is given its lessons, and the member
  sees, adds and removes them under Memory and learning.
- Each agent shows its runs, ratings and approval decisions, so its improvement can be seen.

## Templates

Five starter templates by Aeka come with the workspace: Evening overdue sweep (weekdays 6 pm), Morning
deadline check (weekdays 9 am), Urgent email handler (an urgent email arrives), Chats waiting digest
(weekdays 1 pm) and Friday follow-up sweep (Fridays 4 pm). Only an administrator can remove them.

Partners and administrators publish an agent as a firm template (its name, instruction and trigger,
without its notes or lessons). Any member copies a template as their own agent, paused until they
switch it on; it then runs on their own data with their own permissions.
