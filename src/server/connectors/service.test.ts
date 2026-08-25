import { describe, expect, it, vi } from "vitest";

import { ConnectorService } from "./service";

describe("connector service", () => {
  it("recomputes the approved preview and captures records in bounded batches", async () => {
    const createPreview = vi.fn(async (input) => ({ id: "run-1", status: "previewed", version: 1, ...input }));
    const startApply = vi.fn(async () => ({ id: "run-1", status: "applying", version: 2 }));
    const complete = vi.fn(async (input) => ({ id: "run-1", status: "completed", version: 3, ...input }));
    const capture = vi.fn(async ({ candidates }) => candidates.map(() => ({ outcome: "created" })));
    const service = new ConnectorService({ createPreview, startApply, complete } as never, { capture } as never);
    const input = `${[1, 2, 3, 4].map((id) => JSON.stringify({ id: `m-${id}`, content: `Memory ${id}` })).join("\n")}\n`;
    const preview = await service.preview({ ownerId: "owner", adapterId: "cloud_memory_jsonl", input });

    const result = await service.apply({
      ownerId: "owner",
      runId: preview.run.id,
      expectedVersion: preview.run.version,
      previewSha256: preview.preview.previewSha256,
      adapterId: "cloud_memory_jsonl",
      input,
    });

    expect(capture).toHaveBeenCalledTimes(2);
    expect(capture.mock.calls.map(([call]) => call.candidates.length)).toEqual([3, 1]);
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ importedCount: 4, duplicateCount: 0, rejectedCount: 0 }));
    expect(result.status).toBe("completed");
  });

  it("refuses apply when the recomputed preview differs", async () => {
    const service = new ConnectorService({
      createPreview: vi.fn(),
      startApply: vi.fn(),
      complete: vi.fn(),
    } as never, { capture: vi.fn() } as never);

    await expect(service.apply({
      ownerId: "owner",
      runId: "run-1",
      expectedVersion: 1,
      previewSha256: "a".repeat(64),
      adapterId: "markdown_bundle",
      input: { files: [{ path: "note.md", content: "Changed content" }] },
    })).rejects.toThrow("does not match");
  });

  it("preserves the import error when the failure receipt also conflicts", async () => {
    const createPreview = vi.fn(async (input) => ({ id: "run-1", status: "previewed", version: 1, ...input }));
    const startApply = vi.fn(async () => ({ id: "run-1", status: "applying", version: 2 }));
    const complete = vi.fn().mockRejectedValue(new Error("Connector run version conflict"));
    const capture = vi.fn().mockRejectedValue(new Error("Capture service unavailable"));
    const service = new ConnectorService({ createPreview, startApply, complete } as never, { capture } as never);
    const input = `${JSON.stringify({ id: "m-1", content: "Memory 1" })}\n`;
    const preview = await service.preview({ ownerId: "owner", adapterId: "cloud_memory_jsonl", input });

    await expect(service.apply({
      ownerId: "owner", runId: preview.run.id, expectedVersion: preview.run.version,
      previewSha256: preview.preview.previewSha256, adapterId: "cloud_memory_jsonl", input,
    })).rejects.toThrow("Capture service unavailable");
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ errorClass: "Error" }));
  });
});
