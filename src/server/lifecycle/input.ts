import { z } from "zod";

const optionalId = z.string().trim().min(1).max(100).optional();
const optionalText = (max: number) => z.string().trim().min(1).max(max).optional();
const httpUrl = z
  .url()
  .max(2_048)
  .refine((value) => ["http:", "https:"].includes(new URL(value).protocol));

export const contextBriefInput = z.object({
  query: z.string().trim().min(1).max(2_000),
  project_id: optionalId,
  task_id: optionalId,
  context_pack_id: optionalId,
  memory_limit: z.number().int().min(1).max(10).default(5),
  project_limit: z.number().int().min(1).max(10).default(5),
  task_limit: z.number().int().min(1).max(25).default(10),
  roadmap_limit: z.number().int().min(1).max(10).default(5),
}).strict().refine(
  (input) => !(input.project_id && input.task_id),
  "Specify project_id or task_id, not both",
);

const lifecycleMutation = {
  task_id: z.string().trim().min(1).max(100),
  expected_version: z.number().int().positive(),
  client: z.string().trim().min(1).max(100),
  model: z.string().trim().min(1).max(100),
  correlation_id: optionalText(200),
  source_url: httpUrl.optional(),
  note: optionalText(1_000),
};

export const taskStartInput = z.object(lifecycleMutation).strict();

export const taskFinishInput = z.object({
  ...lifecycleMutation,
  status: z.enum(["done", "review", "blocked"]),
}).strict();
