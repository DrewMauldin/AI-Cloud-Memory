import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { applyTrueMemoryImport, dryRunTrueMemoryImport, sha256Text } from "./truememory";

const ownerId = "123456789";

async function source(records: string[], snapshotSha256 = "a".repeat(64)): Promise<string> {
  const payload = records.length ? `${records.join("\n")}\n` : "";
  return [
    JSON.stringify({
      type: "manifest",
      schemaVersion: 2,
      sourceSystem: "truememory",
      snapshotSha256,
      payloadSha256: await sha256Text(payload),
      recordCount: records.length,
      exportedAt: "2026-08-23T00:00:00.000Z",
    }),
    ...records,
  ].join("\n") + "\n";
}

function record(sourceMemoryId: string, content: string): string {
  return JSON.stringify({
    type: "memory",
    sourceMemoryId,
    content,
    directive: false,
    timestamp: "2026-08-23T00:00:00.000Z",
    sender: "Codex",
    recipient: "Owner",
    category: "project",
    modality: "text",
    metadata: {},
  });
}

describe("TrueMemory dry-run and apply", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM import_items").run();
    await env.DB.prepare("DELETE FROM import_runs").run();
    await env.DB.prepare("DELETE FROM memory_events").run();
    await env.DB.prepare("DELETE FROM memories").run();
    await env.DB.prepare("DELETE FROM users").run();
    await env.DB.prepare(
      `INSERT INTO users (id, github_login, created_at, updated_at) VALUES (?, 'community-owner', ?, ?)`,
    ).bind(ownerId, "2026-08-23T00:00:00.000Z", "2026-08-23T00:00:00.000Z").run();
    await env.DB.prepare(
      `INSERT INTO memories (
        id, owner_id, kind, content, content_sha256, source_system, source_id, created_at, updated_at
      ) VALUES ('existing_1', ?, 'memory', 'Already here', ?, 'truememory', '1', ?, ?),
               ('existing_5', ?, 'memory', 'Old content', ?, 'truememory', '5', ?, ?)`,
    ).bind(
      ownerId, await sha256Text("Already here"), "2026-08-23T00:00:00.000Z", "2026-08-23T00:00:00.000Z",
      ownerId, await sha256Text("Old content"), "2026-08-23T00:00:00.000Z", "2026-08-23T00:00:00.000Z",
    ).run();
  });

  it("classifies without writing memories and applies only safe new records once", async () => {
    const jsonl = await source([
      record("1", "Already here"),
      record("2", "Already here"),
      record("3", "password = super-secret-value"),
      "{malformed",
      record("4", "A safe new memory"),
      record("5", "Changed content"),
    ]);
    const before = await env.DB.prepare("SELECT COUNT(*) AS count FROM memories").first<{ count: number }>();
    const dryRun = await dryRunTrueMemoryImport({ database: env.DB, ownerId, jsonl, newId: () => crypto.randomUUID() });

    expect(dryRun.counts).toMatchObject({
      new: 1,
      duplicate: 1,
      probableDuplicate: 1,
      sensitive: 1,
      malformed: 1,
      conflict: 1,
    });
    const afterDryRun = await env.DB.prepare("SELECT COUNT(*) AS count FROM memories").first<{ count: number }>();
    expect(afterDryRun?.count).toBe(before?.count);

    const imported: string[] = [];
    const approvedBatch = [JSON.parse(record("4", "A safe new memory"))];
    const apply = await applyTrueMemoryImport({
      database: env.DB,
      ownerId,
      runId: dryRun.runId,
      manifestSha256: dryRun.manifestSha256,
      records: approvedBatch,
      store: async (memory) => {
        imported.push(memory.content);
        const id = `target-${memory.sourceId}`;
        await env.DB.prepare(
          `INSERT INTO memories (
            id, owner_id, kind, content, content_sha256, source_system, source_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'truememory', ?, ?, ?)`,
        ).bind(
          id,
          ownerId,
          memory.directive ? "directive" : "memory",
          memory.content,
          await sha256Text(memory.content),
          memory.sourceId,
          "2026-08-23T00:00:00.000Z",
          "2026-08-23T00:00:00.000Z",
        ).run();
        return id;
      },
    });
    expect(apply).toMatchObject({ imported: 1, remaining: 0, failed: 0, completed: true });
    expect(imported).toEqual(["A safe new memory"]);

    const replay = await applyTrueMemoryImport({
      database: env.DB,
      ownerId,
      runId: dryRun.runId,
      manifestSha256: dryRun.manifestSha256,
      records: approvedBatch,
      store: async () => { throw new Error("replay must not write"); },
    });
    expect(replay).toMatchObject({ imported: 0, remaining: 0, completed: true });
  });

  it("quarantines duplicate source IDs and rebuilds an interrupted dry-run receipt", async () => {
    const jsonl = await source([
      record("7", "First version"),
      record("7", "Duplicated source identifier"),
    ]);
    const first = await dryRunTrueMemoryImport({ database: env.DB, ownerId, jsonl });
    expect(first.counts).toMatchObject({ examined: 2, new: 1, malformed: 1 });

    await env.DB.prepare(
      "DELETE FROM import_items WHERE run_id = ? AND outcome = 'malformed'",
    ).bind(first.runId).run();
    const repaired = await dryRunTrueMemoryImport({ database: env.DB, ownerId, jsonl });
    const itemCount = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM import_items WHERE run_id = ?",
    ).bind(repaired.runId).first<{ count: number }>();

    expect(repaired.counts).toMatchObject({ examined: 2, new: 1, malformed: 1 });
    expect(itemCount?.count).toBe(2);
  });

  it("detects an imported source identifier across later snapshots", async () => {
    const firstJsonl = await source([record("9", "Canonical source casing")]);
    const first = await dryRunTrueMemoryImport({ database: env.DB, ownerId, jsonl: firstJsonl });
    await applyTrueMemoryImport({
      database: env.DB,
      ownerId,
      runId: first.runId,
      manifestSha256: first.manifestSha256,
      records: [JSON.parse(record("9", "Canonical source casing"))],
      store: async (memory) => {
        expect(memory.source).toBe("truememory");
        await env.DB.prepare(
          `INSERT INTO memories (
            id, owner_id, kind, content, content_sha256, source_system, source_id, created_at, updated_at
          ) VALUES ('target-9', ?, 'memory', ?, ?, ?, ?, ?, ?)`,
        ).bind(ownerId, memory.content, await sha256Text(memory.content), memory.source, memory.sourceId,
          "2026-08-23T00:00:00.000Z", "2026-08-23T00:00:00.000Z").run();
        return "target-9";
      },
    });

    const replayJsonl = await source([record("9", "Canonical source casing")], "b".repeat(64));
    const replay = await dryRunTrueMemoryImport({ database: env.DB, ownerId, jsonl: replayJsonl });
    expect(replay.counts).toMatchObject({ duplicate: 1, new: 0 });
  });

  it("rejects a payload whose content no longer matches its digest", async () => {
    const jsonl = await source([record("10", "Untampered")]);
    await expect(dryRunTrueMemoryImport({
      database: env.DB,
      ownerId,
      jsonl: jsonl.replace("Untampered", "Tampered"),
    })).rejects.toThrow("payload checksum");
  });

  it("rejects apply content that does not match the approved record hash", async () => {
    const jsonl = await source([record("12", "Approved batch content")]);
    const dryRun = await dryRunTrueMemoryImport({ database: env.DB, ownerId, jsonl });

    await expect(applyTrueMemoryImport({
      database: env.DB,
      ownerId,
      runId: dryRun.runId,
      manifestSha256: dryRun.manifestSha256,
      records: [JSON.parse(record("12", "Changed after approval"))],
      store: async () => { throw new Error("tampered content must not write"); },
    })).rejects.toThrow("does not match the approved dry run");
  });

  it("rejects apply metadata or directive changes after approval", async () => {
    const approved = JSON.parse(record("13", "Approved record fields"));
    approved.metadata = { client: "original-client", conversation_id: "conversation-1" };
    const jsonl = await source([JSON.stringify(approved)]);
    const dryRun = await dryRunTrueMemoryImport({ database: env.DB, ownerId, jsonl });

    await expect(applyTrueMemoryImport({
      database: env.DB,
      ownerId,
      runId: dryRun.runId,
      manifestSha256: dryRun.manifestSha256,
      records: [{ ...approved, directive: true }],
      store: async () => { throw new Error("tampered directive must not write"); },
    })).rejects.toThrow("does not match the approved dry run");

    await expect(applyTrueMemoryImport({
      database: env.DB,
      ownerId,
      runId: dryRun.runId,
      manifestSha256: dryRun.manifestSha256,
      records: [{ ...approved, metadata: { ...approved.metadata, client: "changed-client" } }],
      store: async () => { throw new Error("tampered metadata must not write"); },
    })).rejects.toThrow("does not match the approved dry run");
  });

  it("reclassifies a source that changes after dry-run instead of accepting stale content", async () => {
    const jsonl = await source([record("11", "Approved content")], "c".repeat(64));
    const dryRun = await dryRunTrueMemoryImport({ database: env.DB, ownerId, jsonl });
    await env.DB.prepare(
      `INSERT INTO memories (
        id, owner_id, kind, content, content_sha256, source_system, source_id, created_at, updated_at
      ) VALUES ('changed-11', ?, 'memory', 'Changed elsewhere', ?, 'truememory', '11', ?, ?)`,
    ).bind(ownerId, await sha256Text("Changed elsewhere"),
      "2026-08-23T00:00:00.000Z", "2026-08-23T00:00:00.000Z").run();

    const result = await applyTrueMemoryImport({
      database: env.DB,
      ownerId,
      runId: dryRun.runId,
      manifestSha256: dryRun.manifestSha256,
      records: [JSON.parse(record("11", "Approved content"))],
      store: async () => { throw new Error("conflict must not write"); },
    });
    const item = await env.DB.prepare(
      "SELECT outcome, reason_code FROM import_items WHERE run_id = ? AND source_memory_id = '11'",
    ).bind(dryRun.runId).first<Record<string, string>>();

    expect(result).toMatchObject({ imported: 0, remaining: 0, failed: 0, completed: true });
    expect(item).toEqual({ outcome: "conflict", reason_code: "source_changed_after_dry_run" });
  });
});
