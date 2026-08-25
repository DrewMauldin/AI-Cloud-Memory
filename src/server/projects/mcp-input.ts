import { z } from "zod";

const id = z.string().trim().min(1).max(100);
const requiredText = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => requiredText(max).optional();
const httpUrl = z
  .url()
  .max(2_048)
  .refine((value) => ["http:", "https:"].includes(new URL(value).protocol));
const expectedVersion = z.number().int().positive();
const projectStatus = z.enum(["active", "paused", "completed"]);
const taskStatus = z.enum(["inbox", "planned", "in_progress", "blocked", "review", "done"]);
const taskPriority = z.enum(["low", "medium", "high", "urgent"]);
const taskProvenance = {
  client: requiredText(100),
  model: requiredText(100),
  source_url: httpUrl.optional(),
  note: optionalText(500),
};

export const mcpBoardInput = z.object({
  task_limit: z.number().int().min(1).max(100).default(100),
}).strict();

export const mcpCreateProjectInput = z.object({
  name: requiredText(120),
  description: optionalText(2_000),
  colour: z.string().regex(/^#[0-9a-f]{6}$/i).default("#c9ff3b"),
  source_url: httpUrl.optional(),
}).strict();

export const mcpUpdateProjectInput = z.object({
  project_id: id,
  expected_version: expectedVersion,
  name: requiredText(120).optional(),
  description: z.string().trim().max(2_000).nullable().optional(),
  colour: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  status: projectStatus.optional(),
}).strict().refine(
  (input) => input.name !== undefined
    || input.description !== undefined
    || input.colour !== undefined
    || input.status !== undefined,
  "At least one project field is required",
);

export const mcpArchiveProjectInput = z.object({
  project_id: id,
  expected_version: expectedVersion,
  confirm: z.literal(true),
}).strict();

export const mcpGetTaskInput = z.object({ task_id: id }).strict();

export const mcpCreateTaskInput = z.object({
  project_id: id,
  title: requiredText(240),
  description: optionalText(5_000),
  priority: taskPriority.default("medium"),
  due_at: z.iso.datetime().optional(),
  client: requiredText(100),
  model: requiredText(100),
  source_url: httpUrl.optional(),
}).strict();

export const mcpUpdateTaskInput = z.object({
  task_id: id,
  expected_version: expectedVersion,
  title: requiredText(240).optional(),
  description: z.string().trim().max(5_000).nullable().optional(),
  priority: taskPriority.optional(),
  due_at: z.iso.datetime().nullable().optional(),
  blocker_summary: z.string().trim().max(1_000).nullable().optional(),
  ...taskProvenance,
}).strict().refine(
  (input) => input.title !== undefined
    || input.description !== undefined
    || input.priority !== undefined
    || input.due_at !== undefined
    || input.blocker_summary !== undefined,
  "At least one task field is required",
);

export const mcpMoveTaskInput = z.object({
  task_id: id,
  expected_version: expectedVersion,
  status: taskStatus,
  position: z.number().finite().min(0).optional(),
  correlation_id: optionalText(200),
  ...taskProvenance,
}).strict();

export const mcpArchiveTaskInput = z.object({
  task_id: id,
  expected_version: expectedVersion,
  confirm: z.literal(true),
  ...taskProvenance,
}).strict();
