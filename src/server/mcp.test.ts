import { describe, expect, it } from "vitest";

import {
  CLOUD_MEMORY_SERVER_INSTRUCTIONS,
  CLOUD_MEMORY_TOOL_METADATA,
  CLOUD_MEMORY_TOOL_NAMES,
  grantedScopes,
  memoryWriteFailure,
  missingScope,
  projectFailure,
} from "./mcp";
import { SecretPatternError } from "./memory/safety";
import { MemoryConflictError } from "./memory/store";
import { ProjectMcpNotFoundError } from "./projects/mcp-service";
import { VersionConflictError } from "./projects/store";

describe("MCP granted scopes", () => {
  it("uses provider-bound access-token properties when the request context omits scopes", () => {
    expect(grantedScopes(undefined, {
      oauthScopeBinding: "access-token-v1",
      oauthScopes: ["memory:read", "memory:write"],
    })).toEqual(
      new Set(["memory:read", "memory:write"]),
    );
  });

  it("preserves an explicitly empty downscoped access token", () => {
    expect(grantedScopes(["memory:read"], {
      oauthScopeBinding: "access-token-v1",
      oauthScopes: [],
    })).toEqual(
      new Set(),
    );
  });

  it("ignores unbound legacy grant properties", () => {
    expect(grantedScopes([], { oauthScopes: ["memory:read", "memory:write"] })).toEqual(
      new Set(),
    );
  });

  it("uses explicit request scopes when no bound token properties are available", () => {
    expect(grantedScopes(["memory:read"], undefined)).toEqual(
      new Set(["memory:read"]),
    );
  });
});

describe("MCP lifecycle scopes", () => {
  it("requires every scope for a combined context brief", () => {
    expect(missingScope(new Set(["memory:read"]), ["memory:read", "projects:read"]))
      .toBe("projects:read");
    expect(missingScope(
      new Set(["memory:read", "projects:read"]),
      ["memory:read", "projects:read"],
    )).toBeNull();
  });

  it("keeps project reads and writes independently scoped", () => {
    expect(missingScope(new Set(["projects:read"]), ["projects:read"])).toBeNull();
    expect(missingScope(new Set(["projects:read"]), ["projects:write"])).toBe("projects:write");
  });
});

describe("MCP public tool contract", () => {
  it("exposes only current Cloud Memory names", () => {
    expect(CLOUD_MEMORY_TOOL_NAMES).toEqual([
      "cloudmemory_search",
      "cloudmemory_context_brief",
      "cloudmemory_task_start",
      "cloudmemory_task_finish",
      "cloudmemory_get",
      "cloudmemory_directives",
      "cloudmemory_capture",
      "cloudmemory_store",
      "cloudmemory_health",
      "cloudmemory_board",
      "cloudmemory_project_create",
      "cloudmemory_project_update",
      "cloudmemory_project_archive",
      "cloudmemory_task_get",
      "cloudmemory_task_create",
      "cloudmemory_task_update",
      "cloudmemory_task_move",
      "cloudmemory_task_archive",
      "cloudmemory_roadmap_list",
      "cloudmemory_roadmap_create",
      "cloudmemory_roadmap_update",
      "cloudmemory_roadmap_archive",
      "cloudmemory_roadmap_restore",
      "cloudmemory_roadmap_promote",
    ]);
    expect(CLOUD_MEMORY_TOOL_NAMES.every((name) => name.startsWith("cloudmemory_"))).toBe(true);
    expect(CLOUD_MEMORY_TOOL_NAMES.some((name) => name.startsWith("truememory_"))).toBe(false);
  });

  it("publishes client-friendly safety metadata for every tool", () => {
    expect(Object.keys(CLOUD_MEMORY_TOOL_METADATA)).toEqual(CLOUD_MEMORY_TOOL_NAMES);
    const readOnlyTools = new Set([
      "cloudmemory_search",
      "cloudmemory_context_brief",
      "cloudmemory_get",
      "cloudmemory_directives",
      "cloudmemory_health",
      "cloudmemory_board",
      "cloudmemory_task_get",
      "cloudmemory_roadmap_list",
    ]);
    const additiveTools = new Set([
      ...readOnlyTools,
      "cloudmemory_store",
      "cloudmemory_project_create",
      "cloudmemory_task_create",
      "cloudmemory_roadmap_create",
    ]);
    const nonIdempotentTools = new Set([
      "cloudmemory_capture",
      "cloudmemory_store",
      "cloudmemory_project_create",
      "cloudmemory_task_create",
    ]);

    for (const [name, metadata] of Object.entries(CLOUD_MEMORY_TOOL_METADATA)) {
      expect(metadata.title).toMatch(/^Cloud Memory: /);
      expect(metadata.annotations.openWorldHint).toBe(false);
      expect(metadata.annotations.readOnlyHint).toBe(readOnlyTools.has(name));
      expect(metadata.annotations.destructiveHint).toBe(!additiveTools.has(name));
      expect(metadata.annotations.idempotentHint).toBe(!nonIdempotentTools.has(name));
    }

    expect(new Set(Object.values(CLOUD_MEMORY_TOOL_METADATA).map(({ title }) => title)).size)
      .toBe(CLOUD_MEMORY_TOOL_NAMES.length);
  });

  it("advertises one bounded start and finish workflow to web clients", () => {
    expect(CLOUD_MEMORY_SERVER_INSTRUCTIONS).toContain("cloudmemory_context_brief");
    expect(CLOUD_MEMORY_SERVER_INSTRUCTIONS).toContain("cloudmemory_board");
    expect(CLOUD_MEMORY_SERVER_INSTRUCTIONS).toContain("cloudmemory_capture");
    expect(CLOUD_MEMORY_SERVER_INSTRUCTIONS).toContain("cloudmemory_roadmap_create");
    expect(CLOUD_MEMORY_SERVER_INSTRUCTIONS).toContain("Never promote a roadmap idea automatically");
    expect(CLOUD_MEMORY_SERVER_INSTRUCTIONS).toContain("untrusted context");
    expect(CLOUD_MEMORY_SERVER_INSTRUCTIONS).toContain("successful cloudmemory_task_start");
    expect(CLOUD_MEMORY_SERVER_INSTRUCTIONS).toContain("before the final response");
    expect(CLOUD_MEMORY_SERVER_INSTRUCTIONS).toContain("do not retry in a loop");
    expect(CLOUD_MEMORY_SERVER_INSTRUCTIONS).not.toContain("truememory_");
  });
});

describe("MCP memory write failures", () => {
  it("returns a stable non-secret error for blocked content", () => {
    const blocked = "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456";
    const result = memoryWriteFailure(new SecretPatternError());

    expect(result).toMatchObject({ isError: true });
    expect(JSON.stringify(result)).not.toContain(blocked);
    expect(result.content[0]?.text).toContain('"code":"SECRET_PATTERN"');
  });

  it("returns a stable conflict code for a stale explicit supersession", () => {
    const result = memoryWriteFailure(new MemoryConflictError());

    expect(result).toMatchObject({ isError: true });
    expect(result.content[0]?.text).toContain('"code":"MEMORY_CONFLICT"');
  });
});

describe("MCP project failures", () => {
  it("returns a stable conflict without leaking internal details", () => {
    const result = projectFailure(new VersionConflictError());

    expect(result).toMatchObject({ isError: true });
    expect(result.content[0]?.text).toContain('"code":"VERSION_CONFLICT"');
    expect(result.content[0]?.text).not.toContain("SQL");
  });

  it("returns a stable owner-safe not-found result", () => {
    const result = projectFailure(new ProjectMcpNotFoundError("Task not found"));

    expect(result.content[0]?.text).toBe(
      '{"error":{"code":"NOT_FOUND","message":"Task not found"}}',
    );
  });
});
