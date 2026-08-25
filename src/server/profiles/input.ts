import { z } from "zod";

import { FACET_TYPES } from "./store";

export const facetTypeInput = z.enum(FACET_TYPES);
export const facetInput = z.object({
  content: z.string().trim().min(1).max(4_000),
  summary: z.string().trim().min(1).max(500).optional(),
  sensitivity: z.enum(["normal", "private", "sensitive"]).default("normal"),
  enabled: z.boolean().default(true),
  expectedVersion: z.number().int().positive().optional(),
}).strict();

const packFields = {
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(500).optional(),
  scopeType: z.enum(["global", "project", "repository", "client"]),
  scopeId: z.string().trim().min(1).max(200).optional(),
  facetTypes: z.array(facetTypeInput).max(FACET_TYPES.length).default([]),
  memoryIds: z.array(z.string().min(1).max(100)).max(25).default([]),
  query: z.string().trim().min(1).max(500).optional(),
  memoryLimit: z.number().int().min(0).max(10).default(5),
  directiveLimit: z.number().int().min(0).max(10).default(5),
};

export const createPackInput = z.object(packFields).strict().refine(
  (value) => value.scopeType === "global" ? value.scopeId === undefined : value.scopeId !== undefined,
  "Scoped context packs require scopeId; global packs cannot have scopeId",
);
export const updatePackInput = z.object({ ...packFields, enabled: z.boolean(), expectedVersion: z.number().int().positive() }).strict().refine(
  (value) => value.scopeType === "global" ? value.scopeId === undefined : value.scopeId !== undefined,
  "Scoped context packs require scopeId; global packs cannot have scopeId",
);
export const archiveProfileInput = z.object({ expectedVersion: z.number().int().positive(), confirm: z.literal(true) }).strict();
