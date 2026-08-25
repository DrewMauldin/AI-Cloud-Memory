import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { Hono } from "hono";

import { hasSameOrigin } from "../auth/consent";
import type { BrowserSession } from "../auth/session";
import type { Env } from "../env";
import { apiError, json, readJson } from "../http";
import { MemoryStore } from "../memory/store";
import { semanticSearchEnabled } from "../memory/runtime";
import { reflectionArchiveInput, reflectionDecisionInput, reflectionListInput } from "./input";
import { ReflectionService } from "./service";
import { ReflectionStore } from "./store";

type ReflectionAppEnv = Env & { OAUTH_PROVIDER: OAuthHelpers };
type SessionReader = (request: Request, env: Env) => Promise<BrowserSession>;

function reflectionError(error: unknown): Response {
  const message = error instanceof Error ? error.message : "Reflection operation failed";
  if (/version conflict/i.test(message)) return apiError(409, "VERSION_CONFLICT", message);
  if (/not found/i.test(message)) return apiError(404, "NOT_FOUND", message);
  return apiError(422, "VALIDATION_ERROR", message);
}

export function registerReflectionRoutes(
  app: Hono<{ Bindings: ReflectionAppEnv }>,
  requireSession: SessionReader,
): void {
  app.get("/api/reflection", async (context) => {
    const session = await requireSession(context.req.raw, context.env);
    const input = reflectionListInput.safeParse({ status: context.req.query("status") ?? "open", limit: context.req.query("limit") ?? "100" });
    if (!input.success) return apiError(422, "VALIDATION_ERROR", "Reflection filters are invalid");
    return json({ proposals: await new ReflectionStore(context.env.DB).list(session.userId, input.data.status, input.data.limit) });
  });

  app.post("/api/reflection/run", async (context) => {
    if (!hasSameOrigin(context.req.raw)) return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    const session = await requireSession(context.req.raw, context.env);
    return json(await new ReflectionStore(context.env.DB).run(session.userId));
  });

  app.post("/api/reflection/:proposalId/decision", async (context) => {
    if (!hasSameOrigin(context.req.raw)) return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    const session = await requireSession(context.req.raw, context.env);
    const body = reflectionDecisionInput.safeParse(await readJson(context.req.raw, 4_096));
    if (!body.success) return apiError(422, "VALIDATION_ERROR", "Reflection decision is invalid");
    try {
      return json(await new ReflectionStore(context.env.DB).decide(
        session.userId, context.req.param("proposalId"), body.data.expectedVersion, body.data.decision,
      ));
    } catch (error) { return reflectionError(error); }
  });

  app.post("/api/reflection/:proposalId/archive", async (context) => {
    if (!hasSameOrigin(context.req.raw)) return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    const session = await requireSession(context.req.raw, context.env);
    const body = reflectionArchiveInput.safeParse(await readJson(context.req.raw, 4_096));
    if (!body.success) return apiError(422, "VALIDATION_ERROR", "Reflection archive confirmation is invalid");
    try {
      return json(await new ReflectionService(
        new ReflectionStore(context.env.DB),
        new MemoryStore(context.env.DB),
        semanticSearchEnabled(context.env)
          ? async (memoryId) => { await context.env.MEMORY_INDEX.deleteByIds([memoryId]); }
          : async () => {},
      ).applyArchive({
        ownerId: session.userId,
        proposalId: context.req.param("proposalId"),
        expectedProposalVersion: body.data.expectedProposalVersion,
        expectedMemoryVersion: body.data.expectedMemoryVersion,
      }));
    } catch (error) { return reflectionError(error); }
  });
}
