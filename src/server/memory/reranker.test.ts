import { describe, expect, it, vi } from "vitest";

import { CloudflareSearchReranker } from "./reranker";
import type { MemoryRecord } from "./store";

function memory(id: string, content: string): MemoryRecord {
  return {
    memoryNumber: Number(id.slice(-1)),
    id,
    ownerId: "123456789",
    namespace: "default",
    kind: "memory",
    memoryType: "fact",
    scopeType: "global",
    scopeId: null,
    retentionTier: "durable",
    content,
    contentSha256: `hash_${id}`,
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
    vectorState: "indexed",
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
    version: 1,
  };
}

describe("CloudflareSearchReranker", () => {
  it("maps validated context indices back to candidate IDs", async () => {
    const ai = {
      run: vi.fn().mockResolvedValue({
        response: [
          { id: 1, score: 0.91 },
          { id: 0, score: 0.54 },
        ],
      }),
    } as unknown as Ai;

    const result = await new CloudflareSearchReranker(ai).rerank("memory service", [
      memory("mem_1", "Legacy local memory."),
      memory("mem_2", "Cloud Memory is the replacement service."),
    ]);

    expect(result).toEqual([
      { id: "mem_2", score: 0.91 },
      { id: "mem_1", score: 0.54 },
    ]);
  });

  it("rejects malformed model output instead of trusting it", async () => {
    const ai = {
      run: vi.fn().mockResolvedValue({ response: [{ id: 99, score: 2 }] }),
    } as unknown as Ai;

    await expect(
      new CloudflareSearchReranker(ai).rerank("memory service", [
        memory("mem_1", "Cloud Memory."),
      ]),
    ).rejects.toThrow("invalid reranker response");
  });
});
