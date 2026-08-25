import type { ConnectorAdapterId } from "./registry";

export type ConnectorRunStatus = "previewed" | "applying" | "completed" | "failed";

export interface ConnectorRun {
  id: string;
  adapterId: ConnectorAdapterId;
  sourceRef: string | null;
  inputSha256: string;
  previewSha256: string;
  status: ConnectorRunStatus;
  examinedCount: number;
  importableCount: number;
  duplicateCount: number;
  rejectedCount: number;
  importedCount: number;
  errorClass: string | null;
  createdAt: string;
  completedAt: string | null;
  version: number;
}

interface ConnectorRunRow {
  id: string;
  adapter_id: ConnectorAdapterId;
  source_ref: string | null;
  input_sha256: string;
  preview_sha256: string;
  status: ConnectorRunStatus;
  examined_count: number;
  importable_count: number;
  duplicate_count: number;
  rejected_count: number;
  imported_count: number;
  error_class: string | null;
  created_at: string;
  completed_at: string | null;
  version: number;
}

function mapRun(row: ConnectorRunRow): ConnectorRun {
  return {
    id: row.id,
    adapterId: row.adapter_id,
    sourceRef: row.source_ref,
    inputSha256: row.input_sha256,
    previewSha256: row.preview_sha256,
    status: row.status,
    examinedCount: row.examined_count,
    importableCount: row.importable_count,
    duplicateCount: row.duplicate_count,
    rejectedCount: row.rejected_count,
    importedCount: row.imported_count,
    errorClass: row.error_class,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    version: row.version,
  };
}

function validHash(value: string): boolean {
  return /^[0-9a-f]{64}$/i.test(value);
}

export class ConnectorRunStore {
  constructor(private readonly database: D1Database) {}

  private async get(ownerId: string, runId: string): Promise<ConnectorRun | null> {
    const row = await this.database.prepare(
      `SELECT id, adapter_id, source_ref, input_sha256, preview_sha256, status,
              examined_count, importable_count, duplicate_count, rejected_count,
              imported_count, error_class, created_at, completed_at, version
       FROM connector_runs WHERE id = ? AND owner_id = ?`,
    ).bind(runId, ownerId).first<ConnectorRunRow>();
    return row ? mapRun(row) : null;
  }

  async createPreview(input: {
    ownerId: string;
    adapterId: ConnectorAdapterId;
    sourceRef?: string;
    inputSha256: string;
    previewSha256: string;
    examinedCount: number;
  }): Promise<ConnectorRun> {
    if (!validHash(input.inputSha256) || !validHash(input.previewSha256)) throw new Error("Connector hash is invalid");
    if (!Number.isInteger(input.examinedCount) || input.examinedCount < 1 || input.examinedCount > 500) {
      throw new Error("Connector examined count is invalid");
    }
    const id = crypto.randomUUID();
    await this.database.prepare(
      `INSERT INTO connector_runs (
        id, owner_id, adapter_id, source_ref, input_sha256, preview_sha256,
        status, examined_count, importable_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'previewed', ?, ?, ?)`,
    ).bind(
      id,
      input.ownerId,
      input.adapterId,
      input.sourceRef ?? null,
      input.inputSha256,
      input.previewSha256,
      input.examinedCount,
      input.examinedCount,
      new Date().toISOString(),
    ).run();
    const run = await this.get(input.ownerId, id);
    if (!run) throw new Error("Connector preview receipt could not be created");
    return run;
  }

  async startApply(input: {
    ownerId: string;
    runId: string;
    expectedVersion: number;
    previewSha256: string;
  }): Promise<ConnectorRun> {
    const existing = await this.get(input.ownerId, input.runId);
    if (!existing) throw new Error("Connector run was not found");
    if (existing.previewSha256 !== input.previewSha256) throw new Error("Connector preview does not match the approved receipt");
    if (existing.version !== input.expectedVersion) throw new Error("Connector run version conflict");
    const result = await this.database.prepare(
      `UPDATE connector_runs SET status = 'applying', version = version + 1
       WHERE id = ? AND owner_id = ? AND status IN ('previewed', 'failed') AND version = ?`,
    ).bind(input.runId, input.ownerId, input.expectedVersion).run();
    if (result.meta.changes !== 1) throw new Error("Connector run is not ready to apply");
    const run = await this.get(input.ownerId, input.runId);
    if (!run) throw new Error("Connector run was not found");
    return run;
  }

  async complete(input: {
    ownerId: string;
    runId: string;
    expectedVersion: number;
    importedCount: number;
    duplicateCount: number;
    rejectedCount: number;
    errorClass?: string;
  }): Promise<ConnectorRun> {
    const counts = [input.importedCount, input.duplicateCount, input.rejectedCount];
    if (counts.some((value) => !Number.isInteger(value) || value < 0)) throw new Error("Connector outcome count is invalid");
    const failed = Boolean(input.errorClass);
    const result = await this.database.prepare(
      `UPDATE connector_runs
       SET status = ?, imported_count = ?, duplicate_count = ?, rejected_count = ?,
           importable_count = MAX(0, examined_count - ? - ?), error_class = ?,
           completed_at = ?, version = version + 1
       WHERE id = ? AND owner_id = ? AND status = 'applying' AND version = ?`,
    ).bind(
      failed ? "failed" : "completed",
      input.importedCount,
      input.duplicateCount,
      input.rejectedCount,
      input.duplicateCount,
      input.rejectedCount,
      input.errorClass ?? null,
      new Date().toISOString(),
      input.runId,
      input.ownerId,
      input.expectedVersion,
    ).run();
    if (result.meta.changes !== 1) throw new Error("Connector run version conflict");
    const run = await this.get(input.ownerId, input.runId);
    if (!run) throw new Error("Connector run was not found");
    return run;
  }

  async list(ownerId: string, limit = 20): Promise<ConnectorRun[]> {
    const result = await this.database.prepare(
      `SELECT id, adapter_id, source_ref, input_sha256, preview_sha256, status,
              examined_count, importable_count, duplicate_count, rejected_count,
              imported_count, error_class, created_at, completed_at, version
       FROM connector_runs WHERE owner_id = ? ORDER BY created_at DESC LIMIT ?`,
    ).bind(ownerId, Math.max(1, Math.min(Math.floor(limit), 100))).all<ConnectorRunRow>();
    return result.results.map(mapRun);
  }
}
