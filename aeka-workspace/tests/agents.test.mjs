// Agents: plain-text commands, the run loop with the assistant's and the agent's tools, approvals,
// schedules, events, automatic learning, templates and privacy. The AI is a scripted stand-in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getMember } from '../core/server/members.ts';
import { notify } from '../core/server/notifications.ts';
import { memberContext } from '../modules/assistant/server/context.ts';
import { agentsPass, agentsServer } from '../modules/agents/server/index.ts';
import { firm, people } from './fixtures/workflow-firm.mjs';

const MIN = 60000;
const HOUR = 60 * MIN;
const ist = (s) => Date.parse(s + '+05:30');
// Tuesday 27 Oct 2026, 11:00 am India time.
const T0 = ist('2026-10-27T11:00:00');
const AI_ENV = { LITELLM_BASE_URL: 'https://ai.aeka.example', LITELLM_API_KEY: 'test-key' };

let callId = 0;
const call = (name, args) => ({
  id: `call_${++callId}`,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
});

async function world() {
  // ai.script: a function (body) => { content, calls } for agent runs; planner and reflection answers
  // are set separately.
  const ai = { runs: [], plans: [], reflections: [], script: null, plan: null, lessons: [] };
  const fetcher = async (url, init) => {
    if (!String(url).startsWith('https://ai.aeka.example')) throw new Error('No network in tests');
    const body = JSON.parse(init.body);
    const system = body.messages[0].content;
    let message;
    if (system.startsWith('You turn a command')) {
      ai.plans.push(body);
      message = { role: 'assistant', content: JSON.stringify(ai.plan) };
    } else if (system.startsWith('You help an automated agent')) {
      ai.reflections.push(body);
      message = { role: 'assistant', content: JSON.stringify({ lessons: ai.lessons }) };
    } else {
      ai.runs.push(body);
      const step = ai.script(body);
      message = {
        role: 'assistant',
        content: step.content ?? null,
        ...(step.calls ? { tool_calls: step.calls } : {}),
      };
    }
    return Response.json({
      choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });
  };
  const f = await firm({ env: AI_ENV, fetcher });
  const sys = (now = T0) => ({ db: f.db, env: f.options.env, fetch: (...a) => f.options.fetcher(...a), now });
  const ctx = async (now = T0, key = 'admin') =>
    memberContext(sys(now), await getMember(f.db, people[key].email));
  const action = async (name, payload, now = T0, key = 'admin') =>
    agentsServer.actions[name].handler(await ctx(now, key), payload);
  const rows = (q, ...p) => f.db.sql.prepare(q).all(...p);
  return { f, ai, sys, ctx, action, rows };
}

// A run script from a list of steps: each step is the calls to make; the last is the report.
const steps = (...list) => {
  let i = 0;
  return () => list[Math.min(i++, list.length - 1)];
};
const lastToolResults = (body) =>
  body.messages.filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content));

test('the server implements exactly the actions of the shared contract', () => {
  const contract = readFileSync(new URL('../modules/agents/shared/contract.ts', import.meta.url), 'utf8');
  const start = contract.indexOf('export interface AgentsActions');
  const block = contract.slice(start, contract.indexOf('\n}\n', start));
  const names = [...block.matchAll(/^ {2}'?([\w.]+)'?: \{/gm)].map((m) => m[1]).sort();
  assert.ok(names.length >= 20);
  assert.deepEqual(Object.keys(agentsServer.actions).sort(), names);
  assert.equal(typeof agentsServer.tick, 'function');
});

test('a plain-text command is read as an agent: name, instruction and trigger', async () => {
  const w = await world();
  w.ai.plan = {
    name: 'Evening overdue check',
    instruction: 'List my overdue to-dos and Workflow tasks and notify me with the list.',
    trigger: { type: 'schedule', repeat: 'weekdays', firstRun: '2026-10-27T18:00+05:30' },
    explanation: 'Every weekday at 6 pm — list overdue work and notify you.',
  };
  const plan = await w.action('command.plan', { command: 'Every weekday at 6 pm, tell me what is overdue' });
  assert.equal(plan.name, 'Evening overdue check');
  assert.deepEqual(plan.trigger, { type: 'schedule', repeat: 'weekdays', at: ist('2026-10-27T18:00:00') });
  assert.match(plan.explanation, /^Every weekday at 6 pm, list overdue work and notify you\. First run /);
  assert.match(w.ai.plans[0].messages[1].content, /^<command>\nEvery weekday at 6 pm/);
  // An event command.
  w.ai.plan = {
    name: 'Kestrel urgent mail',
    instruction: 'Make a to-do for it.',
    trigger: { type: 'event', kinds: ['mail.urgent', 'bogus'], contains: 'Kestrel' },
    explanation: 'When an urgent email mentions Kestrel.',
  };
  const ev = await w.action('command.plan', { command: 'When urgent mail from Kestrel comes, make a to-do' });
  assert.deepEqual(ev.trigger, { type: 'event', kinds: ['mail.urgent'], contains: 'Kestrel' });
  // Without AI: on command, with the words as the instruction.
  w.f.options.env = {};
  const manual = await w.action('command.plan', { command: 'Summarise my week' });
  assert.deepEqual(manual.trigger, { type: 'manual' });
  assert.equal(manual.instruction, 'Summarise my week');
  await assert.rejects(w.action('command.plan', { command: '  ' }), /Enter what the agent should do/);
});

test('a command runs now with the assistant tools and reports each step', async () => {
  const w = await world();
  w.ai.script = steps(
    {
      calls: [
        call('create_todo', { title: 'Call Rahul about the SPA', priority: 'high' }),
        call('notify_me', { title: 'Done', body: 'Added the to-do.' }),
      ],
    },
    { content: 'I added a high-priority to-do to call Rahul and notified you.' },
  );
  const run = await w.action('command.run', {
    command: 'Add a to-do to call Rahul about the SPA, high priority',
  });
  assert.equal(run.status, 'done');
  assert.equal(run.agentId, null);
  assert.equal(run.summary, 'I added a high-priority to-do to call Rahul and notified you.');
  assert.deepEqual(
    run.steps.map((s) => [s.tool, s.ok]),
    [
      ['create_todo', true],
      ['notify_me', true],
    ],
  );
  assert.equal(w.rows("SELECT * FROM as_todos WHERE title = 'Call Rahul about the SPA'").length, 1);
  const n = w.rows("SELECT * FROM org_notifications WHERE kind = 'agent.report'");
  assert.deepEqual(
    n.map((x) => [x.title, x.body]),
    [['Command: Done', 'Added the to-do.']],
  );
  // The instruction is the only instruction; it is sent inside <instruction>.
  const system = w.ai.runs[0].messages[0].content;
  assert.match(
    system,
    /<instruction>\nAdd a to-do to call Rahul about the SPA, high priority\n<\/instruction>/,
  );
  assert.match(system, /never ask questions/);
  assert.ok(w.ai.runs[0].tools.some((t) => t.function.name === 'request_task'));
  assert.ok(w.ai.runs[0].tools.some((t) => t.function.name === 'my_work'));
  // One-off commands keep no notes.
  w.ai.script = steps(
    { calls: [call('update_notes', { notes: 'x' })] },
    { content: 'Could not keep notes.' },
  );
  const r2 = await w.action('command.run', { command: 'Remember this' });
  assert.equal(r2.steps[0].ok, false);
  assert.match(r2.steps[0].summary, /one-off command has no notes/);
});

test('outward actions wait for approval; approving creates the task, rejecting teaches the agent', async () => {
  const w = await world();
  const agent = await w.action('agent.save', {
    agent: {
      name: 'Falcon follow-up',
      instruction: 'Create a task to chase the SPA markup.',
      trigger: { type: 'manual' },
      status: 'active',
    },
  });
  w.ai.script = (body) => {
    const results = lastToolResults(body);
    if (!results.length) return { calls: [call('list_mandates', {})] };
    if (results.length === 1) {
      const m = results[0].result.mandates.find((x) => x.mandate === 'Project Falcon');
      return {
        calls: [
          call('request_task', {
            mandateId: m.id,
            title: 'Chase SPA markup',
            assignee: people.associate.email,
            dueDate: '2026-10-30',
            reason: 'The markup is overdue.',
          }),
          call('request_task', { mandateId: 'nope', title: 'X', reason: 'Y' }),
        ],
      };
    }
    return { content: 'Proposed one task for your approval.' };
  };
  const run = await w.action('agent.run', { id: agent.id });
  assert.deepEqual(
    run.steps.map((s) => [s.tool, s.ok]),
    [
      ['list_mandates', true],
      ['request_task', true],
      ['request_task', false],
    ],
  );
  assert.match(run.steps[2].summary, /no such mandate/);
  // Nothing created yet; the member is asked.
  assert.equal(w.rows("SELECT * FROM wf_tasks WHERE title = 'Chase SPA markup'").length, 0);
  const [pending] = await w.action('approvals.list', { status: 'pending' });
  assert.match(pending.title, /^Create the task "Chase SPA markup" on Vista Earth Group, Project Falcon$/);
  assert.match(pending.detail, /Assigned to asha@aeka\.example\.\nDue 2026-10-30\./);
  assert.equal(w.rows("SELECT * FROM org_notifications WHERE kind = 'agent.approval'").length, 1);
  // Another member can neither see nor decide it.
  assert.deepEqual(await w.action('approvals.list', {}, T0, 'partner'), []);
  await assert.rejects(
    w.action('approval.decide', { id: pending.id, approve: true }, T0, 'partner'),
    /could not be found/,
  );
  const { approval } = await w.action('approval.decide', { id: pending.id, approve: true }, T0 + MIN);
  assert.equal(approval.status, 'approved');
  assert.equal(approval.result, 'Task created: Chase SPA markup.');
  assert.equal(w.rows("SELECT * FROM wf_tasks WHERE title = 'Chase SPA markup'").length, 1);
  await assert.rejects(w.action('approval.decide', { id: pending.id, approve: true }), /already decided/);
  // The associate hears about the task assigned to them.
  assert.equal(w.rows("SELECT * FROM org_notifications WHERE kind = 'task.assigned'").length, 1);
  // A second proposal is rejected with a reason: a lesson is learnt and saved at once.
  await w.action('agent.run', { id: agent.id }, T0 + 2 * MIN);
  const [second] = await w.action('approvals.list', { status: 'pending' });
  w.ai.lessons = [{ text: 'Do not assign tasks to Asha; leave them unassigned.', scope: 'this_agent' }];
  const rejected = await w.action(
    'approval.decide',
    { id: second.id, approve: false, reason: 'Asha is on leave' },
    T0 + 3 * MIN,
  );
  assert.equal(rejected.approval.status, 'rejected');
  assert.deepEqual(
    rejected.lessons.map((l) => [l.text, l.agentId, l.source]),
    [['Do not assign tasks to Asha; leave them unassigned.', agent.id, 'approval']],
  );
  assert.match(w.ai.reflections.at(-1).messages[1].content, /rejected this proposed action/);
  // The failed step of the first run was reviewed too.
  assert.match(
    w.ai.reflections[0].messages[1].content,
    /These steps failed: request_task: Not done: There is no such mandate/,
  );
  const { agent: after } = await w.action('agent.get', { id: agent.id });
  assert.equal(after.stats.approved, 1);
  assert.equal(after.stats.rejected, 1);
  // The next run is given the lesson.
  w.ai.script = steps({ content: 'Nothing to do.' });
  await w.action('agent.run', { id: agent.id }, T0 + 4 * MIN);
  assert.match(
    w.ai.runs.at(-1).messages[0].content,
    /- Do not assign tasks to Asha; leave them unassigned\./,
  );
});

test('schedules run once per occurrence and move on; one-off schedules pause after running', async () => {
  const w = await world();
  w.ai.script = steps({ content: 'Checked.' });
  const daily = await w.action('agent.save', {
    agent: {
      name: 'Daily',
      instruction: 'Check.',
      trigger: { type: 'schedule', repeat: 'daily', at: ist('2026-10-27T18:00:00') },
      status: 'active',
    },
  });
  assert.equal(daily.nextRunAt, ist('2026-10-27T18:00:00'));
  const once = await w.action('agent.save', {
    agent: {
      name: 'Once',
      instruction: 'Check.',
      trigger: { type: 'schedule', repeat: 'once', at: T0 + HOUR },
      status: 'active',
    },
  });
  await assert.rejects(
    w.action('agent.save', {
      agent: {
        name: 'Past',
        instruction: 'x',
        trigger: { type: 'schedule', repeat: 'once', at: T0 - HOUR },
        status: 'active',
      },
    }),
    /time has passed/,
  );
  const admin = await getMember(w.f.db, people.admin.email);
  assert.equal(await agentsPass(w.sys(T0 + 30 * MIN), admin), 0);
  assert.equal(await agentsPass(w.sys(T0 + 61 * MIN), admin), 1);
  let o = (await w.action('agent.get', { id: once.id })).agent;
  assert.equal(o.status, 'paused');
  assert.equal(o.nextRunAt, null);
  assert.equal(await agentsPass(w.sys(ist('2026-10-27T18:01:00')), admin), 1);
  assert.equal(await agentsPass(w.sys(ist('2026-10-27T18:30:00')), admin), 0);
  const d = (await w.action('agent.get', { id: daily.id })).agent;
  assert.equal(d.nextRunAt, ist('2026-10-28T18:00:00'));
  assert.equal(d.stats.runs, 1);
  assert.equal((await w.action('runs.list', {})).filter((r) => r.trigger === 'schedule').length, 2);
});

test('event agents run on matching notices only, gathered, and never see chat text', async () => {
  const w = await world();
  w.ai.script = steps({ content: 'Handled.' });
  const before = await w.action('agent.save', {
    agent: {
      name: 'Kestrel watch',
      instruction: 'Make a to-do for each.',
      trigger: { type: 'event', kinds: ['mail.urgent', 'chats.action'], contains: 'kestrel' },
      status: 'active',
    },
  });
  const admin = await getMember(w.f.db, people.admin.email);
  const n = (kind, title, body, at, key) =>
    notify(
      w.f.db,
      { recipient: people.admin.email, module: 'x', kind, title, body, link: '', dedupeKey: key },
      at,
    );
  // Old notices (before the agent was saved) are not replayed.
  await n('mail.urgent', 'Urgent email from Kestrel Capital', 'Old', T0 - HOUR, 'k0');
  await n('mail.urgent', 'Urgent email from Kestrel Capital', 'SPA signing moved to Friday', T0 + MIN, 'k1');
  await n('mail.urgent', 'Urgent email from Northwind', 'Other', T0 + MIN, 'k2');
  await n('chats.action', 'Needs your reply: Kestrel desk (WhatsApp)', 'Private chat text', T0 + MIN, 'k3');
  await n('reminder', 'Kestrel call', '', T0 + MIN, 'k4');
  assert.equal(await agentsPass(w.sys(T0 + 2 * MIN), admin), 1);
  const system = w.ai.runs[0].messages[0].content;
  assert.match(
    system,
    /mail\.urgent at [^:]+:\d\d:\d\d\+05:30: Urgent email from Kestrel Capital: SPA signing moved to Friday/,
  );
  assert.match(system, /chats\.action at .*: Needs your reply: Kestrel desk \(WhatsApp\)\n/);
  assert.ok(!system.includes('Private chat text'));
  assert.ok(!system.includes('Northwind'));
  assert.ok(!system.includes('Old'));
  // Within 5 minutes nothing reruns; later, only new notices count.
  await n('mail.urgent', 'Urgent email from Kestrel Capital', 'Second', T0 + 3 * MIN, 'k5');
  assert.equal(await agentsPass(w.sys(T0 + 4 * MIN), admin), 0);
  assert.equal(await agentsPass(w.sys(T0 + 8 * MIN), admin), 1);
  assert.match(w.ai.runs[1].messages[0].content, /Second/);
  assert.ok(!w.ai.runs[1].messages[0].content.includes('SPA signing'));
  // Agent notices never start agents (no loops).
  assert.equal(await agentsPass(w.sys(T0 + 20 * MIN), admin), 0);
  assert.equal((await w.action('agent.get', { id: before.id })).agent.stats.runs, 2);
});

test('agents learn: notes between runs, lessons they save, and lessons from ratings', async () => {
  const w = await world();
  const agent = await w.action('agent.save', {
    agent: {
      name: 'Weekly digest',
      instruction: 'Summarise my week.',
      trigger: { type: 'manual' },
      status: 'active',
    },
  });
  w.ai.script = steps(
    {
      calls: [
        call('update_notes', { notes: 'Reported up to 27 Oct.' }),
        call('save_lesson', { lesson: 'Keep the digest to five bullet points.', scope: 'all_agents' }),
        call('save_lesson', { lesson: 'keep the digest to five bullet points', scope: 'all_agents' }),
      ],
    },
    { content: 'Summary sent.' },
  );
  const run = await w.action('agent.run', { id: agent.id });
  assert.deepEqual(
    run.steps.map((s) => s.summary),
    [
      'Updated its notes for the next run',
      'Learnt: Keep the digest to five bullet points.',
      'That lesson was already known',
    ],
  );
  assert.equal((await w.action('agent.get', { id: agent.id })).agent.notes, 'Reported up to 27 Oct.');
  // A poor rating with a comment teaches; a good rating without one does not call AI.
  w.ai.lessons = [{ text: 'Mention overdue Workflow tasks first.', scope: 'this_agent' }];
  const fb = await w.action('run.feedback', {
    id: run.id,
    rating: -1,
    comment: 'Overdue tasks should come first',
  });
  assert.deepEqual(
    fb.lessons.map((l) => [l.text, l.source]),
    [['Mention overdue Workflow tasks first.', 'feedback']],
  );
  assert.equal(fb.run.rating, -1);
  const calls = w.ai.reflections.length;
  await w.action('run.feedback', { id: run.id, rating: 1 });
  assert.equal(w.ai.reflections.length, calls);
  const stats = (await w.action('agent.get', { id: agent.id })).agent.stats;
  assert.deepEqual([stats.good, stats.bad], [1, 0]);
  // Next run: notes and both lessons are in its instructions; lessons count their use.
  w.ai.script = steps({ content: 'Done.' });
  await w.action('agent.run', { id: agent.id }, T0 + MIN);
  const system = w.ai.runs.at(-1).messages[0].content;
  assert.match(system, /<notes>\nReported up to 27 Oct\.\n<\/notes>/);
  assert.match(system, /- Mention overdue Workflow tasks first\./);
  assert.match(system, /- Keep the digest to five bullet points\./);
  const lessons = await w.action('lessons.list', {});
  assert.ok(lessons.every((l) => l.uses >= 1));
  // The member can add, see and remove lessons; duplicates are refused.
  const mine = await w.action('lesson.save', { agentId: null, text: 'Write amounts in lakh and crore.' });
  assert.equal(mine.source, 'member');
  await assert.rejects(
    w.action('lesson.save', { agentId: null, text: 'write amounts in lakh and crore' }),
    /already there/,
  );
  await w.action('lesson.delete', { id: mine.id });
  assert.ok(!(await w.action('lessons.list', {})).some((l) => l.id === mine.id));
  await w.action('agent.clearNotes', { id: agent.id });
  assert.equal((await w.action('agent.get', { id: agent.id })).agent.notes, '');
});

test('templates: partners publish, anyone copies as a paused agent; agents stay private', async () => {
  const w = await world();
  const mine = await w.action('agent.save', {
    agent: {
      name: 'Deadline sweep',
      instruction: 'List deadlines in the next 7 days.',
      trigger: { type: 'schedule', repeat: 'weekly', at: ist('2026-11-02T09:00:00') },
      status: 'active',
    },
  });
  // The associate cannot publish.
  const theirs = await w.action(
    'agent.save',
    { agent: { name: 'x', instruction: 'y', trigger: { type: 'manual' }, status: 'active' } },
    T0,
    'associate',
  );
  await assert.rejects(
    w.action('template.publish', { agentId: theirs.id, description: 'd' }, T0, 'associate'),
    /Only Partners/,
  );
  const tpl = await w.action('template.publish', {
    agentId: mine.id,
    description: 'Every Monday, deadlines for the week.',
  });
  assert.equal(tpl.authorName, 'Amith Rao');
  const copy = await w.action('template.copy', { id: tpl.id }, T0, 'associate');
  assert.equal(copy.status, 'paused');
  assert.equal(copy.templateId, tpl.id);
  assert.equal(copy.notes, '');
  assert.equal((await w.action('templates.list', {}, T0, 'manager'))[0].copies, 1);
  await assert.rejects(w.action('template.delete', { id: tpl.id }, T0, 'associate'), /Only its author/);
  // Private: another member cannot read, run or delete my agent, or see my runs.
  await assert.rejects(w.action('agent.get', { id: mine.id }, T0, 'partner'), /could not be found/);
  await assert.rejects(w.action('agent.run', { id: mine.id }, T0, 'partner'), /could not be found/);
  assert.deepEqual((await w.action('agents.list', {}, T0, 'partner')).agents, []);
  // Conflicting edits are refused.
  await w.action('agent.save', {
    id: mine.id,
    agent: { ...mine, name: 'Renamed' },
    baseRevision: mine.revision,
  });
  await assert.rejects(
    w.action('agent.save', { id: mine.id, agent: { ...mine, name: 'Again' }, baseRevision: mine.revision }),
    /changed since/,
  );
  await w.action('agent.delete', { id: mine.id });
  assert.deepEqual((await w.action('agents.list', {})).agents, []);
});
