/**
 * Pure, bounded ranking signals. These signals are intentionally independent
 * of retrieval so they can be benchmarked without network or database calls.
 */

export type TemporalIntentKind = "current" | "historical" | "neutral";

export interface TemporalIntent {
  kind: TemporalIntentKind;
  year: number | null;
  asOf?: string;
  before?: string;
  after?: string;
}

export interface RankingMemory {
  id: string;
  content: string;
  importance: number;
  confidence: number;
  status?: "proposed" | "active" | "superseded" | "rejected" | "archived";
  validFrom: string | null;
  validUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SignalBreakdown {
  entity: number;
  temporal: number;
  importance: number;
  total: number;
}

export interface SignalCandidate<T extends RankingMemory = RankingMemory> {
  memory: T;
  score: number;
  rerankerScore?: number;
}

export type RankedSignalCandidate<
  T extends SignalCandidate<RankingMemory> = SignalCandidate<RankingMemory>,
> = T & {
  boosts: SignalBreakdown;
};

export const MAX_ENTITY_BOOST = 0.03;
export const MAX_TEMPORAL_BOOST = 0.03;
export const MAX_IMPORTANCE_BOOST = 0.02;
export const MAX_TOTAL_METADATA_BOOST = 0.08;
export const MAX_RERANKER_SCORE_FLOOR = 0.05;

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "do", "for", "from",
  "current", "did", "how", "i", "in", "is", "it", "latest", "me", "of", "on", "or", "that", "the",
  "this", "to", "was", "what", "when", "where", "which", "who", "why", "with",
]);

const TOKEN_PATTERN = /[\p{L}\p{N}_]+/gu;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function parseDate(value: string | null): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function detectTemporalIntent(query: string, now = new Date()): TemporalIntent {
  const normalized = query.toLocaleLowerCase("en-US");
  const yearMatch = normalized.match(/\b(19\d{2}|20\d{2})\b/);
  const year = yearMatch ? Number(yearMatch[1]) : null;
  const current = /\b(current|currently|latest|now|today|active|ongoing|recent|newest|this week|this month)\b/u.test(normalized);
  const historical = /\b(previous|former|old|historical|history|past|earlier|before|last week|last month|last year)\b/u.test(normalized);

  const explicitDate = (pattern: RegExp) => {
    const match = normalized.match(pattern);
    if (!match?.[1]) return null;
    const parsed = new Date(`${match[1]}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  };
  const asOfDate = explicitDate(/\bas of\s+(\d{4}-\d{2}-\d{2})\b/u);
  if (asOfDate) {
    asOfDate.setUTCHours(23, 59, 59, 999);
    return { kind: "historical", year, asOf: asOfDate.toISOString() };
  }
  const quarterMatch = normalized.match(/\bbefore\s+q([1-4])\s+(19\d{2}|20\d{2})\b/u);
  if (quarterMatch) {
    const quarter = Number(quarterMatch[1]);
    const quarterYear = Number(quarterMatch[2]);
    return {
      kind: "historical",
      year: quarterYear,
      before: new Date(Date.UTC(quarterYear, (quarter - 1) * 3, 1)).toISOString(),
    };
  }
  const beforeDate = explicitDate(/\bbefore\s+(\d{4}-\d{2}-\d{2})\b/u);
  if (beforeDate) return { kind: "historical", year, before: beforeDate.toISOString() };
  const afterDate = explicitDate(/\bafter\s+(\d{4}-\d{2}-\d{2})\b/u);
  if (afterDate) return { kind: "historical", year, after: afterDate.toISOString() };
  if (/\blast month\b/u.test(normalized)) {
    const thisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    return {
      kind: "historical",
      year: lastMonth.getUTCFullYear(),
      after: lastMonth.toISOString(),
      before: thisMonth.toISOString(),
    };
  }

  if (historical || (year !== null && year < now.getUTCFullYear())) {
    return { kind: "historical", year };
  }
  if (current || (year !== null && year >= now.getUTCFullYear())) {
    return { kind: "current", year };
  }
  return { kind: "neutral", year };
}

export function matchesTemporalIntent(
  memory: Pick<RankingMemory, "validFrom" | "validUntil" | "createdAt">,
  intent: TemporalIntent,
): boolean {
  if (intent.kind !== "historical") return true;
  const intervalStart = parseDate(memory.validFrom) ?? parseDate(memory.createdAt);
  const intervalEnd = parseDate(memory.validUntil);
  if (intent.asOf) {
    const asOf = Date.parse(intent.asOf);
    return intervalStart !== null && intervalStart <= asOf &&
      (intervalEnd === null || intervalEnd > asOf);
  }
  if (intent.before || intent.after) {
    const before = intent.before ? Date.parse(intent.before) : Number.POSITIVE_INFINITY;
    const after = intent.after ? Date.parse(intent.after) : Number.NEGATIVE_INFINITY;
    return intervalStart !== null && intervalStart < before &&
      (intervalEnd === null || intervalEnd > after);
  }
  if (intent.year === null) return true;
  const yearStart = Date.UTC(intent.year, 0, 1);
  const yearEnd = Date.UTC(intent.year + 1, 0, 1);
  return intervalStart !== null && intervalStart < yearEnd &&
    (intervalEnd === null || intervalEnd > yearStart);
}

export function extractEntityTokens(text: string): Set<string> {
  const tokens = text.toLocaleLowerCase("en-US").match(TOKEN_PATTERN) ?? [];
  return new Set(tokens.filter((token) => token.length > 1 && !STOP_WORDS.has(token)));
}

export function calculateEntityBoost(query: string, content: string): number {
  const queryTokens = extractEntityTokens(query);
  if (queryTokens.size === 0) return 0;
  const contentTokens = extractEntityTokens(content.slice(0, 1_000));
  let overlap = 0;
  for (const token of queryTokens) {
    if (contentTokens.has(token)) overlap += 1;
  }
  return Math.min(MAX_ENTITY_BOOST, MAX_ENTITY_BOOST * overlap / queryTokens.size);
}

export function calculateTemporalBoost(
  query: string,
  memory: Pick<RankingMemory, "status" | "validFrom" | "validUntil" | "createdAt" | "updatedAt">,
  now = new Date(),
): number {
  const intent = detectTemporalIntent(query, now);
  if (intent.kind === "neutral") return 0;

  const nowTimestamp = now.getTime();
  const validFrom = parseDate(memory.validFrom);
  const validUntil = parseDate(memory.validUntil);
  const createdAt = parseDate(memory.createdAt);
  const updatedAt = parseDate(memory.updatedAt);
  const currentlyValid = (validFrom === null || validFrom <= nowTimestamp) &&
    (validUntil === null || validUntil > nowTimestamp);

  if (intent.kind === "current") {
    if (!currentlyValid) return 0;
    if (intent.year !== null && validFrom !== null && new Date(validFrom).getUTCFullYear() !== intent.year) return 0;
    const recencyAnchor = Math.max(
      validFrom ?? Number.NEGATIVE_INFINITY,
      updatedAt ?? Number.NEGATIVE_INFINITY,
      createdAt ?? Number.NEGATIVE_INFINITY,
    );
    if (!Number.isFinite(recencyAnchor)) return 0;
    const ageDays = Math.max(0, nowTimestamp - recencyAnchor) / 86_400_000;
    return MAX_TEMPORAL_BOOST * Math.exp(-ageDays / 30);
  }

  if (intent.year !== null) {
    const historicalYear = validUntil !== null
      ? new Date(validUntil).getUTCFullYear()
      : validFrom !== null
        ? new Date(validFrom).getUTCFullYear()
        : createdAt !== null
          ? new Date(createdAt).getUTCFullYear()
          : null;
    if (historicalYear === intent.year) return MAX_TEMPORAL_BOOST;
  }
  if (validUntil !== null && validUntil <= nowTimestamp) return MAX_TEMPORAL_BOOST;
  if (memory.status === "superseded") return MAX_TEMPORAL_BOOST;
  if (updatedAt !== null && updatedAt < nowTimestamp) {
    const ageDays = (nowTimestamp - updatedAt) / 86_400_000;
    return MAX_TEMPORAL_BOOST * (1 - Math.exp(-ageDays / 365));
  }
  return 0;
}

export function calculateImportanceBoost(
  memory: Pick<RankingMemory, "importance" | "confidence">,
): number {
  const importance = clamp01(memory.importance);
  const confidence = clamp01(memory.confidence);
  return Math.min(MAX_IMPORTANCE_BOOST, MAX_IMPORTANCE_BOOST * importance * confidence);
}

export function applyBoundedRankingSignals<
  T extends SignalCandidate<RankingMemory>,
>(
  candidates: T[],
  query: string,
  now = new Date(),
): Array<RankedSignalCandidate<T>> {
  return candidates
    .flatMap((candidate) => {
      const rerankerScore = candidate.rerankerScore ?? candidate.score;
      if (!Number.isFinite(rerankerScore) || rerankerScore < MAX_RERANKER_SCORE_FLOOR) return [];
      const entity = calculateEntityBoost(query, candidate.memory.content);
      const temporal = calculateTemporalBoost(query, candidate.memory, now);
      const importance = calculateImportanceBoost(candidate.memory);
      const total = Math.min(MAX_TOTAL_METADATA_BOOST, entity + temporal + importance);
      return [{
        ...candidate,
        score: clamp01(candidate.score + total),
        boosts: { entity, temporal, importance, total },
      }];
    })
    .sort((left, right) => right.score - left.score || left.memory.id.localeCompare(right.memory.id));
}
