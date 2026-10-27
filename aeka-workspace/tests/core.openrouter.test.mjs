// The AI client works with OpenRouter as well as the LiteLLM proxy: same protocol, an explicit
// provider-prefixed model, and the application name sent along.
import test from 'node:test';
import assert from 'node:assert/strict';
import { aiStatus, chat } from '../core/server/ai.ts';
import { database } from './helpers/database.mjs';

const env = {
  LITELLM_BASE_URL: 'https://openrouter.ai/api/v1',
  LITELLM_API_KEY: 'sk-or-test',
  AEKA_PUBLIC_ORIGIN: 'https://aeka.example',
};

test('OpenRouter needs a provider-prefixed model; requests carry the app name', async () => {
  assert.match(aiStatus(env).reason, /OpenRouter model id/);
  const ready = {
    ...env,
    LITELLM_MODEL: 'anthropic/claude-sonnet-4.5',
    LITELLM_FAST_MODEL: 'anthropic/claude-haiku-4.5',
  };
  assert.deepEqual([aiStatus(ready).ready, aiStatus(ready).fastModel], [true, 'anthropic/claude-haiku-4.5']);
  const seen = [];
  const fetch = async (url, init) => {
    seen.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return Response.json({
      choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
  };
  const r = await chat(
    { db: database(), env: ready, fetch, now: Date.now() },
    {
      purpose: 'other',
      module: 'core',
      actor: 'system',
      model: 'fast',
      messages: [{ role: 'user', content: 'hi' }],
    },
  );
  assert.equal(r.message.content, 'ok');
  assert.equal(seen[0].url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(seen[0].body.model, 'anthropic/claude-haiku-4.5');
  assert.equal(seen[0].headers.Authorization, 'Bearer sk-or-test');
  assert.equal(seen[0].headers['X-Title'], 'Aeka Workspace');
  assert.equal(seen[0].headers['HTTP-Referer'], 'https://aeka.example');
  // The LiteLLM proxy gets no OpenRouter headers and keeps its default model.
  const lite = { LITELLM_BASE_URL: 'https://ai.aeka.example', LITELLM_API_KEY: 'k' };
  assert.equal(aiStatus(lite).ready, true);
  await chat(
    { db: database(), env: lite, fetch, now: Date.now() },
    { purpose: 'other', module: 'core', actor: 'system', messages: [{ role: 'user', content: 'hi' }] },
  );
  assert.equal(seen[1].url, 'https://ai.aeka.example/v1/chat/completions');
  assert.equal(seen[1].headers['X-Title'], undefined);
});
