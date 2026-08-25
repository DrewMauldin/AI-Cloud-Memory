import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import type { Env } from "../env";
import { ConnectorRunStore } from "./runs";

const testEnv = env as unknown as Env;
const ownerId = "connector-run-owner";

beforeEach(async () => {
  const now = new Date().toISOString();
  await testEnv.DB.prepare(
    `INSERT OR IGNORE INTO users (id, github_login, created_at, updated_at) VALUES (?, ?, ?, ?)`,
  ).bind(ownerId, ownerId, now, now).run();
});

describe("connector run receipts", () => {
  it("binds an apply to the owner, version and approved preview hash", async () => {
    const store = new ConnectorRunStore(testEnv.DB);
    const preview = await store.createPreview({
      ownerId,
      adapterId: "markdown_bundle",
      sourceRef: "notes",
      inputSha256: "a".repeat(64),
      previewSha256: "b".repeat(64),
      examinedCount: 2,
    });
    const applying = await store.startApply({
      ownerId,
      runId: preview.id,
      expectedVersion: preview.version,
      previewSha256: "b".repeat(64),
    });
    const completed = await store.complete({
      ownerId,
      runId: preview.id,
      expectedVersion: applying.version,
      importedCount: 1,
      duplicateCount: 1,
      rejectedCount: 0,
    });

    expect(completed).toMatchObject({ status: "completed", importedCount: 1, duplicateCount: 1, version: 3 });
    await expect(store.startApply({
      ownerId: "another-owner",
      runId: preview.id,
      expectedVersion: 1,
      previewSha256: "b".repeat(64),
    })).rejects.toThrow("not found");
  });

  it("rejects a changed preview or stale optimistic version", async () => {
    const store = new ConnectorRunStore(testEnv.DB);
    const preview = await store.createPreview({
      ownerId,
      adapterId: "cloud_memory_jsonl",
      inputSha256: "c".repeat(64),
      previewSha256: "d".repeat(64),
      examinedCount: 1,
    });

    await expect(store.startApply({
      ownerId,
      runId: preview.id,
      expectedVersion: preview.version,
      previewSha256: "e".repeat(64),
    })).rejects.toThrow("does not match");
    await expect(store.startApply({
      ownerId,
      runId: preview.id,
      expectedVersion: 99,
      previewSha256: "d".repeat(64),
    })).rejects.toThrow("version");
  });
});
