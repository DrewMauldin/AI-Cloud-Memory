import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { MemoryStore } from "./store";
import {
  MemoryReviewStore,
  type MemoryFeedbackInput,
  type MemoryReviewInput,
} from "./review";

const ownerId = "123456789";
const otherOwnerId = "other-owner";

const reviewInput = (overrides: Partial<MemoryReviewInput> = {}): MemoryReviewInput => ({
  ownerId,
  reviewType: "probable_duplicate",
  candidateContent: "Cloud Memory keeps D1 canonical.",
  candidateSha256: "a".repeat(64),
  candidateNamespace: "default",
  candidateKind: "memory",
  matchedMemoryId: null,
  similarity: 0.94,
  sourceSystem: "MCP",
  sourceId: "capture-1",
  sourceUrl: "https://chatgpt.com/c/example",
  client: "Codex",
  model: "GPT-5",
  correlationId: "review-1",
  ...overrides,
});

const feedbackInput = (overrides: Partial<MemoryFeedbackInput> = {}): MemoryFeedbackInput => ({
  ownerId,
  memoryId: "memory-1",
  query: "What keeps Cloud Memory canonical?",
  label: "helpful",
  mode: "hybrid",
  rank: 1,
  score: 0.91,
  resultSetId: "search-1",
  correlationId: "feedback-1",
  client: "Codex",
  model: "GPT-5",
  ...overrides,
});

async function createMemory(inputOwnerId: string, id: string): Promise<void> {
  await new MemoryStore(env.DB, {
    now: () => "2026-08-24T01:02:03.000Z",
    newId: () => id,
    sha256: async () => `${id}-hash`,
  }).create({
    ownerId: inputOwnerId,
    content: `Memory owned by ${inputOwnerId}`,
  });
}

describe("MemoryReviewStore", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM memory_relevance_feedback").run();
    await env.DB.prepare("DELETE FROM memory_review_items").run();
    await env.DB.prepare("DELETE FROM memory_events").run();
    await env.DB.prepare("DELETE FROM memories").run();
    await env.DB.prepare("DELETE FROM users").run();
    await env.DB.prepare(
      `INSERT INTO users (id, github_login, created_at, updated_at)
       VALUES (?, ?, ?, ?), (?, ?, ?, ?)`,
    )
      .bind(
        ownerId,
        "community-owner",
        "2026-08-24T00:00:00.000Z",
        "2026-08-24T00:00:00.000Z",
        otherOwnerId,
        "OtherOwner",
        "2026-08-24T00:00:00.000Z",
        "2026-08-24T00:00:00.000Z",
      )
      .run();
    await createMemory(ownerId, "memory-1");
    await createMemory(otherOwnerId, "memory-2");
  });

  it("creates an owner-scoped review and replays the same correlation idempotently", async () => {
    const store = new MemoryReviewStore(env.DB, {
      now: () => "2026-08-24T01:02:03.000Z",
      newId: (() => {
        let count = 0;
        return () => `review-${++count}`;
      })(),
      sha256: async () => "b".repeat(64),
    });

    const first = await store.createReview(reviewInput());
    const replay = await store.createReview(reviewInput());

    expect(first).toMatchObject({ idempotent: false, review: {
      id: "review-1",
      ownerId,
      status: "open",
      reviewType: "probable_duplicate",
      candidateContent: "Cloud Memory keeps D1 canonical.",
    } });
    expect(replay).toEqual({ review: first.review, idempotent: true });
    expect(await store.listReviews({ ownerId })).toHaveLength(1);
    expect(await store.listReviews({ ownerId: otherOwnerId })).toEqual([]);
  });

  it("rejects a reused review correlation id when the payload changes", async () => {
    const store = new MemoryReviewStore(env.DB, {
      sha256: async (value) => value.includes("changed") ? "c".repeat(64) : "d".repeat(64),
    });

    await store.createReview(reviewInput());

    await expect(store.createReview(reviewInput({
      candidateContent: "changed candidate",
    }))).rejects.toMatchObject({ code: "REVIEW_CORRELATION_CONFLICT" });
  });

  it("allows exactly one optimistic resolution winner", async () => {
    const store = new MemoryReviewStore(env.DB, {
      now: (() => {
        let count = 0;
        return () => `2026-08-24T01:02:0${++count}.000Z`;
      })(),
      newId: () => "review-race",
      sha256: async () => "f".repeat(64),
    });
    const { review } = await store.createReview(reviewInput());

    const results = await Promise.allSettled([
      store.resolveReview({
        ownerId,
        reviewId: review.id,
        expectedVersion: review.version,
        status: "approved",
        resolvedBy: "owner",
      }),
      store.resolveReview({
        ownerId,
        reviewId: review.id,
        expectedVersion: review.version,
        status: "rejected",
        resolvedBy: "other-request",
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")[0]).toMatchObject({
      reason: { code: "REVIEW_CONFLICT" },
    });
    const [resolved] = await store.listReviews({ ownerId });
    expect(resolved?.status).toMatch(/approved|rejected/);
    expect(resolved?.version).toBe(2);
  });

  it("validates bounded review inputs and owner-scopes matched memories", async () => {
    const store = new MemoryReviewStore(env.DB);

    await expect(store.createReview(reviewInput({
      candidateContent: "x".repeat(12_001),
    })).catch((error) => error)).resolves.toMatchObject({ code: "REVIEW_VALIDATION" });

    await expect(store.createReview(reviewInput({
      matchedMemoryId: "memory-2",
    })).catch((error) => error)).resolves.toMatchObject({ code: "REVIEW_OWNER_BOUNDARY" });
  });
});

describe("MemoryReviewStore feedback", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM memory_relevance_feedback").run();
    await env.DB.prepare("DELETE FROM memory_review_items").run();
    await env.DB.prepare("DELETE FROM memory_events").run();
    await env.DB.prepare("DELETE FROM memories").run();
    await env.DB.prepare("DELETE FROM users").run();
    await env.DB.prepare(
      `INSERT INTO users (id, github_login, created_at, updated_at)
       VALUES (?, ?, ?, ?), (?, ?, ?, ?)`,
    )
      .bind(
        ownerId,
        "community-owner",
        "2026-08-24T00:00:00.000Z",
        "2026-08-24T00:00:00.000Z",
        otherOwnerId,
        "OtherOwner",
        "2026-08-24T00:00:00.000Z",
        "2026-08-24T00:00:00.000Z",
      )
      .run();
    await createMemory(ownerId, "memory-1");
    await createMemory(otherOwnerId, "memory-2");
  });

  it("creates feedback once and returns the original row on correlation replay", async () => {
    const store = new MemoryReviewStore(env.DB, {
      now: () => "2026-08-24T01:02:03.000Z",
      newId: () => "feedback-1",
      sha256: async () => "e".repeat(64),
    });

    const first = await store.createFeedback(feedbackInput());
    const replay = await store.createFeedback(feedbackInput());

    expect(first).toMatchObject({ idempotent: false, feedback: {
      id: "feedback-1",
      ownerId,
      memoryId: "memory-1",
      label: "helpful",
      querySha256: "e".repeat(64),
    } });
    expect(first.feedback).not.toHaveProperty("query");
    expect(replay).toEqual({ feedback: first.feedback, idempotent: true });
    expect(await store.listFeedback({ ownerId })).toHaveLength(1);
    expect(await store.listFeedback({ ownerId: otherOwnerId })).toEqual([]);

    const columns = await env.DB.prepare(
      "PRAGMA table_info(memory_relevance_feedback)",
    ).all<{ name: string }>();
    expect(columns.results.map((column) => column.name)).toContain("query_sha256");
    expect(columns.results.map((column) => column.name)).not.toContain("query");
  });

  it("rejects feedback for a memory owned by another user", async () => {
    const store = new MemoryReviewStore(env.DB);

    await expect(store.createFeedback(feedbackInput({
      memoryId: "memory-2",
    })).catch((error) => error)).resolves.toMatchObject({ code: "FEEDBACK_OWNER_BOUNDARY" });
  });

  it("rejects unbounded or invalid feedback inputs", async () => {
    const store = new MemoryReviewStore(env.DB);

    await expect(store.createFeedback(feedbackInput({
      query: "x".repeat(501),
    })).catch((error) => error)).resolves.toMatchObject({ code: "FEEDBACK_VALIDATION" });
    await expect(store.createFeedback(feedbackInput({
      score: 1.1,
    })).catch((error) => error)).resolves.toMatchObject({ code: "FEEDBACK_VALIDATION" });
  });
});
