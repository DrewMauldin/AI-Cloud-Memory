import type { MemoryRecord } from "./store";

export interface SemanticMatch {
  id: string;
  score: number;
}

export interface SemanticIndex {
  index(memory: MemoryRecord): Promise<void>;
  search(
    ownerId: string,
    query: string,
    limit: number,
    includeDirectives: boolean,
    namespace?: string,
    kind?: MemoryRecord["kind"],
    includeSuperseded?: boolean,
  ): Promise<SemanticMatch[]>;
}

export class CloudflareSemanticIndex implements SemanticIndex {
  constructor(
    private readonly ai: Ai,
    private readonly vectorize: VectorizeIndex,
  ) {}

  private async embed(text: string): Promise<number[]> {
    const output = await this.ai.run("@cf/baai/bge-base-en-v1.5", {
      text: [text],
    });
    const vector = "data" in output ? output.data?.[0] : undefined;
    if (!vector || vector.length !== 768) {
      throw new Error("Embedding model returned an unexpected vector shape");
    }
    return vector;
  }

  async index(memory: MemoryRecord): Promise<void> {
    await this.vectorize.upsert([
      {
        id: memory.id,
        values: await this.embed(memory.content),
        namespace: memory.namespace,
        metadata: {
          owner_id: memory.ownerId,
          kind: memory.kind,
          status: memory.status,
        },
      },
    ]);
  }

  async search(
    ownerId: string,
    query: string,
    limit: number,
    includeDirectives: boolean,
    namespace?: string,
    kind?: MemoryRecord["kind"],
    includeSuperseded = false,
  ): Promise<SemanticMatch[]> {
    const filter: VectorizeVectorMetadataFilter = {
      owner_id: { $eq: ownerId },
      status: includeSuperseded
        ? { $in: ["active", "superseded"] }
        : { $eq: "active" },
      ...(kind
        ? { kind: { $eq: kind } }
        : includeDirectives
          ? {}
          : { kind: { $eq: "memory" } }),
    };
    const matches = await this.vectorize.query(await this.embed(query), {
      topK: Math.min(limit, 50),
      returnMetadata: "indexed",
      filter,
      ...(namespace ? { namespace } : {}),
    });
    return matches.matches.map((match) => ({ id: match.id, score: match.score }));
  }
}
