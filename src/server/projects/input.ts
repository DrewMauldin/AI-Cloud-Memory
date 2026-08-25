import { z } from "zod";

const optionalText = (max: number) => z.string().trim().min(1).max(max).optional();
const httpUrl = z
  .url()
  .max(2_048)
  .refine((value) => ["http:", "https:"].includes(new URL(value).protocol));

export const taskStatus = z.enum([
  "inbox",
  "planned",
  "in_progress",
  "blocked",
  "review",
  "done",
]);

export const createProjectInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: optionalText(2_000),
    colour: z.string().regex(/^#[0-9a-f]{6}$/i).default("#c9ff3b"),
    sourceUrl: httpUrl.optional(),
  })
  .strict();

export const createTaskInput = z
  .object({
    projectId: z.string().min(1).max(100),
    title: z.string().trim().min(1).max(240),
    description: optionalText(5_000),
    priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
    dueAt: z.iso.datetime().optional(),
    sourceType: z.enum(["human", "model", "automation", "import"]).default("human"),
    client: optionalText(100),
    model: optionalText(100),
    sourceUrl: httpUrl.optional(),
  })
  .strict();

export const moveTaskInput = z
  .object({
    status: taskStatus,
    expectedVersion: z.number().int().positive(),
    position: z.number().finite().min(0).optional(),
    actorType: z.enum(["human", "model", "automation", "import"]).default("human"),
    client: optionalText(100),
    model: optionalText(100),
    sourceUrl: httpUrl.optional(),
    note: optionalText(500),
  })
  .strict();

const mutationProvenance = {
  actorType: z.enum(["human", "model", "automation", "import"]).default("human"),
  client: optionalText(100),
  model: optionalText(100),
  sourceUrl: httpUrl.optional(),
  note: optionalText(500),
};

export const updateProjectInput = z.object({
  expectedVersion: z.number().int().positive(),
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2_000).nullable().optional(),
  colour: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  status: z.enum(["active", "paused", "completed"]).optional(),
}).strict().refine(
  (input) => input.name !== undefined || input.description !== undefined || input.colour !== undefined || input.status !== undefined,
  "At least one project field is required",
);

export const updateTaskInput = z.object({
  expectedVersion: z.number().int().positive(),
  title: z.string().trim().min(1).max(240).optional(),
  description: z.string().trim().max(5_000).nullable().optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  dueAt: z.iso.datetime().nullable().optional(),
  blockerSummary: z.string().trim().max(1_000).nullable().optional(),
  ...mutationProvenance,
}).strict().refine(
  (input) => input.title !== undefined || input.description !== undefined || input.priority !== undefined || input.dueAt !== undefined || input.blockerSummary !== undefined,
  "At least one task field is required",
);

export const archiveRecordInput = z.object({
  expectedVersion: z.number().int().positive(),
  confirm: z.literal(true),
  ...mutationProvenance,
}).strict();
