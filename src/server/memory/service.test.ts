import { describe, expect, it, vi } from "vitest";

import { MemoryService } from "./service";
import type { MemoryRecord } from "./store";

const createdMemory: MemoryRecord = {
  memoryNumber: 1,
  id: "mem_1",
  ownerId: "123456789",
  namespace: "default",
  kind: "memory",
  memoryType: "fact",
  scopeType: "global",
  scopeId: null,
  retentionTier: "durable",
  content: "D1 remains canonical.",
  contentSha256: "hash",
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
  vectorState: "pending",
  createdAt: "2026-08-23T00:00:00.000Z",
  updatedAt: "2026-08-23T00:00:00.000Z",
  version: 1,
};

describe("MemoryService.store", () => {
  it("rejects secret-like content before touching the backend or index", async () => {
    const store = {
      create: vi.fn(),
      createSuperseding: vi.fn(),
      findActiveByContent: vi.fn(),
      findBySourceIdentity: vi.fn(),
      setVectorState: vi.fn(),
      getById: vi.fn(),
      getByNumber: vi.fn(),
      getManyByIds: vi.fn(),
      listNeedingVectorRepair: vi.fn(),
      listDirectives: vi.fn(),
      searchExact: vi.fn(),
      counts: vi.fn(),
    };
    const semanticIndex = { index: vi.fn(), search: vi.fn() };
    const reranker = { rerank: vi.fn() };

    await expect(new MemoryService(store, semanticIndex, reranker).store({
      ownerId: "123456789",
      content: "password: this-is-a-very-long-password-value",
    })).rejects.toMatchObject({
      name: "SecretPatternError",
      code: "SECRET_PATTERN",
    });
    expect(store.create).not.toHaveBeenCalled();
    expect(semanticIndex.index).not.toHaveBeenCalled();
  });

  it("keeps the canonical memory and marks indexing failed when Vectorize is unavailable", async () => {
    const store = {
      create: vi.fn().mockResolvedValue(createdMemory),
      createSuperseding: vi.fn(),
      findActiveByContent: vi.fn(),
      findBySourceIdentity: vi.fn(),
      setVectorState: vi.fn().mockResolvedValue(undefined),
      getById: vi.fn().mockResolvedValue({
        ...createdMemory,
        vectorState: "failed",
      }),
      getManyByIds: vi.fn(),
      listNeedingVectorRepair: vi.fn(),
      searchExact: vi.fn(),
      getByNumber: vi.fn(),
      listDirectives: vi.fn(),
      counts: vi.fn(),
    };
    const semanticIndex = {
      index: vi.fn().mockRejectedValue(new Error("quota exceeded")),
      search: vi.fn(),
    };
    const reranker = { rerank: vi.fn() };

    const service = new MemoryService(store, semanticIndex, reranker);
    const result = await service.store({
      ownerId: "123456789",
      content: "D1 remains canonical.",
    });

    expect(result.vectorState).toBe("failed");
    expect(store.setVectorState).toHaveBeenCalledWith(
      "123456789",
      "mem_1",
      "failed",
    );
  });

  it("repairs bounded pending and failed vectors without changing canonical records", async () => {
    const failedMemory = { ...createdMemory, id: "mem_2", vectorState: "failed" as const };
    const store = {
      create: vi.fn(),
      createSuperseding: vi.fn(),
      findActiveByContent: vi.fn(),
      findBySourceIdentity: vi.fn(),
      setVectorState: vi.fn().mockResolvedValue(undefined),
      getById: vi.fn(),
      getByNumber: vi.fn(),
      getManyByIds: vi.fn(),
      listNeedingVectorRepair: vi.fn().mockResolvedValue([createdMemory, failedMemory]),
      listDirectives: vi.fn(),
      searchExact: vi.fn(),
      counts: vi.fn(),
    };
    const semanticIndex = {
      index: vi.fn().mockResolvedValue(undefined),
      search: vi.fn(),
    };
    const reranker = { rerank: vi.fn() };

    const result = await new MemoryService(store, semanticIndex, reranker).repairIndex("123456789", 25);

    expect(result).toEqual({ examined: 2, indexed: 2, failed: 0 });
    expect(store.setVectorState).toHaveBeenCalledWith("123456789", "mem_1", "indexed");
    expect(store.setVectorState).toHaveBeenCalledWith("123456789", "mem_2", "indexed");
  });

  it("keeps vectors pending and skips AI work when semantic search is disabled", async () => {
    const store = {
      create: vi.fn().mockResolvedValue(createdMemory),
      createSuperseding: vi.fn(),
      findActiveByContent: vi.fn(),
      findBySourceIdentity: vi.fn(),
      setVectorState: vi.fn(),
      getById: vi.fn(),
      getByNumber: vi.fn(),
      getManyByIds: vi.fn(),
      listNeedingVectorRepair: vi.fn(),
      listDirectives: vi.fn(),
      searchExact: vi.fn().mockResolvedValue([createdMemory]),
      counts: vi.fn(),
    };
    const semanticIndex = { index: vi.fn(), search: vi.fn() };
    const reranker = { rerank: vi.fn() };
    const service = new MemoryService(
      store,
      semanticIndex,
      reranker,
      undefined,
      undefined,
      undefined,
      false,
    );

    const stored = await service.store({
      ownerId: createdMemory.ownerId,
      content: createdMemory.content,
    });
    const searched = await service.search({
      ownerId: createdMemory.ownerId,
      query: "canonical D1",
      limit: 5,
      includeDirectives: false,
      mode: "hybrid",
    });
    const repaired = await service.repairIndex(createdMemory.ownerId);

    expect(stored.vectorState).toBe("pending");
    expect(searched.results.map((entry) => entry.memory.id)).toEqual([createdMemory.id]);
    expect(repaired).toEqual({ examined: 0, indexed: 0, failed: 0 });
    expect(store.searchExact).toHaveBeenCalledWith(
      createdMemory.ownerId,
      "canonical D1",
      5,
      false,
    );
    expect(store.setVectorState).not.toHaveBeenCalled();
    expect(store.listNeedingVectorRepair).not.toHaveBeenCalled();
    expect(semanticIndex.index).not.toHaveBeenCalled();
    expect(semanticIndex.search).not.toHaveBeenCalled();
    expect(reranker.rerank).not.toHaveBeenCalled();
  });

  it("oversamples hybrid candidates and applies the reranker before trimming", async () => {
    const secondMemory = { ...createdMemory, id: "mem_2", memoryNumber: 2, content: "Use Cloud Memory." };
    const thirdMemory = { ...createdMemory, id: "mem_3", memoryNumber: 3, content: "Keep TrueMemory disabled." };
    const store = {
      create: vi.fn(),
      createSuperseding: vi.fn(),
      findActiveByContent: vi.fn(),
      findBySourceIdentity: vi.fn(),
      setVectorState: vi.fn(),
      getById: vi.fn(),
      getByNumber: vi.fn(),
      getManyByIds: vi.fn().mockResolvedValue([secondMemory, thirdMemory]),
      listNeedingVectorRepair: vi.fn(),
      listDirectives: vi.fn(),
      searchExact: vi.fn().mockResolvedValue([createdMemory, secondMemory]),
      counts: vi.fn(),
    };
    const semanticIndex = {
      index: vi.fn(),
      search: vi.fn().mockResolvedValue([
        { id: "mem_2", score: 0.91 },
        { id: "mem_3", score: 0.89 },
      ]),
    };
    const reranker = {
      rerank: vi.fn().mockResolvedValue([
        { id: "mem_3", score: 0.99 },
        { id: "mem_2", score: 0.1 },
        { id: "mem_1", score: 0.21 },
      ]),
    };

    const result = await new MemoryService(store, semanticIndex, reranker).search({
      ownerId: "123456789",
      query: "replacement memory service",
      limit: 2,
      includeDirectives: false,
      mode: "hybrid",
    });

    expect(store.searchExact).toHaveBeenCalledWith(
      "123456789",
      "replacement memory service",
      20,
      false,
    );
    expect(semanticIndex.search).toHaveBeenCalledWith(
      "123456789",
      "replacement memory service",
      20,
      false,
    );
    expect(reranker.rerank).toHaveBeenCalledOnce();
    expect(result.results.map((entry) => entry.memory.id)).toEqual(["mem_3", "mem_2"]);
    expect(result.results[0]?.explanation).toMatchObject({
      matchSources: ["semantic"],
      rerankerScore: 0.99,
      temporalIntent: { kind: "neutral", year: null },
      degraded: { lexical: false, semantic: false, reranking: false },
    });
    expect(result.results[0]?.explanation?.boosts).not.toBeNull();
    expect(result.results[0]?.explanation?.boosts?.total ?? 1).toBeLessThanOrEqual(0.08);
    expect(result.lexicalDegraded).toBe(false);
    expect(result.rerankingDegraded).toBe(false);
  });

  it("explains a degraded lexical-only fallback without fabricating reranker signals", async () => {
    const store = {
      create: vi.fn(), createSuperseding: vi.fn(), findActiveByContent: vi.fn(),
      findBySourceIdentity: vi.fn(), setVectorState: vi.fn(), getById: vi.fn(),
      getByNumber: vi.fn(), getManyByIds: vi.fn(), listNeedingVectorRepair: vi.fn(),
      listDirectives: vi.fn(), counts: vi.fn(),
      searchExact: vi.fn().mockResolvedValue([createdMemory]),
    };
    const semanticIndex = { index: vi.fn(), search: vi.fn().mockRejectedValue(new Error("down")) };
    const reranker = { rerank: vi.fn() };

    const result = await new MemoryService(store, semanticIndex, reranker).search({
      ownerId: "123456789",
      query: "canonical D1",
      limit: 5,
      includeDirectives: false,
      mode: "hybrid",
    });

    expect(result.results[0]?.explanation).toEqual({
      matchSources: ["exact"],
      rerankerScore: null,
      boosts: null,
      temporalIntent: { kind: "neutral", year: null },
      degraded: { lexical: false, semantic: true, reranking: false },
    });
  });

  it("uses one bounded context-graph hop only to fill spare hybrid result slots", async () => {
    const related = { ...createdMemory, id: "mem_graph", memoryNumber: 9, content: "Related context" };
    const store = {
      create: vi.fn(), createSuperseding: vi.fn(), findActiveByContent: vi.fn(),
      findBySourceIdentity: vi.fn(), setVectorState: vi.fn(), getById: vi.fn(),
      getByNumber: vi.fn(), listNeedingVectorRepair: vi.fn(), listDirectives: vi.fn(), counts: vi.fn(),
      searchExact: vi.fn().mockResolvedValue([createdMemory]),
      getManyByIds: vi.fn().mockImplementation(async (_ownerId: string, ids: string[]) =>
        ids.includes("mem_graph") ? [related] : [createdMemory]),
    };
    const graph = { relatedMemoryIds: vi.fn().mockResolvedValue(["mem_graph"]) };
    const service = new MemoryService(
      store,
      { index: vi.fn(), search: vi.fn().mockResolvedValue([{ id: createdMemory.id, score: 0.9 }]) },
      { rerank: vi.fn().mockResolvedValue([{ id: createdMemory.id, score: 0.95 }]) },
      undefined,
      undefined,
      graph,
    );

    const result = await service.search({
      ownerId: createdMemory.ownerId,
      query: "Cloud Memory architecture",
      limit: 3,
      includeDirectives: false,
      mode: "hybrid",
    });

    expect(graph.relatedMemoryIds).toHaveBeenCalledWith(createdMemory.ownerId, [createdMemory.id], 2);
    expect(result.results.map((item) => item.memory.id)).toEqual([createdMemory.id, related.id]);
    expect(result.results[1]?.explanation?.matchSources).toEqual(["graph"]);
  });

  it("uses the deepest bounded candidate pool for temporal hybrid queries", async () => {
    const store = {
      create: vi.fn(),
      createSuperseding: vi.fn(),
      findActiveByContent: vi.fn(),
      findBySourceIdentity: vi.fn(),
      setVectorState: vi.fn(),
      getById: vi.fn(),
      getByNumber: vi.fn(),
      getManyByIds: vi.fn().mockResolvedValue([]),
      listNeedingVectorRepair: vi.fn(),
      listDirectives: vi.fn(),
      searchExact: vi.fn().mockResolvedValue([]),
      counts: vi.fn(),
    };
    const semanticIndex = {
      index: vi.fn(),
      search: vi.fn().mockResolvedValue([]),
    };
    const reranker = { rerank: vi.fn() };

    await new MemoryService(store, semanticIndex, reranker).search({
      ownerId: "123456789",
      query: "What is happening with DNS right now?",
      limit: 3,
      includeDirectives: false,
      mode: "hybrid",
    });

    expect(store.searchExact).toHaveBeenCalledWith(
      "123456789",
      "What is happening with DNS right now?",
      50,
      false,
    );
    expect(semanticIndex.search).toHaveBeenCalledWith(
      "123456789",
      "What is happening with DNS right now?",
      50,
      false,
    );
  });

  it("continues hybrid retrieval when lexical search is unavailable", async () => {
    const semanticMemory = { ...createdMemory, id: "mem_2", memoryNumber: 2 };
    const store = {
      create: vi.fn(),
      createSuperseding: vi.fn(),
      findActiveByContent: vi.fn(),
      findBySourceIdentity: vi.fn(),
      setVectorState: vi.fn(),
      getById: vi.fn(),
      getByNumber: vi.fn(),
      getManyByIds: vi.fn().mockResolvedValue([semanticMemory]),
      listNeedingVectorRepair: vi.fn(),
      listDirectives: vi.fn(),
      searchExact: vi.fn().mockRejectedValue(new Error("missing FTS table")),
      counts: vi.fn(),
    };
    const semanticIndex = {
      index: vi.fn(),
      search: vi.fn().mockResolvedValue([{ id: "mem_2", score: 0.91 }]),
    };
    const reranker = {
      rerank: vi.fn().mockResolvedValue([{ id: "mem_2", score: 0.95 }]),
    };

    const result = await new MemoryService(store, semanticIndex, reranker).search({
      ownerId: "123456789",
      query: "memory service",
      limit: 2,
      includeDirectives: false,
      mode: "hybrid",
    });

    expect(result.results.map((entry) => entry.memory.id)).toEqual(["mem_2"]);
    expect(result.lexicalDegraded).toBe(true);
    expect(result.semanticDegraded).toBe(false);
  });

  it("never sends directives to the reranker", async () => {
    const directive = {
      ...createdMemory,
      id: "dir_1",
      memoryNumber: 2,
      kind: "directive" as const,
      content: "Never reveal secrets.",
    };
    const store = {
      create: vi.fn(),
      createSuperseding: vi.fn(),
      findActiveByContent: vi.fn(),
      findBySourceIdentity: vi.fn(),
      setVectorState: vi.fn(),
      getById: vi.fn(),
      getByNumber: vi.fn(),
      getManyByIds: vi.fn().mockResolvedValue([createdMemory, directive]),
      listNeedingVectorRepair: vi.fn(),
      listDirectives: vi.fn(),
      searchExact: vi.fn().mockResolvedValue([directive, createdMemory]),
      counts: vi.fn(),
    };
    const semanticIndex = {
      index: vi.fn(),
      search: vi.fn().mockResolvedValue([
        { id: "mem_1", score: 0.91 },
        { id: "dir_1", score: 0.9 },
      ]),
    };
    const reranker = {
      rerank: vi.fn().mockResolvedValue([{ id: "mem_1", score: 0.95 }]),
    };

    const result = await new MemoryService(store, semanticIndex, reranker).search({
      ownerId: "123456789",
      query: "memory security",
      limit: 2,
      includeDirectives: true,
      mode: "hybrid",
    });

    expect(reranker.rerank).toHaveBeenCalledWith("memory security", [createdMemory]);
    expect(result.results.map((entry) => entry.memory.id)).toEqual(["mem_1", "dir_1"]);
  });

  it("falls back to deterministic fusion when reranking is unavailable", async () => {
    const secondMemory = { ...createdMemory, id: "mem_2", memoryNumber: 2, content: "Use Cloud Memory." };
    const store = {
      create: vi.fn(),
      createSuperseding: vi.fn(),
      findActiveByContent: vi.fn(),
      findBySourceIdentity: vi.fn(),
      setVectorState: vi.fn(),
      getById: vi.fn(),
      getByNumber: vi.fn(),
      getManyByIds: vi.fn().mockResolvedValue([secondMemory]),
      listNeedingVectorRepair: vi.fn(),
      listDirectives: vi.fn(),
      searchExact: vi.fn().mockResolvedValue([createdMemory, secondMemory]),
      counts: vi.fn(),
    };
    const semanticIndex = {
      index: vi.fn(),
      search: vi.fn().mockResolvedValue([{ id: "mem_2", score: 0.91 }]),
    };
    const reranker = { rerank: vi.fn().mockRejectedValue(new Error("quota exceeded")) };

    const result = await new MemoryService(store, semanticIndex, reranker).search({
      ownerId: "123456789",
      query: "memory service",
      limit: 2,
      includeDirectives: false,
      mode: "hybrid",
    });

    expect(result.results.map((entry) => entry.memory.id)).toEqual(["mem_2", "mem_1"]);
    expect(result.rerankingDegraded).toBe(true);
  });

  it("retrieves superseded records only for explicit historical intent", async () => {
    const historical = {
      ...createdMemory,
      status: "superseded" as const,
      validUntil: "2026-07-01T00:00:00.000Z",
    };
    const store = {
      create: vi.fn(),
      createSuperseding: vi.fn(),
      findActiveByContent: vi.fn(),
      findBySourceIdentity: vi.fn(),
      setVectorState: vi.fn(),
      getById: vi.fn(),
      getByNumber: vi.fn(),
      getManyByIds: vi.fn().mockResolvedValue([historical]),
      listNeedingVectorRepair: vi.fn(),
      listDirectives: vi.fn(),
      searchExact: vi.fn().mockResolvedValue([historical]),
      counts: vi.fn(),
    };
    const semanticIndex = { index: vi.fn(), search: vi.fn().mockResolvedValue([]) };
    const reranker = { rerank: vi.fn().mockResolvedValue([{ id: historical.id, score: 0.9 }]) };

    const result = await new MemoryService(store, semanticIndex, reranker).search({
      ownerId: createdMemory.ownerId,
      query: "What was the previous canonical database?",
      limit: 3,
      includeDirectives: false,
      mode: "hybrid",
    });

    expect(store.searchExact).toHaveBeenCalledWith(
      createdMemory.ownerId,
      "What was the previous canonical database?",
      50,
      false,
      true,
    );
    expect(semanticIndex.search).toHaveBeenCalledWith(
      createdMemory.ownerId,
      "What was the previous canonical database?",
      50,
      false,
      undefined,
      undefined,
      true,
    );
    expect(result.results[0]?.memory.status).toBe("superseded");

    const yearResult = await new MemoryService(store, semanticIndex, reranker).search({
      ownerId: createdMemory.ownerId,
      query: "What was the canonical database in 2025?",
      limit: 3,
      includeDirectives: false,
      mode: "hybrid",
    });
    expect(store.searchExact).toHaveBeenLastCalledWith(
      createdMemory.ownerId,
      "What was the canonical database in 2025?",
      50,
      false,
      true,
      2025,
    );
    expect(yearResult.results).toEqual([]);
  });
});

describe("MemoryService.capture", () => {
  const captureStore = () => ({
    create: vi.fn().mockResolvedValue(createdMemory),
    createSuperseding: vi.fn(),
    findActiveByContent: vi.fn().mockResolvedValue(null),
    findBySourceIdentity: vi.fn().mockResolvedValue(null),
    setVectorState: vi.fn().mockResolvedValue(undefined),
    getById: vi.fn().mockResolvedValue({ ...createdMemory, vectorState: "indexed" }),
    getByNumber: vi.fn(),
    getManyByIds: vi.fn().mockResolvedValue([]),
    listNeedingVectorRepair: vi.fn(),
    listDirectives: vi.fn(),
    searchExact: vi.fn(),
    counts: vi.fn(),
  });

  it("returns an exact duplicate before semantic search or a write", async () => {
    const store = captureStore();
    store.findActiveByContent.mockResolvedValue(createdMemory);
    const semanticIndex = { index: vi.fn(), search: vi.fn() };
    const service = new MemoryService(store, semanticIndex, { rerank: vi.fn() });

    const result = await service.capture({
      ownerId: createdMemory.ownerId,
      candidates: [{ content: createdMemory.content }],
    });

    expect(result).toEqual([{ outcome: "exact_duplicate", duplicateOf: createdMemory }]);
    expect(semanticIndex.search).not.toHaveBeenCalled();
    expect(store.create).not.toHaveBeenCalled();
  });

  it("surfaces a source conflict without overwriting", async () => {
    const store = captureStore();
    store.findBySourceIdentity.mockResolvedValue(createdMemory);
    const semanticIndex = { index: vi.fn(), search: vi.fn() };
    const service = new MemoryService(store, semanticIndex, { rerank: vi.fn() });

    const result = await service.capture({
      ownerId: createdMemory.ownerId,
      candidates: [{ content: "D1 is no longer canonical.", source: "Codex", sourceId: "chat-1" }],
    });

    expect(result).toEqual([{ outcome: "source_conflict", conflictingWith: createdMemory }]);
    expect(semanticIndex.search).not.toHaveBeenCalled();
    expect(store.create).not.toHaveBeenCalled();
  });

  it("persists a source conflict review and returns its ID", async () => {
    const store = captureStore();
    store.findBySourceIdentity.mockResolvedValue(createdMemory);
    const reviewStore = {
      createReview: vi.fn().mockResolvedValue({
        review: { id: "review_source_1" },
        idempotent: false,
      }),
    };
    const service = new MemoryService(
      store,
      { index: vi.fn(), search: vi.fn() },
      { rerank: vi.fn() },
      undefined,
      reviewStore as never,
    );

    const result = await service.capture({
      ownerId: createdMemory.ownerId,
      candidates: [{ content: "D1 is no longer canonical.", source: "Codex", sourceId: "chat-1" }],
    });

    expect(result).toEqual([{
      outcome: "source_conflict",
      conflictingWith: createdMemory,
      reviewId: "review_source_1",
    }]);
    expect(reviewStore.createReview).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: createdMemory.ownerId,
      reviewType: "source_conflict",
      matchedMemoryId: createdMemory.id,
      candidateSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    }));
  });

  it("returns at most five owner-revalidated probable duplicates without writing", async () => {
    const store = captureStore();
    const matches = Array.from({ length: 6 }, (_, index) => ({
      ...createdMemory,
      id: `mem_${index + 2}`,
      memoryNumber: index + 2,
      namespace: "atlas",
    }));
    store.getManyByIds.mockResolvedValue(matches);
    const semanticIndex = {
      index: vi.fn(),
      search: vi.fn().mockResolvedValue(matches.map((memory, index) => ({
        id: memory.id,
        score: 0.99 - index * 0.01,
      }))),
    };
    const service = new MemoryService(store, semanticIndex, { rerank: vi.fn() });

    const result = await service.capture({
      ownerId: createdMemory.ownerId,
      candidates: [{ content: "D1 is the canonical store.", namespace: "atlas" }],
    });

    expect(semanticIndex.search).toHaveBeenCalledWith(
      createdMemory.ownerId,
      "D1 is the canonical store.",
      5,
      false,
      "atlas",
      "memory",
    );
    expect(result[0]).toMatchObject({ outcome: "probable_duplicate" });
    expect(result[0]?.outcome === "probable_duplicate" && result[0].candidates).toHaveLength(5);
    expect(store.create).not.toHaveBeenCalled();
  });

  it("persists a probable duplicate review and returns its ID", async () => {
    const store = captureStore();
    store.getManyByIds.mockResolvedValue([{ ...createdMemory, id: "mem_match" }]);
    const semanticIndex = {
      index: vi.fn(),
      search: vi.fn().mockResolvedValue([{ id: "mem_match", score: 0.97 }]),
    };
    const reviewStore = {
      createReview: vi.fn().mockResolvedValue({
        review: { id: "review_duplicate_1" },
        idempotent: false,
      }),
    };
    const service = new MemoryService(
      store,
      semanticIndex,
      { rerank: vi.fn() },
      undefined,
      reviewStore as never,
    );

    const result = await service.capture({
      ownerId: createdMemory.ownerId,
      candidates: [{ content: "D1 remains canonical.", namespace: "default" }],
    });

    expect(result[0]).toMatchObject({
      outcome: "probable_duplicate",
      reviewId: "review_duplicate_1",
    });
    expect(reviewStore.createReview).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: createdMemory.ownerId,
      reviewType: "probable_duplicate",
      matchedMemoryId: "mem_match",
      similarity: 0.97,
      candidateSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    }));
    expect(store.create).not.toHaveBeenCalled();
  });

  it("does not bypass review persistence when a probable duplicate review fails", async () => {
    const store = captureStore();
    store.getManyByIds.mockResolvedValue([{ ...createdMemory, id: "mem_match" }]);
    const reviewStore = {
      createReview: vi.fn().mockRejectedValue(new Error("review database unavailable")),
    };
    const service = new MemoryService(
      store,
      { index: vi.fn(), search: vi.fn().mockResolvedValue([{ id: "mem_match", score: 0.97 }]) },
      { rerank: vi.fn() },
      undefined,
      reviewStore as never,
    );

    await expect(service.capture({
      ownerId: createdMemory.ownerId,
      candidates: [{ content: "D1 remains canonical.", namespace: "default" }],
    })).rejects.toThrow("review database unavailable");
    expect(store.create).not.toHaveBeenCalled();
  });

  it("keeps a canonical write when semantic duplicate checking is unavailable", async () => {
    const store = captureStore();
    const semanticIndex = {
      index: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockRejectedValue(new Error("Vectorize unavailable")),
    };
    const service = new MemoryService(store, semanticIndex, { rerank: vi.fn() });

    const result = await service.capture({
      ownerId: createdMemory.ownerId,
      candidates: [{ content: createdMemory.content }],
    });

    expect(result[0]).toMatchObject({ outcome: "created" });
    expect(store.create).toHaveBeenCalledOnce();
  });

  it("requires explicit lineage and expected version for supersession", async () => {
    const replacement = {
      ...createdMemory,
      id: "mem_2",
      content: "D1 is replaced by Durable Objects.",
      supersedesId: createdMemory.id,
    };
    const store = captureStore();
    store.createSuperseding.mockResolvedValue({
      replacement,
      superseded: { ...createdMemory, status: "superseded", version: 2 },
    });
    const semanticIndex = { index: vi.fn().mockResolvedValue(undefined), search: vi.fn() };
    const service = new MemoryService(store, semanticIndex, { rerank: vi.fn() });

    const result = await service.capture({
      ownerId: createdMemory.ownerId,
      candidates: [{
        content: replacement.content,
        supersedesId: createdMemory.id,
        expectedSupersededVersion: 1,
      }],
    });

    expect(result[0]).toMatchObject({
      outcome: "superseded",
      replacement: { ...replacement, vectorState: "indexed" },
    });
    expect(store.createSuperseding).toHaveBeenCalledOnce();
    expect(semanticIndex.index).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: createdMemory.id, status: "superseded" }),
    );
    expect(semanticIndex.index).toHaveBeenNthCalledWith(2, replacement);
    expect(store.setVectorState).toHaveBeenCalledWith(
      createdMemory.ownerId,
      createdMemory.id,
      "indexed",
    );
  });

  it("rejects more than three capture candidates", async () => {
    const service = new MemoryService(
      captureStore(),
      { index: vi.fn(), search: vi.fn() },
      { rerank: vi.fn() },
    );
    await expect(service.capture({
      ownerId: createdMemory.ownerId,
      candidates: Array.from({ length: 4 }, (_, index) => ({ content: `Fact ${index}` })),
    })).rejects.toThrow("Capture accepts between one and three candidates");
  });
});
