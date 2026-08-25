import type { MemoryRecord } from "./store";

export interface RerankMatch {
  id: string;
  score: number;
}

export interface SearchReranker {
  rerank(query: string, candidates: MemoryRecord[]): Promise<RerankMatch[]>;
}

const MAX_RERANK_CONTENT_LENGTH = 4_000;

export class CloudflareSearchReranker implements SearchReranker {
  constructor(private readonly ai: Ai) {}

  async rerank(query: string, candidates: MemoryRecord[]): Promise<RerankMatch[]> {
    if (candidates.length === 0) return [];
    // Workers AI reranker contract:
    // https://developers.cloudflare.com/workers-ai/models/bge-reranker-base/
    const output = await this.ai.run("@cf/baai/bge-reranker-base", {
      query,
      contexts: candidates.map((candidate) => ({
        text: candidate.content.slice(0, MAX_RERANK_CONTENT_LENGTH),
      })),
      top_k: candidates.length,
    } as Ai_Cf_Baai_Bge_Reranker_Base_Input & { query: string });
    const response = "response" in output ? output.response : undefined;
    if (!Array.isArray(response) || response.length !== candidates.length) {
      throw new Error("invalid reranker response");
    }

    const seen = new Set<number>();
    const matches = response.map((entry) => {
      if (
        !entry ||
        !Number.isInteger(entry.id) ||
        entry.id === undefined ||
        entry.id < 0 ||
        entry.id >= candidates.length ||
        seen.has(entry.id) ||
        typeof entry.score !== "number" ||
        !Number.isFinite(entry.score) ||
        entry.score < 0 ||
        entry.score > 1
      ) {
        throw new Error("invalid reranker response");
      }
      seen.add(entry.id);
      return { id: candidates[entry.id]!.id, score: entry.score };
    });

    return matches.sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
  }
}
