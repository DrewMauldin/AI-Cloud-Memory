import { describe, expect, it, vi } from "vitest";

import { ReflectionService } from "./service";

describe("reflection archive apply", () => {
  it("requires an open archive proposal and both optimistic versions", async () => {
    const get = vi.fn(async () => ({
      id: "proposal-1",
      status: "open",
      version: 2,
      suggestedAction: "archive",
      primaryMemoryId: "memory-1",
    }));
    const decide = vi.fn(async () => ({ id: "proposal-1", status: "applied", version: 3 }));
    const archiveMemory = vi.fn(async () => ({ id: "memory-1", status: "archived", version: 8 }));
    const deleteVector = vi.fn(async () => undefined);
    const service = new ReflectionService({ get, decide } as never, { archiveMemory } as never, deleteVector);

    const result = await service.applyArchive({
      ownerId: "owner",
      proposalId: "proposal-1",
      expectedProposalVersion: 2,
      expectedMemoryVersion: 7,
    });

    expect(archiveMemory).toHaveBeenCalledWith({ ownerId: "owner", memoryId: "memory-1", expectedVersion: 7 });
    expect(decide).toHaveBeenCalledWith("owner", "proposal-1", 2, "applied");
    expect(deleteVector).toHaveBeenCalledWith("memory-1");
    expect(result).toMatchObject({ proposal: { status: "applied" }, memory: { status: "archived" } });
  });
});
