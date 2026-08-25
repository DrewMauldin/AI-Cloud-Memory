import type { Env } from "../env";
import { pushEncryptedExport } from "../export/github";
import { generateEncryptedSnapshot, markExportPushed } from "../export/snapshot";
import { ReflectionStore } from "../reflection/store";
import { deliverWebDavProjection } from "./delivery";
import { buildOwnerProjection, type OwnerProjection } from "./projection";
import { AutomationRunStore, type AutomationOperation, type AutomationRunStatus } from "./runs";

const PROJECTION_CRON = "11 * * * *";
const EXPORT_CRON = "23 2 * * *";
const REFLECTION_CRON = "37 3 * * SUN";

interface SchedulerDependencies {
  buildProjection(input: { env: Env; ownerId: string; generatedAt?: string }): Promise<OwnerProjection>;
  deliverProjection(input: Parameters<typeof deliverWebDavProjection>[0]): ReturnType<typeof deliverWebDavProjection>;
  generateSnapshot(input: Parameters<typeof generateEncryptedSnapshot>[0]): Promise<{
    runId: string;
    path: string;
    encrypted: string;
    recordCount: number;
    contentSha256: string;
  }>;
  pushExport(input: Parameters<typeof pushEncryptedExport>[0]): ReturnType<typeof pushEncryptedExport>;
  markExportPushed: typeof markExportPushed;
  runReflection(ownerId: string): Promise<{ proposals: unknown[] }>;
}

const defaultDependencies: SchedulerDependencies = {
  buildProjection: buildOwnerProjection,
  deliverProjection: deliverWebDavProjection,
  generateSnapshot: generateEncryptedSnapshot,
  pushExport: pushEncryptedExport,
  markExportPushed,
  runReflection: async () => { throw new Error("Reflection dependency requires the current environment"); },
};

export interface NativeAutomationResult {
  operation: AutomationOperation | "none";
  status: AutomationRunStatus;
  itemCount: number;
  replayed?: boolean;
  reason?: "disabled" | "unsupported_schedule" | "webdav_not_configured" | "github_export_not_configured";
  runId?: string;
}

function errorClass(error: unknown): string {
  const name = error instanceof Error ? error.name : "UnknownError";
  return name.replaceAll(/[^A-Za-z0-9_.-]/g, "").slice(0, 100) || "UnknownError";
}

export async function runNativeAutomation(input: {
  env: Env;
  cron: string;
  scheduledTime: number;
  dependencies?: Partial<SchedulerDependencies>;
}): Promise<NativeAutomationResult> {
  if (input.env.NATIVE_AUTOMATION_ENABLED !== "true") {
    return { operation: "none", status: "skipped", itemCount: 0, reason: "disabled" };
  }
  if (![PROJECTION_CRON, EXPORT_CRON, REFLECTION_CRON].includes(input.cron)) {
    return { operation: "none", status: "skipped", itemCount: 0, reason: "unsupported_schedule" };
  }
  const dependencies = { ...defaultDependencies, ...input.dependencies };
  if (!input.dependencies?.runReflection) {
    dependencies.runReflection = (ownerId: string) => new ReflectionStore(input.env.DB).run(ownerId);
  }
  const scheduledFor = new Date(input.scheduledTime).toISOString();
  const store = new AutomationRunStore(input.env.DB);
  if (input.cron === REFLECTION_CRON) {
    const claimed = await store.claim({
      ownerId: input.env.ALLOWED_GITHUB_USER_ID,
      operation: "reflection",
      triggerType: "scheduled",
      idempotencyKey: `reflection:${scheduledFor}`,
      targetType: "d1",
      scheduledFor,
    });
    if (claimed.replayed) return {
      operation: claimed.run.operation, status: claimed.run.status, itemCount: claimed.run.itemCount,
      replayed: true, runId: claimed.run.id,
    };
    try {
      const reflected = await dependencies.runReflection(input.env.ALLOWED_GITHUB_USER_ID);
      const completed = await store.complete({
        ownerId: input.env.ALLOWED_GITHUB_USER_ID,
        runId: claimed.run.id,
        status: "succeeded",
        itemCount: reflected.proposals.length,
      });
      return { operation: completed.operation, status: completed.status, itemCount: completed.itemCount, runId: completed.id };
    } catch (error) {
      const completed = await store.complete({
        ownerId: input.env.ALLOWED_GITHUB_USER_ID,
        runId: claimed.run.id,
        status: "failed",
        itemCount: 0,
        errorClass: errorClass(error),
      });
      return { operation: completed.operation, status: completed.status, itemCount: 0, runId: completed.id };
    }
  }
  if (input.cron === EXPORT_CRON) {
    const keyHex = input.env.EXPORT_ENCRYPTION_KEY;
    const token = input.env.GITHUB_EXPORT_TOKEN;
    if (!keyHex || !token || !/^[0-9a-f]{64}$/i.test(keyHex)) {
      return { operation: "encrypted_export", status: "skipped", itemCount: 0, reason: "github_export_not_configured" };
    }
    const claimed = await store.claim({
      ownerId: input.env.ALLOWED_GITHUB_USER_ID,
      operation: "encrypted_export",
      triggerType: "scheduled",
      idempotencyKey: `encrypted_export:${scheduledFor}`,
      targetType: "github",
      scheduledFor,
    });
    if (claimed.replayed) {
      return {
        operation: claimed.run.operation,
        status: claimed.run.status,
        itemCount: claimed.run.itemCount,
        replayed: true,
        runId: claimed.run.id,
      };
    }
    try {
      const snapshot = await dependencies.generateSnapshot({
        database: input.env.DB,
        ownerId: input.env.ALLOWED_GITHUB_USER_ID,
        keyHex,
        repository: input.env.GITHUB_EXPORT_REPOSITORY,
      });
      const pushed = await dependencies.pushExport({
        repository: input.env.GITHUB_EXPORT_REPOSITORY,
        path: snapshot.path,
        encrypted: snapshot.encrypted,
        token,
      });
      await dependencies.markExportPushed(
        input.env.DB,
        input.env.ALLOWED_GITHUB_USER_ID,
        snapshot.runId,
        pushed.commitSha,
      );
      const completed = await store.complete({
        ownerId: input.env.ALLOWED_GITHUB_USER_ID,
        runId: claimed.run.id,
        status: "succeeded",
        itemCount: snapshot.recordCount,
        contentSha256: snapshot.contentSha256,
      });
      return { operation: completed.operation, status: completed.status, itemCount: completed.itemCount, runId: completed.id };
    } catch (error) {
      const completed = await store.complete({
        ownerId: input.env.ALLOWED_GITHUB_USER_ID,
        runId: claimed.run.id,
        status: "failed",
        itemCount: 0,
        errorClass: errorClass(error),
      });
      return { operation: completed.operation, status: completed.status, itemCount: 0, runId: completed.id };
    }
  }
  const baseUrl = input.env.PROJECTION_WEBDAV_BASE_URL;
  const username = input.env.PROJECTION_WEBDAV_USERNAME;
  const password = input.env.PROJECTION_WEBDAV_PASSWORD;
  if (!baseUrl || !username || !password) {
    return { operation: "obsidian_projection", status: "skipped", itemCount: 0, reason: "webdav_not_configured" };
  }

  const claimed = await store.claim({
    ownerId: input.env.ALLOWED_GITHUB_USER_ID,
    operation: "obsidian_projection",
    triggerType: "scheduled",
    idempotencyKey: `obsidian_projection:${scheduledFor}`,
    targetType: "webdav",
    scheduledFor,
  });
  if (claimed.replayed) {
    return {
      operation: claimed.run.operation,
      status: claimed.run.status,
      itemCount: claimed.run.itemCount,
      replayed: true,
      runId: claimed.run.id,
    };
  }

  try {
    const projection = await dependencies.buildProjection({
      env: input.env,
      ownerId: input.env.ALLOWED_GITHUB_USER_ID,
      generatedAt: scheduledFor,
    });
    const delivered = await dependencies.deliverProjection({
      baseUrl,
      username,
      password,
      files: projection.files,
    });
    const completed = await store.complete({
      ownerId: input.env.ALLOWED_GITHUB_USER_ID,
      runId: claimed.run.id,
      status: "succeeded",
      itemCount: delivered.fileCount,
      contentSha256: projection.files.at(-1)?.sha256,
    });
    return {
      operation: completed.operation,
      status: completed.status,
      itemCount: completed.itemCount,
      runId: completed.id,
    };
  } catch (error) {
    const completed = await store.complete({
      ownerId: input.env.ALLOWED_GITHUB_USER_ID,
      runId: claimed.run.id,
      status: "failed",
      itemCount: 0,
      errorClass: errorClass(error),
    });
    return {
      operation: completed.operation,
      status: completed.status,
      itemCount: 0,
      runId: completed.id,
    };
  }
}
