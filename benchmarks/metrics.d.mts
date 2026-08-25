export function recallAtK(results: string[], relevantIds: Set<string> | string[], k: number): number;
export function reciprocalRank(results: string[], relevantIds: Set<string> | string[], k?: number): number;
export function ndcgAtK(results: string[], graded: Map<string, number> | Record<string, number>, k: number): number;
export function percentile(values: number[], percentileValue: number): number;
export function aggregateMetrics(rows: Array<{
  results: string[];
  relevant: string[];
  graded: Map<string, number> | Record<string, number>;
  expectNoResult?: boolean;
}>, latencies?: number[]): {
  queryCount: number;
  labelledQueryCount: number;
  recallAt1: number;
  recallAt3: number;
  recallAt5: number;
  mrrAt5: number;
  ndcgAt3: number;
  ndcgAt5: number;
  zeroResultAccuracy: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
};
