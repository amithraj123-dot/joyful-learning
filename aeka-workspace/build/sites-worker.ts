import handler from 'vinext/server/fetch-handler';
import { runWithConnectorBinding } from '../lib/connector-context';
import type { ConnectorBinding } from '../lib/connector-contract.mjs';

// Identity comes from oai-authenticated-user-* headers set by the OpenAI Sites edge. Anywhere else a
// client could send them itself, so a deployment outside Sites must set AEKA_SELF_HOSTED=true (and put
// its own authentication in front); the headers are then removed before the app sees the request.
export function withoutPlatformIdentity(request: Request) {
  const headers = new Headers(request.headers);
  for (const name of [...headers.keys()])
    if (name.startsWith('oai-authenticated-user-')) headers.delete(name);
  return new Request(request, { headers });
}

export default {
  fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>) {
    if (env.AEKA_SELF_HOSTED === 'true') request = withoutPlatformIdentity(request);
    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt) return { status: 'request_context_expired' };
          return preview.getContext?.() ?? { status: 'binding_unavailable' };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return {
              status: 'request_context_expired',
              message: 'This request has expired. Please try again.',
            };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    return runWithConnectorBinding(binding, () => handler.fetch(request, env, ctx));
  },
};
