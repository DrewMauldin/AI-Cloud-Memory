import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { decryptExport } from "./crypto";
import { assertSnapshotWithinLimits, generateEncryptedSnapshot } from "./snapshot";

const ownerId = "123456789";
const key = "ab".repeat(32);

describe("canonical encrypted snapshots", () => {
  it("rejects snapshots that exceed the bounded Worker envelope", () => {
    expect(() => assertSnapshotWithinLimits(10_001, 1)).toThrow("bounded Worker export limit");
    expect(() => assertSnapshotWithinLimits(1, 12_000_001)).toThrow("bounded Worker export limit");
  });
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM export_runs").run();
    await env.DB.prepare("DELETE FROM memory_events").run();
    await env.DB.prepare("DELETE FROM memories").run();
    await env.DB.prepare("DELETE FROM users").run();
    await env.DB.prepare(
      `INSERT INTO users (id, github_login, created_at, updated_at) VALUES (?, 'community-owner', ?, ?)`,
    ).bind(ownerId, "2026-08-23T00:00:00.000Z", "2026-08-23T00:00:00.000Z").run();
    await env.DB.prepare(
      `INSERT INTO memories (id, owner_id, kind, content, content_sha256, created_at, updated_at)
       VALUES ('memory_1', ?, 'memory', 'Remember this', 'hash', ?, ?)`,
    ).bind(ownerId, "2026-08-23T00:00:00.000Z", "2026-08-23T00:00:00.000Z").run();
  });

  it("exports owner-scoped canonical rows and records an encrypted receipt", async () => {
    const result = await generateEncryptedSnapshot({
      database: env.DB,
      ownerId,
      keyHex: key,
      repository: "community-owner/ai-cloud-memory",
      now: () => "2026-08-23T03:00:00.000Z",
      newId: () => "run_12345678",
    });

    expect(result.path).toBe("exports/2026-08-23/cloud-memory-20260823030000000-run_1234.enc.json");
    const plaintext = await decryptExport(result.envelope, key);
    expect(plaintext).toContain("Remember this");
    const receipt = await env.DB.prepare(
      "SELECT status, record_count, repository_path FROM export_runs WHERE id = ?",
    ).bind(result.runId).first<Record<string, unknown>>();
    expect(receipt).toEqual({
      status: "encrypted",
      record_count: 1,
      repository_path: result.path,
    });
  });
});
