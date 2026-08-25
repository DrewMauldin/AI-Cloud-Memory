import { OAuthProvider } from "@cloudflare/workers-oauth-provider";

import { createDefaultApp } from "./server/auth/app";
import type { Env } from "./server/env";
import { applySecurityHeaders } from "./server/http";
import { memoryMcpHandler } from "./server/mcp";
import { runNativeAutomation } from "./server/automation/scheduler";
import { resolvePublicOrigin } from "./server/origin";

const defaultApp = createDefaultApp();
function createProvider(resource: string) {
  return new OAuthProvider<Env>({
  apiRoute: "/mcp",
  apiHandler: memoryMcpHandler,
  defaultHandler: defaultApp,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/oauth/token",
  clientRegistrationEndpoint: "/oauth/register",
  clientIdMetadataDocumentEnabled: true,
  scopesSupported: [
    "memory:read",
    "memory:write",
    "projects:read",
    "projects:write",
  ],
  resourceMetadata: {
    resource,
    scopes_supported: [
      "memory:read",
      "memory:write",
      "projects:read",
      "projects:write",
    ],
  },
  tokenExchangeCallback: ({ props, requestedScope }) => ({
    accessTokenProps: {
      ...(props && typeof props === "object" && !Array.isArray(props) ? props : {}),
      oauthScopeBinding: "access-token-v1",
      oauthScopes: requestedScope,
    },
  }),
  });
}

export default {
  async fetch(request, env, context) {
    const provider = createProvider(`${resolvePublicOrigin(request, env.PUBLIC_ORIGIN)}/mcp`);
    const response = await provider.fetch(request, env, context);
    return applySecurityHeaders(response);
  },
  async scheduled(controller, env) {
    const result = await runNativeAutomation({
      env,
      cron: controller.cron,
      scheduledTime: controller.scheduledTime,
    });
    console.log(JSON.stringify({
      event: "native_automation_completed",
      operation: result.operation,
      status: result.status,
      itemCount: result.itemCount,
      runId: result.runId ?? null,
      reason: result.reason ?? null,
    }));
  },
} satisfies ExportedHandler<Env>;
