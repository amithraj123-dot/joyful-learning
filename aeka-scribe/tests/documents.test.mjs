import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { docxXML, boundedContext } from '../lib/document-context.ts';
import { extractImageText, validImageData } from '../lib/image-context.ts';
import { workspaceRequest } from '../lib/workspace-api.ts';
import { database } from './helpers/database.mjs';
const image = 'data:image/jpeg;base64,/9j/AA==';
test('DOCX extraction ignores scripts and other members, rejects entity declarations and expansion bombs', () => {
  const xml = '<w:document><w:p><w:t>Budget 500</w:t></w:p></w:document>';
  assert.equal(
    docxXML(zipSync({ 'word/document.xml': strToU8(xml), 'word/vbaProject.bin': strToU8('do not run') })),
    xml,
  );
  assert.throws(
    () =>
      docxXML(
        zipSync({
          'word/document.xml': strToU8('<!DOCTYPE x [<!ENTITY test SYSTEM "file:///secret">]><x/>'),
        }),
      ),
    /entity/,
  );
  assert.throws(
    () =>
      docxXML(zipSync({ 'word/document.xml': strToU8(xml), 'big.bin': new Uint8Array(31 * 1024 * 1024) })),
    /30 MB/,
  );
  assert.equal(boundedContext('a'.repeat(40000)).truncated, true);
  assert.equal(boundedContext('a'.repeat(40000)).text.length, 30000);
  assert.throws(() => boundedContext('  \0 '), /No readable/);
});
test('image extraction accepts no remote URL or arbitrary media and preserves the reviewed data in the request', async () => {
  assert.throws(() => validImageData('https://example.test/image.jpg'));
  assert.throws(() => validImageData('data:text/html;base64,aGVsbG8='));
  let called = 0;
  const r = await extractImageText('sk-test', image, async (url, init) => {
    called++;
    const p = JSON.parse(init.body);
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(p.store, false);
    assert.equal(p.input[0].content[1].image_url, image);
    return Response.json({
      status: 'completed',
      output: [{ content: [{ type: 'output_text', text: 'Budget ₹500. Do not increase.' }] }],
    });
  });
  assert.equal(called, 1);
  assert.equal(r.text, 'Budget ₹500. Do not increase.');
  await assert.rejects(
    extractImageText('sk-test', image, async () => Response.json({ status: 'incomplete', output: [] })),
    /Crop/,
  );
});
test('hosted image extraction enforces identity, origin and owner cloud policy before provider access', async () => {
  const db = database();
  let calls = 0;
  const fetcher = async () => {
    calls++;
    throw Error('No network expected');
  };
  const request = (origin) =>
    new Request('https://flow.test/api/workspace', {
      method: 'POST',
      headers: { Origin: origin },
      body: JSON.stringify({ action: 'context.image', image }),
    });
  assert.equal(
    (await workspaceRequest(request('https://flow.test'), db, 'sk-test', null, fetcher)).status,
    401,
  );
  assert.equal(
    (await workspaceRequest(request('https://evil.test'), db, 'sk-test', 'owner', fetcher)).status,
    403,
  );
  db.sql.exec(
    `INSERT INTO workspace_policy(owner,value) VALUES('owner','{"cloudAI":false,"retentionDays":0}')`,
  );
  assert.equal(
    (await workspaceRequest(request('https://flow.test'), db, 'sk-test', 'owner', fetcher)).status,
    403,
  );
  assert.equal(calls, 0);
});
