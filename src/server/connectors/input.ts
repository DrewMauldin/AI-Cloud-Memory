import { z } from "zod";

export const connectorAdapterId = z.enum([
  "cloud_memory_jsonl",
  "truememory_jsonl",
  "markdown_bundle",
  "github_markdown",
]);

export const connectorPreviewInput = z.object({
  adapterId: connectorAdapterId,
  sourceRef: z.string().trim().min(1).max(500).optional(),
  input: z.unknown(),
}).strict();

export const connectorApplyInput = connectorPreviewInput.extend({
  expectedVersion: z.number().int().positive(),
  previewSha256: z.string().regex(/^[0-9a-f]{64}$/i),
}).strict();
