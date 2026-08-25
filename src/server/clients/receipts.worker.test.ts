import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import type { Env } from "../env";
import { ClientCompatibilityStore } from "./receipts";

const testEnv = env as unknown as Env;
const ownerId = "client-receipt-owner";

beforeEach(async () => {
  const now = new Date().toISOString();
  await testEnv.DB.prepare(
    "INSERT OR IGNORE INTO users (id, github_login, created_at, updated_at) VALUES (?, ?, ?, ?)",
  ).bind(ownerId, ownerId, now, now).run();
  await testEnv.DB.prepare("DELETE FROM client_compatibility_receipts WHERE owner_id = ?").bind(ownerId).run();
});

describe("client compatibility receipts", () => {
  it("keeps configured, authenticated and verified as independent versioned states", async () => {
    const store = new ClientCompatibilityStore(testEnv.DB);
    const created = await store.record({
      ownerId,
      clientId: "codex",
      endpoint: "https://memory.example.com/mcp",
      configuredStatus: "configured",
      authenticatedStatus: "unknown",
      verifiedStatus: "unknown",
      expectedToolCount: 24,
      evidence: "Registration command completed; OAuth not yet run.",
    });
    const verified = await store.record({
      ownerId,
      clientId: "codex",
      endpoint: created.endpoint,
      configuredStatus: "configured",
      authenticatedStatus: "authenticated",
      verifiedStatus: "verified",
      expectedToolCount: 24,
      discoveredToolCount: 24,
      evidence: "Health and board canaries passed.",
      expectedVersion: created.version,
    });

    expect(verified).toMatchObject({ configuredStatus: "configured", authenticatedStatus: "authenticated", verifiedStatus: "verified", version: 2 });
    await expect(store.record({
      ownerId,
      clientId: "codex",
      endpoint: created.endpoint,
      configuredStatus: "failed",
      authenticatedStatus: "failed",
      verifiedStatus: "failed",
      expectedToolCount: 24,
      expectedVersion: 1,
    })).rejects.toThrow("version");
  });
});
