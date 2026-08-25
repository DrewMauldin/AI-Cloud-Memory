import { z } from "zod";

const optionalText = (maximum: number) =>
  z.string().trim().min(1).max(maximum).optional();

const httpUrl = z
  .url()
  .max(2_048)
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "https:" || protocol === "http:";
  }, "URL must use HTTP or HTTPS");

const memoryType = z.enum([
  "preference",
  "decision",
  "fact",
  "episode",
  "procedure",
  "project_state",
  "correction",
]);
const scopeType = z.enum(["global", "project", "repository", "client"]);
const retentionTier = z.enum(["core", "durable", "dynamic", "archive"]);
const reviewStatus = z.enum(["open", "approved", "rejected", "dismissed"]);
const reviewResolutionStatus = z.enum(["approved", "rejected", "dismissed"]);
const feedbackLabel = z.enum([
  "helpful",
  "not_helpful",
  "incorrect",
  "outdated",
  "confirmed",
]);
const searchMode = z.enum(["exact", "semantic", "hybrid"]);

const memoryFields = {
  content: z.string().trim().min(1).max(12_000),
  directive: z.boolean().default(false),
  source: optionalText(200),
  source_id: optionalText(200),
  source_url: httpUrl.optional(),
  client: optionalText(100),
  model: optionalText(100),
  conversation_id: optionalText(200),
  message_id: optionalText(200),
  memory_type: memoryType.optional(),
  scope_type: scopeType.default("global"),
  scope_id: optionalText(200),
  retention_tier: retentionTier.optional(),
  observed_at: z.iso.datetime().optional(),
  review_at: z.iso.datetime().optional(),
  expires_at: z.iso.datetime().optional(),
};

function validateScope(
  value: { scope_type: z.infer<typeof scopeType>; scope_id?: string },
  context: z.RefinementCtx,
) {
  const isGlobal = value.scope_type === "global";
  if (isGlobal === (value.scope_id !== undefined)) {
    context.addIssue({
      code: "custom",
      path: ["scope_id"],
      message: isGlobal
        ? "scope_id is not allowed for global memory"
        : "scope_id is required for scoped memory",
    });
  }
}

export const storeMemoryInput = z
  .object(memoryFields)
  .strict()
  .superRefine(validateScope);

const captureCandidateInput = z
  .object({
    ...memoryFields,
    namespace: optionalText(100),
    importance: z.number().min(0).max(1).optional(),
    confidence: z.number().min(0).max(1).optional(),
    sensitivity: z.enum(["normal", "private", "sensitive"]).optional(),
    correlation_id: optionalText(200),
    supersedes_memory_id: optionalText(200),
    expected_superseded_version: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    validateScope(value, context);
    if (
      (value.supersedes_memory_id === undefined) !==
      (value.expected_superseded_version === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "supersedes_memory_id and expected_superseded_version must be provided together",
      });
    }
  });

export const captureMemoryInput = z.object({
  candidates: z.array(captureCandidateInput).min(1).max(3),
}).strict();

export const searchMemoryInput = z
  .object({
    query: z.string().trim().min(1).max(500),
    limit: z
      .number()
      .int()
      .min(1)
      .transform((value) => Math.min(value, 50))
      .default(10),
    include_directives: z.boolean().default(true),
    mode: z.enum(["exact", "semantic", "hybrid"]).default("hybrid"),
  })
  .strict();

export const reviewListInput = z.object({
  status: reviewStatus.default("open"),
  limit: z.number().int().min(1).max(100).default(25),
}).strict();

export const reviewDecisionInput = z.object({
  status: reviewResolutionStatus,
  expected_version: z.number().int().positive(),
  resolution_note: optionalText(1_000),
}).strict();

export const memoryFeedbackInput = z.object({
  memory_id: z.string().trim().min(1).max(200),
  query: z.string().trim().min(1).max(500),
  label: feedbackLabel,
  mode: searchMode.default("hybrid"),
  rank: z.number().int().min(1).max(50).nullable().optional(),
  score: z.number().min(0).max(1).nullable().optional(),
  result_set_id: optionalText(200),
  correlation_id: optionalText(200),
  client: optionalText(100),
  model: optionalText(100),
}).strict();

export const getMemoryInput = z.object({
  memory_id: z.union([
    z.number().int().positive(),
    z.string().trim().min(1).max(200),
  ]),
}).strict();

export const libraryListInput = z.object({
  query: z.string().trim().min(1).max(500).optional(),
  cursor: z.string().trim().min(1).max(500).optional(),
  limit: z.number().int().min(1).max(100).default(40),
  status: z.enum(["proposed", "active", "superseded", "rejected", "archived", "all"]).default("active"),
  kind: z.enum(["memory", "directive"]).optional(),
  label: z.string().trim().min(1).max(40).optional(),
  scopeType: scopeType.optional(),
  scopeId: z.string().trim().min(1).max(200).optional(),
  sourceClient: z.string().trim().min(1).max(100).optional(),
  minimumImportance: z.number().min(0).max(1).optional(),
  createdAfter: z.iso.datetime().optional(),
  sort: z.enum(["updated", "created", "importance", "retrieval"]).default("updated"),
}).strict().refine(
  (input) => input.scopeId === undefined || (input.scopeType !== undefined && input.scopeType !== "global"),
  { path: ["scopeId"], message: "scopeId requires a non-global scopeType" },
);

const memoryLabel = z.string().trim().min(1).max(40).regex(/[\p{L}\p{N}]/u);

export const memoryLabelInput = z.object({
  label: memoryLabel,
  expectedVersion: z.number().int().positive(),
}).strict();

const libraryRecordReference = z.object({
  id: z.string().trim().min(1).max(200),
  expectedVersion: z.number().int().positive(),
}).strict();

export const libraryBulkInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("archive"), records: z.array(libraryRecordReference).min(1).max(50) }).strict(),
  z.object({ action: z.literal("restore"), records: z.array(libraryRecordReference).min(1).max(50) }).strict(),
  z.object({ action: z.literal("label"), label: memoryLabel, records: z.array(libraryRecordReference).min(1).max(50) }).strict(),
]).superRefine((input, context) => {
  const ids = new Set(input.records.map((record) => record.id));
  if (ids.size !== input.records.length) {
    context.addIssue({ code: "custom", path: ["records"], message: "Bulk records must be unique" });
  }
});

export const memoryLifecycleInput = z.object({
  expectedVersion: z.number().int().positive(),
}).strict();

export const memoryPurgeInput = z.object({
  expectedVersion: z.number().int().positive(),
  confirmation: z.string().trim().min(1).max(260),
}).strict();

export type StoreMemoryInput = z.infer<typeof storeMemoryInput>;
export type CaptureMemoryInput = z.infer<typeof captureMemoryInput>;
export type SearchMemoryInput = z.infer<typeof searchMemoryInput>;
export type ReviewListInput = z.infer<typeof reviewListInput>;
export type ReviewDecisionInput = z.infer<typeof reviewDecisionInput>;
export type MemoryFeedbackInput = z.infer<typeof memoryFeedbackInput>;
