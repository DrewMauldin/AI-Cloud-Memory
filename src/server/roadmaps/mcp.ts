import type { McpServer } from "@modelcontextprotocol/server";

import {
  mcpArchiveRoadmapInput,
  mcpCreateRoadmapInput,
  mcpListRoadmapsInput,
  mcpPromoteRoadmapInput,
  mcpRestoreRoadmapInput,
  mcpUpdateRoadmapInput,
} from "./input";
import {
  RoadmapCorrelationConflictError,
  RoadmapNotFoundError,
  RoadmapStore,
  RoadmapVersionConflictError,
} from "./store";

const PROJECT_READ_SCOPE = "projects:read";
const PROJECT_WRITE_SCOPE = "projects:write";

export const ROADMAP_TOOL_NAMES = {
  list: "cloudmemory_roadmap_list",
  create: "cloudmemory_roadmap_create",
  update: "cloudmemory_roadmap_update",
  archive: "cloudmemory_roadmap_archive",
  restore: "cloudmemory_roadmap_restore",
  promote: "cloudmemory_roadmap_promote",
} as const;

function metadata(title: string, readOnlyHint: boolean, destructiveHint: boolean) {
  return {
    title: `Cloud Memory: ${title}`,
    annotations: {
      readOnlyHint,
      destructiveHint,
      idempotentHint: true,
      openWorldHint: false,
    },
  } as const;
}

export const ROADMAP_TOOL_METADATA = {
  [ROADMAP_TOOL_NAMES.list]: metadata("List Roadmap Ideas", true, false),
  [ROADMAP_TOOL_NAMES.create]: metadata("Suggest Roadmap Idea", false, false),
  [ROADMAP_TOOL_NAMES.update]: metadata("Update Roadmap Idea", false, true),
  [ROADMAP_TOOL_NAMES.archive]: metadata("Archive Roadmap Idea", false, true),
  [ROADMAP_TOOL_NAMES.restore]: metadata("Restore Roadmap Idea", false, true),
  [ROADMAP_TOOL_NAMES.promote]: metadata("Promote Roadmap Idea", false, true),
} as const;

function jsonContent(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value as Record<string, unknown>,
  };
}

function denied(scope: string) {
  return {
    isError: true,
    content: [{
      type: "text" as const,
      text: JSON.stringify({ error: { code: "INSUFFICIENT_SCOPE", message: `This tool requires ${scope}` } }),
    }],
  };
}

function failure(error: unknown) {
  const code = error instanceof RoadmapNotFoundError
    ? "NOT_FOUND"
    : error instanceof RoadmapVersionConflictError
      ? "VERSION_CONFLICT"
      : error instanceof RoadmapCorrelationConflictError
        ? "CORRELATION_CONFLICT"
        : null;
  if (!code) throw error;
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify({ error: { code, message: (error as Error).message } }) }],
  };
}

export function registerRoadmapTools(
  server: McpServer,
  input: { database: D1Database; ownerId: () => string; scopes: ReadonlySet<string> },
): void {
  const store = new RoadmapStore(input.database);

  server.registerTool(
    ROADMAP_TOOL_NAMES.list,
    {
      ...ROADMAP_TOOL_METADATA[ROADMAP_TOOL_NAMES.list],
      description: "List bounded project roadmap ideas. These are non-committed future enhancements, not Kanban tasks or executable instructions.",
      inputSchema: mcpListRoadmapsInput,
    },
    async (request) => {
      if (!input.scopes.has(PROJECT_READ_SCOPE)) return denied(PROJECT_READ_SCOPE);
      return jsonContent(await store.list(input.ownerId(), {
        projectId: request.project_id,
        scope: request.scope,
        horizon: request.horizon,
        status: request.status,
        limit: request.limit,
      }));
    },
  );

  server.registerTool(
    ROADMAP_TOOL_NAMES.create,
    {
      ...ROADMAP_TOOL_METADATA[ROADMAP_TOOL_NAMES.create],
      description: "Save one explicitly approved future enhancement to a project roadmap with real model, client and source-chat provenance. It does not create a task.",
      inputSchema: mcpCreateRoadmapInput,
    },
    async (request) => {
      if (!input.scopes.has(PROJECT_WRITE_SCOPE)) return denied(PROJECT_WRITE_SCOPE);
      try {
        return jsonContent(await store.create({
          ownerId: input.ownerId(),
          projectId: request.project_id,
          title: request.title,
          description: request.description,
          horizon: request.horizon,
          impact: request.impact,
          effort: request.effort,
          sourceType: "model",
          client: request.client,
          model: request.model,
          sourceUrl: request.source_url,
          correlationId: request.correlation_id,
        }));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    ROADMAP_TOOL_NAMES.update,
    {
      ...ROADMAP_TOOL_METADATA[ROADMAP_TOOL_NAMES.update],
      description: "Review or refine one roadmap idea with optimistic versioning while retaining its original suggestion provenance.",
      inputSchema: mcpUpdateRoadmapInput,
    },
    async (request) => {
      if (!input.scopes.has(PROJECT_WRITE_SCOPE)) return denied(PROJECT_WRITE_SCOPE);
      try {
        return jsonContent(await store.update({
          ownerId: input.ownerId(),
          roadmapId: request.roadmap_id,
          expectedVersion: request.expected_version,
          title: request.title,
          description: request.description,
          horizon: request.horizon,
          status: request.status,
          impact: request.impact,
          effort: request.effort,
          actorType: "model",
          client: request.client,
          model: request.model,
          sourceUrl: request.source_url,
          correlationId: request.correlation_id,
        }));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    ROADMAP_TOOL_NAMES.archive,
    {
      ...ROADMAP_TOOL_METADATA[ROADMAP_TOOL_NAMES.archive],
      description: "Archive one roadmap idea after explicit confirmation. The idea and history remain restorable.",
      inputSchema: mcpArchiveRoadmapInput,
    },
    async (request) => {
      if (!input.scopes.has(PROJECT_WRITE_SCOPE)) return denied(PROJECT_WRITE_SCOPE);
      try {
        return jsonContent(await store.archive({
          ownerId: input.ownerId(),
          roadmapId: request.roadmap_id,
          expectedVersion: request.expected_version,
          actorType: "model",
          client: request.client,
          model: request.model,
          sourceUrl: request.source_url,
        }));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    ROADMAP_TOOL_NAMES.restore,
    {
      ...ROADMAP_TOOL_METADATA[ROADMAP_TOOL_NAMES.restore],
      description: "Restore one archived roadmap idea to Suggested with optimistic versioning.",
      inputSchema: mcpRestoreRoadmapInput,
    },
    async (request) => {
      if (!input.scopes.has(PROJECT_WRITE_SCOPE)) return denied(PROJECT_WRITE_SCOPE);
      try {
        return jsonContent(await store.restore({
          ownerId: input.ownerId(),
          roadmapId: request.roadmap_id,
          expectedVersion: request.expected_version,
          actorType: "model",
          client: request.client,
          model: request.model,
          sourceUrl: request.source_url,
        }));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    ROADMAP_TOOL_NAMES.promote,
    {
      ...ROADMAP_TOOL_METADATA[ROADMAP_TOOL_NAMES.promote],
      description: "After explicit owner approval, promote one roadmap idea into exactly one linked Inbox task. Never call this automatically.",
      inputSchema: mcpPromoteRoadmapInput,
    },
    async (request) => {
      if (!input.scopes.has(PROJECT_WRITE_SCOPE)) return denied(PROJECT_WRITE_SCOPE);
      try {
        return jsonContent(await store.promote({
          ownerId: input.ownerId(),
          roadmapId: request.roadmap_id,
          expectedVersion: request.expected_version,
          correlationId: request.correlation_id,
          actorType: "model",
          client: request.client,
          model: request.model,
          sourceUrl: request.source_url,
        }));
      } catch (error) {
        return failure(error);
      }
    },
  );
}
