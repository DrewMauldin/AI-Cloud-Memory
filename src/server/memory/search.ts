import type { MemoryRecord } from "./store";
import type { SignalBreakdown, TemporalIntent } from "./signals";

export interface SearchExplanation {
  matchSources: Array<"exact" | "semantic" | "graph">;
  rerankerScore: number | null;
  boosts: SignalBreakdown | null;
  temporalIntent: TemporalIntent;
  degraded: {
    lexical: boolean;
    semantic: boolean;
    reranking: boolean;
  };
}

export interface RankedMemory {
  memory: MemoryRecord;
  score: number;
  sources: Array<"exact" | "semantic" | "graph">;
  rerankerScore?: number;
  boosts?: SignalBreakdown;
  explanation?: SearchExplanation;
}

export function explainSearchResults(
  results: RankedMemory[],
  temporalIntent: TemporalIntent,
  degraded: SearchExplanation["degraded"],
): RankedMemory[] {
  return results.map((result) => ({
    ...result,
    explanation: {
      matchSources: result.sources,
      rerankerScore: result.rerankerScore ?? null,
      boosts: result.boosts ?? null,
      temporalIntent,
      degraded,
    },
  }));
}

const RRF_K = 60;
const MIN_RERANKER_SCORE = 0.05;
const MAX_FTS_TERMS = 20;
const MAX_FTS_TERM_LENGTH = 64;

export function buildSafeFtsQuery(query: string): string | null {
  const tokens = query.match(/[\p{L}\p{N}_]+/gu)?.slice(0, MAX_FTS_TERMS) ?? [];
  const bounded = tokens
    .map((token) => token.slice(0, MAX_FTS_TERM_LENGTH))
    .filter(Boolean);
  return bounded.length > 0
    ? bounded.map((token) => `"${token}"`).join(" OR ")
    : null;
}

export function fuseSearchResults(
  exact: MemoryRecord[],
  semantic: Array<{ memory: MemoryRecord; score: number }>,
  limit: number,
): RankedMemory[] {
  const ranked = new Map<string, RankedMemory>();

  exact.forEach((memory, index) => {
    ranked.set(memory.id, {
      memory,
      score: 1 / (RRF_K + index + 1),
      sources: ["exact"],
    });
  });

  semantic.forEach(({ memory }, index) => {
    const existing = ranked.get(memory.id);
    if (existing) {
      existing.score += 1 / (RRF_K + index + 1);
      existing.sources.push("semantic");
      return;
    }
    ranked.set(memory.id, {
      memory,
      score: 1 / (RRF_K + index + 1),
      sources: ["semantic"],
    });
  });

  return [...ranked.values()]
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.memory.memoryNumber - left.memory.memoryNumber,
    )
    .slice(0, limit);
}

export function applyRerankerScores(
  candidates: RankedMemory[],
  reranked: Array<{ id: string; score: number }>,
  limit: number,
): RankedMemory[] {
  if (candidates.length === 0) return [];
  const fusedScores = candidates.map((candidate) => candidate.score);
  const minFused = Math.min(...fusedScores);
  const maxFused = Math.max(...fusedScores);
  const fusedRange = maxFused - minFused;
  const rerankerScores = new Map(reranked.map((match) => [match.id, match.score]));

  return candidates
    .flatMap((candidate) => {
      const rerankerScore = rerankerScores.get(candidate.memory.id);
      if (rerankerScore === undefined || rerankerScore < MIN_RERANKER_SCORE) return [];
      const normalisedFused = fusedRange === 0
        ? 1
        : (candidate.score - minFused) / fusedRange;
      return [{
        ...candidate,
        score: rerankerScore * 0.6 + normalisedFused * 0.4,
        rerankerScore,
      }];
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.memory.memoryNumber - left.memory.memoryNumber,
    )
    .slice(0, limit);
}
