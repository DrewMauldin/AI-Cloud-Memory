import type { MemoryStore } from "../memory/store";
import type { ReflectionStore } from "./store";

export class ReflectionService {
  constructor(
    private readonly proposals: ReflectionStore,
    private readonly memories: Pick<MemoryStore, "archiveMemory">,
    private readonly deleteVector: (memoryId: string) => Promise<void> = async () => undefined,
  ) {}

  async applyArchive(input: {
    ownerId: string;
    proposalId: string;
    expectedProposalVersion: number;
    expectedMemoryVersion: number;
  }) {
    const proposal = await this.proposals.get(input.ownerId, input.proposalId);
    if (!proposal || proposal.status !== "open") throw new Error("Open reflection proposal was not found");
    if (proposal.version !== input.expectedProposalVersion) throw new Error("Reflection proposal version conflict");
    if (proposal.suggestedAction !== "archive") throw new Error("Reflection proposal does not support archive apply");
    const memory = await this.memories.archiveMemory({
      ownerId: input.ownerId,
      memoryId: proposal.primaryMemoryId,
      expectedVersion: input.expectedMemoryVersion,
    });
    const applied = await this.proposals.decide(input.ownerId, proposal.id, proposal.version, "applied");
    try { await this.deleteVector(memory.id); } catch {
      console.error(JSON.stringify({ message: "reflection archive vector deletion failed", memoryId: memory.id }));
    }
    return { proposal: applied, memory };
  }
}
