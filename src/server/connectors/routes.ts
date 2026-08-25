import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { Hono } from "hono";

import type { BrowserSession } from "../auth/session";
import { hasSameOrigin } from "../auth/consent";
import type { Env } from "../env";
import { apiError, json, readJson } from "../http";
import type { MemoryService } from "../memory/service";
import { connectorApplyInput, connectorPreviewInput } from "./input";
import { ConnectorRunStore } from "./runs";
import { ConnectorService } from "./service";

type ConnectorAppEnv = Env & { OAUTH_PROVIDER: OAuthHelpers };
type SessionReader = (request: Request, env: Env) => Promise<BrowserSession>;
type MemoryServiceFactory = (env: Env) => MemoryService;

export const CONNECTOR_ADAPTERS = [
  { id: "cloud_memory_jsonl", label: "Cloud Memory JSONL", remote: false },
  { id: "truememory_jsonl", label: "TrueMemory JSONL", remote: false },
  { id: "markdown_bundle", label: "Markdown bundle", remote: false },
  { id: "github_markdown", label: "GitHub Markdown", remote: true },
] as const;

function connectorError(error: unknown): Response {
  const message = error instanceof Error ? error.message : "Connector operation failed";
  if (/version conflict|not ready|does not match/i.test(message)) return apiError(409, "CONNECTOR_CONFLICT", message);
  if (/not found/i.test(message)) return apiError(404, "NOT_FOUND", message);
  return apiError(422, "CONNECTOR_REJECTED", message);
}

export function registerConnectorRoutes(
  app: Hono<{ Bindings: ConnectorAppEnv }>,
  requireSession: SessionReader,
  createMemoryService: MemoryServiceFactory,
): void {
  app.get("/api/connectors", async (context) => {
    const session = await requireSession(context.req.raw, context.env);
    const runs = await new ConnectorRunStore(context.env.DB).list(session.userId, 30);
    return json({ adapters: CONNECTOR_ADAPTERS, runs });
  });

  app.post("/api/connectors/preview", async (context) => {
    if (!hasSameOrigin(context.req.raw)) return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    const session = await requireSession(context.req.raw, context.env);
    const body = connectorPreviewInput.safeParse(await readJson(context.req.raw, 2_100_000));
    if (!body.success) return apiError(422, "VALIDATION_ERROR", "Connector preview input is invalid");
    try {
      const service = new ConnectorService(new ConnectorRunStore(context.env.DB), createMemoryService(context.env));
      return json(await service.preview({
        ownerId: session.userId,
        ...body.data,
        githubToken: context.env.GITHUB_CONNECTOR_TOKEN,
      }), { status: 201 });
    } catch (error) {
      return connectorError(error);
    }
  });

  app.post("/api/connectors/:runId/apply", async (context) => {
    if (!hasSameOrigin(context.req.raw)) return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    const session = await requireSession(context.req.raw, context.env);
    const body = connectorApplyInput.safeParse(await readJson(context.req.raw, 2_100_000));
    if (!body.success) return apiError(422, "VALIDATION_ERROR", "Connector apply input is invalid");
    try {
      const service = new ConnectorService(new ConnectorRunStore(context.env.DB), createMemoryService(context.env));
      return json(await service.apply({
        ownerId: session.userId,
        runId: context.req.param("runId"),
        ...body.data,
        githubToken: context.env.GITHUB_CONNECTOR_TOKEN,
      }));
    } catch (error) {
      return connectorError(error);
    }
  });
}
