import { z } from "zod";

import { CLIENT_IDS } from "./manifest";

export const clientIdInput = z.enum(CLIENT_IDS);

export const clientReceiptInput = z.object({
  clientVersion: z.string().trim().min(1).max(100).optional(),
  endpoint: z.url(),
  configuredStatus: z.enum(["unknown", "configured", "failed"]),
  authenticatedStatus: z.enum(["unknown", "authenticated", "failed", "not_supported"]),
  verifiedStatus: z.enum(["unknown", "verified", "degraded", "failed"]),
  expectedToolCount: z.number().int().min(1).max(100),
  discoveredToolCount: z.number().int().min(0).max(100).optional(),
  model: z.string().trim().min(1).max(100).optional(),
  evidence: z.string().trim().min(1).max(500).optional(),
  checkedAt: z.iso.datetime().optional(),
  expectedVersion: z.number().int().positive().optional(),
}).strict();
