import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../env";
import type { OwnerProjection } from "./projection";
import { runNativeAutomation } from "./scheduler";

const testEnv = env as unknown as Env;
const ownerId = "scheduled-automation-owner";
const projection: OwnerProjection = {
  schemaVersion: 2,
  mode: "managed-read-only",
  generatedAt: "2026-08-25T02:11:00.000Z",
  files: [
    { path: "Cloud Memory/README.md", content: "# Cloud Memory\n", sha256: "a".repeat(64) },
    { path: "Cloud Memory/manifest.json", content: "{}\n", sha256: "b".repeat(64) },
  ],
};

beforeEach(async () => {
  const now = new Date().toISOString();
  await testEnv.DB.prepare(
    `INSERT OR IGNORE INTO users (id, github_login, created_at, updated_at)
     VALUES (?, ?, ?, ?)`,
  ).bind(ownerId, ownerId, now, now).run();
});

describe("native scheduled automation", () => {
  it("delivers one manifest-last projection and replays without a second delivery", async () => {
    const buildProjection = vi.fn(async () => projection);
    const deliverProjection = vi.fn(async () => ({ fileCount: 2, manifestPath: "Cloud Memory/manifest.json" }));
    const automationEnv = {
      ...testEnv,
      ALLOWED_GITHUB_USER_ID: ownerId,
      NATIVE_AUTOMATION_ENABLED: "true",
      PROJECTION_WEBDAV_BASE_URL: "https://dav.example.com/vault/",
      PROJECTION_WEBDAV_USERNAME: "owner",
      PROJECTION_WEBDAV_PASSWORD: "secret",
    } as Env;

    const first = await runNativeAutomation({
      env: automationEnv,
      cron: "11 * * * *",
      scheduledTime: Date.parse("2026-08-25T02:11:00.000Z"),
      dependencies: { buildProjection, deliverProjection },
    });
    const replay = await runNativeAutomation({
      env: automationEnv,
      cron: "11 * * * *",
      scheduledTime: Date.parse("2026-08-25T02:11:00.000Z"),
      dependencies: { buildProjection, deliverProjection },
    });

    expect(first).toMatchObject({ status: "succeeded", operation: "obsidian_projection", itemCount: 2 });
    expect(replay).toMatchObject({ status: "succeeded", replayed: true });
    expect(buildProjection).toHaveBeenCalledTimes(1);
    expect(deliverProjection).toHaveBeenCalledTimes(1);
  });

  it("fails closed when disabled or when credentials are incomplete", async () => {
    const dependencies = {
      buildProjection: vi.fn(async () => projection),
      deliverProjection: vi.fn(async () => ({ fileCount: 2, manifestPath: "Cloud Memory/manifest.json" })),
    };
    const disabled = await runNativeAutomation({
      env: { ...testEnv, ALLOWED_GITHUB_USER_ID: ownerId, NATIVE_AUTOMATION_ENABLED: "false" } as Env,
      cron: "11 * * * *",
      scheduledTime: Date.parse("2026-08-25T03:11:00.000Z"),
      dependencies,
    });
    const incomplete = await runNativeAutomation({
      env: { ...testEnv, ALLOWED_GITHUB_USER_ID: ownerId, NATIVE_AUTOMATION_ENABLED: "true" } as Env,
      cron: "11 * * * *",
      scheduledTime: Date.parse("2026-08-25T04:11:00.000Z"),
      dependencies,
    });

    expect(disabled).toMatchObject({ status: "skipped", reason: "disabled" });
    expect(incomplete).toMatchObject({ status: "skipped", reason: "webdav_not_configured" });
    expect(dependencies.buildProjection).not.toHaveBeenCalled();
  });

  it("pushes one encrypted daily snapshot with a separately scoped token", async () => {
    const generateSnapshot = vi.fn(async () => ({
      runId: "export-run-1",
      path: "exports/2026-08-25/cloud-memory.enc.json",
      encrypted: "{\"algorithm\":\"AES-256-GCM\"}\n",
      recordCount: 12,
      contentSha256: "d".repeat(64),
    }));
    const pushExport = vi.fn(async () => ({ commitSha: "commit-sha" }));
    const markExportPushed = vi.fn(async (...arguments_: [D1Database, string, string, string]) => {
      void arguments_;
    });
    const result = await runNativeAutomation({
      env: {
        ...testEnv,
        ALLOWED_GITHUB_USER_ID: ownerId,
        NATIVE_AUTOMATION_ENABLED: "true",
        EXPORT_ENCRYPTION_KEY: "1".repeat(64),
        GITHUB_EXPORT_TOKEN: "configured-in-secret-store",
        GITHUB_EXPORT_REPOSITORY: "owner/private-backup",
      } as Env,
      cron: "23 2 * * *",
      scheduledTime: Date.parse("2026-08-25T02:23:00.000Z"),
      dependencies: { generateSnapshot, pushExport, markExportPushed },
    });

    expect(result).toMatchObject({ operation: "encrypted_export", status: "succeeded", itemCount: 12 });
    expect(generateSnapshot).toHaveBeenCalledTimes(1);
    expect(pushExport).toHaveBeenCalledTimes(1);
    expect(markExportPushed).toHaveBeenCalledTimes(1);
    const markArguments = markExportPushed.mock.calls[0]!;
    expect(markArguments[0]).toBe(testEnv.DB);
    expect(markArguments.slice(1)).toEqual([ownerId, "export-run-1", "commit-sha"]);
  });

  it("creates proposal-only reflection receipts on the weekly schedule", async () => {
    const runReflection = vi.fn(async () => ({ examined: 40, proposals: [{ id: "proposal-1" }], truncated: false }));
    const result = await runNativeAutomation({
      env: { ...testEnv, ALLOWED_GITHUB_USER_ID: ownerId, NATIVE_AUTOMATION_ENABLED: "true" } as Env,
      cron: "37 3 * * SUN",
      scheduledTime: Date.parse("2026-08-30T03:37:00.000Z"),
      dependencies: { runReflection },
    });

    expect(result).toMatchObject({ operation: "reflection", status: "succeeded", itemCount: 1 });
    expect(runReflection).toHaveBeenCalledWith(ownerId);
  });
});
