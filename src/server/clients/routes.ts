import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { Hono } from "hono";

import { hasSameOrigin } from "../auth/consent";
import type { BrowserSession } from "../auth/session";
import type { Env } from "../env";
import { apiError, json, readJson } from "../http";
import { resolvePublicOrigin } from "../origin";
import { clientIdInput, clientReceiptInput } from "./input";
import { buildClientCompatibilityManifest } from "./manifest";
import { ClientCompatibilityStore } from "./receipts";

type ClientAppEnv = Env & { OAUTH_PROVIDER: OAuthHelpers };
type SessionReader = (request: Request, env: Env) => Promise<BrowserSession>;

export function registerClientCompatibilityRoutes(
  app: Hono<{ Bindings: ClientAppEnv }>,
  requireSession: SessionReader,
): void {
  app.get("/api/client-compatibility", async (context) => {
    const session = await requireSession(context.req.raw, context.env);
    return json({
      manifest: buildClientCompatibilityManifest(resolvePublicOrigin(context.req.raw, context.env.PUBLIC_ORIGIN)),
      receipts: await new ClientCompatibilityStore(context.env.DB).list(session.userId),
    });
  });

  app.put("/api/client-compatibility/:clientId", async (context) => {
    if (!hasSameOrigin(context.req.raw)) return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    const session = await requireSession(context.req.raw, context.env);
    const clientId = clientIdInput.safeParse(context.req.param("clientId"));
    const body = clientReceiptInput.safeParse(await readJson(context.req.raw, 8_192));
    if (!clientId.success || !body.success) return apiError(422, "VALIDATION_ERROR", "Client receipt input is invalid");
    try {
      return json(await new ClientCompatibilityStore(context.env.DB).record({
        ownerId: session.userId,
        clientId: clientId.data,
        ...body.data,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Client receipt could not be recorded";
      if (/version conflict/i.test(message)) return apiError(409, "VERSION_CONFLICT", message);
      return apiError(422, "VALIDATION_ERROR", message);
    }
  });
}
