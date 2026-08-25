import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import type { Env } from "../env";
import { MemoryStore } from "../memory/store";
import { ReflectionStore } from "./store";

const testEnv = env as unknown as Env;
const ownerId = "reflection-owner";

beforeEach(async () => {
  const now = new Date().toISOString();
  await testEnv.DB.prepare(
    "INSERT OR IGNORE INTO users (id, github_login, created_at, updated_at) VALUES (?, ?, ?, ?)",
  ).bind(ownerId, ownerId, now, now).run();
  await testEnv.DB.prepare("DELETE FROM reflection_proposals WHERE owner_id = ?").bind(ownerId).run();
  await testEnv.DB.prepare("DELETE FROM memory_events WHERE owner_id = ?").bind(ownerId).run();
  await testEnv.DB.prepare("DELETE FROM memories WHERE owner_id = ?").bind(ownerId).run();
});

describe("proposal-only reflection", () => {
  it("finds expiry and duplicate candidates without mutating canonical memory", async () => {
    const memories = new MemoryStore(testEnv.DB);
    const first = await memories.create({ ownerId, content: "Duplicate durable fact", expiresAt: "2026-01-01T00:00:00.000Z" });
    await memories.create({ ownerId, content: "Duplicate durable fact", source: "another-source", sourceId: "duplicate-2" });
    const reflection = new ReflectionStore(testEnv.DB, () => "2026-08-25T00:00:00.000Z");
    const result = await reflection.run(ownerId);
    const unchanged = await memories.getById(ownerId, first.id);

    expect(result.proposals.map((proposal) => proposal.proposalType)).toEqual(expect.arrayContaining(["exact_duplicate", "expiry_review"]));
    expect(unchanged).toMatchObject({ status: "active", version: first.version });
  });

  it("version-checks keep and dismiss decisions", async () => {
    const memories = new MemoryStore(testEnv.DB);
    await memories.create({ ownerId, content: "Expired fact", expiresAt: "2026-01-01T00:00:00.000Z" });
    const reflection = new ReflectionStore(testEnv.DB, () => "2026-08-25T00:00:00.000Z");
    const proposal = (await reflection.run(ownerId)).proposals[0]!;
    const kept = await reflection.decide(ownerId, proposal.id, proposal.version, "kept");

    expect(kept.status).toBe("kept");
    await expect(reflection.decide(ownerId, proposal.id, proposal.version, "dismissed")).rejects.toThrow("version");
  });

  it("finds stale dynamic records beyond the newest 200 memories", async () => {
    const recent = Array.from({ length: 205 }, (_, index) => testEnv.DB.prepare(
      `INSERT INTO memories (id, owner_id, kind, content, content_sha256, status, retention_tier, created_at, updated_at)
       VALUES (?, ?, 'memory', ?, ?, 'active', 'durable', ?, ?)`,
    ).bind(`recent-${index}`, ownerId, `Recent fact ${index}`, `recent-hash-${index}`, "2026-08-24T00:00:00.000Z", "2026-08-24T00:00:00.000Z"));
    for (let offset = 0; offset < recent.length; offset += 50) await testEnv.DB.batch(recent.slice(offset, offset + 50));
    await testEnv.DB.prepare(
      `INSERT INTO memories (id, owner_id, kind, content, content_sha256, status, retention_tier, created_at, updated_at)
       VALUES (?, ?, 'memory', ?, ?, 'active', 'dynamic', ?, ?)`,
    ).bind("old-dynamic", ownerId, "Old dynamic fact", "old-dynamic-hash", "2025-01-01T00:00:00.000Z", "2025-01-01T00:00:00.000Z").run();

    const result = await new ReflectionStore(testEnv.DB, () => "2026-08-25T00:00:00.000Z").run(ownerId);

    expect(result.examined).toBe(206);
    expect(result.proposals).toContainEqual(expect.objectContaining({
      proposalType: "stale_dynamic",
      primaryMemoryId: "old-dynamic",
    }));
  });
});
