import { z } from "zod";

import { hasSecretPattern } from "../memory/safety";

const MAX_IMPORT_BYTES = 5_000_000;
const MAX_IMPORT_RECORDS = 2_000;
const APPLY_BATCH_SIZE = 10;
const SOURCE_SYSTEM = "truememory" as const;

const manifestSchema = z.object({
  type: z.literal("manifest"),
  schemaVersion: z.literal(2),
  sourceSystem: z.literal(SOURCE_SYSTEM),
  snapshotSha256: z.string().regex(/^[0-9a-f]{64}$/i),
  payloadSha256: z.string().regex(/^[0-9a-f]{64}$/i),
  recordCount: z.number().int().min(0).max(MAX_IMPORT_RECORDS),
  exportedAt: z.iso.datetime(),
}).strict();

const memorySchema = z.object({
  type: z.literal("memory"),
  sourceMemoryId: z.string().min(1).max(200),
  content: z.string().trim().min(1).max(12_000),
  directive: z.boolean().default(false),
  timestamp: z.string().max(100).optional(),
  sender: z.string().max(100).optional(),
  recipient: z.string().max(100).optional(),
  category: z.string().max(100).optional(),
  modality: z.string().max(100).optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
}).strict();

const applyBatchSchema = z.object({
  records: z.array(memorySchema).min(1).max(APPLY_BATCH_SIZE),
}).strict();

export interface ParsedTrueMemoryRecord extends z.infer<typeof memorySchema> {
  contentSha256: string;
  lineNumber: number;
}

export interface ParsedImport {
  manifest: z.infer<typeof manifestSchema>;
  manifestSha256: string;
  records: ParsedTrueMemoryRecord[];
  malformed: Array<{ sourceMemoryId: string; lineNumber: number; reason: string }>;
}

export interface ImportCounts {
  examined: number;
  new: number;
  duplicate: number;
  probableDuplicate: number;
  conflict: number;
  malformed: number;
  sensitive: number;
}

function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export async function sha256Text(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", exactBuffer(new TextEncoder().encode(value)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}

async function approvedRecordSha256(record: z.infer<typeof memorySchema>): Promise<string> {
  return sha256Text(canonicalJson({
    type: record.type,
    sourceMemoryId: record.sourceMemoryId,
    content: record.content,
    directive: record.directive,
    timestamp: record.timestamp,
    sender: record.sender,
    recipient: record.recipient,
    category: record.category,
    modality: record.modality,
    metadata: record.metadata,
  }));
}

export async function parseTrueMemoryImport(jsonl: string): Promise<ParsedImport> {
  if (new TextEncoder().encode(jsonl).byteLength > MAX_IMPORT_BYTES) {
    throw new Error("TrueMemory import exceeds the 5 MB request limit");
  }
  const lines = jsonl.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 1 || lines.length > MAX_IMPORT_RECORDS + 1) {
    throw new Error("TrueMemory import record count is invalid");
  }
  let manifestValue: unknown;
  try { manifestValue = JSON.parse(lines[0] ?? ""); } catch { throw new Error("TrueMemory manifest is malformed"); }
  const manifest = manifestSchema.parse(manifestValue);
  if (manifest.recordCount !== lines.length - 1) {
    throw new Error("TrueMemory manifest record count does not match the payload");
  }
  const payload = lines.length > 1 ? `${lines.slice(1).join("\n")}\n` : "";
  if (await sha256Text(payload) !== manifest.payloadSha256.toLowerCase()) {
    throw new Error("TrueMemory payload checksum does not match the manifest");
  }

  const records: ParsedTrueMemoryRecord[] = [];
  const malformed: ParsedImport["malformed"] = [];
  const seenSourceIds = new Set<string>();
  for (let index = 1; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    let value: unknown;
    try {
      value = JSON.parse(lines[index] ?? "");
    } catch {
      malformed.push({ sourceMemoryId: `malformed-line-${lineNumber}`, lineNumber, reason: "invalid_json" });
      continue;
    }
    const parsed = memorySchema.safeParse(value);
    if (!parsed.success) {
      const candidate = value && typeof value === "object" && "sourceMemoryId" in value
        ? String((value as { sourceMemoryId: unknown }).sourceMemoryId).slice(0, 180)
        : "unknown";
      malformed.push({ sourceMemoryId: `malformed-${candidate || "unknown"}-line-${lineNumber}`, lineNumber, reason: "invalid_record" });
      continue;
    }
    if (seenSourceIds.has(parsed.data.sourceMemoryId)) {
      malformed.push({
        sourceMemoryId: `duplicate-${parsed.data.sourceMemoryId}-line-${lineNumber}`,
        lineNumber,
        reason: "duplicate_source_id",
      });
      continue;
    }
    seenSourceIds.add(parsed.data.sourceMemoryId);
    records.push({ ...parsed.data, contentSha256: await sha256Text(parsed.data.content), lineNumber });
  }
  return { manifest, manifestSha256: await sha256Text(jsonl), records, malformed };
}

type Outcome = "new" | "duplicate" | "probable_duplicate" | "conflict" | "malformed" | "sensitive";
type ImportItemOutcome = Outcome | "imported" | "failed";

async function existingRun(database: D1Database, ownerId: string, snapshotSha256: string) {
  return database.prepare(
    `SELECT id, manifest_sha256, examined_count, new_count, duplicate_count,
      probable_duplicate_count, conflict_count, malformed_count, sensitive_count, status,
      payload_sha256
     FROM import_runs WHERE owner_id = ? AND source_system = ? AND snapshot_sha256 = ?`,
  ).bind(ownerId, SOURCE_SYSTEM, snapshotSha256).first<Record<string, string | number>>();
}

function resultFromRun(run: Record<string, string | number>) {
  return {
    runId: String(run.id),
    manifestSha256: String(run.manifest_sha256),
    counts: {
      examined: Number(run.examined_count),
      new: Number(run.new_count),
      duplicate: Number(run.duplicate_count),
      probableDuplicate: Number(run.probable_duplicate_count),
      conflict: Number(run.conflict_count),
      malformed: Number(run.malformed_count),
      sensitive: Number(run.sensitive_count),
    } satisfies ImportCounts,
  };
}

export async function dryRunTrueMemoryImport(input: {
  database: D1Database;
  ownerId: string;
  jsonl: string;
  newId?: () => string;
}) {
  const parsed = await parseTrueMemoryImport(input.jsonl);
  const prior = await existingRun(input.database, input.ownerId, parsed.manifest.snapshotSha256);
  if (prior) {
    if (prior.payload_sha256 !== parsed.manifest.payloadSha256) {
      throw new Error("This source snapshot already has a different verified payload");
    }
    if (prior.manifest_sha256 !== parsed.manifestSha256) {
      throw new Error("This source snapshot already has a different dry-run manifest");
    }
    const itemCount = await input.database.prepare(
      "SELECT COUNT(*) AS count FROM import_items WHERE run_id = ? AND owner_id = ?",
    ).bind(String(prior.id), input.ownerId).first<{ count: number }>();
    if (itemCount?.count === Number(prior.examined_count)) return resultFromRun(prior);
    if (prior.status !== "dry_run") {
      throw new Error("Existing import receipt is incomplete and can no longer be rebuilt safely");
    }
    await input.database.batch([
      input.database.prepare("DELETE FROM import_items WHERE run_id = ? AND owner_id = ?").bind(String(prior.id), input.ownerId),
      input.database.prepare("DELETE FROM import_runs WHERE id = ? AND owner_id = ? AND status = 'dry_run'").bind(String(prior.id), input.ownerId),
    ]);
  }

  const newId = input.newId ?? (() => crypto.randomUUID());
  const runId = newId();
  const now = new Date().toISOString();
  const items: Array<{
    id: string;
    sourceMemoryId: string;
    contentSha256: string;
    approvedRecordSha256: string | null;
    outcome: Outcome;
    reason: string | null;
  }> = [];

  const exactRows = parsed.records.length
    ? await input.database.prepare(
        `SELECT source_id, content_sha256 FROM memories
         WHERE owner_id = ? AND namespace = 'default' AND source_system = ?
           AND source_id IN (SELECT value FROM json_each(?))`,
      ).bind(
        input.ownerId,
        SOURCE_SYSTEM,
        JSON.stringify(parsed.records.map((record) => record.sourceMemoryId)),
      ).all<{ source_id: string; content_sha256: string }>()
    : { results: [] };
  const existingBySourceId = new Map(
    exactRows.results.map((row) => [row.source_id, row.content_sha256]),
  );
  const hashRows = parsed.records.length
    ? await input.database.prepare(
        `SELECT DISTINCT content_sha256 FROM memories
         WHERE owner_id = ? AND namespace = 'default'
           AND content_sha256 IN (SELECT value FROM json_each(?))`,
      ).bind(
        input.ownerId,
        JSON.stringify(parsed.records.map((record) => record.contentSha256)),
      ).all<{ content_sha256: string }>()
    : { results: [] };
  const existingHashes = new Set(hashRows.results.map((row) => row.content_sha256));

  for (const malformed of parsed.malformed) {
    items.push({ id: newId(), sourceMemoryId: malformed.sourceMemoryId, contentSha256: await sha256Text(`malformed:${malformed.lineNumber}`), approvedRecordSha256: null, outcome: "malformed", reason: malformed.reason });
  }
  for (const record of parsed.records) {
    let outcome: Outcome;
    let reason: string | null;
    if (hasSecretPattern(record.content)) {
      outcome = "sensitive";
      reason = "secret_pattern";
    } else {
      const exactHash = existingBySourceId.get(record.sourceMemoryId);
      if (exactHash) {
        outcome = exactHash === record.contentSha256 ? "duplicate" : "conflict";
        reason = outcome === "conflict" ? "source_id_content_changed" : "source_id_and_hash_match";
      } else {
        const sameContent = existingHashes.has(record.contentSha256);
        outcome = sameContent ? "probable_duplicate" : "new";
        reason = sameContent ? "content_hash_match" : null;
      }
    }
    items.push({
      id: newId(),
      sourceMemoryId: record.sourceMemoryId,
      contentSha256: record.contentSha256,
      approvedRecordSha256: await approvedRecordSha256(record),
      outcome,
      reason,
    });
  }

  const counts: ImportCounts = {
    examined: items.length,
    new: items.filter((item) => item.outcome === "new").length,
    duplicate: items.filter((item) => item.outcome === "duplicate").length,
    probableDuplicate: items.filter((item) => item.outcome === "probable_duplicate").length,
    conflict: items.filter((item) => item.outcome === "conflict").length,
    malformed: items.filter((item) => item.outcome === "malformed").length,
    sensitive: items.filter((item) => item.outcome === "sensitive").length,
  };

  await input.database.prepare(
    `INSERT INTO import_runs (
      id, owner_id, source_system, schema_version, manifest_sha256, snapshot_sha256, payload_sha256,
      status, examined_count, new_count, duplicate_count, probable_duplicate_count,
      conflict_count, malformed_count, sensitive_count, created_at
    ) VALUES (?, ?, ?, 2, ?, ?, ?, 'dry_run', ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    runId, input.ownerId, SOURCE_SYSTEM, parsed.manifestSha256, parsed.manifest.snapshotSha256,
    parsed.manifest.payloadSha256,
    counts.examined, counts.new, counts.duplicate, counts.probableDuplicate,
    counts.conflict, counts.malformed, counts.sensitive, now,
  ).run();

  for (let offset = 0; offset < items.length; offset += 50) {
    await input.database.batch(items.slice(offset, offset + 50).map((item) =>
      input.database.prepare(
        `INSERT INTO import_items (
          id, run_id, owner_id, source_system, source_memory_id, content_sha256,
          approved_record_sha256, outcome, reason_code, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(item.id, runId, input.ownerId, SOURCE_SYSTEM, item.sourceMemoryId, item.contentSha256, item.approvedRecordSha256, item.outcome, item.reason, now, now),
    ));
  }
  return { runId, manifestSha256: parsed.manifestSha256, counts };
}

export interface TrueMemoryApplyRecord {
  content: string;
  directive: boolean;
  source: typeof SOURCE_SYSTEM;
  sourceId: string;
  client?: string;
  conversationId?: string;
  actorType: "import";
  correlationId: string;
  eventContext: Record<string, unknown>;
}

export async function applyTrueMemoryImport(input: {
  database: D1Database;
  ownerId: string;
  runId: string;
  manifestSha256: string;
  records: unknown[];
  store: (record: TrueMemoryApplyRecord) => Promise<string>;
}) {
  const batch = applyBatchSchema.parse({ records: input.records }).records;
  if (new Set(batch.map((record) => record.sourceMemoryId)).size !== batch.length) {
    throw new Error("Import batch contains duplicate source identifiers");
  }
  const run = await input.database.prepare(
    `SELECT manifest_sha256, snapshot_sha256, status FROM import_runs
     WHERE id = ? AND owner_id = ? AND source_system = ?`,
  ).bind(input.runId, input.ownerId, SOURCE_SYSTEM).first<{
    manifest_sha256: string;
    snapshot_sha256: string;
    status: string;
  }>();
  if (!run || run.manifest_sha256 !== input.manifestSha256) {
    throw new Error("Approved TrueMemory dry run was not found");
  }
  if (run.status === "completed") return { imported: 0, remaining: 0, failed: 0, completed: true };
  if (!["dry_run", "approved", "applying", "failed"].includes(run.status)) {
    throw new Error("TrueMemory dry run is not ready to apply");
  }

  await input.database.prepare(
    `UPDATE import_runs SET status = 'applying', approved_at = COALESCE(approved_at, ?)
     WHERE id = ? AND owner_id = ?`,
  ).bind(new Date().toISOString(), input.runId, input.ownerId).run();

  const approvedItems = await input.database.prepare(
    `SELECT id, source_memory_id, content_sha256, approved_record_sha256, outcome FROM import_items
     WHERE run_id = ? AND owner_id = ?
       AND source_memory_id IN (SELECT value FROM json_each(?))`,
  ).bind(
    input.runId,
    input.ownerId,
    JSON.stringify(batch.map((record) => record.sourceMemoryId)),
  ).all<{
    id: string;
    source_memory_id: string;
    content_sha256: string;
    approved_record_sha256: string | null;
    outcome: ImportItemOutcome;
  }>();
  const itemsBySourceId = new Map(
    approvedItems.results.map((item) => [item.source_memory_id, item]),
  );
  let imported = 0;
  let transientFailures = 0;
  for (const record of batch) {
    const item = itemsBySourceId.get(record.sourceMemoryId);
    const contentSha256 = await sha256Text(record.content);
    const recordSha256 = await approvedRecordSha256(record);
    if (
      !item ||
      item.content_sha256 !== contentSha256 ||
      item.approved_record_sha256 !== recordSha256
    ) {
      throw new Error("Import batch does not match the approved dry run");
    }
    if (item.outcome === "imported") continue;
    if (item.outcome !== "new") {
      continue;
    }
    const alreadyImported = await input.database.prepare(
      `SELECT id, content_sha256 FROM memories
       WHERE owner_id = ? AND namespace = 'default' AND source_system = ? AND source_id = ?`,
    ).bind(input.ownerId, SOURCE_SYSTEM, record.sourceMemoryId).first<{ id: string; content_sha256: string }>();
    if (alreadyImported && alreadyImported.content_sha256 !== contentSha256) {
      await input.database.batch([
        input.database.prepare(
          `UPDATE import_items SET outcome = 'conflict', reason_code = 'source_changed_after_dry_run', updated_at = ?
           WHERE id = ? AND run_id = ? AND outcome = 'new'`,
        ).bind(new Date().toISOString(), item.id, input.runId),
        input.database.prepare(
          `UPDATE import_runs SET new_count = MAX(new_count - 1, 0), conflict_count = conflict_count + 1
           WHERE id = ? AND owner_id = ?`,
        ).bind(input.runId, input.ownerId),
      ]);
      continue;
    }
    let targetId = alreadyImported?.id;
    if (!targetId) {
      try {
        targetId = await input.store({
          content: record.content,
          directive: record.directive,
          source: SOURCE_SYSTEM,
          sourceId: record.sourceMemoryId,
          client: typeof record.metadata.client === "string" ? record.metadata.client : undefined,
          conversationId: typeof record.metadata.conversation_id === "string" ? record.metadata.conversation_id : undefined,
          actorType: "import",
          correlationId: input.runId,
          eventContext: {
            sourceSystem: SOURCE_SYSTEM,
            sourceMemoryId: record.sourceMemoryId,
            sourceSnapshotSha256: run.snapshot_sha256,
            sourceTimestamp: record.timestamp ?? null,
            sender: record.sender ?? null,
            recipient: record.recipient ?? null,
            category: record.category ?? null,
            modality: record.modality ?? null,
          },
        });
      } catch {
        transientFailures += 1;
        continue;
      }
    }
    await input.database.prepare(
      `UPDATE import_items SET outcome = 'imported', target_memory_id = ?, updated_at = ?
       WHERE id = ? AND run_id = ? AND outcome IN ('new', 'failed')`,
    ).bind(targetId, new Date().toISOString(), item.id, input.runId).run();
    imported += 1;
  }

  const remainingRow = await input.database.prepare(
    `SELECT COUNT(*) AS count FROM import_items WHERE run_id = ? AND outcome = 'new'`,
  ).bind(input.runId).first<{ count: number }>();
  const failureRow = await input.database.prepare(
    `SELECT COUNT(*) AS count FROM import_items WHERE run_id = ? AND outcome = 'failed'`,
  ).bind(input.runId).first<{ count: number }>();
  const importedRow = await input.database.prepare(
    `SELECT COUNT(*) AS count FROM import_items WHERE run_id = ? AND outcome = 'imported'`,
  ).bind(input.runId).first<{ count: number }>();
  const remaining = remainingRow?.count ?? 0;
  const failed = (failureRow?.count ?? 0) + transientFailures;
  const completed = remaining === 0 && failed === 0;
  await input.database.prepare(
    `UPDATE import_runs SET status = ?, imported_count = ?,
      failure_count = ?, completed_at = ? WHERE id = ? AND owner_id = ?`,
  ).bind(
    completed ? "completed" : failed > 0 ? "failed" : "applying",
    importedRow?.count ?? 0,
    failed,
    completed ? new Date().toISOString() : null,
    input.runId,
    input.ownerId,
  ).run();
  return { imported, remaining, failed, completed };
}
