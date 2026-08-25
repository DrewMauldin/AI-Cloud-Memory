import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { CapabilityReceiptStore } from "./receipts";

const ownerId = "receipt-owner";

beforeEach(async () => {
  await env.DB.prepare("INSERT OR IGNORE INTO users (id, github_login, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .bind(ownerId, "receipt-owner", "2026-08-24T00:00:00.000Z", "2026-08-24T00:00:00.000Z").run();
  await env.DB.prepare("DELETE FROM capability_receipts WHERE owner_id = ?").bind(ownerId).run();
});

describe("CapabilityReceiptStore", () => {
  it("keeps only the latest bounded receipt for each capability", async () => {
    const store = new CapabilityReceiptStore(env.DB, () => "2026-08-24T01:00:00.000Z");
    await store.record({ ownerId, capability: "d1", status: "verified", detail: "SELECT 1 passed", source: "health" });
    const updated = await store.record({ ownerId, capability: "d1", status: "degraded", detail: "Latency exceeded canary threshold", source: "live canary", checkedAt: "2026-08-24T00:30:00.000Z" });
    expect(updated.version).toBe(2);
    expect(await store.list(ownerId)).toMatchObject([{ capability: "d1", status: "degraded", checkedAt: "2026-08-24T00:30:00.000Z" }]);
  });

  it("rejects future evidence dates without replacing the last verified receipt", async () => {
    const store = new CapabilityReceiptStore(env.DB, () => "2026-08-24T01:00:00.000Z");
    await store.record({ ownerId, capability: "d1", status: "verified", detail: "SELECT 1 passed", source: "health" });

    await expect(store.record({
      ownerId,
      capability: "d1",
      status: "failed",
      detail: "Fabricated future canary",
      source: "live canary",
      checkedAt: "2026-08-25T01:00:00.000Z",
    })).rejects.toThrow("Receipt checked time cannot be in the future");

    expect(await store.list(ownerId)).toMatchObject([{
      capability: "d1",
      status: "verified",
      checkedAt: "2026-08-24T01:00:00.000Z",
      version: 1,
    }]);
  });

  it("does not return another owner's evidence", async () => {
    const store = new CapabilityReceiptStore(env.DB);
    expect(await store.list("other-owner")).toEqual([]);
  });
});
