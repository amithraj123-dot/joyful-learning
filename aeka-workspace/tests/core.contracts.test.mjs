import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// callModule sends { ...payload, module, action }: a payload field named module or action would be
// overwritten by the envelope and never reach the server.
test('no action payload uses the reserved envelope keys module or action', () => {
  const root = new URL('../modules/', import.meta.url);
  const offenders = [];
  for (const mod of readdirSync(root)) {
    let text;
    try {
      text = readFileSync(new URL(`${mod}/shared/contract.ts`, root), 'utf8');
    } catch {
      continue;
    }
    const re = /payload:\s*\{/g;
    let m;
    while ((m = re.exec(text))) {
      // The payload object literal, up to its matching brace.
      let depth = 0,
        i = m.index + m[0].length - 1;
      for (; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}' && --depth === 0) break;
      }
      const body = text.slice(m.index, i + 1);
      // Only keys at the top level of the payload object matter.
      let level = 0,
        top = '';
      for (const ch of body.slice(body.indexOf('{') + 1, -1)) {
        if (ch === '{') level++;
        if (level === 0) top += ch;
        if (ch === '}') level--;
      }
      if (/(^|[\s;{])(module|action)\??:/.test(top))
        offenders.push(`${mod}: ${body.replace(/\s+/g, ' ').slice(0, 120)}`);
    }
  }
  assert.deepEqual(offenders, []);
});
