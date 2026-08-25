import { describe, expect, it } from "vitest";

import {
  archiveRoadmapInput,
  createRoadmapInput,
  mcpCreateRoadmapInput,
  mcpPromoteRoadmapInput,
  promoteRoadmapInput,
  roadmapListInput,
  updateRoadmapInput,
} from "./input";

describe("roadmap inputs", () => {
  it("applies conservative defaults to a human roadmap idea", () => {
    expect(createRoadmapInput.parse({ projectId: "project-1", title: "  Better exports  " })).toEqual({
      projectId: "project-1",
      title: "Better exports",
      horizon: "later",
      impact: "medium",
      effort: "medium",
      sourceType: "human",
    });
  });

  it("bounds list filters and rejects unknown fields", () => {
    expect(roadmapListInput.parse({ projectId: "project-1", scope: "active", limit: "25" })).toEqual({
      projectId: "project-1",
      scope: "active",
      limit: 25,
    });
    expect(roadmapListInput.safeParse({ limit: "101" }).success).toBe(false);
    expect(createRoadmapInput.safeParse({ projectId: "project-1", title: "Idea", secret: "no" }).success).toBe(false);
  });

  it("requires a real change and HTTP source URLs", () => {
    expect(updateRoadmapInput.safeParse({ expectedVersion: 1 }).success).toBe(false);
    expect(createRoadmapInput.safeParse({
      projectId: "project-1",
      title: "Idea",
      sourceUrl: "javascript:alert(1)",
    }).success).toBe(false);
    expect(archiveRoadmapInput.safeParse({ expectedVersion: 1, confirm: false }).success).toBe(false);
  });

  it("requires MCP model provenance and stable promotion intent", () => {
    expect(createRoadmapInput.safeParse({
      projectId: "project-1",
      title: "Idea",
      sourceType: "model",
    }).success).toBe(false);
    expect(createRoadmapInput.safeParse({
      projectId: "project-1",
      title: "Idea",
      sourceType: "model",
      client: "Codex",
      model: "GPT-5",
    }).success).toBe(true);
    expect(mcpCreateRoadmapInput.safeParse({
      project_id: "project-1",
      title: "Idea",
      client: "Codex",
      model: "GPT-5",
      correlation_id: "roadmap-create-1",
    }).success).toBe(true);
    expect(mcpCreateRoadmapInput.safeParse({
      project_id: "project-1",
      title: "Idea",
      client: "Codex",
      correlation_id: "roadmap-create-1",
    }).success).toBe(false);
    expect(mcpPromoteRoadmapInput.safeParse({
      roadmap_id: "roadmap-1",
      expected_version: 1,
      correlation_id: "roadmap-promote-1",
      confirm: true,
      client: "Codex",
      model: "GPT-5",
    }).success).toBe(true);
    expect(promoteRoadmapInput.safeParse({
      expectedVersion: 1,
      correlationId: "roadmap-promote-1",
      confirm: true,
    }).success).toBe(true);
  });
});
