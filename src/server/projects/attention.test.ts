import { describe, expect, it } from "vitest";

import {
  DEFAULT_STALE_AFTER_MS,
  MAX_AGENT_RUNS,
  classifyTaskAttention,
  type AttentionTask,
  type AgentRunSignal,
} from "./attention";

const now = "2026-08-24T12:00:00.000Z";

const task: AttentionTask = {
  status: "planned",
  dueAt: null,
  archivedAt: null,
  updatedAt: now,
  sourceType: "human",
  sourceClient: null,
  sourceModel: null,
};

describe("classifyTaskAttention", () => {
  it("returns blocked and review reasons in a stable order", () => {
    expect(classifyTaskAttention({ ...task, status: "blocked" }, now)).toEqual({
      needsMe: true,
      reasons: ["blocked"],
    });
    expect(classifyTaskAttention({ ...task, status: "review" }, now)).toEqual({
      needsMe: true,
      reasons: ["review"],
    });
  });

  it("marks overdue open tasks but ignores completed and archived tasks", () => {
    const overdue = { ...task, dueAt: "2026-08-24T11:59:59.000Z" };
    expect(classifyTaskAttention(overdue, now)).toEqual({
      needsMe: true,
      reasons: ["overdue"],
    });
    expect(classifyTaskAttention({ ...overdue, status: "done" }, now)).toEqual({
      needsMe: false,
      reasons: [],
    });
    expect(classifyTaskAttention({ ...overdue, archivedAt: now }, now)).toEqual({
      needsMe: false,
      reasons: [],
    });
  });

  it("marks only sufficiently old in-progress tasks as stale", () => {
    const staleAt = new Date(Date.parse(now) - DEFAULT_STALE_AFTER_MS - 1).toISOString();
    const recentAt = new Date(Date.parse(now) - DEFAULT_STALE_AFTER_MS + 1).toISOString();

    expect(classifyTaskAttention({ ...task, status: "in_progress", updatedAt: staleAt }, now)).toEqual({
      needsMe: true,
      reasons: ["stale_in_progress"],
    });
    expect(classifyTaskAttention({ ...task, status: "in_progress", updatedAt: recentAt }, now)).toEqual({
      needsMe: false,
      reasons: [],
    });
  });

  it("requires client and model provenance for non-human open tasks", () => {
    expect(classifyTaskAttention({ ...task, sourceType: "model" }, now)).toEqual({
      needsMe: true,
      reasons: ["missing_provenance"],
    });
    expect(classifyTaskAttention({
      ...task,
      sourceType: "model",
      sourceClient: "Codex",
      sourceModel: "GPT-5",
    }, now)).toEqual({
      needsMe: false,
      reasons: [],
    });
    expect(classifyTaskAttention({ ...task, sourceType: "human" }, now)).toEqual({
      needsMe: false,
      reasons: [],
    });
  });

  it("includes failed and awaiting-human agent runs without depending on wall clock", () => {
    const runs: AgentRunSignal[] = [
      { status: "failed" },
      { status: "awaiting_human" },
    ];

    expect(classifyTaskAttention({ ...task, agentRuns: runs }, now)).toEqual({
      needsMe: true,
      reasons: ["agent_failed", "agent_awaiting_human"],
    });
    expect(classifyTaskAttention({ ...task, agentRuns: runs }, "2030-01-01T00:00:00.000Z")).toEqual({
      needsMe: true,
      reasons: ["agent_failed", "agent_awaiting_human"],
    });
  });

  it("examines only the bounded newest-run input", () => {
    const runs: AgentRunSignal[] = Array.from(
      { length: MAX_AGENT_RUNS },
      () => ({ status: "running" as const }),
    );
    runs.push({ status: "failed" });

    expect(classifyTaskAttention({ ...task, agentRuns: runs }, now)).toEqual({
      needsMe: false,
      reasons: [],
    });
  });

  it("returns all applicable reasons in the documented order", () => {
    const result = classifyTaskAttention({
      ...task,
      status: "blocked",
      dueAt: "2026-08-23T12:00:00.000Z",
      updatedAt: "2026-08-01T12:00:00.000Z",
      sourceType: "automation",
      agentRuns: [{ status: "failed" }, { status: "awaiting_human" }],
    }, now);

    expect(result).toEqual({
      needsMe: true,
      reasons: ["blocked", "overdue", "missing_provenance", "agent_failed", "agent_awaiting_human"],
    });
  });
});
