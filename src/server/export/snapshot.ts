import { encryptExport, serializeExport, type EncryptedExportEnvelope } from "./crypto";

const MAX_EXPORT_RECORDS = 10_000;
const MAX_EXPORT_CONTENT_CHARS = 12_000_000;

interface ExportReceipt {
  runId: string;
  ownerId: string;
  recordCount: number;
  contentSha256: string;
  path: string;
  encrypted: string;
  envelope: EncryptedExportEnvelope;
}

async function rows(
  database: D1Database,
  sql: string,
  ownerId: string,
): Promise<Record<string, unknown>[]> {
  const result = await database.prepare(sql).bind(ownerId).all<Record<string, unknown>>();
  return result.results;
}

function exportPath(timestamp: string, runId: string): string {
  const [day = "unknown"] = timestamp.split("T");
  const compact = timestamp.replaceAll(/[-:.TZ]/g, "");
  return `exports/${day}/cloud-memory-${compact}-${runId.slice(0, 8)}.enc.json`;
}

export function assertSnapshotWithinLimits(recordCount: number, contentChars: number): void {
  if (recordCount > MAX_EXPORT_RECORDS || contentChars > MAX_EXPORT_CONTENT_CHARS) {
    throw new Error("Encrypted snapshot exceeds the bounded Worker export limit");
  }
}

export async function generateEncryptedSnapshot(input: {
  database: D1Database;
  ownerId: string;
  keyHex: string;
  repository: string;
  now?: () => string;
  newId?: () => string;
}): Promise<ExportReceipt> {
  const now = input.now?.() ?? new Date().toISOString();
  const runId = input.newId?.() ?? crypto.randomUUID();
  const size = await input.database.prepare(
    `SELECT
      (SELECT COUNT(*) FROM memories WHERE owner_id = ?) +
      (SELECT COUNT(*) FROM projects WHERE owner_id = ?) +
      (SELECT COUNT(*) FROM tasks WHERE owner_id = ?) +
      (SELECT COUNT(*) FROM memory_events WHERE owner_id = ?) +
      (SELECT COUNT(*) FROM task_events WHERE owner_id = ?) +
      (SELECT COUNT(*) FROM conversations WHERE owner_id = ?) +
      (SELECT COUNT(*) FROM task_conversations tc JOIN tasks t ON t.id = tc.task_id WHERE t.owner_id = ?) +
      (SELECT COUNT(*) FROM memory_links WHERE owner_id = ?) AS record_count,
      (SELECT COALESCE(SUM(LENGTH(content)), 0) FROM memories WHERE owner_id = ?) +
      (SELECT COALESCE(SUM(LENGTH(description)), 0) FROM projects WHERE owner_id = ?) +
      (SELECT COALESCE(SUM(LENGTH(title) + LENGTH(COALESCE(description, ''))), 0) FROM tasks WHERE owner_id = ?) +
      (SELECT COALESCE(SUM(LENGTH(COALESCE(previous_json, '')) + LENGTH(COALESCE(next_json, ''))), 0) FROM memory_events WHERE owner_id = ?) +
      (SELECT COALESCE(SUM(LENGTH(COALESCE(previous_json, '')) + LENGTH(COALESCE(next_json, '')) + LENGTH(COALESCE(note, ''))), 0) FROM task_events WHERE owner_id = ?) AS content_chars`,
  ).bind(...Array(13).fill(input.ownerId)).first<{ record_count: number; content_chars: number }>();
  assertSnapshotWithinLimits(size?.record_count ?? 0, size?.content_chars ?? 0);
  const [memories, projects, tasks, memoryEvents, taskEvents, conversations, taskConversations, memoryLinks] = await Promise.all([
    rows(input.database, "SELECT * FROM memories WHERE owner_id = ? ORDER BY memory_number", input.ownerId),
    rows(input.database, "SELECT * FROM projects WHERE owner_id = ? ORDER BY created_at, id", input.ownerId),
    rows(input.database, "SELECT * FROM tasks WHERE owner_id = ? ORDER BY created_at, id", input.ownerId),
    rows(input.database, "SELECT * FROM memory_events WHERE owner_id = ? ORDER BY created_at, id", input.ownerId),
    rows(input.database, "SELECT * FROM task_events WHERE owner_id = ? ORDER BY created_at, id", input.ownerId),
    rows(input.database, "SELECT * FROM conversations WHERE owner_id = ? ORDER BY created_at, id", input.ownerId),
    rows(input.database, "SELECT tc.* FROM task_conversations tc JOIN tasks t ON t.id = tc.task_id WHERE t.owner_id = ? ORDER BY tc.created_at", input.ownerId),
    rows(input.database, "SELECT * FROM memory_links WHERE owner_id = ? ORDER BY created_at", input.ownerId),
  ]);
  const recordCount = memories.length + projects.length + tasks.length + memoryEvents.length + taskEvents.length + conversations.length + taskConversations.length + memoryLinks.length;
  const plaintext = serializeExport({
    exportedAt: now,
    ownerId: input.ownerId,
    memories,
    projects,
    tasks,
    memoryEvents,
    taskEvents,
    conversations,
    taskConversations,
    memoryLinks,
  });
  const envelope = await encryptExport(plaintext, input.keyHex);
  const encrypted = `${JSON.stringify(envelope)}\n`;
  const path = exportPath(now, runId);

  await input.database
    .prepare(
      `INSERT INTO export_runs (
        id, owner_id, format, status, record_count, content_sha256,
        repository, repository_path, created_at, completed_at
      ) VALUES (?, ?, 'encrypted_jsonl', 'encrypted', ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      runId,
      input.ownerId,
      recordCount,
      envelope.plaintextSha256,
      input.repository,
      path,
      now,
      now,
    )
    .run();

  return {
    runId,
    ownerId: input.ownerId,
    recordCount,
    contentSha256: envelope.plaintextSha256,
    path,
    encrypted,
    envelope,
  };
}

export async function markExportPushed(
  database: D1Database,
  ownerId: string,
  runId: string,
  commitSha: string,
): Promise<void> {
  const result = await database
    .prepare(
      `UPDATE export_runs SET status = 'pushed', commit_sha = ?, completed_at = ?
       WHERE id = ? AND owner_id = ? AND status = 'encrypted'`,
    )
    .bind(commitSha, new Date().toISOString(), runId, ownerId)
    .run();
  if (result.meta.changes !== 1) throw new Error("Export receipt could not be marked as pushed");
}
