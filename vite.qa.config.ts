import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const now = "2026-08-23T10:00:00.000Z";
const project = {
  id: "project-cloud-memory", ownerId: "123456789", name: "Cloud Memory",
  description: "Private edge memory and project command centre", colour: "#c9ff3b",
  status: "active", sourceUrl: null, createdAt: now, updatedAt: now, version: 1,
};
const projects = [
  project,
  { ...project, id: "project-basware", name: "Basware OS", colour: "#82d8ff", status: "paused" },
  { ...project, id: "project-chs", name: "CHS Buddy", colour: "#ff9e80", status: "completed" },
];
const task = (id: string, title: string, status: string, projectId: string, model: string | null, client: string | null, sourceUrl: string | null, priority = "medium") => ({
  id, ownerId: "123456789", projectId, title, description: `Verified work item for ${title.toLocaleLowerCase()}.`,
  status, priority, position: 1000, dueAt: null, blockerSummary: status === "blocked" ? "Waiting for Cloudflare browser authorisation" : null,
  sourceType: model ? "model" : "human", sourceClient: client, sourceModel: model, sourceUrl,
  archivedAt: null, createdAt: now, updatedAt: now, version: 1,
});
let tasks = [
  task("t1", "Import the latest memory snapshot", "inbox", project.id, "GPT-5.6", "Codex", null, "high"),
  task("t2", "Verify MCP Inspector authorisation", "planned", project.id, "Claude Opus", "Claude Code", "https://claude.ai/chat/example"),
  task("t3", "Polish the Signal Room dashboard", "in_progress", project.id, "GPT-5.6", "Codex", "https://chatgpt.com/c/example", "urgent"),
  task("t4", "Create Cloudflare resources", "blocked", project.id, null, null, null, "high"),
  task("t5", "Review public product narrative", "review", "project-basware", "Gemini 3", "OpenCode", null),
  task("t6", "Ship native symptom timeline", "done", "project-chs", "GPT-5", "Codex", "https://chatgpt.com/c/example"),
  { ...task("t7", "Retire the legacy MCP naming", "done", project.id, "Claude Opus", "Claude Code", "https://claude.ai/chat/example"), updatedAt: "2026-08-10T10:00:00.000Z" },
].map((item) => ({
  ...item,
  attentionReasons: item.status === "blocked"
    ? ["blocked"]
    : item.status === "review"
      ? ["review"]
      : item.sourceUrl ? [] : ["missing_provenance"],
}));

const libraryRecord = (id: string, kind: "memory" | "directive", content: string, index: number) => ({
  memoryNumber: index + 1,
  id,
  ownerId: "123456789",
  namespace: kind === "directive" ? "directives" : index % 3 === 0 ? "decisions" : "default",
  kind,
  memoryType: kind === "directive" ? "preference" : index % 3 === 0 ? "decision" : "fact",
  scopeType: index % 2 === 0 ? "project" : "global",
  scopeId: index % 2 === 0 ? "project-cloud-memory" : null,
  retentionTier: kind === "directive" ? "core" : "durable",
  content,
  contentSha256: `qa-hash-${id}`,
  summary: index % 3 === 0 ? content.split(".")[0] : null,
  importance: Math.max(0.55, 0.95 - index * 0.02),
  confidence: 0.96,
  status: "active",
  sensitivity: "normal",
  sourceSystem: "Cloud Memory QA",
  sourceId: id,
  sourceUrl: index % 2 === 0 ? "https://chatgpt.com/c/example" : null,
  sourceClient: index % 2 === 0 ? "Codex" : "Claude Code",
  sourceModel: index % 2 === 0 ? "GPT-5.6" : "Claude Opus",
  conversationId: null,
  messageId: null,
  observedAt: now,
  recordedAt: now,
  reviewAt: null,
  expiresAt: null,
  vectorState: "indexed",
  archivedAt: null,
  purgedAt: null,
  lastRetrievedAt: index % 4 === 0 ? now : null,
  retrievalCount: index % 4 === 0 ? index + 1 : 0,
  labels: index % 3 === 0 ? ["architecture", "cloud-memory"] : index % 3 === 1 ? ["workflow"] : [],
  createdAt: now,
  updatedAt: now,
  version: 1,
});
type QaLibraryRecord = Omit<ReturnType<typeof libraryRecord>, "archivedAt"> & { archivedAt: string | null };
let libraryRecords: QaLibraryRecord[] = [
  ...Array.from({ length: 16 }, (_, index) => libraryRecord(
    `directive-${index + 1}`,
    "directive",
    [
      "Use Cloud Memory MCP tools for every canonical memory and project operation.",
      "Keep secrets out of memory, Obsidian, source control and execution logs.",
      "Prefer Australian English in owner-facing copy and release notes.",
      "Treat D1 as canonical and every projection as safely rebuildable.",
    ][index % 4] ?? "Standing directive",
    index,
  )),
  ...Array.from({ length: 12 }, (_, index) => libraryRecord(
    `memory-${index + 1}`,
    "memory",
    [
      "Cloud Memory uses D1 for canonical records and Vectorize for derived semantic recall.",
      "The optional Obsidian projection is delivered through a guarded WebDAV automation.",
      "GitHub OAuth identifies the owner while scoped MCP OAuth controls model access.",
      "Archived projects retain their task history and disappear from the active board.",
    ][index % 4] ?? "Durable memory",
    index + 16,
  )),
];
const archivedProjects = [{
  ...project,
  id: "project-archived",
  name: "Legacy migration study",
  description: "Preserved migration evidence and compatibility decisions.",
  status: "archived",
  archivedAt: now,
  version: 4,
}];
const archivedTasks = [task("task-archived", "Validate the final import receipt", "done", "project-archived", "GPT-5.6", "Codex", "https://chatgpt.com/c/example")];
type QaRoadmap = {
  id: string; ownerId: string; projectId: string; title: string; description: string | null;
  horizon: "next" | "later" | "someday"; status: "suggested" | "considering" | "planned" | "promoted" | "dismissed" | "archived";
  impact: "low" | "medium" | "high"; effort: "small" | "medium" | "large"; position: number;
  sourceType: string; sourceClient: string | null; sourceModel: string | null; sourceUrl: string | null;
  promotedTaskId: string | null; promotedAt: string | null; archivedAt: string | null;
  createdAt: string; updatedAt: string; version: number;
};
const roadmapIdea = (id: string, title: string, horizon: QaRoadmap["horizon"], impact: QaRoadmap["impact"], effort: QaRoadmap["effort"], projectId = project.id): QaRoadmap => ({
  id, ownerId: "123456789", projectId, title,
  description: `A durable future enhancement for ${title.toLocaleLowerCase()}.`,
  horizon, status: "suggested", impact, effort, position: 1000,
  sourceType: "model", sourceClient: "Codex", sourceModel: "GPT-5.6",
  sourceUrl: "https://chatgpt.com/c/example", promotedTaskId: null, promotedAt: null,
  archivedAt: null, createdAt: now, updatedAt: now, version: 1,
});
let roadmaps: QaRoadmap[] = [
  roadmapIdea("roadmap-confidence", "Add confidence trends", "next", "high", "small"),
  roadmapIdea("roadmap-benchmark", "Build benchmark history", "next", "high", "medium"),
  roadmapIdea("roadmap-workspaces", "Explore shared workspaces", "later", "high", "large", "project-basware"),
  roadmapIdea("roadmap-offline", "Investigate offline read access", "someday", "medium", "large"),
];

const agentRun = {
  id: "run-qa-1", taskId: "t3", conversationId: "conversation-qa-1", correlationId: "qa-run-1",
  actorType: "model", client: "Codex", model: "GPT-5.6", sourceUrl: "https://chatgpt.com/c/example",
  status: "succeeded", receipt: "Implemented the command-centre trust surfaces and passed focused verification.",
  startedAt: now, heartbeatAt: now, finishedAt: now, linkedMemoryCount: 3,
};

const clientManifest = {
  schemaVersion: 1 as const,
  endpoint: "https://memory.example/mcp",
  requiredScopes: ["memory:read", "memory:write", "projects:read", "projects:write"],
  clients: [
    { id: "codex", label: "Codex", setup: "cli", oauth: true, hookSupport: "native", writeSupport: "full", expectedToolCount: 24, canary: ["configured", "authenticated", "cloudmemory_health", "cloudmemory_board", "tool_count_24"] },
    { id: "claude_code", label: "Claude Code", setup: "cli", oauth: true, hookSupport: "native", writeSupport: "full", expectedToolCount: 24, canary: ["configured", "authenticated", "cloudmemory_health", "cloudmemory_board", "tool_count_24"] },
    { id: "opencode", label: "OpenCode", setup: "cli", oauth: true, hookSupport: "plugin", writeSupport: "full", expectedToolCount: 24, canary: ["configured", "authenticated", "cloudmemory_health", "cloudmemory_board", "tool_count_24"] },
    { id: "claude_web", label: "Claude Web", setup: "connector_ui", oauth: true, hookSupport: "instructions_only", writeSupport: "full", expectedToolCount: 24, canary: ["configured", "authenticated", "cloudmemory_health", "cloudmemory_board", "tool_count_24"] },
    { id: "chatgpt", label: "ChatGPT", setup: "connector_ui", oauth: true, hookSupport: "instructions_only", writeSupport: "read_only_plan_limit", expectedToolCount: 24, canary: ["configured", "authenticated", "cloudmemory_health", "cloudmemory_board", "tool_count_24"] },
  ],
};
const clientReceipts = clientManifest.clients.map((client, index) => ({
  clientId: client.id, clientVersion: index < 3 ? "current" : null, endpoint: clientManifest.endpoint,
  configuredStatus: "configured", authenticatedStatus: "authenticated", verifiedStatus: index === 4 ? "degraded" : "verified",
  expectedToolCount: 24, discoveredToolCount: 24, model: index === 0 ? "GPT-5.6" : null,
  evidence: index === 4 ? "Read-only plan canary passed." : "Health, board and 24-tool canary passed.", checkedAt: now, updatedAt: now, version: 1,
}));
const profileFacets = [
  { id: "facet-communication", facetType: "communication", content: "Use polished Australian English and make outcomes easy to scan.", summary: "Australian English and clear outcomes", sensitivity: "normal", enabled: true, archivedAt: null, version: 1 },
  { id: "facet-working-style", facetType: "working_style", content: "Verify the decisive live surface and distinguish deployed from pending work.", summary: "Evidence-led collaboration", sensitivity: "normal", enabled: true, archivedAt: null, version: 1 },
  { id: "facet-constraints", facetType: "constraints", content: "Keep secrets out of memory, projections, source control and logs.", summary: "Strict secret boundary", sensitivity: "private", enabled: true, archivedAt: null, version: 1 },
  { id: "facet-goals", facetType: "goals", content: "Make Cloud Memory dependable enough to become the primary cross-client workspace.", summary: "Primary workspace readiness", sensitivity: "normal", enabled: false, archivedAt: now, version: 2 },
];
const contextPacks = [
  {
    id: "pack-cloud-memory", name: "Cloud Memory development", description: "Bounded context for product work", scopeType: "project", scopeId: project.id,
    facetTypes: ["communication", "working_style", "constraints"], memoryIds: ["memory-1"], query: "Cloud Memory architecture and current release work",
    memoryLimit: 5, directiveLimit: 5, enabled: true, archivedAt: null, version: 1,
  },
  {
    id: "pack-legacy-migration", name: "Legacy migration", description: "Preserved context for completed migration work", scopeType: "global", scopeId: null,
    facetTypes: ["constraints"], memoryIds: [], query: "legacy migration history",
    memoryLimit: 3, directiveLimit: 3, enabled: false, archivedAt: now, version: 2,
  },
];
const reflectionProposals = [{
  id: "proposal-stale", proposalType: "stale_dynamic", primaryMemoryId: "memory-2", relatedMemoryIds: [], evidence: { ageDays: 112 },
  suggestedAction: "archive", impact: "medium", status: "open", createdAt: now, updatedAt: now, version: 1,
  primaryMemory: { version: 1, status: "active", summary: "Legacy projection transport status" },
}];
const connectorRuns = [{
  id: "connector-run-1", adapterId: "markdown_bundle", sourceRef: "qa-fixture", status: "completed", examinedCount: 4,
  importableCount: 3, duplicateCount: 1, rejectedCount: 0, importedCount: 3, previewSha256: "9c55f6f4b9847a6726b6f8dcba326f7a",
  createdAt: now, completedAt: now, version: 2,
}];

function json(response: unknown, status = 200) {
  return { status, body: JSON.stringify(response), headers: { "content-type": "application/json" } };
}

function qaApi(): Plugin {
  return {
    name: "cloud-memory-qa-api",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url ?? "/", "http://qa.local");
        const readBody = async () => {
          const chunks: Buffer[] = [];
          for await (const chunk of request) chunks.push(Buffer.from(chunk));
          return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
        };
        let result: ReturnType<typeof json> | null = null;
        if (url.pathname === "/api/session") result = json({ authenticated: true, user: { id: "123456789", login: "community-owner", name: "Owner", avatarUrl: null }, exportCapabilities: { encryptedDownload: true, githubExport: false } });
        else if (url.pathname === "/api/health") result = json({ status: "ok", service: "cloud-memory-qa", version: "1.0.0", environment: "qa-fixture", checkedAt: now, checks: { worker: "ok", d1: "ok", vectorize: "configured", workersAi: "configured" } });
        else if (url.pathname === "/api/projects" && request.method === "GET") result = url.searchParams.get("scope") === "archived"
          ? json({ projects: archivedProjects, tasks: archivedTasks })
          : json({ projects, tasks });
        else if (url.pathname === "/api/agent-runs") result = json({ runs: [agentRun] });
        else if (url.pathname === "/api/capability-receipts") result = json({ receipts: [] });
        else if (url.pathname === "/api/client-compatibility" && request.method === "GET") result = json({ manifest: clientManifest, receipts: clientReceipts });
        else if (url.pathname === "/api/context-profile" && request.method === "GET") result = json({ facets: profileFacets, packs: contextPacks });
        else if (url.pathname === "/api/reflection" && request.method === "GET") result = json({ proposals: reflectionProposals });
        else if (url.pathname === "/api/connectors" && request.method === "GET") result = json({ adapters: [
          { id: "cloud_memory_jsonl", label: "Cloud Memory JSONL", remote: false },
          { id: "truememory_jsonl", label: "TrueMemory JSONL", remote: false },
          { id: "markdown_bundle", label: "Markdown bundle", remote: false },
          { id: "github_markdown", label: "GitHub Markdown", remote: true },
        ], runs: connectorRuns });
        else if (url.pathname === "/api/memories/reviews") result = json({ reviews: [] });
        else if (url.pathname === "/api/memory-doctor") result = json({ findings: [] });
        else if (url.pathname === "/api/context-graph") result = json({
          entities: [
            { id: "entity-cloud-memory", ownerId: "123456789", canonicalName: "Cloud Memory", entityType: "system", description: "Canonical private memory and project control plane.", aliases: ["CM"], createdAt: now, updatedAt: now, version: 1 },
            { id: "entity-obsidian", ownerId: "123456789", canonicalName: "Obsidian", entityType: "system", description: "Managed read-only knowledge projection.", aliases: ["Vault"], createdAt: now, updatedAt: now, version: 1 },
          ],
          relationships: [{ id: "relationship-qa-1", fromEntityId: "entity-cloud-memory", toEntityId: "entity-obsidian", relationshipType: "projects to", validFrom: null, validUntil: null, evidenceMemoryId: "memory-qa-1", confidence: 0.97, updatedAt: now }],
          memoryLinks: [{ memoryId: "memory-qa-1", entityId: "entity-cloud-memory", relation: "evidence", confidence: 1 }],
        });
        else if (url.pathname === "/api/activity") result = json({ events: [
          { id: "activity-1", subjectType: "memory", subjectId: "memory-1", subjectTitle: "D1 remains canonical", eventType: "labelled", actorType: "human", client: "Cloud Memory dashboard", model: null, sourceUrl: null, createdAt: now },
          { id: "activity-2", subjectType: "project", subjectId: project.id, subjectTitle: project.name, eventType: "restored", actorType: "human", client: null, model: null, sourceUrl: null, createdAt: now },
          { id: "activity-3", subjectType: "task", subjectId: "t3", subjectTitle: "Polish the Signal Room dashboard", eventType: "updated", actorType: "model", client: "Codex", model: "GPT-5.6", sourceUrl: "https://chatgpt.com/c/example", createdAt: now },
        ] });
        else if (url.pathname === "/api/library" && request.method === "GET") {
          const status = url.searchParams.get("status") ?? "active";
          const kind = url.searchParams.get("kind");
          const query = (url.searchParams.get("query") ?? "").toLocaleLowerCase();
          const scopeId = url.searchParams.get("scopeId");
          const sort = url.searchParams.get("sort") ?? "updated";
          const items = libraryRecords.filter((item) => item.status === status
            && (!kind || item.kind === kind)
            && (!scopeId || item.scopeId === scopeId)
            && (!query || `${item.summary ?? ""} ${item.content}`.toLocaleLowerCase().includes(query)))
            .sort((left, right) => sort === "importance" ? right.importance - left.importance : right.memoryNumber - left.memoryNumber);
          result = json({
            items,
            nextCursor: null,
            counts: {
              active: libraryRecords.length,
              archived: 4,
              memories: libraryRecords.filter((item) => item.kind === "memory").length,
              directives: libraryRecords.filter((item) => item.kind === "directive").length,
            },
          });
        }
        else if (url.pathname === "/api/library/bulk" && request.method === "POST") {
          const body = await readBody() as { action: "archive" | "restore" | "label"; label?: string; records: Array<{ id: string; expectedVersion: number }> };
          const results = body.records.map((record) => {
            const existing = libraryRecords.find((item) => item.id === record.id && item.version === record.expectedVersion);
            if (!existing) return { id: record.id, outcome: "conflict" };
            const updated = body.action === "label"
              ? { ...existing, labels: [...new Set([...existing.labels, body.label ?? ""])], version: existing.version + 1 }
              : { ...existing, status: body.action === "archive" ? "archived" : "active", archivedAt: body.action === "archive" ? now : null, version: existing.version + 1 };
            libraryRecords = libraryRecords.map((item) => item.id === record.id ? updated : item);
            return { id: record.id, outcome: "changed", memory: updated };
          });
          result = json({ results });
        }
        else if (/^\/api\/memories\/[^/]+\/history$/.test(url.pathname) && request.method === "GET") {
          const id = url.pathname.split("/")[3];
          result = json({ events: [{ id: `history-${id}`, memoryId: id, eventType: "created", actorType: "model", client: "Codex", model: "GPT-5.6", sourceUrl: "https://chatgpt.com/c/example", correlationId: "qa-history", previous: null, next: { status: "active" }, createdAt: now }] });
        }
        else if (/^\/api\/memories\/[^/]+\/related$/.test(url.pathname) && request.method === "GET") {
          const id = url.pathname.split("/")[3];
          const selected = libraryRecords.find((item) => item.id === id);
          result = json({ items: selected ? libraryRecords.filter((item) => item.id !== id && (item.scopeId === selected.scopeId || item.labels.some((label) => selected.labels.includes(label)))).slice(0, 4) : [] });
        }
        else if (url.pathname === "/api/projects" && request.method === "POST") {
          const body = await readBody();
          const created = { ...project, id: `project-${projects.length + 1}`, name: body.name, description: body.description ?? null, colour: body.colour };
          projects.unshift(created as typeof project);
          result = json(created, 201);
        }
        else if (url.pathname === "/api/roadmaps" && request.method === "GET") {
          const scope = url.searchParams.get("scope") ?? "active";
          const projectId = url.searchParams.get("projectId");
          const items = roadmaps.filter((item) => (!projectId || item.projectId === projectId)
            && (scope === "active" ? ["suggested", "considering", "planned"].includes(item.status)
              : scope === "promoted" ? item.status === "promoted"
                : scope === "archived" ? ["archived", "dismissed"].includes(item.status) : true));
          result = json({ items, total: items.length });
        }
        else if (url.pathname === "/api/roadmaps" && request.method === "POST") {
          const body = await readBody();
          const created = {
            ...roadmapIdea(`roadmap-${roadmaps.length + 1}`, String(body.title), String(body.horizon) as QaRoadmap["horizon"], String(body.impact) as QaRoadmap["impact"], String(body.effort) as QaRoadmap["effort"], String(body.projectId)),
            description: body.description ? String(body.description) : null,
            sourceType: String(body.sourceType), sourceClient: body.client ? String(body.client) : null,
            sourceModel: body.model ? String(body.model) : null, sourceUrl: body.sourceUrl ? String(body.sourceUrl) : null,
          };
          roadmaps.unshift(created);
          result = json(created, 201);
        }
        else if (/^\/api\/roadmaps\/[^/]+$/.test(url.pathname) && request.method === "PATCH") {
          const id = url.pathname.split("/")[3];
          const body = await readBody();
          const existing = roadmaps.find((item) => item.id === id);
          if (existing) {
            const updated = { ...existing, ...body, version: existing.version + 1, updatedAt: now };
            roadmaps = roadmaps.map((item) => item.id === id ? updated : item);
            result = json(updated);
          }
        }
        else if (/^\/api\/roadmaps\/[^/]+\/(archive|restore|promote)$/.test(url.pathname) && request.method === "POST") {
          const [, , , id, action] = url.pathname.split("/");
          const existing = roadmaps.find((item) => item.id === id);
          if (existing && action === "promote") {
            const promotedTask = { ...task(`t${tasks.length + 1}`, existing.title, "inbox", existing.projectId, existing.sourceModel, existing.sourceClient, existing.sourceUrl), attentionReasons: [] };
            tasks.unshift(promotedTask);
            const updated: QaRoadmap = { ...existing, status: "promoted", promotedTaskId: promotedTask.id, promotedAt: now, version: existing.version + 1 };
            roadmaps = roadmaps.map((item) => item.id === id ? updated : item);
            result = json({ roadmap: updated, task: promotedTask, replayed: false });
          } else if (existing) {
            const updated: QaRoadmap = { ...existing, status: action === "archive" ? "archived" : "suggested", archivedAt: action === "archive" ? now : null, version: existing.version + 1 };
            roadmaps = roadmaps.map((item) => item.id === id ? updated : item);
            result = json(updated);
          }
        }
        else if (url.pathname === "/api/tasks" && request.method === "POST") {
          const body = await readBody();
          const created = { ...task(`t${tasks.length + 1}`, String(body.title), "inbox", String(body.projectId), body.model ? String(body.model) : null, body.client ? String(body.client) : null, body.sourceUrl ? String(body.sourceUrl) : null, String(body.priority)), attentionReasons: [] };
          tasks.unshift(created);
          result = json(created, 201);
        }
        else if (url.pathname === "/api/memories/directives") result = json({ directives: [{ id: "d1", memoryNumber: 1, content: "Keep Cloud Memory owner-only and never commit plaintext exports.", kind: "directive" }] });
        else if (/^\/api\/tasks\/[^/]+$/.test(url.pathname)) {
          const id = url.pathname.split("/")[3];
          const found = tasks.find((item) => item.id === id);
          const relatedTasks = tasks.filter((item) => item.projectId === found?.projectId && item.id !== id).map((item) => ({ id: item.id, title: item.title, status: item.status }));
          result = found ? json({ task: found, events: [{ id: "e1", taskId: id, eventType: "created", actorType: found.sourceType, client: found.sourceClient, model: found.sourceModel, sourceUrl: found.sourceUrl, fromStatus: null, toStatus: "inbox", note: null, createdAt: now }], runs: id === "t3" ? [agentRun] : [], structure: { taskId: id, parentTaskId: null, isMilestone: id === "t3", dependencies: [], progress: { childCount: 2, completedChildCount: 1, percent: 50 }, version: 1, updatedAt: now, parentTask: null, dependencyTasks: [], relatedTasks, linkedMemoryCount: id === "t3" ? 3 : 0 } }) : json({ error: { message: "Task not found" } }, 404);
        }
        else if (/^\/api\/tasks\/[^/]+\/move$/.test(url.pathname) && request.method === "PATCH") {
          const id = url.pathname.split("/")[3];
          const existing = tasks.find((item) => item.id === id);
          if (existing) {
            const body = await readBody();
            const updated = { ...existing, status: String(body.status), version: existing.version + 1, updatedAt: new Date().toISOString() };
            tasks = tasks.map((item) => item.id === id ? updated : item);
            result = json(updated);
          } else result = json({ error: { message: "Task not found" } }, 404);
        }
        if (!result && url.pathname.startsWith("/api/")) result = json({ error: { code: "QA_ROUTE_NOT_MOCKED", message: `No QA fixture exists for ${request.method ?? "GET"} ${url.pathname}` } }, 501);
        if (!result) return next();
        response.statusCode = result.status;
        for (const [name, value] of Object.entries(result.headers)) response.setHeader(name, value);
        response.end(result.body);
      });
    },
  };
}

export default defineConfig({ plugins: [react(), qaApi()] });
