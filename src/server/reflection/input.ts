import { z } from "zod";

export const reflectionListInput = z.object({
  status: z.enum(["open", "kept", "dismissed", "applied"]).default("open"),
  limit: z.coerce.number().int().min(1).max(200).default(100),
}).strict();

export const reflectionDecisionInput = z.object({
  expectedVersion: z.number().int().positive(),
  decision: z.enum(["kept", "dismissed"]),
}).strict();

export const reflectionArchiveInput = z.object({
  expectedProposalVersion: z.number().int().positive(),
  expectedMemoryVersion: z.number().int().positive(),
  confirm: z.literal(true),
}).strict();
