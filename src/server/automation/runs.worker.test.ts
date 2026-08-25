import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import type { Env } from "../env";
import { AutomationRunStore } from "./runs";

const testEnv = env as unknown as Env;
const ownerId = "automation-run-owner";

beforeEach(async () => {
  const now = new Date().toISOString();
  await testEnv.DB.prepare(
    `INSERT OR IGNORE INTO users (id, github_login, created_at, updated_at)
     VALUES (?, ?, ?, ?)`,
  ).bind(ownerId, ownerId, now, now).run();
});

describe("AutomationRunStore", () => {
  it("claims one scheduled intent and replays the same run", async () => {
    const store = new AutomationRunStore(testEnv.DB);
    const first = await store.claim({
      ownerId,
      operation: "obsidian_projection",
      triggerType: "scheduled",
      idempotencyKey: "projection:2026-08-25T02",
      targetType: "webdav",
      scheduledFor: "2026-08-25T02:00:00.000Z",
    });
    const replay = await store.claim({
      ownerId,
      operation: "obsidian_projection",
      triggerType: "scheduled",
      idempotencyKey: "projection:2026-08-25T02",
      targetType: "webdav",
      scheduledFor: "2026-08-25T02:00:00.000Z",
    });

    expect(first.replayed).toBe(false);
    expect(replay).toMatchObject({ replayed: true, run: { id: first.run.id, status: "running" } });
  });

  it("records bounded success evidence and prevents cross-owner completion", async () => {
    const store = new AutomationRunStore(testEnv.DB);
    const claimed = await store.claim({
      ownerId,
      operation: "reflection",
      triggerType: "manual",
      idempotencyKey: `reflection:${crypto.randomUUID()}`,
      targetType: "d1",
    });
    const completed = await store.complete({
      ownerId,
      runId: claimed.run.id,
      status: "succeeded",
      itemCount: 4,
      contentSha256: "a".repeat(64),
    });

    expect(completed).toMatchObject({ status: "succeeded", itemCount: 4, version: 2 });
    await expect(store.complete({
      ownerId: "another-owner",
      runId: claimed.run.id,
      status: "failed",
      itemCount: 0,
      errorClass: "ShouldNotApply",
    })).rejects.toThrow("not found");
  });
});
