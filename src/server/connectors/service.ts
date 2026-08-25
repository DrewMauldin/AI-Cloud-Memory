import type { MemoryService } from "../memory/service";
import { previewConnector, type ConnectorAdapterId } from "./registry";
import type { ConnectorRunStore } from "./runs";

function errorClass(error: unknown): string {
  return error instanceof Error && error.name ? error.name.slice(0, 100) : "ConnectorApplyError";
}

export class ConnectorService {
  constructor(
    private readonly runs: Pick<ConnectorRunStore, "createPreview" | "startApply" | "complete">,
    private readonly memories: Pick<MemoryService, "capture">,
  ) {}

  async preview(input: {
    ownerId: string;
    adapterId: ConnectorAdapterId;
    input: unknown;
    sourceRef?: string;
    fetcher?: typeof fetch;
    githubToken?: string;
  }) {
    const preview = await previewConnector(input);
    const run = await this.runs.createPreview({
      ownerId: input.ownerId,
      adapterId: input.adapterId,
      sourceRef: input.sourceRef,
      inputSha256: preview.inputSha256,
      previewSha256: preview.previewSha256,
      examinedCount: preview.records.length,
    });
    return { run, preview };
  }

  async apply(input: {
    ownerId: string;
    runId: string;
    expectedVersion: number;
    previewSha256: string;
    adapterId: ConnectorAdapterId;
    input: unknown;
    fetcher?: typeof fetch;
    githubToken?: string;
  }) {
    const preview = await previewConnector(input);
    if (preview.previewSha256 !== input.previewSha256) {
      throw new Error("Recomputed connector preview does not match the approved hash");
    }
    const applying = await this.runs.startApply(input);
    let importedCount = 0;
    let duplicateCount = 0;
    let rejectedCount = 0;
    try {
      for (let offset = 0; offset < preview.records.length; offset += 3) {
        const records = preview.records.slice(offset, offset + 3);
        const outcomes = await this.memories.capture({
          ownerId: input.ownerId,
          candidates: records.map((record) => ({
            content: record.content,
            directive: record.directive,
            namespace: record.namespace,
            memoryType: record.memoryType,
            source: record.sourceSystem,
            sourceId: record.sourceId,
            sourceUrl: record.sourceUrl,
            actorType: "import" as const,
            correlationId: input.runId,
            eventContext: { connectorAdapter: input.adapterId, connectorPreviewSha256: input.previewSha256 },
          })),
        });
        for (const outcome of outcomes) {
          if (outcome.outcome === "created" || outcome.outcome === "superseded") importedCount += 1;
          else if (outcome.outcome === "exact_duplicate" || outcome.outcome === "probable_duplicate") duplicateCount += 1;
          else rejectedCount += 1;
        }
      }
      return await this.runs.complete({
        ownerId: input.ownerId,
        runId: input.runId,
        expectedVersion: applying.version,
        importedCount,
        duplicateCount,
        rejectedCount,
      });
    } catch (error) {
      try {
        await this.runs.complete({
          ownerId: input.ownerId,
          runId: input.runId,
          expectedVersion: applying.version,
          importedCount,
          duplicateCount,
          rejectedCount,
          errorClass: errorClass(error),
        });
      } catch {
        // Preserve the import failure. A concurrent receipt change must not mask the root cause.
      }
      throw error;
    }
  }
}
