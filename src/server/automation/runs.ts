export type AutomationOperation = "obsidian_projection" | "encrypted_export" | "reflection";
export type AutomationTarget = "webdav" | "github" | "d1" | "none";
export type AutomationRunStatus = "running" | "succeeded" | "failed" | "skipped";

export interface AutomationRun {
  id: string;
  operation: AutomationOperation;
  triggerType: "manual" | "scheduled";
  targetType: AutomationTarget;
  status: AutomationRunStatus;
  itemCount: number;
  contentSha256: string | null;
  errorClass: string | null;
  scheduledFor: string | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  version: number;
}

interface AutomationRunRow {
  id: string;
  operation: AutomationOperation;
  trigger_type: "manual" | "scheduled";
  target_type: AutomationTarget;
  status: AutomationRunStatus;
  item_count: number;
  content_sha256: string | null;
  error_class: string | null;
  scheduled_for: string | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  version: number;
}

function mapRun(row: AutomationRunRow): AutomationRun {
  return {
    id: row.id,
    operation: row.operation,
    triggerType: row.trigger_type,
    targetType: row.target_type,
    status: row.status,
    itemCount: row.item_count,
    contentSha256: row.content_sha256,
    errorClass: row.error_class,
    scheduledFor: row.scheduled_for,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs: row.duration_ms,
    version: row.version,
  };
}

function validIdempotencyKey(value: string): boolean {
  return value.length >= 1 && value.length <= 200 && !/[\r\n]/.test(value);
}

export class AutomationRunStore {
  constructor(private readonly database: D1Database) {}

  async claim(input: {
    ownerId: string;
    operation: AutomationOperation;
    triggerType: "manual" | "scheduled";
    idempotencyKey: string;
    targetType: AutomationTarget;
    scheduledFor?: string;
  }): Promise<{ run: AutomationRun; replayed: boolean }> {
    if (!validIdempotencyKey(input.idempotencyKey)) throw new Error("Automation idempotency key is invalid");
    const id = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const result = await this.database.prepare(
      `INSERT INTO automation_runs (
        id, owner_id, operation, trigger_type, idempotency_key, target_type,
        status, scheduled_for, started_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?)
      ON CONFLICT (owner_id, operation, idempotency_key) DO NOTHING`,
    ).bind(
      id,
      input.ownerId,
      input.operation,
      input.triggerType,
      input.idempotencyKey,
      input.targetType,
      input.scheduledFor ?? null,
      startedAt,
    ).run();
    const row = await this.database.prepare(
      `SELECT id, operation, trigger_type, target_type, status, item_count,
              content_sha256, error_class, scheduled_for, started_at,
              completed_at, duration_ms, version
       FROM automation_runs
       WHERE owner_id = ? AND operation = ? AND idempotency_key = ?`,
    ).bind(input.ownerId, input.operation, input.idempotencyKey).first<AutomationRunRow>();
    if (!row) throw new Error("Automation run could not be claimed");
    return { run: mapRun(row), replayed: result.meta.changes === 0 };
  }

  async complete(input: {
    ownerId: string;
    runId: string;
    status: Exclude<AutomationRunStatus, "running">;
    itemCount: number;
    contentSha256?: string;
    errorClass?: string;
  }): Promise<AutomationRun> {
    if (!Number.isInteger(input.itemCount) || input.itemCount < 0) throw new Error("Automation item count is invalid");
    if (input.contentSha256 && !/^[0-9a-f]{64}$/i.test(input.contentSha256)) throw new Error("Automation content hash is invalid");
    if (input.errorClass && (input.errorClass.length > 100 || /[\r\n]/.test(input.errorClass))) throw new Error("Automation error class is invalid");
    const completedAt = new Date().toISOString();
    const result = await this.database.prepare(
      `UPDATE automation_runs
       SET status = ?, item_count = ?, content_sha256 = ?, error_class = ?,
           completed_at = ?, duration_ms = MAX(0, CAST((julianday(?) - julianday(started_at)) * 86400000 AS INTEGER)),
           version = version + 1
       WHERE id = ? AND owner_id = ? AND status = 'running'`,
    ).bind(
      input.status,
      input.itemCount,
      input.contentSha256 ?? null,
      input.errorClass ?? null,
      completedAt,
      completedAt,
      input.runId,
      input.ownerId,
    ).run();
    if (result.meta.changes !== 1) throw new Error("Automation run was not found or already completed");
    const row = await this.database.prepare(
      `SELECT id, operation, trigger_type, target_type, status, item_count,
              content_sha256, error_class, scheduled_for, started_at,
              completed_at, duration_ms, version
       FROM automation_runs WHERE id = ? AND owner_id = ?`,
    ).bind(input.runId, input.ownerId).first<AutomationRunRow>();
    if (!row) throw new Error("Automation run was not found");
    return mapRun(row);
  }

  async list(ownerId: string, limit = 20): Promise<AutomationRun[]> {
    const bounded = Math.max(1, Math.min(Math.floor(limit), 100));
    const result = await this.database.prepare(
      `SELECT id, operation, trigger_type, target_type, status, item_count,
              content_sha256, error_class, scheduled_for, started_at,
              completed_at, duration_ms, version
       FROM automation_runs WHERE owner_id = ? ORDER BY started_at DESC LIMIT ?`,
    ).bind(ownerId, bounded).all<AutomationRunRow>();
    return result.results.map(mapRun);
  }
}
