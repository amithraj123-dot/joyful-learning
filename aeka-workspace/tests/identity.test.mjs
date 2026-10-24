import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('self-hosted deployments drop client-supplied platform identity headers', async () => {
  // The worker module imports the framework handler, so check the exported helper in isolation.
  const source = fs.readFileSync(new URL('../build/sites-worker.ts', import.meta.url), 'utf8');
  const helper = source.slice(
    source.indexOf('export function withoutPlatformIdentity'),
    source.indexOf('export default'),
  );
  const { withoutPlatformIdentity } = await import(
    'data:text/javascript,' + encodeURIComponent(helper.replace('(request: Request)', '(request)'))
  );
  const forged = new Request('https://example.test/api/cloud', {
    headers: {
      'oai-authenticated-user-id': 'victim',
      'oai-authenticated-user-email': 'v@x.test',
      Origin: 'o',
    },
  });
  const clean = withoutPlatformIdentity(forged);
  assert.equal(clean.headers.get('oai-authenticated-user-id'), null);
  assert.equal(clean.headers.get('oai-authenticated-user-email'), null);
  assert.equal(clean.headers.get('origin'), 'o');
  assert.match(source, /env\.AEKA_SELF_HOSTED === 'true'\) request = withoutPlatformIdentity\(request\)/);
});
