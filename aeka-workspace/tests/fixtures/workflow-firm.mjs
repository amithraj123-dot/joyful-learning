// A small firm for the Workflow tests: members of every grade, called through the real module router.
import { moduleRequest } from '../../core/server/router.ts';
import { serverModules } from '../../core/server/registry.ts';
import { database } from '../helpers/database.mjs';

const origin = 'https://aeka-workspace.example';
const person = (email, name) => ({ userId: email, email, name });

export const people = {
  admin: person('amith@aeka.example', 'Amith Rao'), // first user: admin Partner
  partner: person('pia@aeka.example', 'Pia Nair'),
  director: person('dina@aeka.example', 'Dina Kapoor'),
  manager: person('mona@aeka.example', 'Mona Iyer'),
  am: person('arun@aeka.example', 'Arun Bose'),
  associate: person('asha@aeka.example', 'Asha Verma'),
  article: person('arti@aeka.example', 'Arti Shah'),
  opsAdmin: person('ola@aeka.example', 'Ola Fernandes'), // an admin with the most junior designation
  outsider: person('x@elsewhere.example', 'Xavier'),
};
const roster = [
  ['partner', 'Partner', false],
  ['director', 'Director', false],
  ['manager', 'Manager', false],
  ['am', 'Assistant Manager', false],
  ['associate', 'Associate', false],
  ['article', 'Article', false],
  ['opsAdmin', 'Article', true],
];

export const matterInput = (clientId, over = {}) => ({
  clientId,
  title: 'Project Falcon',
  type: 'Deal (Buy Side)',
  status: 'active',
  stage: 'Due Diligence',
  priority: false,
  note: '',
  team: [],
  restricted: false,
  peerFeedbackVisible: false,
  isDeal: true,
  ...over,
});
export const taskInput = (matterId, over = {}) => ({
  matterId,
  title: 'Draft SPA comments',
  status: 'Preparing',
  assignee: null,
  preparedBy: null,
  reviewedBy: null,
  dueDate: null,
  priority: false,
  notes: '',
  steps: [],
  ...over,
});

export async function firm() {
  const db = database();
  const send = async (who, module, action, payload = {}) => {
    const user = typeof who === 'string' ? people[who] : who;
    const r = await moduleRequest(
      new Request(origin + '/api/modules', {
        method: 'POST',
        headers: { Origin: origin },
        body: JSON.stringify({ module, action, ...payload }),
      }),
      db,
      user,
      serverModules,
    );
    const body = await r.json();
    return { status: r.status, value: body.value, error: body.error };
  };
  const wf = (who, action, payload) => send(who, 'workflow', action, payload);
  // Calls that must succeed return their value.
  const ok = async (who, action, payload) => {
    const r = await wf(who, action, payload);
    if (r.status !== 200) throw new Error(`${action} by ${who}: ${r.status} ${r.error}`);
    return r.value;
  };
  await send('admin', 'core', 'me');
  for (const [key, designation, isAdmin] of roster)
    await send('admin', 'core', 'members.save', {
      member: { email: people[key].email, name: people[key].name, designation, isAdmin },
    });
  const client = await ok('admin', 'client.create', { client: { name: 'Vista Earth Group', notes: '' } });
  const open = await ok('admin', 'matter.create', {
    matter: matterInput(client.id, { team: [people.associate.email, people.manager.email] }),
  });
  // Behind an ethical wall: only the associate is on the team.
  const walled = await ok('admin', 'matter.create', {
    matter: matterInput(client.id, {
      title: 'Project Kite',
      restricted: true,
      team: [people.associate.email],
    }),
  });
  return { db, wf, ok, send, client, open, walled };
}
