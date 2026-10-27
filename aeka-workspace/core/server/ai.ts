// The firm's AI service: the LiteLLM proxy (OpenAI-compatible chat completions). Every call, including
// failed ones, is metered in ai_usage; a member's daily call limit and a firm-wide kill switch are
// enforced before anything is sent. Content passed here leaves the workspace for the proxy, so
// callers send only what the task needs.
import { CloudError } from '../../lib/cloud-store.ts';
import { configured, type ServerEnv } from './env.ts';

export type AiPurpose = 'triage' | 'draft' | 'chat' | 'brief' | 'other';
export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';
export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}
export interface ChatMessage {
  role: ChatRole;
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}
export interface ToolSchema {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}
export interface AiRequest {
  purpose: AiPurpose;
  module: string;
  actor: string; // member email, or "system"
  model?: 'fast' | 'strong';
  messages: ChatMessage[];
  tools?: ToolSchema[];
  json?: boolean; // ask for a JSON object reply
  maxTokens?: number;
  temperature?: number;
}
export interface AiResult {
  message: ChatMessage;
  finish: string;
  model: string;
  usage: { prompt: number; completion: number };
}
export interface AiDeps {
  db: D1Database;
  env: ServerEnv;
  fetch: typeof fetch;
  now: number;
}

const DEFAULT_MODEL = 'claude-sonnet-4.6';
// On OpenRouter the workspace uses Sonnet 6, the model the firm's deck engine uses, unless
// LITELLM_MODEL names another.
export const OPENROUTER_MODEL = 'anthropic/claude-sonnet-6';
const TIMEOUT_MS = 60000;
const dayStartIST = (now: number) => {
  const d = new Date(now + 330 * 60000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - 330 * 60000;
};

export const aiConfigured = (env: ServerEnv) =>
  configured(env.LITELLM_BASE_URL, env.LITELLM_API_KEY) && env.AEKA_AI_DISABLED !== 'true';

// OpenRouter (https://openrouter.ai/api/v1) speaks the same protocol as LiteLLM; its model ids name the
// provider ("anthropic/claude-sonnet-6"), so a model id without one is refused there.
export const isOpenRouter = (base: string | undefined) => {
  try {
    return !!base && new URL(base.trim()).hostname.endsWith('openrouter.ai');
  } catch {
    return false;
  }
};

export function aiStatus(env: ServerEnv) {
  if (env.AEKA_AI_DISABLED === 'true') return { ready: false, reason: 'AI is switched off for the firm.' };
  if (!configured(env.LITELLM_BASE_URL, env.LITELLM_API_KEY))
    return { ready: false, reason: 'The firm AI service (LiteLLM or OpenRouter) is not configured.' };
  const openRouter = isOpenRouter(env.LITELLM_BASE_URL);
  const fallback = openRouter ? OPENROUTER_MODEL : DEFAULT_MODEL;
  const model = env.LITELLM_MODEL?.trim() || fallback;
  const fastModel = env.LITELLM_FAST_MODEL?.trim() || model;
  if (openRouter && !(model.includes('/') && fastModel.includes('/')))
    return {
      ready: false,
      reason: `Set LITELLM_MODEL to an OpenRouter model id with its provider, for example ${OPENROUTER_MODEL}.`,
    };
  return { ready: true, reason: '', model, fastModel };
}

function endpoint(base: string) {
  const url = new URL(base.trim());
  if (url.username || url.password || url.search || url.hash)
    throw new CloudError('The AI service address must not contain credentials or a query.', 503);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
    throw new CloudError('The AI service must use HTTPS.', 503);
  const path = url.pathname.replace(/\/+$/, '');
  return url.origin + (path.endsWith('/v1') ? path : path + '/v1') + '/chat/completions';
}

export async function usedToday(db: D1Database, actor: string, now: number) {
  const r = await db
    .prepare('SELECT count(*) AS n FROM ai_usage WHERE actor = ? AND at >= ?')
    .bind(actor, dayStartIST(now))
    .first<{ n: number }>();
  return r?.n ?? 0;
}

const limitFor = (env: ServerEnv) => {
  const n = Number(env.AEKA_AI_DAILY_LIMIT);
  return Number.isInteger(n) && n > 0 ? n : 400;
};

async function meter(
  deps: AiDeps,
  req: AiRequest,
  model: string,
  ok: boolean,
  usage: { prompt: number; completion: number },
  error = '',
) {
  await deps.db
    .prepare(
      'INSERT INTO ai_usage(id,at,actor,module,purpose,model,ok,prompt_tokens,completion_tokens,error) VALUES(?,?,?,?,?,?,?,?,?,?)',
    )
    .bind(
      crypto.randomUUID(),
      deps.now,
      req.actor,
      req.module,
      req.purpose,
      model,
      ok ? 1 : 0,
      usage.prompt,
      usage.completion,
      error.slice(0, 300),
    )
    .run();
}

export async function chat(deps: AiDeps, req: AiRequest): Promise<AiResult> {
  const status = aiStatus(deps.env);
  if (!status.ready) throw new CloudError(status.reason, 503);
  if (req.actor !== 'system' && (await usedToday(deps.db, req.actor, deps.now)) >= limitFor(deps.env))
    throw new CloudError('Your AI allowance for today has been used. It resets at midnight India time.', 429);
  const model = req.model === 'fast' ? status.fastModel! : status.model!;
  const body: Record<string, unknown> = {
    model,
    messages: req.messages,
    max_tokens: req.maxTokens ?? 1500,
    temperature: req.temperature ?? 0.2,
  };
  if (req.tools?.length) body.tools = req.tools;
  if (req.json) body.response_format = { type: 'json_object' };
  let res: Response;
  try {
    res = await deps.fetch(endpoint(deps.env.LITELLM_BASE_URL!), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${deps.env.LITELLM_API_KEY}`,
        'Content-Type': 'application/json',
        // OpenRouter shows usage under this application name.
        ...(isOpenRouter(deps.env.LITELLM_BASE_URL)
          ? {
              'HTTP-Referer': deps.env.AEKA_PUBLIC_ORIGIN || 'https://aeka.example',
              'X-Title': 'Aeka Workspace',
            }
          : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    if (e instanceof CloudError) throw e;
    await meter(deps, req, model, false, { prompt: 0, completion: 0 }, 'network');
    throw new CloudError('The AI service could not be reached. Try again shortly.', 502);
  }
  if (!res.ok) {
    await meter(deps, req, model, false, { prompt: 0, completion: 0 }, `http ${res.status}`);
    throw new CloudError(
      res.status === 401 || res.status === 403
        ? 'The firm AI key was refused. An administrator must renew LITELLM_API_KEY.'
        : res.status === 429
          ? 'The AI service is busy or over its limit. Try again shortly.'
          : (res.status === 400 || res.status === 404) && isOpenRouter(deps.env.LITELLM_BASE_URL)
            ? `The AI service did not accept the request for the model "${model}". Check LITELLM_MODEL against openrouter.ai/models.`
            : `The AI service returned an error (${res.status}).`,
      res.status === 401 || res.status === 403 ? 503 : 502,
    );
  }
  let data: {
    choices?: { message?: ChatMessage; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  const usage = { prompt: data.usage?.prompt_tokens ?? 0, completion: data.usage?.completion_tokens ?? 0 };
  const choice = data.choices?.[0];
  if (!choice?.message) {
    await meter(deps, req, model, false, usage, 'no completion');
    throw new CloudError('The AI service returned an empty reply.', 502);
  }
  await meter(deps, req, model, true, usage);
  return {
    message: {
      role: 'assistant',
      content: choice.message.content ?? null,
      tool_calls: choice.message.tool_calls,
    },
    finish: choice.finish_reason || 'stop',
    model,
    usage,
  };
}

// The first JSON object in a model reply, tolerating code fences and surrounding prose.
export function parseJsonObject(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], text];
  for (const c of candidates) {
    if (!c) continue;
    const start = c.indexOf('{');
    const end = c.lastIndexOf('}');
    if (start < 0 || end <= start) continue;
    try {
      const v = JSON.parse(c.slice(start, end + 1));
      if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {
      // try the next candidate
    }
  }
  return null;
}
