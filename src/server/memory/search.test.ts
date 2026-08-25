import { describe, expect, it } from "vitest";

import type { MemoryRecord } from "./store";
import { applyRerankerScores, buildSafeFtsQuery, fuseSearchResults } from "./search";

function memory(id: string): MemoryRecord {
  return {
    memoryNumber: Number(id.slice(-1)),
    id,
    ownerId: "123456789",
    namespace: "default",
    kind: "memory",
    memoryType: "fact",
    scopeType: "global",
    scopeId: null,
    retentionTier: "durable",
    content: id,
    contentSha256: `hash_${id}`,
    summary: null,
    importance: 0.5,
    confidence: 1,
    status: "active",
    sensitivity: "normal",
    sourceSystem: null,
    sourceId: null,
    sourceUrl: null,
    sourceClient: null,
    sourceModel: null,
    conversationId: null,
    messageId: null,
    supersedesId: null,
    validFrom: "2026-08-23T00:00:00.000Z",
    validUntil: null,
    observedAt: "2026-08-23T00:00:00.000Z",
    recordedAt: "2026-08-23T00:00:00.000Z",
    reviewAt: null,
    expiresAt: null,
    vectorState: "indexed",
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
    version: 1,
  };
}

describe("fuseSearchResults", () => {
  it("uses reciprocal-rank fusion so agreement between retrievers wins", () => {
    const result = fuseSearchResults(
      [memory("mem_1"), memory("mem_2")],
      [
        { memory: memory("mem_2"), score: 0.95 },
        { memory: memory("mem_3"), score: 0.9 },
      ],
      3,
    );

    expect(result.map((entry) => entry.memory.id)).toEqual([
      "mem_2",
      "mem_1",
      "mem_3",
    ]);
    expect(result[0]?.sources).toEqual(["exact", "semantic"]);
    expect(result[0]?.score).toBeGreaterThan(result[1]?.score ?? 0);
  });
});

describe("buildSafeFtsQuery", () => {
  it("turns untrusted natural language into a bounded OR query", () => {
    expect(buildSafeFtsQuery('Cloud Memory "OAuth" + TrueMemory')).toBe(
      '"Cloud" OR "Memory" OR "OAuth" OR "TrueMemory"',
    );
  });

  it("returns null when the query has no searchable tokens", () => {
    expect(buildSafeFtsQuery('" + -')).toBeNull();
  });
});

describe("applyRerankerScores", () => {
  it("drops candidates the reranker judges irrelevant even when fusion ranked them first", () => {
    const candidates = fuseSearchResults(
      [memory("mem_1"), memory("mem_2")],
      [],
      2,
    );

    const result = applyRerankerScores(candidates, [
      { id: "mem_1", score: 0.001 },
      { id: "mem_2", score: 0.8 },
    ], 2);

    expect(result.map((entry) => entry.memory.id)).toEqual(["mem_2"]);
  });
});
