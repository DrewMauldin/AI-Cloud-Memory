import {
  AuthorizationError,
  type AuthRequest,
  type OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import { z } from "zod";

import {
  authenticateAutomationToken,
  AUTOMATION_SCOPES,
  issueAutomationToken,
} from "../automation/token";
import { buildOwnerProjection } from "../automation/projection";
import { LifecycleActivityStore } from "../activity/store";
import type { Env } from "../env";
import { exportCapabilities } from "../export/capabilities";
import { pushEncryptedExport } from "../export/github";
import { generateEncryptedSnapshot, markExportPushed } from "../export/snapshot";
import { applyTrueMemoryImport, dryRunTrueMemoryImport } from "../import/truememory";
import { apiError, HttpError, json, readJson } from "../http";
import {
  libraryBulkInput,
  libraryListInput,
  memoryFeedbackInput,
  memoryLabelInput,
  memoryLifecycleInput,
  memoryPurgeInput,
  reviewDecisionInput,
  reviewListInput,
  searchMemoryInput,
  storeMemoryInput,
} from "../memory/input";
import { MemoryService } from "../memory/service";
import { CloudflareSemanticIndex } from "../memory/semantic";
import { CloudflareSearchReranker } from "../memory/reranker";
import { semanticSearchEnabled } from "../memory/runtime";
import { SecretPatternError } from "../memory/safety";
import { MemoryConflictError, MemoryStore } from "../memory/store";
import { ContextGraphStore } from "../memory/context-graph";
import { MemoryDoctor } from "../memory/doctor";
import {
  FeedbackConflictError,
  FeedbackOwnerBoundaryError,
  FeedbackValidationError,
  MemoryReviewStore,
  ReviewConflictError,
  ReviewNotFoundError,
  ReviewOwnerBoundaryError,
  ReviewValidationError,
} from "../memory/review";
import {
  archiveRecordInput,
  createProjectInput,
  createTaskInput,
  moveTaskInput,
  updateProjectInput,
  updateTaskInput,
} from "../projects/input";
import { ProjectStore, VersionConflictError } from "../projects/store";
import { classifyTaskAttention } from "../projects/attention";
import { registerConnectorRoutes } from "../connectors/routes";
import { registerClientCompatibilityRoutes } from "../clients/routes";
import { registerContextProfileRoutes } from "../profiles/routes";
import { registerReflectionRoutes } from "../reflection/routes";
import { AgentRunStore } from "../projects/runs";
import { TaskStructureStore } from "../projects/structure";
import { registerRoadmapRoutes } from "../roadmaps/routes";
import { CAPABILITIES, CapabilityReceiptStore } from "../operations/receipts";
import { SERVICE_VERSION } from "../version";
import { resolvePublicOrigin } from "../origin";
import {
  CONSENT_SUBMIT_PATH,
  escapeHtml,
  filterScopes,
  hasSameOrigin,
  unsupportedScopes,
} from "./consent";
import {
  authenticateGitHubCode,
  buildGitHubAuthorizationUrl,
  GitHubIdentityError,
  pkceChallenge,
  type GitHubIdentity,
} from "./github";
import {
  clearSessionCookie,
  openSession,
  readCookie,
  sealSession,
  SESSION_COOKIE_NAME,
  sessionCookie,
  type BrowserSession,
} from "./session";
import { readOAuthState, storeOAuthState, takeOAuthState } from "./state";

type AppEnv = Env & { OAUTH_PROVIDER: OAuthHelpers };

const SUPPORTED_SCOPES = [
  "memory:read",
  "memory:write",
  "projects:read",
  "projects:write",
] as const;
const SESSION_TTL_SECONDS = 24 * 60 * 60;
const OAUTH_STATE_TTL_SECONDS = 10 * 60;
const automationTokenInput = z.object({
  label: z.string().trim().min(1).max(100),
  scopes: z.array(z.enum(AUTOMATION_SCOPES)).min(1).max(AUTOMATION_SCOPES.length),
  expiresAt: z.iso.datetime().optional(),
}).strict();
const taskStructureInput = z.object({
  expectedVersion: z.number().int().positive(),
  parentTaskId: z.string().min(1).max(100).nullable().optional(),
  isMilestone: z.boolean().optional(),
}).strict().refine((input) => input.parentTaskId !== undefined || input.isMilestone !== undefined, "At least one structure field is required");
const taskDependencyInput = z.object({
  expectedVersion: z.number().int().positive(),
  dependsOnTaskId: z.string().min(1).max(100),
}).strict();
const doctorDecisionInput = z.object({
  expectedVersion: z.number().int().positive(),
  status: z.enum(["approved", "dismissed"]),
}).strict();
const capabilityReceiptInput = z.object({
  capability: z.enum(CAPABILITIES),
  status: z.enum(["verified", "degraded", "failed", "configured", "unknown"]),
  detail: z.string().trim().min(1).max(500),
  evidenceSha256: z.string().regex(/^[0-9a-f]{64}$/i).optional(),
  source: z.string().trim().min(1).max(100),
  checkedAt: z.iso.datetime().optional(),
}).strict();
const projectScopeInput = z.enum(["active", "archived", "all"]);
const graphEntityInput = z.object({
  canonicalName: z.string().trim().min(1).max(200),
  entityType: z.enum(["person", "organisation", "project", "place", "concept", "system"]),
  description: z.string().trim().min(1).max(1000).optional(),
}).strict();
const graphAliasInput = z.object({ alias: z.string().trim().min(1).max(200) }).strict();
const graphMemoryLinkInput = z.object({
  memoryId: z.string().min(1).max(100),
  entityId: z.string().min(1).max(100),
  relation: z.enum(["mentioned", "subject", "evidence"]).default("mentioned"),
  confidence: z.number().min(0).max(1).default(1),
}).strict();
const graphRelationshipInput = z.object({
  fromEntityId: z.string().min(1).max(100),
  toEntityId: z.string().min(1).max(100),
  relationshipType: z.string().trim().min(1).max(100),
  validFrom: z.iso.datetime().optional(),
  validUntil: z.iso.datetime().optional(),
  evidenceMemoryId: z.string().min(1).max(100).optional(),
  confidence: z.number().min(0).max(1).default(1),
}).strict();

interface LoginState {
  purpose: "dashboard" | "mcp";
  oauthRequest?: AuthRequest;
  codeVerifier?: string;
}

interface ConsentState {
  oauthRequest: AuthRequest;
  identity: GitHubIdentity;
}

function randomState(): string {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
}

function callbackUrl(request: Request, env: Env): string {
  return `${resolvePublicOrigin(request, env.PUBLIC_ORIGIN)}/callback`;
}

function memoryService(env: Env): MemoryService {
  return new MemoryService(
    new MemoryStore(env.DB),
    new CloudflareSemanticIndex(env.AI, env.MEMORY_INDEX),
    new CloudflareSearchReranker(env.AI),
    undefined,
    new MemoryReviewStore(env.DB),
    new ContextGraphStore(env.DB),
    semanticSearchEnabled(env),
  );
}

function reviewApiError(error: unknown): Response | null {
  if (error instanceof ReviewNotFoundError || error instanceof ReviewOwnerBoundaryError) {
    return apiError(404, "NOT_FOUND", "Memory review not found");
  }
  if (error instanceof ReviewConflictError || error instanceof FeedbackConflictError) {
    return apiError(409, error.code, error.message);
  }
  if (error instanceof ReviewValidationError || error instanceof FeedbackValidationError) {
    return apiError(422, "VALIDATION_ERROR", error.message);
  }
  if (error instanceof FeedbackOwnerBoundaryError) {
    return apiError(404, "NOT_FOUND", "Memory not found");
  }
  return null;
}

function memoryLifecycleApiError(error: unknown): Response | null {
  if (error instanceof MemoryConflictError) {
    return apiError(409, error.code, error.message);
  }
  return null;
}

async function readImportBody(request: Request): Promise<string> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > 5_000_000) {
    throw new HttpError(413, "PAYLOAD_TOO_LARGE", "Import exceeds the 5 MB limit");
  }
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > 5_000_000) {
    throw new HttpError(413, "PAYLOAD_TOO_LARGE", "Import exceeds the 5 MB limit");
  }
  return body;
}

async function storeState(
  env: Env,
  prefix: "login" | "consent",
  state: string,
  value: LoginState | ConsentState,
): Promise<void> {
  await storeOAuthState(env.DB, `${prefix}:${state}`, value, OAUTH_STATE_TTL_SECONDS);
}

async function takeState<T>(
  env: Env,
  prefix: "login" | "consent",
  state: string,
): Promise<T | null> {
  return takeOAuthState<T>(env.DB, `${prefix}:${state}`);
}

async function startGitHub(
  request: Request,
  env: Env,
  loginState: LoginState,
): Promise<Response> {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
    return apiError(503, "AUTH_NOT_CONFIGURED", "GitHub authentication is not configured");
  }
  const state = randomState();
  const codeVerifier = randomState();
  await storeState(env, "login", state, { ...loginState, codeVerifier });
  return Response.redirect(
    buildGitHubAuthorizationUrl({
      clientId: env.GITHUB_CLIENT_ID,
      callbackUrl: callbackUrl(request, env),
      state,
      codeChallenge: await pkceChallenge(codeVerifier),
    }),
    302,
  );
}

async function readSession(request: Request, env: Env): Promise<BrowserSession | null> {
  const token = readCookie(request, SESSION_COOKIE_NAME);
  return token ? openSession(token, env.COOKIE_ENCRYPTION_KEY) : null;
}

async function requireSession(request: Request, env: Env): Promise<BrowserSession> {
  const session = await readSession(request, env);
  if (!session || session.userId !== env.ALLOWED_GITHUB_USER_ID) {
    throw new HttpError(401, "UNAUTHENTICATED", "Sign in with GitHub to continue");
  }
  return session;
}

async function upsertUser(env: Env, identity: GitHubIdentity): Promise<void> {
  const timestamp = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO users (id, github_login, avatar_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       github_login = excluded.github_login,
       avatar_url = excluded.avatar_url,
       updated_at = excluded.updated_at`,
  )
    .bind(
      identity.userId,
      identity.login,
      identity.avatarUrl ?? null,
      timestamp,
      timestamp,
    )
    .run();
}

async function newSession(identity: GitHubIdentity, env: Env): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);
  return sealSession(
    {
      ...identity,
      issuedAt,
      expiresAt: issuedAt + SESSION_TTL_SECONDS,
    },
    env.COOKIE_ENCRYPTION_KEY,
  );
}

function renderConsent(input: {
  clientName: string;
  scopes: string[];
  state: string;
}): Response {
  const scopes = input.scopes
    .map((scope) => `<li><code>${escapeHtml(scope)}</code></li>`)
    .join("");
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>Authorise Cloud Memory</title>
  <link rel="stylesheet" href="/auth.css">
</head>
<body>
  <main>
    <p class="eyebrow">CLOUD MEMORY / AUTHORISATION</p>
    <h1>Approve this connection?</h1>
    <p><strong>${escapeHtml(input.clientName)}</strong> wants to use Cloud Memory on your behalf.</p>
    <div class="scopes"><p>Requested access:</p><ul>${scopes}</ul></div>
    <form method="post" action="${CONSENT_SUBMIT_PATH}" data-oauth-consent>
      <input type="hidden" name="state" value="${escapeHtml(input.state)}">
      <div class="actions">
        <button type="submit" name="decision" value="deny">Deny</button>
        <button class="primary" type="submit" name="decision" value="grant">Approve connection</button>
      </div>
      <p role="status" aria-live="polite" data-consent-status></p>
    </form>
    <script src="/consent-handoff.js" defer></script>
  </main>
</body>
</html>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      },
    },
  );
}

function oauthError(error: AuthorizationError): Response {
  if (!error.redirectUri) return apiError(400, "INVALID_OAUTH_REQUEST", error.description);
  const redirect = new URL(error.redirectUri);
  redirect.searchParams.set("error", error.code);
  redirect.searchParams.set("error_description", error.description);
  if (error.state) redirect.searchParams.set("state", error.state);
  if (error.issuer) redirect.searchParams.set("iss", error.issuer);
  return Response.redirect(redirect, 302);
}

export function createDefaultApp() {
  const app = new Hono<{ Bindings: AppEnv }>();

  app.get("/login", (context) =>
    startGitHub(context.req.raw, context.env, { purpose: "dashboard" }),
  );

  app.get("/authorize", async (context) => {
    try {
      const oauthRequest = await context.env.OAUTH_PROVIDER.parseAuthRequest(
        context.req.raw,
      );
      const client = await context.env.OAUTH_PROVIDER.lookupClient(oauthRequest.clientId);
      if (!client) return apiError(400, "UNKNOWN_CLIENT", "Unknown OAuth client");
      const unsupported = unsupportedScopes(oauthRequest.scope, SUPPORTED_SCOPES);
      if (unsupported.length > 0) {
        return apiError(400, "INVALID_SCOPE", `Unsupported OAuth scope: ${unsupported.join(", ")}`);
      }
      return startGitHub(context.req.raw, context.env, {
        purpose: "mcp",
        oauthRequest,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) return oauthError(error);
      throw error;
    }
  });

  app.get("/callback", async (context) => {
    const state = context.req.query("state") ?? "";
    const code = context.req.query("code") ?? "";
    if (!/^[A-Za-z0-9]{20,200}$/.test(state) || code.length < 1 || code.length > 500) {
      return apiError(400, "INVALID_CALLBACK", "GitHub callback is invalid");
    }

    let loginState: LoginState | null;
    try {
      loginState = await takeState<LoginState>(context.env, "login", state);
    } catch (error) {
      console.error(JSON.stringify({
        event: "github_callback_failed",
        stage: "oauth_state_consume",
        error: error instanceof Error ? error.name : "UnknownError",
      }));
      throw error;
    }
    if (!loginState || !["dashboard", "mcp"].includes(loginState.purpose) || !loginState.codeVerifier) {
      return apiError(400, "EXPIRED_STATE", "The sign-in request expired; please start again");
    }

    let callbackStage = "github_identity";
    try {
      const identity = await authenticateGitHubCode({
        code,
        clientId: context.env.GITHUB_CLIENT_ID,
        clientSecret: context.env.GITHUB_CLIENT_SECRET,
        callbackUrl: callbackUrl(context.req.raw, context.env),
        codeVerifier: loginState.codeVerifier,
        allowedUserId: context.env.ALLOWED_GITHUB_USER_ID,
      });
      callbackStage = "user_upsert";
      await upsertUser(context.env, identity);
      callbackStage = "session_seal";
      const token = await newSession(identity, context.env);

      if (loginState.purpose === "dashboard") {
        return new Response(null, {
          status: 302,
          headers: {
            location: "/",
            "set-cookie": sessionCookie(token, SESSION_TTL_SECONDS),
            "cache-control": "no-store",
          },
        });
      }

      if (!loginState.oauthRequest) {
        return apiError(400, "INVALID_OAUTH_STATE", "OAuth state is incomplete");
      }
      const consentState = randomState();
      await storeState(context.env, "consent", consentState, {
        oauthRequest: loginState.oauthRequest,
        identity,
      });
      return new Response(null, {
        status: 302,
        headers: {
          location: `/authorize/consent?state=${encodeURIComponent(consentState)}`,
          "set-cookie": sessionCookie(token, SESSION_TTL_SECONDS),
          "cache-control": "no-store",
        },
      });
    } catch (error) {
      if (error instanceof GitHubIdentityError) {
        console.error(JSON.stringify({
          event: "github_identity_failed",
          stage: error.stage ?? "identity_check",
          error: error.code,
        }));
        return apiError(
          error.code === "IDENTITY_DENIED" ? 403 : 502,
          error.code,
          error.message,
        );
      }
      console.error(JSON.stringify({
        event: "github_callback_failed",
        stage: callbackStage,
        error: error instanceof Error ? error.name : "UnknownError",
      }));
      throw error;
    }
  });

  app.get("/authorize/consent", async (context) => {
    const session = await requireSession(context.req.raw, context.env);
    const state = context.req.query("state") ?? "";
    const consent = await readOAuthState<ConsentState>(context.env.DB, `consent:${state}`);
    if (!consent) return apiError(400, "EXPIRED_STATE", "The consent request expired");
    if (consent.identity.userId !== session.userId) {
      return apiError(403, "FORBIDDEN", "Consent identity does not match");
    }
    const client = await context.env.OAUTH_PROVIDER.lookupClient(
      consent.oauthRequest.clientId,
    );
    if (!client) return apiError(400, "UNKNOWN_CLIENT", "Unknown OAuth client");
    const unsupported = unsupportedScopes(consent.oauthRequest.scope, SUPPORTED_SCOPES);
    if (unsupported.length > 0) {
      return apiError(400, "INVALID_SCOPE", `Unsupported OAuth scope: ${unsupported.join(", ")}`);
    }
    return renderConsent({
      clientName: client.clientName || "MCP client",
      scopes: filterScopes(consent.oauthRequest.scope, SUPPORTED_SCOPES),
      state,
    });
  });

  app.post(CONSENT_SUBMIT_PATH, async (context) => {
    if (!hasSameOrigin(context.req.raw)) {
      return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    }
    const declaredLength = Number(context.req.header("content-length") ?? "0");
    if (declaredLength > 4_096) {
      return apiError(413, "PAYLOAD_TOO_LARGE", "Consent request is too large");
    }
    const session = await requireSession(context.req.raw, context.env);
    const form = await context.req.raw.formData();
    const state = form.get("state");
    const decision = form.get("decision");
    if (typeof state !== "string" || !/^[A-Za-z0-9]{20,200}$/.test(state)) {
      return apiError(400, "INVALID_STATE", "Consent state is invalid");
    }
    const consent = await takeState<ConsentState>(context.env, "consent", state);
    if (!consent || consent.identity.userId !== session.userId) {
      return apiError(400, "EXPIRED_STATE", "The consent request expired");
    }

    if (decision !== "grant") {
      const redirect = new URL(consent.oauthRequest.redirectUri);
      redirect.searchParams.set("error", "access_denied");
      redirect.searchParams.set("state", consent.oauthRequest.state);
      if (consent.oauthRequest.issuer) {
        redirect.searchParams.set("iss", consent.oauthRequest.issuer);
      }
      return context.req.header("accept")?.includes("application/json")
        ? json({ redirectTo: redirect.toString() })
        : Response.redirect(redirect, 302);
    }

    const client = await context.env.OAUTH_PROVIDER.lookupClient(
      consent.oauthRequest.clientId,
    );
    if (!client) return apiError(400, "UNKNOWN_CLIENT", "Unknown OAuth client");
    const unsupported = unsupportedScopes(consent.oauthRequest.scope, SUPPORTED_SCOPES);
    if (unsupported.length > 0) {
      return apiError(400, "INVALID_SCOPE", `Unsupported OAuth scope: ${unsupported.join(", ")}`);
    }
    const scopes = filterScopes(consent.oauthRequest.scope, SUPPORTED_SCOPES);
    const { redirectTo } = await context.env.OAUTH_PROVIDER.completeAuthorization({
      request: consent.oauthRequest,
      userId: session.userId,
      metadata: { clientName: client.clientName || "MCP client" },
      scope: scopes,
      props: {
        userId: session.userId,
        login: session.login,
        avatarUrl: session.avatarUrl,
      },
    });
    return context.req.header("accept")?.includes("application/json")
      ? json({ redirectTo })
      : Response.redirect(redirectTo, 302);
  });

  app.post("/logout", async (context) => {
    if (!hasSameOrigin(context.req.raw)) {
      return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    }
    return new Response(null, {
      status: 204,
      headers: { "set-cookie": clearSessionCookie() },
    });
  });

  app.get("/api/health", async (context) => {
    const database = await context.env.DB.prepare("SELECT 1 AS ok").first<{
      ok: number;
    }>();
    return json({
      status: database?.ok === 1 ? "ok" : "degraded",
      service: "cloud-memory",
      version: SERVICE_VERSION,
      environment: context.env.APP_ENV,
      checkedAt: new Date().toISOString(),
      checks: {
        worker: "responding",
        d1: database?.ok === 1 ? "verified" : "failed",
        vectorize: semanticSearchEnabled(context.env) ? "configured" : "disabled",
        workersAi: semanticSearchEnabled(context.env) ? "configured" : "disabled",
      },
    });
  });

  app.get("/api/session", async (context) => {
    const session = await readSession(context.req.raw, context.env);
    return session
      ? json({ authenticated: true, user: {
          id: session.userId,
          login: session.login,
          name: null,
          avatarUrl: session.avatarUrl ?? null,
        }, exportCapabilities: exportCapabilities(context.env) })
      : json({ authenticated: false, user: null }, { status: 401 });
  });

  app.get("/api/memories/directives", async (context) => {
    const session = await requireSession(context.req.raw, context.env);
    return json({ directives: await memoryService(context.env).directives(session.userId) });
  });

  app.get("/api/activity", async (context) => {
    const session = await requireSession(context.req.raw, context.env);
    const limit = Number(context.req.query("limit") ?? "50");
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return apiError(422, "VALIDATION_ERROR", "Activity limit is invalid");
    }
    return json({ events: await new LifecycleActivityStore(context.env.DB).list(session.userId, limit) });
  });

  app.get("/api/library", async (context) => {
    const session = await requireSession(context.req.raw, context.env);
    const parsed = libraryListInput.safeParse({
      query: context.req.query("query"),
      cursor: context.req.query("cursor"),
      limit: Number(context.req.query("limit") ?? "40"),
      status: context.req.query("status") ?? "active",
      kind: context.req.query("kind"),
      label: context.req.query("label"),
      scopeType: context.req.query("scopeType"),
      scopeId: context.req.query("scopeId"),
      sourceClient: context.req.query("sourceClient"),
      minimumImportance: context.req.query("minimumImportance") === undefined
        ? undefined
        : Number(context.req.query("minimumImportance")),
      createdAfter: context.req.query("createdAfter"),
      sort: context.req.query("sort") ?? "updated",
    });
    if (!parsed.success) return apiError(422, "VALIDATION_ERROR", "Library filters are invalid");
    try {
      return json(await new MemoryStore(context.env.DB).listLibrary({
        ownerId: session.userId,
        ...parsed.data,
      }));
    } catch (error) {
      if (error instanceof Error && error.message === "Library cursor is invalid") {
        return apiError(422, "VALIDATION_ERROR", error.message);
      }
      throw error;
    }
  });

  app.post("/api/library/bulk", async (context) => {
    if (!hasSameOrigin(context.req.raw)) return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    const session = await requireSession(context.req.raw, context.env);
    const body = libraryBulkInput.safeParse(await readJson(context.req.raw, 32_768));
    if (!body.success) return apiError(422, "VALIDATION_ERROR", "Library bulk input is invalid");
    const store = new MemoryStore(context.env.DB);
    const results: Array<{
      id: string;
      outcome: "changed" | "conflict" | "failed";
      memory?: Awaited<ReturnType<MemoryStore["getLibraryById"]>>;
    }> = [];
    for (const record of body.data.records) {
      try {
        let memory;
        if (body.data.action === "label") {
          memory = await store.addLabel({
            ownerId: session.userId,
            memoryId: record.id,
            expectedVersion: record.expectedVersion,
            label: body.data.label,
          });
        } else if (body.data.action === "archive") {
          memory = await store.archiveMemory({
            ownerId: session.userId,
            memoryId: record.id,
            expectedVersion: record.expectedVersion,
          });
          if (semanticSearchEnabled(context.env)) {
            try {
              await context.env.MEMORY_INDEX.deleteByIds([record.id]);
            } catch {
              console.error(JSON.stringify({ message: "bulk archive vector deletion failed", memoryId: record.id }));
            }
          }
        } else {
          memory = await store.restoreMemory({
            ownerId: session.userId,
            memoryId: record.id,
            expectedVersion: record.expectedVersion,
          });
          if (semanticSearchEnabled(context.env)) {
            try {
              await new CloudflareSemanticIndex(context.env.AI, context.env.MEMORY_INDEX).index(memory);
              await store.setVectorState(session.userId, memory.id, "indexed");
            } catch {
              console.error(JSON.stringify({ message: "bulk restore indexing failed", memoryId: memory.id }));
              try {
                await store.setVectorState(session.userId, memory.id, "failed");
              } catch {
                console.error(JSON.stringify({ message: "bulk restore vector state update failed", memoryId: memory.id }));
              }
            }
          }
          memory = await store.getLibraryById(session.userId, memory.id) ?? memory;
        }
        results.push({ id: record.id, outcome: "changed", memory });
      } catch (error) {
        if (error instanceof MemoryConflictError) {
          results.push({ id: record.id, outcome: "conflict" });
        } else {
          console.error(JSON.stringify({ message: "Library bulk record failed", memoryId: record.id, action: body.data.action }));
          results.push({ id: record.id, outcome: "failed" });
        }
      }
    }
    return json({ results });
  });

  app.get("/api/memories/:memoryId/related", async (context) => {
    const session = await requireSession(context.req.raw, context.env);
    const limit = Number(context.req.query("limit") ?? "8");
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
      return apiError(422, "VALIDATION_ERROR", "Related memory limit is invalid");
    }
    const store = new MemoryStore(context.env.DB);
    if (!await store.getById(session.userId, context.req.param("memoryId"))) {
      return apiError(404, "NOT_FOUND", "Memory not found");
    }
    return json({ items: await store.listRelated(session.userId, context.req.param("memoryId"), limit) });
  });

  app.get("/api/memories/:memoryId/history", async (context) => {
    const session = await requireSession(context.req.raw, context.env);
    const limit = Number(context.req.query("limit") ?? "50");
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return apiError(422, "VALIDATION_ERROR", "History limit is invalid");
    }
    const store = new MemoryStore(context.env.DB);
    if (!await store.getById(session.userId, context.req.param("memoryId"))) {
      return apiError(404, "NOT_FOUND", "Memory not found");
    }
    return json({ events: await store.listMemoryEvents(session.userId, context.req.param("memoryId"), limit) });
  });

  app.post("/api/memories/:memoryId/labels", async (context) => {
    if (!hasSameOrigin(context.req.raw)) return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    const session = await requireSession(context.req.raw, context.env);
    const body = memoryLabelInput.safeParse(await readJson(context.req.raw, 4_096));
    if (!body.success) return apiError(422, "VALIDATION_ERROR", "Memory label is invalid");
    try {
      return json(await new MemoryStore(context.env.DB).addLabel({
        ownerId: session.userId,
        memoryId: context.req.param("memoryId"),
        ...body.data,
      }));
    } catch (error) {
      const response = memoryLifecycleApiError(error);
      if (response) return response;
      throw error;
    }
  });

  app.delete("/api/memories/:memoryId/labels/:label", async (context) => {
    if (!hasSameOrigin(context.req.raw)) return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    const session = await requireSession(context.req.raw, context.env);
    const expectedVersion = Number(context.req.query("expectedVersion"));
    const input = memoryLabelInput.safeParse({ label: context.req.param("label"), expectedVersion });
    if (!input.success) return apiError(422, "VALIDATION_ERROR", "Memory label or version is invalid");
    try {
      return json(await new MemoryStore(context.env.DB).removeLabel({
        ownerId: session.userId,
        memoryId: context.req.param("memoryId"),
        ...input.data,
      }));
    } catch (error) {
      const response = memoryLifecycleApiError(error);
      if (response) return response;
      throw error;
    }
  });

  app.post("/api/memories/:memoryId/archive", async (context) => {
    if (!hasSameOrigin(context.req.raw)) return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    const session = await requireSession(context.req.raw, context.env);
    const body = memoryLifecycleInput.safeParse(await readJson(context.req.raw, 4_096));
    if (!body.success) return apiError(422, "VALIDATION_ERROR", "Memory archive input is invalid");
    const store = new MemoryStore(context.env.DB);
    const memoryId = context.req.param("memoryId");
    try {
      const archived = await store.archiveMemory({
        ownerId: session.userId,
        memoryId,
        expectedVersion: body.data.expectedVersion,
      });
      if (semanticSearchEnabled(context.env)) {
        try {
          await context.env.MEMORY_INDEX.deleteByIds([memoryId]);
        } catch {
          console.error(JSON.stringify({ message: "archived memory vector deletion failed", memoryId }));
        }
      }
      return json(archived);
    } catch (error) {
      const response = memoryLifecycleApiError(error);
      if (response) return response;
      throw error;
    }
  });

  app.post("/api/memories/:memoryId/restore", async (context) => {
    if (!hasSameOrigin(context.req.raw)) return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    const session = await requireSession(context.req.raw, context.env);
    const body = memoryLifecycleInput.safeParse(await readJson(context.req.raw, 4_096));
    if (!body.success) return apiError(422, "VALIDATION_ERROR", "Memory restore input is invalid");
    const store = new MemoryStore(context.env.DB);
    try {
      const restored = await store.restoreMemory({
        ownerId: session.userId,
        memoryId: context.req.param("memoryId"),
        expectedVersion: body.data.expectedVersion,
      });
      if (semanticSearchEnabled(context.env)) {
        try {
          await new CloudflareSemanticIndex(context.env.AI, context.env.MEMORY_INDEX).index(restored);
          await store.setVectorState(session.userId, restored.id, "indexed");
        } catch {
          console.error(JSON.stringify({ message: "memory restore indexing failed", memoryId: restored.id }));
          try {
            await store.setVectorState(session.userId, restored.id, "failed");
          } catch {
            console.error(JSON.stringify({ message: "memory restore vector state update failed", memoryId: restored.id }));
          }
        }
      }
      const memory = await store.getLibraryById(session.userId, restored.id);
      return json(memory ?? restored);
    } catch (error) {
      const response = memoryLifecycleApiError(error);
      if (response) return response;
      throw error;
    }
  });

  app.post("/api/memories/:memoryId/purge", async (context) => {
    if (!hasSameOrigin(context.req.raw)) return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    const session = await requireSession(context.req.raw, context.env);
    const body = memoryPurgeInput.safeParse(await readJson(context.req.raw, 4_096));
    if (!body.success) return apiError(422, "VALIDATION_ERROR", "Memory purge input is invalid");
    const store = new MemoryStore(context.env.DB);
    const memoryId = context.req.param("memoryId");
    try {
      const current = await store.getById(session.userId, memoryId);
      if (
        !current ||
        current.version !== body.data.expectedVersion ||
        current.status !== "archived" ||
        body.data.confirmation !== `PURGE ${memoryId}`
      ) {
        throw new MemoryConflictError("Purge confirmation or memory state does not match");
      }
      const purged = await store.purgeMemory({
        ownerId: session.userId,
        memoryId,
        ...body.data,
      });
      if (semanticSearchEnabled(context.env)) {
        try {
          await context.env.MEMORY_INDEX.deleteByIds([memoryId]);
        } catch {
          console.error(JSON.stringify({ message: "purged memory vector deletion failed", memoryId }));
        }
      }
      return json(purged);
    } catch (error) {
      const response = memoryLifecycleApiError(error);
      if (response) return response;
      throw error;
    }
  });

  app.get("/api/memories/reviews", async (context) => {
    const session = await requireSession(context.req.raw, context.env);
    const parsed = reviewListInput.safeParse({
      status: context.req.query("status"),
      limit: Number(context.req.query("limit") ?? "25"),
    });
    if (!parsed.success) return apiError(422, "VALIDATION_ERROR", "Review list input is invalid");
    try {
      const reviews = await memoryService(context.env).listReviews({
        ownerId: session.userId,
        status: parsed.data.status,
        limit: parsed.data.limit,
      });
      return json({ reviews });
    } catch (error) {
      const response = reviewApiError(error);
      if (response) return response;
      throw error;
    }
  });

  app.post("/api/memories/reviews/:reviewId/resolve", async (context) => {
    if (!hasSameOrigin(context.req.raw)) {
      return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    }
    const session = await requireSession(context.req.raw, context.env);
    const body = reviewDecisionInput.safeParse(await readJson(context.req.raw, 8_000));
    if (!body.success) return apiError(422, "VALIDATION_ERROR", "Review decision is invalid");
    try {
      const review = await memoryService(context.env).resolveReview({
        ownerId: session.userId,
        reviewId: context.req.param("reviewId"),
        expectedVersion: body.data.expected_version,
        status: body.data.status,
        resolvedBy: session.userId,
        resolutionNote: body.data.resolution_note,
      });
      return json({ review });
    } catch (error) {
      const response = reviewApiError(error);
      if (response) return response;
      throw error;
    }
  });

  app.post("/api/memories/feedback", async (context) => {
    if (!hasSameOrigin(context.req.raw)) {
      return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    }
    const session = await requireSession(context.req.raw, context.env);
    const body = memoryFeedbackInput.safeParse(await readJson(context.req.raw, 8_000));
    if (!body.success) return apiError(422, "VALIDATION_ERROR", "Memory feedback is invalid");
    try {
      const result = await memoryService(context.env).createFeedback({
        ownerId: session.userId,
        query: body.data.query,
        memoryId: body.data.memory_id,
        label: body.data.label,
        mode: body.data.mode,
        rank: body.data.rank,
        score: body.data.score,
        resultSetId: body.data.result_set_id,
        correlationId: body.data.correlation_id,
        client: body.data.client,
        model: body.data.model,
      });
      return json(result, { status: result.idempotent ? 200 : 201 });
    } catch (error) {
      const response = reviewApiError(error);
      if (response) return response;
      throw error;
    }
  });

  app.get("/api/memory-doctor", async (context) => {
    const session = await requireSession(context.req.raw, context.env);
    return json({ findings: await new MemoryDoctor(context.env.DB).list(session.userId, "open", 100) });
  });

  app.post("/api/memory-doctor/run", async (context) => {
    if (!hasSameOrigin(context.req.raw)) return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    const session = await requireSession(context.req.raw, context.env);
    return json(await new MemoryDoctor(context.env.DB).run(session.userId));
  });

  app.post("/api/memory-doctor/:findingId/decision", async (context) => {
    if (!hasSameOrigin(context.req.raw)) return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    const session = await requireSession(context.req.raw, context.env);
    const body = doctorDecisionInput.safeParse(await readJson(context.req.raw, 4_000));
    if (!body.success) return apiError(422, "VALIDATION_ERROR", "Memory Doctor decision is invalid");
    try {
      return json({ finding: await new MemoryDoctor(context.env.DB).decide(
        session.userId,
        context.req.param("findingId"),
        body.data.expectedVersion,
        body.data.status,
      ) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Memory Doctor decision failed";
      return apiError(message.includes("version conflict") ? 409 : 404, "MEMORY_DOCTOR_ERROR", message);
    }
  });

  app.get("/api/context-graph", async (context) => {
    const session = await requireSession(context.req.raw, context.env);
    return json(await new ContextGraphStore(context.env.DB).list(session.userId, 200));
  });

  app.post("/api/context-graph/entities", async (context) => {
    if (!hasSameOrigin(context.req.raw)) return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    const session = await requireSession(context.req.raw, context.env);
    const body = graphEntityInput.safeParse(await readJson(context.req.raw, 4_000));
    if (!body.success) return apiError(422, "VALIDATION_ERROR", "Context graph entity is invalid");
    return json(await new ContextGraphStore(context.env.DB).upsertEntity({ ownerId: session.userId, ...body.data }), { status: 201 });
  });

  app.post("/api/context-graph/entities/:entityId/aliases", async (context) => {
    if (!hasSameOrigin(context.req.raw)) return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    const session = await requireSession(context.req.raw, context.env);
    const body = graphAliasInput.safeParse(await readJson(context.req.raw, 2_000));
    if (!body.success) return apiError(422, "VALIDATION_ERROR", "Context graph alias is invalid");
    await new ContextGraphStore(context.env.DB).addAlias(session.userId, context.req.param("entityId"), body.data.alias);
    return new Response(null, { status: 204 });
  });

  app.post("/api/context-graph/memory-links", async (context) => {
    if (!hasSameOrigin(context.req.raw)) return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    const session = await requireSession(context.req.raw, context.env);
    const body = graphMemoryLinkInput.safeParse(await readJson(context.req.raw, 4_000));
    if (!body.success) return apiError(422, "VALIDATION_ERROR", "Context graph memory link is invalid");
    await new ContextGraphStore(context.env.DB).linkMemory({ ownerId: session.userId, ...body.data });
    return new Response(null, { status: 204 });
  });

  app.post("/api/context-graph/relationships", async (context) => {
    if (!hasSameOrigin(context.req.raw)) return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    const session = await requireSession(context.req.raw, context.env);
    const body = graphRelationshipInput.safeParse(await readJson(context.req.raw, 6_000));
    if (!body.success) return apiError(422, "VALIDATION_ERROR", "Context graph relationship is invalid");
    await new ContextGraphStore(context.env.DB).relate({ ownerId: session.userId, ...body.data });
    return new Response(null, { status: 204 });
  });

  app.get("/api/capability-receipts", async (context) => {
    const session = await requireSession(context.req.raw, context.env);
    return json({ receipts: await new CapabilityReceiptStore(context.env.DB).list(session.userId) });
  });

  app.post("/api/capability-receipts", async (context) => {
    if (!hasSameOrigin(context.req.raw)) return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    const session = await requireSession(context.req.raw, context.env);
    const body = capabilityReceiptInput.safeParse(await readJson(context.req.raw, 4_000));
    if (!body.success) return apiError(422, "VALIDATION_ERROR", "Capability receipt is invalid");
    return json(await new CapabilityReceiptStore(context.env.DB).record({ ownerId: session.userId, ...body.data }), { status: 201 });
  });

  app.post("/api/memories/repair-index", async (context) => {
    if (!hasSameOrigin(context.req.raw)) {
      return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    }
    const session = await requireSession(context.req.raw, context.env);
    return json(await memoryService(context.env).repairIndex(session.userId, 25));
  });

  app.get("/api/projects", async (context) => {
    const session = await requireSession(context.req.raw, context.env);
    const parsedScope = projectScopeInput.safeParse(context.req.query("scope") ?? "active");
    if (!parsedScope.success) return apiError(422, "VALIDATION_ERROR", "Project scope is invalid");
    const scope = parsedScope.data;
    const store = new ProjectStore(context.env.DB);
    const [projects, tasks] = await Promise.all([
      store.listProjects(session.userId, scope),
      store.listTasks(session.userId, scope),
    ]);
    const runsByTask = await new AgentRunStore(context.env.DB).listLatestRelevantByTask(
      session.userId,
      tasks.filter((task) => task.archivedAt === null && task.status !== "done").map((task) => task.id),
      20,
    );
    const now = new Date().toISOString();
    return json({
      projects,
      tasks: tasks.map((task) => ({
        ...task,
        attentionReasons: classifyTaskAttention({ ...task, agentRuns: runsByTask.get(task.id) }, now).reasons,
      })),
    });
  });

  app.post("/api/projects", async (context) => {
    if (!hasSameOrigin(context.req.raw)) {
      return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    }
    const session = await requireSession(context.req.raw, context.env);
    const body = createProjectInput.safeParse(await readJson(context.req.raw, 12_000));
    if (!body.success) return apiError(422, "VALIDATION_ERROR", "Project input is invalid");
    const project = await new ProjectStore(context.env.DB).createProject({
      ownerId: session.userId,
      ...body.data,
    });
    return json(project, { status: 201 });
  });

  app.patch("/api/projects/:projectId", async (context) => {
    if (!hasSameOrigin(context.req.raw)) return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    const session = await requireSession(context.req.raw, context.env);
    const body = updateProjectInput.safeParse(await readJson(context.req.raw, 12_000));
    if (!body.success) return apiError(422, "VALIDATION_ERROR", "Project update is invalid");
    try {
      return json(await new ProjectStore(context.env.DB).updateProject({
        ownerId: session.userId, projectId: context.req.param("projectId"), ...body.data,
      }));
    } catch (error) {
      if (error instanceof VersionConflictError) return apiError(409, "VERSION_CONFLICT", error.message);
      throw error;
    }
  });

  app.post("/api/projects/:projectId/archive", async (context) => {
    if (!hasSameOrigin(context.req.raw)) return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    const session = await requireSession(context.req.raw, context.env);
    const body = archiveRecordInput.safeParse(await readJson(context.req.raw, 4_096));
    if (!body.success) return apiError(422, "VALIDATION_ERROR", "Project archive confirmation is invalid");
    try {
      return json(await new ProjectStore(context.env.DB).archiveProject({
        ownerId: session.userId, projectId: context.req.param("projectId"), expectedVersion: body.data.expectedVersion,
      }));
    } catch (error) {
      if (error instanceof VersionConflictError) return apiError(409, "VERSION_CONFLICT", error.message);
      throw error;
    }
  });

  app.post("/api/projects/:projectId/restore", async (context) => {
    if (!hasSameOrigin(context.req.raw)) return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    const session = await requireSession(context.req.raw, context.env);
    const body = memoryLifecycleInput.safeParse(await readJson(context.req.raw, 4_096));
    if (!body.success) return apiError(422, "VALIDATION_ERROR", "Project restore input is invalid");
    try {
      return json(await new ProjectStore(context.env.DB).restoreProject({
        ownerId: session.userId,
        projectId: context.req.param("projectId"),
        expectedVersion: body.data.expectedVersion,
      }));
    } catch (error) {
      if (error instanceof VersionConflictError) return apiError(409, "VERSION_CONFLICT", error.message);
      throw error;
    }
  });

  registerRoadmapRoutes(app, requireSession);
  registerConnectorRoutes(app, requireSession, memoryService);
  registerClientCompatibilityRoutes(app, requireSession);
  registerContextProfileRoutes(app, requireSession);
  registerReflectionRoutes(app, requireSession);

  app.post("/api/tasks", async (context) => {
    if (!hasSameOrigin(context.req.raw)) {
      return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    }
    const session = await requireSession(context.req.raw, context.env);
    const body = createTaskInput.safeParse(await readJson(context.req.raw, 20_000));
    if (!body.success) return apiError(422, "VALIDATION_ERROR", "Task input is invalid");
    const task = await new ProjectStore(context.env.DB).createTask({
      ownerId: session.userId,
      ...body.data,
    });
    return json(task, { status: 201 });
  });

  app.get("/api/tasks/:taskId", async (context) => {
    const session = await requireSession(context.req.raw, context.env);
    const store = new ProjectStore(context.env.DB);
    const task = await store.getTask(session.userId, context.req.param("taskId"));
    if (!task) return apiError(404, "NOT_FOUND", "Task not found");
    const runStore = new AgentRunStore(context.env.DB);
    const [events, runs, structure] = await Promise.all([
      store.listTaskEvents(session.userId, task.id),
      runStore.listRunsByTask(session.userId, task.id, 50),
      new TaskStructureStore(context.env.DB).get(session.userId, task.id),
    ]);
    const runMemoryBundles = await runStore.listRunMemoryBundles(session.userId, runs.map((run) => run.id), 100);
    const runsWithMemories = runs.map((run) => {
      const bundle = runMemoryBundles.get(run.id);
      return { ...run, memories: bundle?.memories ?? [], linkedMemoryCount: bundle?.linkedMemoryCount ?? 0 };
    });
    const [parentTask, dependencyTasks, relatedTasks] = await Promise.all([
      structure.parentTaskId ? store.getTask(session.userId, structure.parentTaskId) : null,
      Promise.all(structure.dependencies.map((dependencyId) => store.getTask(session.userId, dependencyId))),
      store.listTasksByProject(session.userId, task.projectId, 100).then((tasks) => tasks.filter((candidate) => candidate.id !== task.id)),
    ]);
    const linkedMemoryCount = new Set(runsWithMemories.flatMap((run) => run.memories.map((memory) => memory.memoryId))).size;
    return json({
      task,
      events,
      runs: runsWithMemories,
      structure: {
        ...structure,
        parentTask: parentTask ? { id: parentTask.id, title: parentTask.title, status: parentTask.status } : null,
        dependencyTasks: dependencyTasks.filter((dependency) => dependency !== null).map((dependency) => ({
          id: dependency.id,
          title: dependency.title,
          status: dependency.status,
        })),
        relatedTasks: relatedTasks.map((relatedTask) => ({
          id: relatedTask.id,
          title: relatedTask.title,
          status: relatedTask.status,
        })),
        linkedMemoryCount,
      },
    });
  });

  app.get("/api/agent-runs", async (context) => {
    const session = await requireSession(context.req.raw, context.env);
    return json({ runs: await new AgentRunStore(context.env.DB).listRecent(session.userId, 100) });
  });

  app.patch("/api/tasks/:taskId/structure", async (context) => {
    if (!hasSameOrigin(context.req.raw)) return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    const session = await requireSession(context.req.raw, context.env);
    const body = taskStructureInput.safeParse(await readJson(context.req.raw, 4_000));
    if (!body.success) return apiError(422, "VALIDATION_ERROR", "Task structure input is invalid");
    try {
      return json(await new TaskStructureStore(context.env.DB).update({
        ownerId: session.userId,
        taskId: context.req.param("taskId"),
        expectedVersion: body.data.expectedVersion,
        parentTaskId: body.data.parentTaskId,
        isMilestone: body.data.isMilestone,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Task structure could not be updated";
      return apiError(message.includes("version conflict") ? 409 : 422, "TASK_STRUCTURE_ERROR", message);
    }
  });

  app.post("/api/tasks/:taskId/dependencies", async (context) => {
    if (!hasSameOrigin(context.req.raw)) return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    const session = await requireSession(context.req.raw, context.env);
    const body = taskDependencyInput.safeParse(await readJson(context.req.raw, 4_000));
    if (!body.success) return apiError(422, "VALIDATION_ERROR", "Task dependency input is invalid");
    try {
      return json(await new TaskStructureStore(context.env.DB).addDependency({
        ownerId: session.userId,
        taskId: context.req.param("taskId"),
        expectedVersion: body.data.expectedVersion,
        dependsOnTaskId: body.data.dependsOnTaskId,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Task dependency could not be added";
      return apiError(message.includes("version conflict") ? 409 : 422, "TASK_STRUCTURE_ERROR", message);
    }
  });

  app.delete("/api/tasks/:taskId/dependencies/:dependsOnTaskId", async (context) => {
    if (!hasSameOrigin(context.req.raw)) return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    const session = await requireSession(context.req.raw, context.env);
    const parsedVersion = Number(context.req.query("expectedVersion"));
    if (!Number.isInteger(parsedVersion) || parsedVersion < 1) return apiError(422, "VALIDATION_ERROR", "Expected version is invalid");
    try {
      return json(await new TaskStructureStore(context.env.DB).removeDependency({
        ownerId: session.userId,
        taskId: context.req.param("taskId"),
        expectedVersion: parsedVersion,
        dependsOnTaskId: context.req.param("dependsOnTaskId"),
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Task dependency could not be removed";
      return apiError(message.includes("version conflict") ? 409 : 422, "TASK_STRUCTURE_ERROR", message);
    }
  });

  app.patch("/api/tasks/:taskId", async (context) => {
    if (!hasSameOrigin(context.req.raw)) return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    const session = await requireSession(context.req.raw, context.env);
    const body = updateTaskInput.safeParse(await readJson(context.req.raw, 20_000));
    if (!body.success) return apiError(422, "VALIDATION_ERROR", "Task update is invalid");
    try {
      return json(await new ProjectStore(context.env.DB).updateTask({
        ownerId: session.userId, taskId: context.req.param("taskId"), ...body.data,
      }));
    } catch (error) {
      if (error instanceof VersionConflictError) return apiError(409, "VERSION_CONFLICT", error.message);
      throw error;
    }
  });

  app.post("/api/tasks/:taskId/archive", async (context) => {
    if (!hasSameOrigin(context.req.raw)) return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    const session = await requireSession(context.req.raw, context.env);
    const body = archiveRecordInput.safeParse(await readJson(context.req.raw, 4_096));
    if (!body.success) return apiError(422, "VALIDATION_ERROR", "Task archive confirmation is invalid");
    try {
      return json(await new ProjectStore(context.env.DB).archiveTask({
        ownerId: session.userId, taskId: context.req.param("taskId"), ...body.data,
      }));
    } catch (error) {
      if (error instanceof VersionConflictError) return apiError(409, "VERSION_CONFLICT", error.message);
      throw error;
    }
  });

  app.patch("/api/tasks/:taskId/move", async (context) => {
    if (!hasSameOrigin(context.req.raw)) {
      return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    }
    const session = await requireSession(context.req.raw, context.env);
    const body = moveTaskInput.safeParse(await readJson(context.req.raw, 12_000));
    if (!body.success) return apiError(422, "VALIDATION_ERROR", "Task move is invalid");
    try {
      const task = await new ProjectStore(context.env.DB).moveTask({
        ownerId: session.userId,
        taskId: context.req.param("taskId"),
        ...body.data,
      });
      return json(task);
    } catch (error) {
      if (error instanceof VersionConflictError) {
        return apiError(409, "VERSION_CONFLICT", error.message);
      }
      throw error;
    }
  });

  app.get("/api/memories/search", async (context) => {
    const session = await requireSession(context.req.raw, context.env);
    const parsed = searchMemoryInput.safeParse({
      query: context.req.query("query"),
      limit: Number(context.req.query("limit") ?? "20"),
      include_directives: context.req.query("includeDirectives") !== "false",
      mode: context.req.query("mode") ?? "hybrid",
    });
    if (!parsed.success) return apiError(422, "VALIDATION_ERROR", "Search input is invalid");
    const result = await memoryService(context.env).search({
      ownerId: session.userId,
      query: parsed.data.query,
      limit: parsed.data.limit,
      includeDirectives: parsed.data.include_directives,
      mode: parsed.data.mode,
    });
    return json(result);
  });

  app.get("/api/memories/:memoryNumber", async (context) => {
    const session = await requireSession(context.req.raw, context.env);
    const memoryNumber = Number(context.req.param("memoryNumber"));
    if (!Number.isInteger(memoryNumber) || memoryNumber < 1) {
      return apiError(422, "VALIDATION_ERROR", "Memory number is invalid");
    }
    const memory = await memoryService(context.env).get(session.userId, memoryNumber);
    return memory ? json(memory) : apiError(404, "NOT_FOUND", "Memory not found");
  });

  app.post("/api/memories", async (context) => {
    if (!hasSameOrigin(context.req.raw)) {
      return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    }
    const session = await requireSession(context.req.raw, context.env);
    const body = storeMemoryInput.safeParse(await readJson(context.req.raw, 20_000));
    if (!body.success) return apiError(422, "VALIDATION_ERROR", "Memory input is invalid");
    const memory = await memoryService(context.env).store({
      ownerId: session.userId,
      content: body.data.content,
      directive: body.data.directive,
      source: body.data.source ?? "Dashboard",
      sourceId: body.data.source_id,
      sourceUrl: body.data.source_url,
      client: body.data.client,
      model: body.data.model,
      conversationId: body.data.conversation_id,
      messageId: body.data.message_id,
      memoryType: body.data.memory_type,
      scopeType: body.data.scope_type,
      scopeId: body.data.scope_id,
      retentionTier: body.data.retention_tier,
      observedAt: body.data.observed_at,
      reviewAt: body.data.review_at,
      expiresAt: body.data.expires_at,
    });
    return json(memory, { status: 201 });
  });

  app.post("/api/exports/download", async (context) => {
    if (!hasSameOrigin(context.req.raw)) {
      return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    }
    const session = await requireSession(context.req.raw, context.env);
    const keyHex = context.env.EXPORT_ENCRYPTION_KEY;
    if (!keyHex || !exportCapabilities(context.env).encryptedDownload) {
      return apiError(503, "EXPORT_NOT_CONFIGURED", "Encrypted exports are not configured");
    }
    const snapshot = await generateEncryptedSnapshot({
      database: context.env.DB,
      ownerId: session.userId,
      keyHex,
      repository: context.env.GITHUB_EXPORT_REPOSITORY,
    });
    return new Response(snapshot.encrypted, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${snapshot.path.split("/").at(-1)}"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  });

  app.post("/api/exports/github", async (context) => {
    if (!hasSameOrigin(context.req.raw)) {
      return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    }
    const session = await requireSession(context.req.raw, context.env);
    const keyHex = context.env.EXPORT_ENCRYPTION_KEY;
    const token = context.env.GITHUB_EXPORT_TOKEN;
    if (!keyHex || !token || !exportCapabilities(context.env).githubExport) {
      return apiError(503, "EXPORT_NOT_CONFIGURED", "GitHub encrypted exports are not configured");
    }
    const snapshot = await generateEncryptedSnapshot({
      database: context.env.DB,
      ownerId: session.userId,
      keyHex,
      repository: context.env.GITHUB_EXPORT_REPOSITORY,
    });
    const pushed = await pushEncryptedExport({
      repository: context.env.GITHUB_EXPORT_REPOSITORY,
      path: snapshot.path,
      encrypted: snapshot.encrypted,
      token,
    });
    await markExportPushed(context.env.DB, session.userId, snapshot.runId, pushed.commitSha);
    return json({
      runId: snapshot.runId,
      path: snapshot.path,
      recordCount: snapshot.recordCount,
      contentSha256: snapshot.contentSha256,
      commitSha: pushed.commitSha,
    });
  });

  app.post("/api/imports/truememory/dry-run", async (context) => {
    if (!hasSameOrigin(context.req.raw)) {
      return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    }
    const session = await requireSession(context.req.raw, context.env);
    try {
      return json(await dryRunTrueMemoryImport({
        database: context.env.DB,
        ownerId: session.userId,
        jsonl: await readImportBody(context.req.raw),
      }));
    } catch (error) {
      if (error instanceof HttpError) throw error;
      return apiError(422, "IMPORT_INVALID", error instanceof Error ? error.message : "Import is invalid");
    }
  });

  app.post("/api/imports/truememory/apply", async (context) => {
    if (!hasSameOrigin(context.req.raw)) {
      return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    }
    const session = await requireSession(context.req.raw, context.env);
    const runId = context.req.header("x-import-run-id") ?? "";
    const manifestSha256 = context.req.header("x-import-manifest-sha256") ?? "";
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(runId) || !/^[0-9a-f]{64}$/i.test(manifestSha256)) {
      return apiError(422, "IMPORT_APPROVAL_INVALID", "Import approval headers are invalid");
    }
    try {
      const service = memoryService(context.env);
      const batch = await readJson<{ records: unknown[] }>(context.req.raw, 200_000);
      return json(await applyTrueMemoryImport({
        database: context.env.DB,
        ownerId: session.userId,
        runId,
        manifestSha256,
        records: batch.records,
        store: async (record) => {
          const memory = await service.store({ ownerId: session.userId, ...record });
          return memory.id;
        },
      }));
    } catch (error) {
      if (error instanceof HttpError) throw error;
      return apiError(422, "IMPORT_APPLY_FAILED", error instanceof Error ? error.message : "Import could not be applied");
    }
  });

  app.get("/api/automation-tokens", async (context) => {
    const session = await requireSession(context.req.raw, context.env);
    const result = await context.env.DB.prepare(
      `SELECT id, label, scopes_json, expires_at, last_used_at, revoked_at, created_at
       FROM automation_tokens WHERE owner_id = ? ORDER BY created_at DESC LIMIT 50`,
    ).bind(session.userId).all<Record<string, unknown>>();
    return json({ tokens: result.results.map((row) => ({
      id: row.id,
      label: row.label,
      scopes: JSON.parse(String(row.scopes_json)),
      expiresAt: row.expires_at,
      lastUsedAt: row.last_used_at,
      revokedAt: row.revoked_at,
      createdAt: row.created_at,
    })) });
  });

  app.post("/api/automation-tokens", async (context) => {
    if (!hasSameOrigin(context.req.raw)) {
      return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    }
    const session = await requireSession(context.req.raw, context.env);
    const body = automationTokenInput.safeParse(await readJson(context.req.raw, 4_000));
    if (!body.success) return apiError(422, "VALIDATION_ERROR", "Automation token input is invalid");
    if (body.data.expiresAt && body.data.expiresAt <= new Date().toISOString()) {
      return apiError(422, "VALIDATION_ERROR", "Automation token expiry must be in the future");
    }
    const issued = await issueAutomationToken({
      database: context.env.DB,
      ownerId: session.userId,
      ...body.data,
    });
    return json({ ...issued, label: body.data.label, scopes: body.data.scopes }, { status: 201 });
  });

  app.delete("/api/automation-tokens/:tokenId", async (context) => {
    if (!hasSameOrigin(context.req.raw)) {
      return apiError(403, "INVALID_ORIGIN", "Request origin is not allowed");
    }
    const session = await requireSession(context.req.raw, context.env);
    await context.env.DB.prepare(
      `UPDATE automation_tokens SET revoked_at = ?
       WHERE id = ? AND owner_id = ? AND revoked_at IS NULL`,
    ).bind(new Date().toISOString(), context.req.param("tokenId"), session.userId).run();
    return new Response(null, { status: 204 });
  });

  app.get("/api/automation/obsidian-projection", async (context) => {
    let automation: { ownerId: string };
    try {
      automation = await authenticateAutomationToken({
        database: context.env.DB,
        authorization: context.req.header("authorization"),
        requiredScope: "projection:read",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Automation authorisation failed";
      return apiError(message.includes("scope") ? 403 : 401, "AUTOMATION_UNAUTHORISED", message);
    }
    return json(await buildOwnerProjection({ env: context.env, ownerId: automation.ownerId }));
  });

  app.post("/api/automation/export", async (context) => {
    let automation: { ownerId: string };
    try {
      automation = await authenticateAutomationToken({
        database: context.env.DB,
        authorization: context.req.header("authorization"),
        requiredScope: "export:write",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Automation authorisation failed";
      return apiError(message.includes("scope") ? 403 : 401, "AUTOMATION_UNAUTHORISED", message);
    }
    const keyHex = context.env.EXPORT_ENCRYPTION_KEY;
    const token = context.env.GITHUB_EXPORT_TOKEN;
    if (!keyHex || !token || !exportCapabilities(context.env).githubExport) {
      return apiError(503, "EXPORT_NOT_CONFIGURED", "GitHub encrypted exports are not configured");
    }
    const snapshot = await generateEncryptedSnapshot({
      database: context.env.DB,
      ownerId: automation.ownerId,
      keyHex,
      repository: context.env.GITHUB_EXPORT_REPOSITORY,
    });
    const pushed = await pushEncryptedExport({
      repository: context.env.GITHUB_EXPORT_REPOSITORY,
      path: snapshot.path,
      encrypted: snapshot.encrypted,
      token,
    });
    await markExportPushed(context.env.DB, automation.ownerId, snapshot.runId, pushed.commitSha);
    return json({ runId: snapshot.runId, path: snapshot.path, recordCount: snapshot.recordCount, commitSha: pushed.commitSha });
  });

  app.notFound(() => apiError(404, "NOT_FOUND", "Resource not found"));
  app.onError((error) => {
    if (error instanceof HttpError) return apiError(error.status, error.code, error.message);
    if (error instanceof SecretPatternError) return apiError(422, error.code, error.message);
    console.error(JSON.stringify({ event: "request_failed", error: error.name }));
    return apiError(500, "INTERNAL_ERROR", "The request could not be completed");
  });

  return app;
}
