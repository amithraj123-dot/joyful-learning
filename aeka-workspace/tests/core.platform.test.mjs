import test from 'node:test';
import assert from 'node:assert/strict';
import { moduleRequest } from '../core/server/router.ts';
import { coreModule } from '../core/server/core-module.ts';
import { database } from './helpers/database.mjs';

const origin = 'https://aeka-workspace.example';
const req = (module, action, p = {}, from = origin) =>
  new Request(origin + '/api/modules', {
    method: 'POST',
    headers: { Origin: from },
    body: JSON.stringify({ module, action, ...p }),
  });
const echo = {
  id: 'demo',
  actions: {
    open: { handler: () => 'member ok' },
    partnersOnly: {
      permission: (ctx) => ctx.member?.designation === 'Partner',
      handler: async (ctx) => {
        await ctx.log('demo.done', 'x', 'Did the partner thing');
        return 'partner ok';
      },
    },
  },
};
const modules = [coreModule, echo];
const call = async (db, user, module, action, p, from) => {
  const r = await moduleRequest(req(module, action, p, from), db, user, modules);
  return { status: r.status, body: await r.json() };
};
const amith = { userId: 'u1', email: 'Amith@Aeka.example', name: 'Amithraj AN' };
const priya = { userId: 'u2', email: 'priya@aeka.example', name: 'Priya Rao' };

test('module requests need sign-in, same origin and a known action', async () => {
  const db = database();
  assert.equal((await call(db, null, 'core', 'me')).status, 401);
  assert.equal((await call(db, amith, 'core', 'me', {}, 'https://evil.example')).status, 403);
  assert.equal((await call(db, amith, 'nope', 'me')).status, 404);
  assert.equal((await call(db, amith, 'core', 'toString')).status, 404);
  assert.equal((await call(db, amith, 'core', '__proto__')).status, 404);
});

test('the first signed-in person becomes the admin partner; others need to be added', async () => {
  const db = database();
  const me = (await call(db, amith, 'core', 'me')).body.value;
  assert.equal(me.member.email, 'amith@aeka.example');
  assert.equal(me.member.designation, 'Partner');
  assert.equal(me.member.isAdmin, true);
  assert.equal(me.member.initials, 'AA');
  const stranger = await call(db, priya, 'demo', 'open');
  assert.equal(stranger.status, 403);
  assert.match(stranger.body.error, /not a member/);
  assert.equal((await call(db, priya, 'core', 'me')).body.value.member, null);
  // Only admins add members.
  assert.equal(
    (
      await call(db, priya, 'core', 'members.save', {
        member: { email: priya.email, name: 'Priya Rao', designation: 'Partner', isAdmin: true },
      })
    ).status,
    403,
  );
  const added = await call(db, amith, 'core', 'members.save', {
    member: { email: 'PRIYA@aeka.example', name: 'Priya Rao', designation: 'Associate' },
  });
  assert.equal(added.status, 200);
  assert.equal(added.body.value.initials, 'PR');
  assert.equal((await call(db, priya, 'demo', 'open')).body.value, 'member ok');
  assert.equal((await call(db, priya, 'demo', 'partnersOnly')).status, 403);
  assert.equal((await call(db, amith, 'demo', 'partnersOnly')).body.value, 'partner ok');
  const activity = (await call(db, priya, 'core', 'activity.list')).body.value;
  assert.deepEqual(
    activity.map((a) => a.action),
    ['demo.done', 'member.added'],
  );
  assert.equal(activity[0].actorName, 'Amithraj AN');
});

test('members keep unique initials, a remaining admin, and lose access when deactivated', async () => {
  const db = database();
  await call(db, amith, 'core', 'me');
  const save = (member, user = amith) => call(db, user, 'core', 'members.save', { member });
  assert.equal(
    (await save({ email: 'x@aeka.example', name: 'Ann Able', initials: 'AA', designation: 'Article' }))
      .status,
    409,
  );
  assert.equal((await save({ email: 'bad', name: 'Bad', designation: 'Article' })).status, 400);
  assert.equal((await save({ email: 'y@aeka.example', name: 'Y', designation: 'Boss' })).status, 400);
  // The only admin cannot remove their own admin rights.
  assert.equal(
    (await save({ email: amith.email, name: 'Amithraj AN', designation: 'Partner', isAdmin: false })).status,
    409,
  );
  await save({ email: priya.email, name: 'Priya Rao', designation: 'Manager' });
  assert.equal((await call(db, amith, 'core', 'members.deactivate', { email: amith.email })).status, 409);
  assert.equal((await call(db, amith, 'core', 'members.deactivate', { email: priya.email })).status, 200);
  assert.equal((await call(db, priya, 'demo', 'open')).status, 403);
  const list = (await call(db, amith, 'core', 'members.list')).body.value;
  assert.deepEqual(
    list.map((m) => [m.email, m.active]),
    [
      ['amith@aeka.example', true],
      ['priya@aeka.example', false],
    ],
  );
});
