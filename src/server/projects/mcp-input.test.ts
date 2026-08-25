import { describe, expect, it } from "vitest";

import {
  mcpArchiveProjectInput,
  mcpArchiveTaskInput,
  mcpBoardInput,
  mcpCreateProjectInput,
  mcpCreateTaskInput,
  mcpGetTaskInput,
  mcpMoveTaskInput,
  mcpUpdateProjectInput,
  mcpUpdateTaskInput,
} from "./mcp-input";

describe("project MCP boundary schemas", () => {
  it("bounds board responses independently of the dashboard", () => {
    expect(mcpBoardInput.parse({})).toEqual({ task_limit: 100 });
    expect(mcpBoardInput.safeParse({ task_limit: 101 }).success).toBe(false);
  });

  it("uses snake-case fields and model provenance defaults", () => {
    expect(mcpCreateTaskInput.parse({
      project_id: "project_1",
      title: "  Build through MCP  ",
      client: "Codex",
      model: "GPT-5.6",
      source_url: "https://chat.example/tasks/1",
    })).toMatchObject({
      project_id: "project_1",
      title: "Build through MCP",
      client: "Codex",
      model: "GPT-5.6",
    });
  });

  it("accepts bounded project and task mutations", () => {
    expect(mcpCreateProjectInput.safeParse({ name: "Cloud Memory" }).success).toBe(true);
    expect(mcpUpdateProjectInput.safeParse({
      project_id: "project_1",
      expected_version: 1,
      status: "paused",
    }).success).toBe(true);
    expect(mcpUpdateTaskInput.safeParse({
      task_id: "task_1",
      expected_version: 1,
      priority: "urgent",
      client: "Codex",
      model: "GPT-5.6",
    }).success).toBe(true);
    expect(mcpMoveTaskInput.safeParse({
      task_id: "task_1",
      expected_version: 2,
      status: "review",
      client: "Codex",
      model: "GPT-5.6",
    }).success).toBe(true);
  });

  it("requires IDs, optimistic versions and explicit archive confirmation", () => {
    expect(mcpGetTaskInput.safeParse({ task_id: "task_1" }).success).toBe(true);
    expect(mcpUpdateTaskInput.safeParse({ task_id: "task_1", priority: "high" }).success).toBe(false);
    expect(mcpCreateTaskInput.safeParse({
      project_id: "project_1",
      title: "Missing provenance",
    }).success).toBe(false);
    expect(mcpArchiveProjectInput.safeParse({
      project_id: "project_1",
      expected_version: 1,
      confirm: false,
    }).success).toBe(false);
    expect(mcpArchiveTaskInput.safeParse({
      task_id: "task_1",
      expected_version: 1,
      confirm: true,
      client: "Codex",
      model: "GPT-5.6",
      note: "Canary complete",
    }).success).toBe(true);
  });

  it("rejects unsupported protocols and unknown fields", () => {
    expect(mcpCreateProjectInput.safeParse({
      name: "Unsafe",
      source_url: "file:///tmp/source",
    }).success).toBe(false);
    expect(mcpCreateTaskInput.safeParse({
      project_id: "project_1",
      title: "Unknown field",
      browser_fallback: true,
    }).success).toBe(false);
  });
});
