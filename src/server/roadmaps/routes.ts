import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { Hono } from "hono";

import type { BrowserSession } from "../auth/session";
import { hasSameOrigin } from "../auth/consent";
import type { Env } from "../env";
import { apiError, json, readJson } from "../http";
import {
  archiveRoadmapInput,
  createRoadmapInput,
  promoteRoadmapInput,
  restoreRoadmapInput,
  roadmapListInput,
  updateRoadmapInput,
} from "./input";
import {
  RoadmapCorrelationConflictError,
  RoadmapNotFoundError,
  RoadmapStore,
  RoadmapVersionConflictError,
} from "./store";

type RoadmapAppEnv = Env & { OAUTH_PROVIDER: OAuthHelpers };
type SessionReader = (request: Request, env: Env) => Promise<BrowserSession>;

function roadmapError(error: unknown): Response | null {
  if (error instanceof RoadmapNotFoundError) return apiError(404, "NOT_FOUND", error.message);
  if (error instanceof RoadmapVersionConflictError) return apiError(409, "VERSION_CONFLICT", error.message);
  if (error instanceof RoadmapCorrelationConflictError) return apiError(409, "CORRELATION_CONFLICT", error.message);
  return null;
}

export function registerRoadmapRoutes(
  app: Hono<{ Bindings: RoadmapAppEnv }>,
  requireSession: SessionReader,
): void {
  app.get("/api/roadmaps", async (context) => {
    const session = await requireSession(context.req.raw, context.env);
    const parsed = roadmapListInput.safeParse({
      projectId: context.req.query("projectId"),
      scope: context.req.query("scope") ?? "active",
      horizon: context.req.query("horizon"),
      status: context.req.query("status"),
      limit: context.req.query("limit") ?? "100",
    });
    if (!parsed.success) return apiError(422, "VALIDATION_ERROR", "Roadmap filters are invalid");
    return json(await new RoadmapStore(context.env.DB).list(session.userId, parsed.data));
  });

  app.post("/api/roadmaps", async (context) => {
    if (!hasSameOrigin(context.req.raw)) return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    const session = await requireSession(context.req.raw, context.env);
    const body = createRoadmapInput.safeParse(await readJson(context.req.raw, 12_000));
    if (!body.success) return apiError(422, "VALIDATION_ERROR", "Roadmap input is invalid");
    try {
      return json(await new RoadmapStore(context.env.DB).create({
        ownerId: session.userId,
        ...body.data,
      }), { status: 201 });
    } catch (error) {
      const response = roadmapError(error);
      if (response) return response;
      throw error;
    }
  });

  app.patch("/api/roadmaps/:roadmapId", async (context) => {
    if (!hasSameOrigin(context.req.raw)) return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    const session = await requireSession(context.req.raw, context.env);
    const body = updateRoadmapInput.safeParse(await readJson(context.req.raw, 12_000));
    if (!body.success) return apiError(422, "VALIDATION_ERROR", "Roadmap update is invalid");
    try {
      return json(await new RoadmapStore(context.env.DB).update({
        ownerId: session.userId,
        roadmapId: context.req.param("roadmapId"),
        ...body.data,
      }));
    } catch (error) {
      const response = roadmapError(error);
      if (response) return response;
      throw error;
    }
  });

  app.post("/api/roadmaps/:roadmapId/archive", async (context) => {
    if (!hasSameOrigin(context.req.raw)) return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    const session = await requireSession(context.req.raw, context.env);
    const body = archiveRoadmapInput.safeParse(await readJson(context.req.raw, 4_096));
    if (!body.success) return apiError(422, "VALIDATION_ERROR", "Roadmap archive confirmation is invalid");
    try {
      return json(await new RoadmapStore(context.env.DB).archive({
        ownerId: session.userId,
        roadmapId: context.req.param("roadmapId"),
        ...body.data,
      }));
    } catch (error) {
      const response = roadmapError(error);
      if (response) return response;
      throw error;
    }
  });

  app.post("/api/roadmaps/:roadmapId/restore", async (context) => {
    if (!hasSameOrigin(context.req.raw)) return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    const session = await requireSession(context.req.raw, context.env);
    const body = restoreRoadmapInput.safeParse(await readJson(context.req.raw, 4_096));
    if (!body.success) return apiError(422, "VALIDATION_ERROR", "Roadmap restore input is invalid");
    try {
      return json(await new RoadmapStore(context.env.DB).restore({
        ownerId: session.userId,
        roadmapId: context.req.param("roadmapId"),
        ...body.data,
      }));
    } catch (error) {
      const response = roadmapError(error);
      if (response) return response;
      throw error;
    }
  });

  app.post("/api/roadmaps/:roadmapId/promote", async (context) => {
    if (!hasSameOrigin(context.req.raw)) return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    const session = await requireSession(context.req.raw, context.env);
    const body = promoteRoadmapInput.safeParse(await readJson(context.req.raw, 4_096));
    if (!body.success) return apiError(422, "VALIDATION_ERROR", "Roadmap promotion input is invalid");
    try {
      return json(await new RoadmapStore(context.env.DB).promote({
        ownerId: session.userId,
        roadmapId: context.req.param("roadmapId"),
        expectedVersion: body.data.expectedVersion,
        correlationId: body.data.correlationId,
        actorType: body.data.actorType,
        client: body.data.client ?? "Cloud Memory dashboard",
        model: body.data.model,
        sourceUrl: body.data.sourceUrl,
      }));
    } catch (error) {
      const response = roadmapError(error);
      if (response) return response;
      throw error;
    }
  });

  app.get("/api/roadmaps/:roadmapId/events", async (context) => {
    const session = await requireSession(context.req.raw, context.env);
    const store = new RoadmapStore(context.env.DB);
    if (!await store.get(session.userId, context.req.param("roadmapId"))) {
      return apiError(404, "NOT_FOUND", "Roadmap item not found");
    }
    return json({ events: await store.events(session.userId, context.req.param("roadmapId")) });
  });
}
