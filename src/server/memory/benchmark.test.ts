import { describe, expect, it } from "vitest";

import dataset from "../../../benchmarks/relevance.example.json";
import { assertDataset } from "../../../benchmarks/validate.mjs";

describe("synthetic relevance benchmark", () => {
  it("contains a fixed 20-30 query corpus with stable labels and no secret-like text", () => {
    expect(() => assertDataset(dataset)).not.toThrow();
    expect(dataset.queries.length).toBeGreaterThanOrEqual(20);
    expect(dataset.queries.length).toBeLessThanOrEqual(30);
    expect(new Set(dataset.queries.map((query) => query.id)).size).toBe(dataset.queries.length);
    expect(JSON.stringify(dataset)).not.toMatch(/(gh[pousr]_\w{20,}|github_pat_|Bearer\s+)/iu);
    expect(dataset.queries.filter((query) => query.expectNoResult).length).toBeGreaterThan(0);
  });

  it("rejects unlabelled positives and labels absent from the candidate set", () => {
    const unlabelled = structuredClone(dataset);
    unlabelled.queries[0]!.relevant = [];
    expect(() => assertDataset(unlabelled)).toThrow("empty relevance labels");

    const missing = structuredClone(dataset);
    missing.queries[0]!.candidates = missing.queries[0]!.candidates.filter(
      (candidate) => candidate.id !== missing.queries[0]!.relevant[0],
    );
    expect(() => assertDataset(missing)).toThrow("missing from candidates");
  });
});
