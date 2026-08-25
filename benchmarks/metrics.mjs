function asSet(values) {
  return values instanceof Set ? values : new Set(values);
}

export function recallAtK(results, relevantIds, k) {
  const relevant = asSet(relevantIds);
  if (relevant.size === 0) return 0;
  const hits = results.slice(0, k).filter((id) => relevant.has(id)).length;
  return hits / relevant.size;
}

export function reciprocalRank(results, relevantIds, k = results.length) {
  const relevant = asSet(relevantIds);
  const index = results.slice(0, k).findIndex((id) => relevant.has(id));
  return index < 0 ? 0 : 1 / (index + 1);
}

function discountedGain(relevance, k) {
  return relevance.slice(0, k).reduce(
    (sum, grade, index) => sum + (2 ** grade - 1) / Math.log2(index + 2),
    0,
  );
}

export function ndcgAtK(results, graded, k) {
  const grades = graded instanceof Map ? graded : new Map(Object.entries(graded));
  const actual = results.map((id) => Number(grades.get(id) ?? 0));
  const ideal = [...grades.values()].map(Number).sort((a, b) => b - a);
  const idealGain = discountedGain(ideal, k);
  return idealGain === 0 ? 0 : discountedGain(actual, k) / idealGain;
}

export function percentile(values, percentileValue) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(percentileValue * sorted.length) - 1));
  return sorted[index];
}

export function aggregateMetrics(rows, latencies = []) {
  const labelled = rows.filter((row) => row.relevant.length > 0);
  const mean = (values) => values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
  const noResult = rows.filter((row) => row.expectNoResult === true);
  const zeroResultAccuracy = noResult.length === 0
    ? 1
    : mean(noResult.map((row) => row.results.length === 0 ? 1 : 0));
  return {
    queryCount: rows.length,
    labelledQueryCount: labelled.length,
    recallAt1: mean(labelled.map((row) => recallAtK(row.results, row.relevant, 1))),
    recallAt3: mean(labelled.map((row) => recallAtK(row.results, row.relevant, 3))),
    recallAt5: mean(labelled.map((row) => recallAtK(row.results, row.relevant, 5))),
    mrrAt5: mean(labelled.map((row) => reciprocalRank(row.results, row.relevant, 5))),
    ndcgAt3: mean(labelled.map((row) => ndcgAtK(row.results, row.graded, 3))),
    ndcgAt5: mean(labelled.map((row) => ndcgAtK(row.results, row.graded, 5))),
    zeroResultAccuracy,
    p50LatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
  };
}
