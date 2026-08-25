import { z } from "zod";

const id = z.string().trim().min(1).max(100);
const requiredText = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => requiredText(max).optional();
const httpUrl = z.url().max(2_048).refine((value) => ["http:", "https:"].includes(new URL(value).protocol));
const expectedVersion = z.number().int().positive();

export const roadmapHorizon = z.enum(["next", "later", "someday"]);
export const roadmapStatus = z.enum(["suggested", "considering", "planned", "promoted", "dismissed", "archived"]);
export const editableRoadmapStatus = z.enum(["suggested", "considering", "planned", "dismissed"]);
export const roadmapImpact = z.enum(["low", "medium", "high"]);
export const roadmapEffort = z.enum(["small", "medium", "large"]);
export const roadmapSourceType = z.enum(["human", "model", "automation", "import"]);

export const roadmapListInput = z.object({
  projectId: id.optional(),
  scope: z.enum(["active", "promoted", "archived", "all"]).default("active"),
  horizon: roadmapHorizon.optional(),
  status: roadmapStatus.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
}).strict();

export const createRoadmapInput = z.object({
  projectId: id,
  title: requiredText(240),
  description: optionalText(5_000),
  horizon: roadmapHorizon.default("later"),
  impact: roadmapImpact.default("medium"),
  effort: roadmapEffort.default("medium"),
  sourceType: roadmapSourceType.default("human"),
  client: optionalText(100),
  model: optionalText(100),
  sourceUrl: httpUrl.optional(),
  correlationId: optionalText(200),
}).strict().superRefine((input, context) => {
  if (input.sourceType !== "model") return;
  if (!input.client) context.addIssue({ code: "custom", path: ["client"], message: "Model suggestions require a client" });
  if (!input.model) context.addIssue({ code: "custom", path: ["model"], message: "Model suggestions require a model" });
});

const mutationProvenance = {
  actorType: z.enum(["human", "model", "automation", "import"]).default("human"),
  client: optionalText(100),
  model: optionalText(100),
  sourceUrl: httpUrl.optional(),
  correlationId: optionalText(200),
};

export const updateRoadmapInput = z.object({
  expectedVersion,
  title: requiredText(240).optional(),
  description: z.string().trim().max(5_000).nullable().optional(),
  horizon: roadmapHorizon.optional(),
  status: editableRoadmapStatus.optional(),
  impact: roadmapImpact.optional(),
  effort: roadmapEffort.optional(),
  ...mutationProvenance,
}).strict().refine((input) => input.title !== undefined
  || input.description !== undefined
  || input.horizon !== undefined
  || input.status !== undefined
  || input.impact !== undefined
  || input.effort !== undefined, "At least one roadmap field is required");

export const archiveRoadmapInput = z.object({
  expectedVersion,
  confirm: z.literal(true),
  ...mutationProvenance,
}).strict();

export const restoreRoadmapInput = z.object({
  expectedVersion,
  ...mutationProvenance,
}).strict();

export const promoteRoadmapInput = z.object({
  expectedVersion,
  correlationId: requiredText(200),
  confirm: z.literal(true),
  actorType: z.enum(["human", "model", "automation", "import"]).default("human"),
  client: optionalText(100),
  model: optionalText(100),
  sourceUrl: httpUrl.optional(),
}).strict();

const mcpProvenance = {
  client: requiredText(100),
  model: requiredText(100),
  source_url: httpUrl.optional(),
};

export const mcpListRoadmapsInput = z.object({
  project_id: id.optional(),
  scope: z.enum(["active", "promoted", "archived", "all"]).default("active"),
  horizon: roadmapHorizon.optional(),
  status: roadmapStatus.optional(),
  limit: z.number().int().min(1).max(100).default(50),
}).strict();

export const mcpCreateRoadmapInput = z.object({
  project_id: id,
  title: requiredText(240),
  description: optionalText(5_000),
  horizon: roadmapHorizon.default("later"),
  impact: roadmapImpact.default("medium"),
  effort: roadmapEffort.default("medium"),
  correlation_id: requiredText(200),
  ...mcpProvenance,
}).strict();

export const mcpUpdateRoadmapInput = z.object({
  roadmap_id: id,
  expected_version: expectedVersion,
  title: requiredText(240).optional(),
  description: z.string().trim().max(5_000).nullable().optional(),
  horizon: roadmapHorizon.optional(),
  status: editableRoadmapStatus.optional(),
  impact: roadmapImpact.optional(),
  effort: roadmapEffort.optional(),
  correlation_id: optionalText(200),
  ...mcpProvenance,
}).strict().refine((input) => input.title !== undefined
  || input.description !== undefined
  || input.horizon !== undefined
  || input.status !== undefined
  || input.impact !== undefined
  || input.effort !== undefined, "At least one roadmap field is required");

export const mcpArchiveRoadmapInput = z.object({
  roadmap_id: id,
  expected_version: expectedVersion,
  confirm: z.literal(true),
  ...mcpProvenance,
}).strict();

export const mcpRestoreRoadmapInput = z.object({
  roadmap_id: id,
  expected_version: expectedVersion,
  ...mcpProvenance,
}).strict();

export const mcpPromoteRoadmapInput = z.object({
  roadmap_id: id,
  expected_version: expectedVersion,
  correlation_id: requiredText(200),
  confirm: z.literal(true),
  ...mcpProvenance,
}).strict();
