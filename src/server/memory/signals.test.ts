import { describe, expect, it } from "vitest";

import {
  applyBoundedRankingSignals,
  calculateEntityBoost,
  calculateImportanceBoost,
  calculateTemporalBoost,
  detectTemporalIntent,
  extractEntityTokens,
  MAX_ENTITY_BOOST,
  MAX_IMPORTANCE_BOOST,
  MAX_RERANKER_SCORE_FLOOR,
  MAX_TEMPORAL_BOOST,
  matchesTemporalIntent,
} from "./signals";
import type { RankingMemory } from "./signals";

const NOW = new Date("2026-08-24T12:00:00.000Z");

function memory(overrides: Partial<RankingMemory> = {}): RankingMemory {
  return {
    id: "memory-1",
    content: "Cloud Memory uses a D1 archive.",
    importance: 0.5,
    confidence: 1,
    status: "active",
    validFrom: "2026-08-01T00:00:00.000Z",
    validUntil: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("detectTemporalIntent", () => {
  it.each([
    ["What is the current Cloud Memory workflow?", "current"],
    ["Show the latest indexing state", "current"],
    ["What was the previous indexing workflow?", "historical"],
    ["Show the 2025 deployment decision", "historical"],
    ["How does semantic retrieval work?", "neutral"],
  ] as const)("classifies %j as %s", (query, kind) => {
    expect(detectTemporalIntent(query, NOW).kind).toBe(kind);
  });

  it("parses bounded as-of, before, after, quarter and relative-date windows", () => {
    expect(detectTemporalIntent("What was true as of 2026-06-30?", NOW)).toMatchObject({
      kind: "historical",
      asOf: "2026-06-30T23:59:59.999Z",
    });
    expect(detectTemporalIntent("What changed before Q2 2026?", NOW)).toMatchObject({
      kind: "historical",
      before: "2026-04-01T00:00:00.000Z",
    });
    expect(detectTemporalIntent("What changed after 2026-07-01?", NOW)).toMatchObject({
      kind: "historical",
      after: "2026-07-01T00:00:00.000Z",
    });
    expect(detectTemporalIntent("What was active last month?", NOW)).toMatchObject({
      kind: "historical",
      after: "2026-07-01T00:00:00.000Z",
      before: "2026-08-01T00:00:00.000Z",
    });
  });
});

describe("matchesTemporalIntent", () => {
  it("includes only memories whose validity interval overlaps an explicit year", () => {
    const intent = detectTemporalIntent("What was the 2025 workflow?", NOW);
    expect(matchesTemporalIntent(memory({
      validFrom: "2025-01-01T00:00:00.000Z",
      validUntil: "2026-01-01T00:00:00.000Z",
    }), intent)).toBe(true);
    expect(matchesTemporalIntent(memory({
      validFrom: "2024-01-01T00:00:00.000Z",
      validUntil: "2025-01-01T00:00:00.000Z",
    }), intent)).toBe(false);
  });
});

describe("bounded ranking signals", () => {
  it("uses Unicode token boundaries and ignores stop words for entity overlap", () => {
    expect(extractEntityTokens("What did Cloud Memory: Beta do?")).toEqual(
      new Set(["cloud", "memory", "beta"]),
    );
    expect(calculateEntityBoost(
      "What did Cloud Memory: Beta do?",
      "Cloud Memory beta is the archive.",
    )).toBe(MAX_ENTITY_BOOST);
    expect(calculateEntityBoost("memory", "memoryful content")).toBe(0);
  });

  it("caps each temporal and importance signal", () => {
    const currentBoost = calculateTemporalBoost(
      "What is the current workflow?",
      memory({ importance: 1 }),
      NOW,
    );
    expect(currentBoost).toBeGreaterThan(0);
    expect(currentBoost).toBeLessThanOrEqual(MAX_TEMPORAL_BOOST);
    expect(calculateTemporalBoost(
      "What was the previous workflow?",
      memory({
        status: "superseded",
        validUntil: "2026-07-01T00:00:00.000Z",
      }),
      NOW,
    )).toBe(MAX_TEMPORAL_BOOST);
    expect(calculateImportanceBoost(memory({ importance: 1, confidence: 1 }))).toBe(
      MAX_IMPORTANCE_BOOST,
    );
    expect(calculateImportanceBoost(memory({ importance: 4, confidence: 4 }))).toBe(
      MAX_IMPORTANCE_BOOST,
    );
  });

  it("favours a newer valid record for current intent without a universal recency boost", () => {
    const recent = calculateTemporalBoost(
      "What is the latest workflow?",
      memory({ updatedAt: "2026-08-23T00:00:00.000Z" }),
      NOW,
    );
    const stale = calculateTemporalBoost(
      "What is the latest workflow?",
      memory({ updatedAt: "2025-08-23T00:00:00.000Z" }),
      NOW,
    );

    expect(recent).toBeGreaterThan(stale);
    expect(calculateTemporalBoost("How does the workflow work?", memory(), NOW)).toBe(0);
  });

  it("bounds entity scanning to the first 1,000 candidate characters", () => {
    expect(calculateEntityBoost("Quartz", `${"x".repeat(1_001)} Quartz`)).toBe(0);
  });

  it("does not resurrect a candidate below the reranker floor", () => {
    const result = applyBoundedRankingSignals(
      [{ memory: memory(), score: 0.99, rerankerScore: MAX_RERANKER_SCORE_FLOOR - 0.001 }],
      "What is the current Cloud Memory workflow?",
      NOW,
    );
    expect(result).toEqual([]);
  });

  it("caps total metadata uplift and returns a deterministic breakdown", () => {
    const result = applyBoundedRankingSignals(
      [{
        memory: memory({ content: "Cloud Memory Beta workflow archive", importance: 1 }),
        score: 0.5,
        rerankerScore: 0.8,
      }],
      "What is the current Cloud Memory Beta workflow?",
      NOW,
    );
    const first = result[0]!;
    expect(first.score).toBeCloseTo(0.5 + first.boosts.total, 10);
    expect(first.boosts.entity).toBe(MAX_ENTITY_BOOST);
    expect(first.boosts.temporal).toBeLessThanOrEqual(MAX_TEMPORAL_BOOST);
    expect(first.boosts.importance).toBe(MAX_IMPORTANCE_BOOST);
    expect(first.boosts.total).toBeLessThanOrEqual(0.08);
  });
});
