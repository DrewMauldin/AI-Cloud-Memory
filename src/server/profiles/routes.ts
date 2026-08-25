import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { Hono } from "hono";

import { hasSameOrigin } from "../auth/consent";
import type { BrowserSession } from "../auth/session";
import type { Env } from "../env";
import { apiError, json, readJson } from "../http";
import { archiveProfileInput, createPackInput, facetInput, facetTypeInput, updatePackInput } from "./input";
import { ContextProfileStore } from "./store";

type ProfileAppEnv = Env & { OAUTH_PROVIDER: OAuthHelpers };
type SessionReader = (request: Request, env: Env) => Promise<BrowserSession>;

function profileError(error: unknown): Response {
  const message = error instanceof Error ? error.message : "Context profile operation failed";
  if (/version conflict/i.test(message)) return apiError(409, "VERSION_CONFLICT", message);
  if (/not found/i.test(message)) return apiError(404, "NOT_FOUND", message);
  return apiError(422, "VALIDATION_ERROR", message);
}

export function registerContextProfileRoutes(
  app: Hono<{ Bindings: ProfileAppEnv }>,
  requireSession: SessionReader,
): void {
  app.get("/api/context-profile", async (context) => {
    const session = await requireSession(context.req.raw, context.env);
    return json(await new ContextProfileStore(context.env.DB).list(session.userId));
  });

  app.put("/api/context-profile/facets/:facetType", async (context) => {
    if (!hasSameOrigin(context.req.raw)) return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    const session = await requireSession(context.req.raw, context.env);
    const facetType = facetTypeInput.safeParse(context.req.param("facetType"));
    const body = facetInput.safeParse(await readJson(context.req.raw, 8_192));
    if (!facetType.success || !body.success) return apiError(422, "VALIDATION_ERROR", "Profile facet input is invalid");
    try {
      return json(await new ContextProfileStore(context.env.DB).saveFacet({ ownerId: session.userId, facetType: facetType.data, ...body.data }));
    } catch (error) { return profileError(error); }
  });

  app.post("/api/context-profile/facets/:facetId/archive", async (context) => {
    if (!hasSameOrigin(context.req.raw)) return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    const session = await requireSession(context.req.raw, context.env);
    const body = archiveProfileInput.safeParse(await readJson(context.req.raw, 4_096));
    if (!body.success) return apiError(422, "VALIDATION_ERROR", "Profile archive input is invalid");
    try {
      return json(await new ContextProfileStore(context.env.DB).archiveFacet(session.userId, context.req.param("facetId"), body.data.expectedVersion));
    } catch (error) { return profileError(error); }
  });

  app.post("/api/context-packs", async (context) => {
    if (!hasSameOrigin(context.req.raw)) return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    const session = await requireSession(context.req.raw, context.env);
    const body = createPackInput.safeParse(await readJson(context.req.raw, 12_000));
    if (!body.success) return apiError(422, "VALIDATION_ERROR", "Context pack input is invalid");
    try {
      return json(await new ContextProfileStore(context.env.DB).createPack({ ownerId: session.userId, ...body.data }), { status: 201 });
    } catch (error) { return profileError(error); }
  });

  app.put("/api/context-packs/:packId", async (context) => {
    if (!hasSameOrigin(context.req.raw)) return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    const session = await requireSession(context.req.raw, context.env);
    const body = updatePackInput.safeParse(await readJson(context.req.raw, 12_000));
    if (!body.success) return apiError(422, "VALIDATION_ERROR", "Context pack update is invalid");
    try {
      return json(await new ContextProfileStore(context.env.DB).updatePack({ ownerId: session.userId, packId: context.req.param("packId"), ...body.data }));
    } catch (error) { return profileError(error); }
  });

  app.post("/api/context-packs/:packId/archive", async (context) => {
    if (!hasSameOrigin(context.req.raw)) return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    const session = await requireSession(context.req.raw, context.env);
    const body = archiveProfileInput.safeParse(await readJson(context.req.raw, 4_096));
    if (!body.success) return apiError(422, "VALIDATION_ERROR", "Context pack archive input is invalid");
    try {
      return json(await new ContextProfileStore(context.env.DB).archivePack(session.userId, context.req.param("packId"), body.data.expectedVersion));
    } catch (error) { return profileError(error); }
  });

  app.post("/api/context-packs/:packId/restore", async (context) => {
    if (!hasSameOrigin(context.req.raw)) return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    const session = await requireSession(context.req.raw, context.env);
    const body = archiveProfileInput.safeParse(await readJson(context.req.raw, 4_096));
    if (!body.success) return apiError(422, "VALIDATION_ERROR", "Context pack restore input is invalid");
    try {
      return json(await new ContextProfileStore(context.env.DB).restorePack(session.userId, context.req.param("packId"), body.data.expectedVersion));
    } catch (error) { return profileError(error); }
  });

  app.get("/api/context-packs/:packId/preview", async (context) => {
    const session = await requireSession(context.req.raw, context.env);
    const result = await new ContextProfileStore(context.env.DB).buildContext(session.userId, context.req.param("packId"));
    return result ? json(result) : apiError(404, "NOT_FOUND", "Active context pack not found");
  });
}
