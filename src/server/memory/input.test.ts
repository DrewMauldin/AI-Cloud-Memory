import { describe, expect, it } from "vitest";

import {
  captureMemoryInput,
  libraryBulkInput,
  libraryListInput,
  memoryLabelInput,
  memoryFeedbackInput,
  reviewDecisionInput,
  reviewListInput,
  searchMemoryInput,
  storeMemoryInput,
} from "./input";

describe("memory boundary schemas", () => {
  it("normalises a bounded store request", () => {
    expect(
      storeMemoryInput.parse({
        content: "  Keep D1 canonical.  ",
        directive: false,
        source_url: "https://chatgpt.com/c/example",
      }),
    ).toMatchObject({
      content: "Keep D1 canonical.",
      directive: false,
      source_url: "https://chatgpt.com/c/example",
    });
  });

  it("accepts typed, scoped and reviewable memory metadata", () => {
    expect(storeMemoryInput.parse({
      content: "Cloud Memory is canonical for project Atlas.",
      memory_type: "decision",
      scope_type: "project",
      scope_id: "atlas",
      retention_tier: "core",
      observed_at: "2026-08-24T01:02:03.000Z",
      review_at: "2026-09-24T01:02:03.000Z",
    })).toMatchObject({
      memory_type: "decision",
      scope_type: "project",
      scope_id: "atlas",
      retention_tier: "core",
    });
  });

  it("requires a scope ID for non-global memories and rejects one for global memories", () => {
    expect(storeMemoryInput.safeParse({
      content: "Scoped fact",
      scope_type: "project",
    }).success).toBe(false);
    expect(storeMemoryInput.safeParse({
      content: "Global fact",
      scope_type: "global",
      scope_id: "unexpected",
    }).success).toBe(false);
  });

  it("rejects empty or unbounded memory content", () => {
    expect(storeMemoryInput.safeParse({ content: "   " }).success).toBe(false);
    expect(
      storeMemoryInput.safeParse({ content: "x".repeat(12_001) }).success,
    ).toBe(false);
  });

  it("caps search result counts", () => {
    expect(searchMemoryInput.parse({ query: "cloud", limit: 500 }).limit).toBe(50);
  });

  it("keeps labels within the D1 constraint and requires meaningful text", () => {
    expect(memoryLabelInput.safeParse({ label: "Cloud Memory", expectedVersion: 1 }).success).toBe(true);
    expect(memoryLabelInput.safeParse({ label: "x".repeat(41), expectedVersion: 1 }).success).toBe(false);
    expect(memoryLabelInput.safeParse({ label: "---", expectedVersion: 1 }).success).toBe(false);
  });

  it("validates bounded Library filters and bulk operations", () => {
    expect(libraryListInput.safeParse({ sort: "importance", scopeType: "project", scopeId: "cloud-memory" }).success).toBe(true);
    expect(libraryListInput.safeParse({ scopeId: "orphaned" }).success).toBe(false);
    expect(libraryBulkInput.safeParse({
      action: "archive",
      records: [{ id: "memory-1", expectedVersion: 1 }],
    }).success).toBe(true);
    expect(libraryBulkInput.safeParse({
      action: "label",
      label: "release",
      records: Array.from({ length: 51 }, (_, index) => ({ id: `memory-${index}`, expectedVersion: 1 })),
    }).success).toBe(false);
  });

  it("accepts at most three bounded capture candidates", () => {
    expect(captureMemoryInput.parse({
      candidates: [{
        content: "Atlas now uses D1.",
        namespace: "atlas",
        supersedes_memory_id: "mem_old",
        expected_superseded_version: 1,
      }],
    }).candidates).toHaveLength(1);
    expect(captureMemoryInput.safeParse({
      candidates: Array.from({ length: 4 }, (_, index) => ({ content: `Fact ${index}` })),
    }).success).toBe(false);
  });

  it("requires the memory ID and version together for explicit supersession", () => {
    expect(captureMemoryInput.safeParse({
      candidates: [{ content: "New fact", supersedes_memory_id: "mem_old" }],
    }).success).toBe(false);
    expect(captureMemoryInput.safeParse({
      candidates: [{ content: "New fact", expected_superseded_version: 1 }],
    }).success).toBe(false);
  });

  it("keeps review queue and decision inputs bounded and typed", () => {
    expect(reviewListInput.parse({}).status).toBe("open");
    expect(reviewListInput.parse({ limit: 100 }).limit).toBe(100);
    expect(reviewListInput.safeParse({ limit: 101 }).success).toBe(false);
    expect(reviewDecisionInput.safeParse({
      status: "approved",
      expected_version: 1,
      resolution_note: "Confirmed by owner",
    }).success).toBe(true);
    expect(reviewDecisionInput.safeParse({ status: "open", expected_version: 1 }).success).toBe(false);
  });

  it("accepts transient bounded feedback query without allowing unknown fields", () => {
    expect(memoryFeedbackInput.parse({
      memory_id: "mem_1",
      query: "canonical database",
      label: "helpful",
      mode: "hybrid",
    })).toMatchObject({
      memory_id: "mem_1",
      query: "canonical database",
      label: "helpful",
    });
    expect(memoryFeedbackInput.safeParse({
      memory_id: "mem_1",
      query: "x".repeat(501),
      label: "helpful",
    }).success).toBe(false);
    expect(memoryFeedbackInput.safeParse({
      memory_id: "mem_1",
      query: "canonical database",
      label: "helpful",
      query_sha256: "a".repeat(64),
    }).success).toBe(false);
  });
});
