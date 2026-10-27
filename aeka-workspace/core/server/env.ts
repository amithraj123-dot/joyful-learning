// Server configuration. Values come from the hosting platform's secret settings (never from the
// browser, the database or the repository). Modules read them through ctx.env so tests can supply
// their own.
export interface ServerEnv {
  // 32 or more random bytes, base64 or hex. Seals stored credentials (mail tokens). Required before
  // any mailbox can be connected.
  AEKA_ENCRYPTION_KEY?: string;
  // The firm's AI service, OpenAI-compatible: the LiteLLM proxy, or OpenRouter (base URL
  // https://openrouter.ai/api/v1, LITELLM_MODEL an OpenRouter id; it defaults there to anthropic/claude-sonnet-6).
  // Base URL ends with /v1 or is the proxy root.
  LITELLM_BASE_URL?: string;
  LITELLM_API_KEY?: string;
  LITELLM_MODEL?: string; // drafting and chat; default claude-sonnet-4.6
  LITELLM_FAST_MODEL?: string; // triage; default LITELLM_MODEL
  AEKA_AI_DAILY_LIMIT?: string; // model calls per member per day (India time); default 400
  AEKA_AI_DISABLED?: string; // "true" stops every model call (kill switch)
  // Microsoft Entra app registration for Outlook (delegated permissions).
  MS_CLIENT_ID?: string;
  MS_CLIENT_SECRET?: string;
  MS_TENANT_ID?: string; // tenant id or "organizations"
  // The public address of the workspace, for OAuth redirects (for example https://aeka.example).
  AEKA_PUBLIC_ORIGIN?: string;
  // Bearer token for POST /api/tick, called by an external scheduler every few minutes so reminders,
  // briefs, mail sync and WhatsApp work while nobody has the workspace open.
  AEKA_TICK_TOKEN?: string;
  // WhatsApp Cloud API (optional).
  WHATSAPP_ENABLED?: string;
  WHATSAPP_APP_SECRET?: string;
  WHATSAPP_VERIFY_TOKEN?: string;
  WHATSAPP_ACCESS_TOKEN?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  WHATSAPP_DISPLAY_NUMBER?: string; // the business number members message, e.g. +91 98xxx xxxxx
  WHATSAPP_GRAPH_VERSION?: string; // e.g. v23.0
  WHATSAPP_NOTIFICATION_TEMPLATE?: string; // approved template with one body parameter
  WHATSAPP_TEMPLATE_LANGUAGE?: string; // default en
}

// The server-side context that background work runs with (no signed-in caller).
export interface SystemContext {
  db: D1Database;
  env: ServerEnv;
  fetch: typeof fetch;
  now: number;
}

export const configured = (...values: (string | undefined)[]) => values.every((v) => !!v && !!v.trim());
