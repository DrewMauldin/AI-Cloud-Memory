// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { RankedMemory } from "../types";
import { MemoryResultCard } from "./MemoryResultCard";

const result = {
  memory: {
    memoryNumber: 42,
    id: "memory-42",
    ownerId: "123456789",
    namespace: "default",
    kind: "memory",
    memoryType: "decision",
    scopeType: "project",
    scopeId: "cloud-memory",
    retentionTier: "core",
    content: "D1 remains canonical.",
    contentSha256: "hash",
    summary: null,
    importance: 0.9,
    confidence: 1,
    status: "active",
    sensitivity: "normal",
    sourceSystem: "MCP",
    sourceId: null,
    sourceUrl: "https://chatgpt.com/c/example",
    sourceClient: "Codex",
    sourceModel: "GPT-5",
    conversationId: null,
    messageId: null,
    observedAt: "2026-08-24T00:00:00.000Z",
    recordedAt: "2026-08-24T00:00:00.000Z",
    reviewAt: null,
    expiresAt: null,
    vectorState: "indexed",
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z",
  },
  score: 0.92,
  sources: ["exact", "semantic"],
  explanation: {
    matchSources: ["exact", "semantic"],
    rerankerScore: 0.88,
    boosts: { entity: 0.03, temporal: 0.01, importance: 0.02, total: 0.06 },
    temporalIntent: { kind: "current", year: 2026 },
    degraded: { lexical: false, semantic: false, reranking: false },
  },
} satisfies RankedMemory;

describe("MemoryResultCard", () => {
  it("shows typed provenance and an accessible ranking explanation", async () => {
    const user = userEvent.setup();
    render(<MemoryResultCard result={result} />);

    expect(screen.getByText("decision")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open source chat" }).getAttribute("href"))
      .toBe("https://chatgpt.com/c/example");
    await user.click(screen.getByText("Why this result?"));
    expect(screen.getByText("88%" )).toBeTruthy();
    expect(screen.getByText("+6%" )).toBeTruthy();
    expect(screen.getByText("current" )).toBeTruthy();
  });

  it("emits each explicit relevance label from accessible buttons", async () => {
    const user = userEvent.setup();
    const onFeedback = vi.fn();
    render(<MemoryResultCard result={result} onFeedback={onFeedback} />);

    for (const label of ["Helpful", "Not helpful", "Outdated", "Incorrect"]) {
      await user.click(screen.getByRole("button", { name: label }));
    }

    expect(onFeedback.mock.calls).toEqual([
      ["helpful"],
      ["not_helpful"],
      ["outdated"],
      ["incorrect"],
    ]);
  });
});
