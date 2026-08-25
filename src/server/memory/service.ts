import {
  applyRerankerScores,
  explainSearchResults,
  fuseSearchResults,
  type RankedMemory,
} from "./search";
import {
  CAPTURE_CANDIDATE_LIMIT,
  DUPLICATE_CANDIDATE_LIMIT,
  PROBABLE_DUPLICATE_THRESHOLD,
  type CaptureCandidate,
  type CaptureOutcome,
  type DuplicateCandidate,
} from "./capture";
import {
  applyBoundedRankingSignals,
  detectTemporalIntent,
  matchesTemporalIntent,
} from "./signals";
import type { SearchReranker } from "./reranker";
import type {
  FeedbackListInput,
  MemoryFeedbackInput,
  MemoryFeedbackRecord,
  MemoryReviewInput,
  MemoryReviewRecord,
  ResolveReviewInput,
  ReviewListInput,
} from "./review";
import { assertSafeMemoryContent } from "./safety";
import type { SemanticIndex } from "./semantic";
import type {
  CreateMemoryInput,
  CreateSupersedingMemoryInput,
  MemoryRecord,
  SupersessionResult,
} from "./store";

interface MemoryStoreContract {
  create(input: CreateMemoryInput): Promise<MemoryRecord>;
  createSuperseding(input: CreateSupersedingMemoryInput): Promise<SupersessionResult>;
  findActiveByContent(
    ownerId: string,
    namespace: string,
    kind: MemoryRecord["kind"],
    content: string,
  ): Promise<MemoryRecord | null>;
  findBySourceIdentity(
    ownerId: string,
    namespace: string,
    sourceSystem: string,
    sourceId: string,
  ): Promise<MemoryRecord | null>;
  setVectorState(
    ownerId: string,
    id: string,
    state: "indexed" | "failed",
  ): Promise<void>;
  getById(ownerId: string, id: string): Promise<MemoryRecord | null>;
  getByNumber(ownerId: string, memoryNumber: number): Promise<MemoryRecord | null>;
  getManyByIds(ownerId: string, ids: string[]): Promise<MemoryRecord[]>;
  recordRetrieval?(ownerId: string, memoryId: string): Promise<MemoryRecord>;
  listNeedingVectorRepair(ownerId: string, limit: number): Promise<MemoryRecord[]>;
  listDirectives(ownerId: string): Promise<MemoryRecord[]>;
  searchExact(
    ownerId: string,
    query: string,
    limit: number,
    includeDirectives: boolean,
    includeSuperseded?: boolean,
    historicalYear?: number,
  ): Promise<MemoryRecord[]>;
  counts(ownerId: string): Promise<MemoryCounts>;
}

interface MemoryReviewStoreContract {
  createReview(input: MemoryReviewInput): Promise<{
    review: MemoryReviewRecord;
    idempotent: boolean;
  }>;
  listReviews(input: ReviewListInput): Promise<MemoryReviewRecord[]>;
  resolveReview(input: ResolveReviewInput): Promise<MemoryReviewRecord>;
  createFeedback(input: MemoryFeedbackInput): Promise<{
    feedback: MemoryFeedbackRecord;
    idempotent: boolean;
  }>;
  listFeedback(input: FeedbackListInput): Promise<MemoryFeedbackRecord[]>;
}

interface ContextGraphContract {
  relatedMemoryIds(ownerId: string, seedMemoryIds: string[], limit?: number): Promise<string[]>;
}

type CaptureOutcomeWithReview = CaptureOutcome & { reviewId?: string };

export interface MemoryCounts {
  memories: number;
  directives: number;
  indexed: number;
  pending: number;
  failed: number;
}

export interface MemorySearchResult {
  results: RankedMemory[];
  temporalIntent: ReturnType<typeof detectTemporalIntent>;
  lexicalDegraded: boolean;
  semanticDegraded: boolean;
  rerankingDegraded: boolean;
}

const candidateLimit = (
  limit: number,
  temporalIntent: "current" | "historical" | "neutral",
) => temporalIntent === "neutral"
  ? Math.min(50, Math.max(20, limit * 5))
  : 50;

async function sha256Text(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class MemoryService {
  constructor(
    private readonly storeBackend: MemoryStoreContract,
    private readonly semanticIndex: SemanticIndex,
    private readonly reranker: SearchReranker,
    private readonly now: () => Date = () => new Date(),
    private readonly reviewStore?: MemoryReviewStoreContract,
    private readonly contextGraph?: ContextGraphContract,
    private readonly semanticEnabled = true,
  ) {}

  private async fillFromContextGraph(
    ownerId: string,
    ranked: RankedMemory[],
    limit: number,
    includeDirectives: boolean,
  ): Promise<RankedMemory[]> {
    if (!this.contextGraph || ranked.length >= limit || ranked.length === 0) return ranked.slice(0, limit);
    try {
      const existingIds = new Set(ranked.map((result) => result.memory.id));
      const ids = await this.contextGraph.relatedMemoryIds(
        ownerId,
        ranked.slice(0, 5).map((result) => result.memory.id),
        Math.min(3, limit - ranked.length),
      );
      const memories = await this.storeBackend.getManyByIds(ownerId, ids);
      const floor = Math.max(0, (ranked.at(-1)?.score ?? 0.05) * 0.85);
      const graphResults = memories
        .filter((memory) => memory.status === "active"
          && !existingIds.has(memory.id)
          && (includeDirectives || memory.kind === "memory"))
        .slice(0, limit - ranked.length)
        .map((memory, index): RankedMemory => ({
          memory,
          score: Math.max(0, floor - index * 0.001),
          sources: ["graph"],
        }));
      return [...ranked, ...graphResults].slice(0, limit);
    } catch {
      return ranked.slice(0, limit);
    }
  }

  async store(input: CreateMemoryInput): Promise<MemoryRecord> {
    assertSafeMemoryContent(input.content);
    const canonical = await this.storeBackend.create(input);
    if (!this.semanticEnabled) return canonical;
    let vectorState: "indexed" | "failed" = "indexed";
    try {
      await this.semanticIndex.index(canonical);
    } catch {
      vectorState = "failed";
    }

    await this.storeBackend.setVectorState(input.ownerId, canonical.id, vectorState);
    return (
      (await this.storeBackend.getById(input.ownerId, canonical.id)) ?? {
        ...canonical,
        vectorState,
      }
    );
  }

  async capture(input: {
    ownerId: string;
    candidates: CaptureCandidate[];
  }): Promise<CaptureOutcomeWithReview[]> {
    if (
      input.candidates.length < 1 ||
      input.candidates.length > CAPTURE_CANDIDATE_LIMIT
    ) {
      throw new Error("Capture accepts between one and three candidates");
    }

    const outcomes: CaptureOutcomeWithReview[] = [];
    for (const candidate of input.candidates) {
      assertSafeMemoryContent(candidate.content);
      const namespace = candidate.namespace ?? "default";
      const kind = candidate.directive ? "directive" : "memory";
      const exact = await this.storeBackend.findActiveByContent(
        input.ownerId,
        namespace,
        kind,
        candidate.content,
      );
      if (exact) {
        outcomes.push({ outcome: "exact_duplicate", duplicateOf: exact });
        continue;
      }

      if (candidate.supersedesId !== undefined) {
        if (candidate.expectedSupersededVersion === undefined) {
          throw new Error("Explicit supersession requires the expected version");
        }
        const result = await this.storeBackend.createSuperseding({
          ownerId: input.ownerId,
          ...candidate,
          supersedesId: candidate.supersedesId,
          expectedSupersededVersion: candidate.expectedSupersededVersion,
        });
        let supersededVectorState: "pending" | "indexed" | "failed" = "pending";
        let vectorState: "pending" | "indexed" | "failed" = "pending";
        if (this.semanticEnabled) {
          supersededVectorState = "indexed";
          try {
            await this.semanticIndex.index(result.superseded);
          } catch {
            supersededVectorState = "failed";
          }
          await this.storeBackend.setVectorState(
            input.ownerId,
            result.superseded.id,
            supersededVectorState,
          );
          vectorState = "indexed";
          try {
            await this.semanticIndex.index(result.replacement);
          } catch {
            vectorState = "failed";
          }
          await this.storeBackend.setVectorState(
            input.ownerId,
            result.replacement.id,
            vectorState,
          );
        }
        outcomes.push({
          outcome: "superseded",
          replacement: { ...result.replacement, vectorState },
          superseded: {
            ...result.superseded,
            vectorState: supersededVectorState,
          },
        });
        continue;
      }

      if (candidate.source && candidate.sourceId) {
        const sourceMatch = await this.storeBackend.findBySourceIdentity(
          input.ownerId,
          namespace,
          candidate.source,
          candidate.sourceId,
        );
        if (sourceMatch) {
          const review = this.reviewStore
            ? await this.reviewStore.createReview({
              ownerId: input.ownerId,
              reviewType: "source_conflict",
              candidateContent: candidate.content,
              candidateSha256: await sha256Text(candidate.content),
              candidateNamespace: namespace,
              candidateKind: kind,
              matchedMemoryId: sourceMatch.id,
              similarity: null,
              sourceSystem: candidate.source,
              sourceId: candidate.sourceId,
              sourceUrl: candidate.sourceUrl ?? null,
              client: candidate.client ?? null,
              model: candidate.model ?? null,
              correlationId: candidate.correlationId ?? null,
            })
            : null;
          outcomes.push({
            outcome: "source_conflict",
            conflictingWith: sourceMatch,
            ...(review ? { reviewId: review.review.id } : {}),
          } as CaptureOutcomeWithReview);
          continue;
        }
      }

      let probable: DuplicateCandidate[] = [];
      if (this.semanticEnabled) {
        try {
          const matches = await this.semanticIndex.search(
            input.ownerId,
            candidate.content,
            DUPLICATE_CANDIDATE_LIMIT,
            false,
            namespace,
            kind,
          );
          const scores = new Map(matches.map((match) => [match.id, match.score]));
          probable = (await this.storeBackend.getManyByIds(
            input.ownerId,
            matches.slice(0, DUPLICATE_CANDIDATE_LIMIT).map((match) => match.id),
          ))
            .filter((memory) =>
              memory.status === "active" &&
              memory.namespace === namespace &&
              memory.kind === kind &&
              (scores.get(memory.id) ?? 0) >= PROBABLE_DUPLICATE_THRESHOLD)
            .slice(0, DUPLICATE_CANDIDATE_LIMIT)
            .map((memory) => ({ memory, score: scores.get(memory.id) ?? 0 }));
        } catch {
          // Semantic duplicate detection is derived and must not block a canonical write.
        }
      }

      if (probable.length > 0) {
        const review = this.reviewStore
          ? await this.reviewStore.createReview({
            ownerId: input.ownerId,
            reviewType: "probable_duplicate",
            candidateContent: candidate.content,
            candidateSha256: await sha256Text(candidate.content),
            candidateNamespace: namespace,
            candidateKind: kind,
            matchedMemoryId: probable[0]?.memory.id ?? null,
            similarity: probable[0]?.score ?? null,
            sourceSystem: candidate.source ?? null,
            sourceId: candidate.sourceId ?? null,
            sourceUrl: candidate.sourceUrl ?? null,
            client: candidate.client ?? null,
            model: candidate.model ?? null,
            correlationId: candidate.correlationId ?? null,
          })
          : null;
        outcomes.push({
          outcome: "probable_duplicate",
          candidates: probable,
          ...(review ? { reviewId: review.review.id } : {}),
        } as CaptureOutcomeWithReview);
        continue;
      }

      outcomes.push({
        outcome: "created",
        memory: await this.store({ ownerId: input.ownerId, ...candidate }),
      });
    }
    return outcomes;
  }

  async get(ownerId: string, memoryId: number | string): Promise<MemoryRecord | null> {
    const memory = await (typeof memoryId === "number"
      ? this.storeBackend.getByNumber(ownerId, memoryId)
      : this.storeBackend.getById(ownerId, memoryId));
    if (!memory || !this.storeBackend.recordRetrieval) return memory;
    return this.storeBackend.recordRetrieval(ownerId, memory.id);
  }

  directives(ownerId: string): Promise<MemoryRecord[]> {
    return this.storeBackend.listDirectives(ownerId);
  }

  counts(ownerId: string): Promise<MemoryCounts> {
    return this.storeBackend.counts(ownerId);
  }

  listReviews(input: ReviewListInput): Promise<MemoryReviewRecord[]> {
    if (!this.reviewStore) throw new Error("Memory review storage is unavailable");
    return this.reviewStore.listReviews(input);
  }

  resolveReview(input: ResolveReviewInput): Promise<MemoryReviewRecord> {
    if (!this.reviewStore) throw new Error("Memory review storage is unavailable");
    return this.reviewStore.resolveReview(input);
  }

  createFeedback(input: MemoryFeedbackInput): Promise<{
    feedback: MemoryFeedbackRecord;
    idempotent: boolean;
  }> {
    if (!this.reviewStore) throw new Error("Memory review storage is unavailable");
    return this.reviewStore.createFeedback(input);
  }

  listFeedback(input: FeedbackListInput): Promise<MemoryFeedbackRecord[]> {
    if (!this.reviewStore) throw new Error("Memory review storage is unavailable");
    return this.reviewStore.listFeedback(input);
  }

  async repairIndex(ownerId: string, limit = 25): Promise<{
    examined: number;
    indexed: number;
    failed: number;
  }> {
    if (!this.semanticEnabled) return { examined: 0, indexed: 0, failed: 0 };
    const candidates = await this.storeBackend.listNeedingVectorRepair(
      ownerId,
      Math.max(1, Math.min(limit, 50)),
    );
    let indexed = 0;
    let failed = 0;
    for (const memory of candidates) {
      try {
        await this.semanticIndex.index(memory);
        await this.storeBackend.setVectorState(ownerId, memory.id, "indexed");
        indexed += 1;
      } catch {
        await this.storeBackend.setVectorState(ownerId, memory.id, "failed");
        failed += 1;
      }
    }
    return { examined: candidates.length, indexed, failed };
  }

  async search(input: {
    ownerId: string;
    query: string;
    limit: number;
    includeDirectives: boolean;
    mode: "exact" | "semantic" | "hybrid";
  }): Promise<MemorySearchResult> {
    const mode = this.semanticEnabled ? input.mode : "exact";
    const now = this.now();
    const temporalIntent = detectTemporalIntent(input.query, now);
    const retrievalLimit = candidateLimit(input.limit, temporalIntent.kind);
    const includeSuperseded = temporalIntent.kind === "historical";
    let lexicalDegraded = false;
    let exact: MemoryRecord[] = [];
    if (mode !== "semantic") {
      try {
        const searchArguments = [
          input.ownerId,
          input.query,
          mode === "hybrid" ? retrievalLimit : input.limit,
          input.includeDirectives,
        ] as const;
        exact = includeSuperseded
          ? temporalIntent.year === null
            ? await this.storeBackend.searchExact(...searchArguments, true)
            : await this.storeBackend.searchExact(
              ...searchArguments,
              true,
              temporalIntent.year,
            )
          : await this.storeBackend.searchExact(...searchArguments);
        exact = exact.filter((memory) => matchesTemporalIntent(memory, temporalIntent));
      } catch {
        lexicalDegraded = true;
      }
    }

    if (mode === "exact") {
      return {
        results: explainSearchResults(exact.map((memory, index) => ({
          memory,
          score: 1 / (index + 1),
          sources: ["exact"],
        })), temporalIntent, {
          lexical: lexicalDegraded,
          semantic: false,
          reranking: false,
        }),
        lexicalDegraded,
        semanticDegraded: false,
        rerankingDegraded: false,
        temporalIntent,
      };
    }

    try {
      const semanticArguments = [
        input.ownerId,
        input.query,
        mode === "hybrid" ? retrievalLimit : input.limit,
        input.includeDirectives,
      ] as const;
      const matches = includeSuperseded
        ? await this.semanticIndex.search(
          ...semanticArguments,
          undefined,
          undefined,
          true,
        )
        : await this.semanticIndex.search(...semanticArguments);
      const memories = await this.storeBackend.getManyByIds(
        input.ownerId,
        matches.map((match) => match.id),
      );
      const scores = new Map(matches.map((match) => [match.id, match.score]));
      const semantic = memories
        .filter(
          (memory) =>
            (memory.status === "active" ||
              (includeSuperseded && memory.status === "superseded")) &&
            matchesTemporalIntent(memory, temporalIntent) &&
            (input.includeDirectives || memory.kind === "memory"),
        )
        .map((memory) => ({ memory, score: scores.get(memory.id) ?? 0 }));

      if (mode === "semantic") {
        return {
          results: explainSearchResults(semantic.slice(0, input.limit).map(({ memory, score }) => ({
            memory,
            score,
            sources: ["semantic"],
          })), temporalIntent, {
            lexical: lexicalDegraded,
            semantic: false,
            reranking: false,
          }),
          lexicalDegraded,
          semanticDegraded: false,
          rerankingDegraded: false,
          temporalIntent,
        };
      }

      const fused = fuseSearchResults(exact, semantic, retrievalLimit);
      const rerankable = fused.filter((candidate) => candidate.memory.kind !== "directive");
      const directives = fused.filter((candidate) => candidate.memory.kind === "directive");
      if (rerankable.length === 0) {
        return {
          results: explainSearchResults(directives.slice(0, input.limit), temporalIntent, {
            lexical: lexicalDegraded,
            semantic: false,
            reranking: false,
          }),
          lexicalDegraded,
          semanticDegraded: false,
          rerankingDegraded: false,
          temporalIntent,
        };
      }
      try {
        const reranked = await this.reranker.rerank(
          input.query,
          rerankable.map((candidate) => candidate.memory),
        );
        const relevanceRanked = applyRerankerScores(
          rerankable,
          reranked,
          retrievalLimit,
        );
        const ranked = [
            ...applyBoundedRankingSignals(
              relevanceRanked,
              input.query,
              now,
            ),
            ...directives,
          ];
        return {
          results: explainSearchResults(await this.fillFromContextGraph(
            input.ownerId,
            ranked,
            input.limit,
            input.includeDirectives,
          ), temporalIntent, {
            lexical: lexicalDegraded,
            semantic: false,
            reranking: false,
          }),
          lexicalDegraded,
          semanticDegraded: false,
          rerankingDegraded: false,
          temporalIntent,
        };
      } catch {
        const ranked = await this.fillFromContextGraph(
          input.ownerId,
          fused,
          input.limit,
          input.includeDirectives,
        );
        return {
          results: explainSearchResults(ranked, temporalIntent, {
            lexical: lexicalDegraded,
            semantic: false,
            reranking: true,
          }),
          lexicalDegraded,
          semanticDegraded: false,
          rerankingDegraded: true,
          temporalIntent,
        };
      }
    } catch {
      return {
        results: explainSearchResults(
          fuseSearchResults(exact, [], input.limit),
          temporalIntent,
          { lexical: lexicalDegraded, semantic: true, reranking: false },
        ),
        lexicalDegraded,
        semanticDegraded: true,
        rerankingDegraded: false,
        temporalIntent,
      };
    }
  }
}
