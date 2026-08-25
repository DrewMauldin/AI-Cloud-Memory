import { describe, expect, it } from "vitest";

import { aggregateMetrics, ndcgAtK, recallAtK, reciprocalRank } from "../../../benchmarks/metrics.mjs";

describe("relevance metrics", () => {
  it("computes recall and reciprocal rank with explicit cutoffs", () => {
    expect(recallAtK(["m2", "m1", "m3"], new Set(["m1", "m3"]), 2)).toBe(0.5);
    expect(reciprocalRank(["m2", "m1", "m3"], new Set(["m1", "m3"]), 2)).toBe(0.5);
  });

  it("computes graded nDCG against the ideal ordering", () => {
    expect(ndcgAtK(["m2", "m1"], { m1: 3, m2: 1 }, 2)).toBeCloseTo(
      (1 / Math.log2(2) + 7 / Math.log2(3)) / (7 / Math.log2(2) + 1 / Math.log2(3)),
      10,
    );
  });

  it("keeps abstention accuracy separate from labelled retrieval metrics", () => {
    const metrics = aggregateMetrics([
      { results: ["m1"], relevant: ["m1"], graded: { m1: 3 } },
      { results: [], relevant: [], graded: {}, expectNoResult: true },
      { results: ["m2"], relevant: [], graded: {}, expectNoResult: true },
    ], [1, 2, 3, 4]);
    expect(metrics.queryCount).toBe(3);
    expect(metrics.recallAt5).toBe(1);
    expect(metrics.mrrAt5).toBe(1);
    expect(metrics.zeroResultAccuracy).toBe(0.5);
    expect(metrics.p50LatencyMs).toBe(2);
    expect(metrics.p95LatencyMs).toBe(4);
  });
});
