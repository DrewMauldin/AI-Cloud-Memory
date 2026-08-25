import { describe, expect, it } from "vitest";

import { contextBriefInput, taskFinishInput, taskStartInput } from "./input";

describe("lifecycle MCP schemas", () => {
  it("bounds context retrieval and supplies conservative defaults", () => {
    expect(contextBriefInput.parse({ query: "Cloud Memory" })).toEqual({
      query: "Cloud Memory",
      memory_limit: 5,
      project_limit: 5,
      task_limit: 10,
      roadmap_limit: 5,
    });
    expect(contextBriefInput.safeParse({ query: "Cloud Memory", task_limit: 500 }).success).toBe(false);
    expect(contextBriefInput.safeParse({ query: "Cloud Memory", roadmap_limit: 11 }).success).toBe(false);
    expect(contextBriefInput.safeParse({ query: "Cloud Memory", context_pack_id: "pack_1" }).success).toBe(true);
  });

  it("requires versioning and model provenance for lifecycle mutations", () => {
    expect(taskStartInput.safeParse({ task_id: "task_1", client: "Codex", model: "GPT-5" }).success).toBe(false);
    expect(taskStartInput.safeParse({
      task_id: "task_1",
      expected_version: 1,
      client: "Codex",
      model: "GPT-5",
      correlation_id: "run-123",
    }).success).toBe(true);
    expect(taskFinishInput.safeParse({
      task_id: "task_1",
      expected_version: 1,
      status: "in_progress",
      client: "Codex",
      model: "GPT-5",
    }).success).toBe(false);
  });

  it("bounds correlation identifiers", () => {
    expect(taskStartInput.safeParse({
      task_id: "task_1",
      expected_version: 1,
      client: "Codex",
      model: "GPT-5",
      correlation_id: "x".repeat(201),
    }).success).toBe(false);
  });
});
