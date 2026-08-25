import { buildSafeFtsQuery } from "./search";
import { assertSafeMemoryContent } from "./safety";

export interface MemoryRecord {
  memoryNumber: number;
  id: string;
  ownerId: string;
  namespace: string;
  kind: "memory" | "directive";
  memoryType: "preference" | "decision" | "fact" | "episode" | "procedure" | "project_state" | "correction";
  scopeType: "global" | "project" | "repository" | "client";
  scopeId: string | null;
  retentionTier: "core" | "durable" | "dynamic" | "archive";
  content: string;
  contentSha256: string;
  summary: string | null;
  importance: number;
  confidence: number;
  status: "proposed" | "active" | "superseded" | "rejected" | "archived";
  sensitivity: "normal" | "private" | "sensitive";
  sourceSystem: string | null;
  sourceId: string | null;
  sourceUrl: string | null;
  sourceClient: string | null;
  sourceModel: string | null;
  conversationId: string | null;
  messageId: string | null;
  supersedesId: string | null;
  validFrom: string | null;
  validUntil: string | null;
  observedAt: string;
  recordedAt: string;
  reviewAt: string | null;
  expiresAt: string | null;
  vectorState: "pending" | "indexed" | "failed" | "not_required";
  archivedAt?: string | null;
  purgedAt?: string | null;
  lastRetrievedAt?: string | null;
  retrievalCount?: number;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface LibraryMemoryRecord extends MemoryRecord {
  labels: string[];
  archivedAt: string | null;
  purgedAt: string | null;
  lastRetrievedAt: string | null;
  retrievalCount: number;
}

export interface MemoryEventRecord {
  id: string;
  memoryId: string;
  eventType: string;
  actorType: string;
  client: string | null;
  model: string | null;
  sourceUrl: string | null;
  correlationId: string | null;
  previous: unknown;
  next: unknown;
  createdAt: string;
}

export interface LibraryListInput {
  ownerId: string;
  limit?: number;
  cursor?: string;
  status?: MemoryRecord["status"] | "all";
  kind?: MemoryRecord["kind"];
  label?: string;
  query?: string;
  scopeType?: MemoryRecord["scopeType"];
  scopeId?: string;
  sourceClient?: string;
  minimumImportance?: number;
  createdAfter?: string;
  sort?: "updated" | "created" | "importance" | "retrieval";
}

export interface LibraryListResult {
  items: LibraryMemoryRecord[];
  nextCursor: string | null;
  counts: {
    active: number;
    archived: number;
    memories: number;
    directives: number;
  };
}

export interface CreateMemoryInput {
  ownerId: string;
  content: string;
  memoryType?: MemoryRecord["memoryType"];
  scopeType?: MemoryRecord["scopeType"];
  scopeId?: string;
  retentionTier?: MemoryRecord["retentionTier"];
  summary?: string;
  observedAt?: string;
  reviewAt?: string;
  expiresAt?: string;
  directive?: boolean;
  namespace?: string;
  source?: string;
  sourceId?: string;
  sourceUrl?: string;
  client?: string;
  model?: string;
  conversationId?: string;
  messageId?: string;
  importance?: number;
  confidence?: number;
  sensitivity?: "normal" | "private" | "sensitive";
  actorType?: "human" | "model" | "automation" | "import" | "system";
  correlationId?: string;
  eventContext?: Record<string, unknown>;
}

export interface CreateSupersedingMemoryInput extends CreateMemoryInput {
  supersedesId: string;
  expectedSupersededVersion: number;
}

export interface SupersessionResult {
  replacement: MemoryRecord;
  superseded: MemoryRecord;
}

interface MemoryStoreDependencies {
  now: () => string;
  newId: () => string;
  sha256: (content: string) => Promise<string>;
}

export class MemoryConflictError extends Error {
  readonly code = "MEMORY_CONFLICT";

  constructor(message = "Memory version conflict") {
    super(message);
    this.name = "MemoryConflictError";
  }
}

interface MemoryRow {
  memory_number: number;
  id: string;
  owner_id: string;
  namespace: string;
  kind: MemoryRecord["kind"];
  memory_type: MemoryRecord["memoryType"];
  scope_type: MemoryRecord["scopeType"];
  scope_id: string | null;
  retention_tier: MemoryRecord["retentionTier"];
  content: string;
  content_sha256: string;
  summary: string | null;
  importance: number;
  confidence: number;
  status: MemoryRecord["status"];
  sensitivity: MemoryRecord["sensitivity"];
  source_system: string | null;
  source_id: string | null;
  source_url: string | null;
  source_client: string | null;
  source_model: string | null;
  conversation_id: string | null;
  message_id: string | null;
  supersedes_id: string | null;
  valid_from: string | null;
  valid_until: string | null;
  observed_at: string;
  recorded_at: string;
  review_at: string | null;
  expires_at: string | null;
  vector_state: MemoryRecord["vectorState"];
  archived_at: string | null;
  purged_at: string | null;
  last_retrieved_at: string | null;
  retrieval_count: number;
  created_at: string;
  updated_at: string;
  version: number;
}

const MEMORY_COLUMNS = `
  memory_number, id, owner_id, namespace, kind, memory_type, scope_type,
  scope_id, retention_tier, content, content_sha256, summary,
  importance, confidence, status, sensitivity, source_system, source_id,
  source_url, source_client, source_model, conversation_id, message_id,
  supersedes_id, valid_from, valid_until, observed_at, recorded_at, review_at,
  expires_at, vector_state, created_at, updated_at,
  archived_at, purged_at, last_retrieved_at, retrieval_count, version
`;

const qualifiedMemoryColumns = (alias: string) =>
  MEMORY_COLUMNS.split(",")
    .map((column) => `${alias}.${column.trim()}`)
    .join(", ");

const defaultDependencies: MemoryStoreDependencies = {
  now: () => new Date().toISOString(),
  newId: () => crypto.randomUUID(),
  sha256: async (content) => {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(content),
    );
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  },
};

function toMemory(row: MemoryRow): MemoryRecord {
  return {
    memoryNumber: row.memory_number,
    id: row.id,
    ownerId: row.owner_id,
    namespace: row.namespace,
    kind: row.kind,
    memoryType: row.memory_type,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    retentionTier: row.retention_tier,
    content: row.content,
    contentSha256: row.content_sha256,
    summary: row.summary,
    importance: row.importance,
    confidence: row.confidence,
    status: row.status,
    sensitivity: row.sensitivity,
    sourceSystem: row.source_system,
    sourceId: row.source_id,
    sourceUrl: row.source_url,
    sourceClient: row.source_client,
    sourceModel: row.source_model,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    supersedesId: row.supersedes_id,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    observedAt: row.observed_at,
    recordedAt: row.recorded_at,
    reviewAt: row.review_at,
    expiresAt: row.expires_at,
    vectorState: row.vector_state,
    archivedAt: row.archived_at,
    purgedAt: row.purged_at,
    lastRetrievedAt: row.last_retrieved_at,
    retrievalCount: row.retrieval_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

function normaliseLabel(value: string): string {
  const label = value
    .trim()
    .toLocaleLowerCase("en-AU")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  if (!label) throw new Error("Label must contain a letter or number");
  return label;
}

type LibrarySort = NonNullable<LibraryListInput["sort"]>;

function librarySortColumn(sort: LibrarySort): string {
  if (sort === "created") return "created_at";
  if (sort === "importance") return "importance";
  if (sort === "retrieval") return "retrieval_count";
  return "updated_at";
}

function librarySortValue(row: MemoryRow, sort: LibrarySort): string | number {
  if (sort === "created") return row.created_at;
  if (sort === "importance") return row.importance;
  if (sort === "retrieval") return row.retrieval_count;
  return row.updated_at;
}

function encodeLibraryCursor(sort: LibrarySort, value: string | number, memoryNumber: number): string {
  return btoa(JSON.stringify([sort, value, memoryNumber]));
}

function decodeLibraryCursor(cursor: string, expectedSort: LibrarySort): [string | number, number] {
  try {
    const value: unknown = JSON.parse(atob(cursor));
    if (
      !Array.isArray(value) ||
      value.length !== 3 ||
      value[0] !== expectedSort ||
      (typeof value[1] !== "string" && typeof value[1] !== "number") ||
      typeof value[2] !== "number" ||
      !Number.isInteger(value[2]) ||
      value[2] < 1 ||
      ((expectedSort === "importance" || expectedSort === "retrieval") && typeof value[1] !== "number") ||
      ((expectedSort === "updated" || expectedSort === "created") && typeof value[1] !== "string")
    ) {
      throw new Error();
    }
    return [value[1], value[2]];
  } catch {
    throw new Error("Library cursor is invalid");
  }
}

function parseEventJson(value: string | null): unknown {
  if (value === null) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export class MemoryStore {
  private readonly dependencies: MemoryStoreDependencies;

  constructor(
    private readonly database: D1Database,
    dependencies: MemoryStoreDependencies = defaultDependencies,
  ) {
    this.dependencies = dependencies;
  }

  async create(input: CreateMemoryInput): Promise<MemoryRecord> {
    assertSafeMemoryContent(input.content);
    const id = this.dependencies.newId();
    const eventId = this.dependencies.newId();
    const timestamp = this.dependencies.now();
    const contentSha256 = await this.dependencies.sha256(input.content);
    const kind = input.directive ? "directive" : "memory";
    const memoryType = input.memoryType ?? (input.directive ? "preference" : "fact");
    const scopeType = input.scopeType ?? "global";
    const retentionTier = input.retentionTier ?? (input.directive ? "core" : "durable");
    const observedAt = input.observedAt ?? timestamp;
    const actorType = input.actorType ?? (input.client || input.model ? "model" : "human");

    await this.database.batch([
      this.database
        .prepare(
          `INSERT INTO memories (
            id, owner_id, namespace, kind, memory_type, scope_type, scope_id,
            retention_tier, content, content_sha256, summary,
            importance, confidence, sensitivity, source_system, source_id,
            source_url, source_client, source_model, conversation_id, message_id,
            valid_from, observed_at, recorded_at, review_at, expires_at,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          input.ownerId,
          input.namespace ?? "default",
          kind,
          memoryType,
          scopeType,
          input.scopeId ?? null,
          retentionTier,
          input.content,
          contentSha256,
          input.summary ?? null,
          input.importance ?? (input.directive ? 1 : 0.5),
          input.confidence ?? 1,
          input.sensitivity ?? "normal",
          input.source ?? null,
          input.sourceId ?? null,
          input.sourceUrl ?? null,
          input.client ?? null,
          input.model ?? null,
          input.conversationId ?? null,
          input.messageId ?? null,
          observedAt,
          observedAt,
          timestamp,
          input.reviewAt ?? null,
          input.expiresAt ?? null,
          timestamp,
          timestamp,
        ),
      this.database
        .prepare(
          `INSERT INTO memory_events (
            id, memory_id, owner_id, event_type, actor_type, client, model,
            source_url, correlation_id, next_json, created_at
          ) VALUES (?, ?, ?, 'created', ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          eventId,
          id,
          input.ownerId,
          actorType,
          input.client ?? null,
          input.model ?? null,
          input.sourceUrl ?? null,
          input.correlationId ?? null,
          JSON.stringify({ kind, memoryType, scopeType, retentionTier, contentSha256, ...input.eventContext }),
          timestamp,
        ),
    ]);

    const memory = await this.getById(input.ownerId, id);
    if (!memory) throw new Error("Created memory could not be read back");
    return memory;
  }

  async findActiveByContent(
    ownerId: string,
    namespace: string,
    kind: MemoryRecord["kind"],
    content: string,
  ): Promise<MemoryRecord | null> {
    const contentSha256 = await this.dependencies.sha256(content);
    const row = await this.database
      .prepare(
        `SELECT ${MEMORY_COLUMNS} FROM memories
         WHERE owner_id = ? AND namespace = ? AND kind = ?
           AND content_sha256 = ? AND status = 'active'
         ORDER BY updated_at DESC, memory_number DESC
         LIMIT 1`,
      )
      .bind(ownerId, namespace, kind, contentSha256)
      .first<MemoryRow>();
    return row ? toMemory(row) : null;
  }

  async findBySourceIdentity(
    ownerId: string,
    namespace: string,
    sourceSystem: string,
    sourceId: string,
  ): Promise<MemoryRecord | null> {
    const row = await this.database
      .prepare(
         `SELECT ${MEMORY_COLUMNS} FROM memories
         WHERE owner_id = ? AND namespace = ? AND source_system = ?
           AND source_id = ?
         LIMIT 1`,
      )
      .bind(ownerId, namespace, sourceSystem, sourceId)
      .first<MemoryRow>();
    return row ? toMemory(row) : null;
  }

  async createSuperseding(
    input: CreateSupersedingMemoryInput,
  ): Promise<SupersessionResult> {
    assertSafeMemoryContent(input.content);
    const contentSha256 = await this.dependencies.sha256(input.content);
    const namespace = input.namespace ?? "default";
    const kind = input.directive ? "directive" : "memory";
    const memoryType = input.memoryType ?? (input.directive ? "preference" : "fact");
    const scopeType = input.scopeType ?? "global";
    const retentionTier = input.retentionTier ?? (input.directive ? "core" : "durable");
    const actorType = input.actorType ?? (input.client || input.model ? "model" : "human");

    if (input.correlationId) {
      const replay = await this.database
        .prepare(
          `SELECT old_event.memory_id AS superseded_id,
                  replacement.id AS replacement_id
           FROM memory_events old_event
           JOIN memories replacement
             ON replacement.owner_id = old_event.owner_id
            AND replacement.supersedes_id = old_event.memory_id
           JOIN memory_events replacement_event
             ON replacement_event.owner_id = old_event.owner_id
            AND replacement_event.memory_id = replacement.id
            AND replacement_event.event_type = 'created'
            AND replacement_event.correlation_id = old_event.correlation_id
           WHERE old_event.owner_id = ?
             AND old_event.correlation_id = ?
             AND old_event.event_type = 'superseded'
           ORDER BY old_event.created_at DESC
           LIMIT 1`,
        )
        .bind(input.ownerId, input.correlationId)
        .first<{ superseded_id: string; replacement_id: string }>();
      if (replay) {
        const [replacement, superseded] = await Promise.all([
          this.getById(input.ownerId, replay.replacement_id),
          this.getById(input.ownerId, replay.superseded_id),
        ]);
        if (
          replay.superseded_id !== input.supersedesId ||
          !replacement ||
          !superseded ||
          replacement.contentSha256 !== contentSha256 ||
          replacement.namespace !== namespace ||
          replacement.kind !== kind ||
          superseded.status !== "superseded" ||
          superseded.version !== input.expectedSupersededVersion + 1
        ) {
          throw new MemoryConflictError("Correlation ID already belongs to another supersession");
        }
        return { replacement, superseded };
      }
    }

    if (input.source && input.sourceId) {
      const sourceMatch = await this.findBySourceIdentity(
        input.ownerId,
        namespace,
        input.source,
        input.sourceId,
      );
      if (sourceMatch) {
        throw new MemoryConflictError(
          "A replacement must use a distinct source identity",
        );
      }
    }

    const replacementId = this.dependencies.newId();
    const replacementEventId = this.dependencies.newId();
    const supersededEventId = this.dependencies.newId();
    const timestamp = this.dependencies.now();
    const observedAt = input.observedAt ?? timestamp;

    const [supersede, insert, , , releaseClaim] = await this.database.batch([
      this.database
        .prepare(
          `UPDATE memories
           SET status = 'superseded', valid_until = ?, updated_at = ?,
               version = version + 1, supersession_token = ?
           WHERE owner_id = ? AND id = ? AND namespace = ? AND kind = ?
             AND status = 'active' AND version = ?`,
        )
        .bind(
          timestamp,
          timestamp,
          replacementId,
          input.ownerId,
          input.supersedesId,
          namespace,
          kind,
          input.expectedSupersededVersion,
        ),
      this.database
        .prepare(
          `INSERT INTO memories (
            id, owner_id, namespace, kind, memory_type, scope_type, scope_id,
            retention_tier, content, content_sha256, summary,
            importance, confidence, sensitivity, source_system, source_id,
            source_url, source_client, source_model, conversation_id, message_id,
            supersedes_id, valid_from, observed_at, recorded_at, review_at,
            expires_at, created_at, updated_at
          )
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 ?, ?, ?, ?, ?, ?, ?, ?, ?
          FROM memories replaced
          WHERE replaced.owner_id = ? AND replaced.id = ?
            AND replaced.namespace = ? AND replaced.kind = ?
            AND replaced.status = 'superseded'
            AND replaced.version = ? AND replaced.valid_until = ?
            AND replaced.supersession_token = ?`,
        )
        .bind(
          replacementId,
          input.ownerId,
          namespace,
          kind,
          memoryType,
          scopeType,
          input.scopeId ?? null,
          retentionTier,
          input.content,
          contentSha256,
          input.summary ?? null,
          input.importance ?? (input.directive ? 1 : 0.5),
          input.confidence ?? 1,
          input.sensitivity ?? "normal",
          input.source ?? null,
          input.sourceId ?? null,
          input.sourceUrl ?? null,
          input.client ?? null,
          input.model ?? null,
          input.conversationId ?? null,
          input.messageId ?? null,
          input.supersedesId,
          observedAt,
          observedAt,
          timestamp,
          input.reviewAt ?? null,
          input.expiresAt ?? null,
          timestamp,
          timestamp,
          input.ownerId,
          input.supersedesId,
          namespace,
          kind,
          input.expectedSupersededVersion + 1,
          timestamp,
          replacementId,
        ),
      this.database
        .prepare(
          `INSERT INTO memory_events (
            id, memory_id, owner_id, event_type, actor_type, client, model,
            source_url, correlation_id, next_json, created_at
          )
          SELECT ?, id, owner_id, 'created', ?, ?, ?, ?, ?, ?, ?
          FROM memories WHERE owner_id = ? AND id = ?`,
        )
        .bind(
          replacementEventId,
          actorType,
          input.client ?? null,
          input.model ?? null,
          input.sourceUrl ?? null,
          input.correlationId ?? null,
          JSON.stringify({ kind, memoryType, scopeType, retentionTier, contentSha256, supersedesId: input.supersedesId, ...input.eventContext }),
          timestamp,
          input.ownerId,
          replacementId,
        ),
      this.database
        .prepare(
          `INSERT INTO memory_events (
            id, memory_id, owner_id, event_type, actor_type, client, model,
            source_url, correlation_id, previous_json, next_json, created_at
          )
          SELECT ?, id, owner_id, 'superseded', ?, ?, ?, ?, ?, ?, ?, ?
          FROM memories
          WHERE owner_id = ? AND id = ? AND status = 'superseded'
            AND supersession_token = ?`,
        )
        .bind(
          supersededEventId,
          actorType,
          input.client ?? null,
          input.model ?? null,
          input.sourceUrl ?? null,
          input.correlationId ?? null,
          JSON.stringify({ status: "active", version: input.expectedSupersededVersion }),
          JSON.stringify({ status: "superseded", validUntil: timestamp }),
          timestamp,
          input.ownerId,
          input.supersedesId,
          replacementId,
        ),
      this.database
        .prepare(
          `UPDATE memories SET supersession_token = NULL
           WHERE owner_id = ? AND id = ? AND supersession_token = ?`,
        )
        .bind(input.ownerId, input.supersedesId, replacementId),
    ]);

    if (
      (supersede.meta.changes ?? 0) < 1 ||
      (insert.meta.changes ?? 0) < 1 ||
      (releaseClaim.meta.changes ?? 0) < 1
    ) {
      throw new MemoryConflictError();
    }

    const [replacement, superseded] = await Promise.all([
      this.getById(input.ownerId, replacementId),
      this.getById(input.ownerId, input.supersedesId),
    ]);
    if (!replacement || !superseded) {
      throw new Error("Supersession result could not be read back");
    }
    return { replacement, superseded };
  }

  async getById(ownerId: string, id: string): Promise<MemoryRecord | null> {
    const row = await this.database
      .prepare(
        `SELECT ${MEMORY_COLUMNS} FROM memories
         WHERE owner_id = ? AND id = ?`,
      )
      .bind(ownerId, id)
      .first<MemoryRow>();
    return row ? toMemory(row) : null;
  }

  async getByNumber(
    ownerId: string,
    memoryNumber: number,
  ): Promise<MemoryRecord | null> {
    const row = await this.database
      .prepare(
        `SELECT ${MEMORY_COLUMNS} FROM memories
         WHERE owner_id = ? AND memory_number = ?`,
      )
      .bind(ownerId, memoryNumber)
      .first<MemoryRow>();
    return row ? toMemory(row) : null;
  }

  async getManyByIds(ownerId: string, ids: string[]): Promise<MemoryRecord[]> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(", ");
    const result = await this.database
      .prepare(
        `SELECT ${MEMORY_COLUMNS} FROM memories
         WHERE owner_id = ? AND id IN (${placeholders})`,
      )
      .bind(ownerId, ...ids)
      .all<MemoryRow>();
    const byId = new Map(result.results.map((row) => [row.id, toMemory(row)]));
    return ids.flatMap((id) => {
      const memory = byId.get(id);
      return memory ? [memory] : [];
    });
  }

  async getLibraryById(ownerId: string, id: string): Promise<LibraryMemoryRecord | null> {
    const row = await this.database
      .prepare(
        `SELECT ${qualifiedMemoryColumns("m")},
          COALESCE((SELECT GROUP_CONCAT(ml.label, ',') FROM memory_labels ml
            WHERE ml.owner_id = m.owner_id AND ml.memory_id = m.id), '') AS labels_csv
         FROM memories m WHERE m.owner_id = ? AND m.id = ?`,
      )
      .bind(ownerId, id)
      .first<MemoryRow & { labels_csv: string }>();
    if (!row) return null;
    return {
      ...toMemory(row),
      archivedAt: row.archived_at,
      purgedAt: row.purged_at,
      lastRetrievedAt: row.last_retrieved_at,
      retrievalCount: row.retrieval_count,
      labels: row.labels_csv ? row.labels_csv.split(",").sort() : [],
    };
  }

  async listLibrary(input: LibraryListInput): Promise<LibraryListResult> {
    const limit = Math.max(1, Math.min(Math.floor(input.limit ?? 40), 100));
    const sort = input.sort ?? "updated";
    const sortColumn = librarySortColumn(sort);
    const clauses = ["m.owner_id = ?"];
    const values: unknown[] = [input.ownerId];
    const status = input.status ?? "active";
    if (status !== "all") {
      clauses.push("m.status = ?");
      values.push(status);
    }
    if (input.kind) {
      clauses.push("m.kind = ?");
      values.push(input.kind);
    }
    if (input.label) {
      clauses.push(`EXISTS (
        SELECT 1 FROM memory_labels selected_label
        WHERE selected_label.owner_id = m.owner_id
          AND selected_label.memory_id = m.id
          AND selected_label.label = ?
      )`);
      values.push(normaliseLabel(input.label));
    }
    if (input.query?.trim()) {
      clauses.push("instr(lower(COALESCE(m.summary, '') || ' ' || m.content), lower(?)) > 0");
      values.push(input.query.trim());
    }
    if (input.scopeType) {
      clauses.push("m.scope_type = ?");
      values.push(input.scopeType);
    }
    if (input.scopeId) {
      clauses.push("m.scope_id = ?");
      values.push(input.scopeId);
    }
    if (input.sourceClient) {
      clauses.push("m.source_client = ?");
      values.push(input.sourceClient);
    }
    if (input.minimumImportance !== undefined) {
      clauses.push("m.importance >= ?");
      values.push(Math.max(0, Math.min(input.minimumImportance, 1)));
    }
    if (input.createdAfter) {
      clauses.push("m.created_at >= ?");
      values.push(input.createdAfter);
    }
    if (input.cursor) {
      const [sortValue, memoryNumber] = decodeLibraryCursor(input.cursor, sort);
      clauses.push(`(m.${sortColumn} < ? OR (m.${sortColumn} = ? AND m.memory_number < ?))`);
      values.push(sortValue, sortValue, memoryNumber);
    }

    const result = await this.database
      .prepare(
        `SELECT ${qualifiedMemoryColumns("m")},
          COALESCE((SELECT GROUP_CONCAT(ml.label, ',') FROM memory_labels ml
            WHERE ml.owner_id = m.owner_id AND ml.memory_id = m.id), '') AS labels_csv
         FROM memories m
         WHERE ${clauses.join(" AND ")}
         ORDER BY m.${sortColumn} DESC, m.memory_number DESC
         LIMIT ?`,
      )
      .bind(...values, limit + 1)
      .all<MemoryRow & { labels_csv: string }>();

    const rows = result.results.slice(0, limit);
    const items = rows.map((row) => ({
      ...toMemory(row),
      archivedAt: row.archived_at,
      purgedAt: row.purged_at,
      lastRetrievedAt: row.last_retrieved_at,
      retrievalCount: row.retrieval_count,
      labels: row.labels_csv ? row.labels_csv.split(",").sort() : [],
    }));
    const last = rows.at(-1);
    const countRow = await this.database.prepare(
      `SELECT
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN status = 'archived' THEN 1 ELSE 0 END) AS archived,
        SUM(CASE WHEN status = 'active' AND kind = 'memory' THEN 1 ELSE 0 END) AS memories,
        SUM(CASE WHEN status = 'active' AND kind = 'directive' THEN 1 ELSE 0 END) AS directives
       FROM memories WHERE owner_id = ?`,
    ).bind(input.ownerId).first<{
      active: number | null;
      archived: number | null;
      memories: number | null;
      directives: number | null;
    }>();

    return {
      items,
      nextCursor: result.results.length > limit && last
        ? encodeLibraryCursor(sort, librarySortValue(last, sort), last.memory_number)
        : null,
      counts: {
        active: countRow?.active ?? 0,
        archived: countRow?.archived ?? 0,
        memories: countRow?.memories ?? 0,
        directives: countRow?.directives ?? 0,
      },
    };
  }

  async listRelated(ownerId: string, memoryId: string, limit = 8): Promise<LibraryMemoryRecord[]> {
    const boundedLimit = Math.max(1, Math.min(Math.floor(limit), 20));
    const result = await this.database.prepare(
      `SELECT ${qualifiedMemoryColumns("m")},
        COALESCE((SELECT GROUP_CONCAT(ml.label, ',') FROM memory_labels ml
          WHERE ml.owner_id = m.owner_id AND ml.memory_id = m.id), '') AS labels_csv
       FROM memories m
       JOIN memories selected ON selected.owner_id = m.owner_id AND selected.id = ?
       WHERE m.owner_id = ? AND m.id != selected.id AND m.purged_at IS NULL
         AND (
           m.supersedes_id = selected.id OR selected.supersedes_id = m.id OR
           (selected.scope_id IS NOT NULL AND m.scope_type = selected.scope_type AND m.scope_id = selected.scope_id) OR
           EXISTS (
             SELECT 1 FROM memory_labels candidate_label
             JOIN memory_labels selected_label
               ON selected_label.owner_id = candidate_label.owner_id
              AND selected_label.label = candidate_label.label
              AND selected_label.memory_id = selected.id
             WHERE candidate_label.owner_id = m.owner_id AND candidate_label.memory_id = m.id
           )
         )
       ORDER BY
         CASE WHEN m.supersedes_id = selected.id OR selected.supersedes_id = m.id THEN 0 ELSE 1 END,
         m.importance DESC, m.updated_at DESC, m.memory_number DESC
       LIMIT ?`,
    ).bind(memoryId, ownerId, boundedLimit).all<MemoryRow & { labels_csv: string }>();
    return result.results.map((row) => ({
      ...toMemory(row),
      archivedAt: row.archived_at,
      purgedAt: row.purged_at,
      lastRetrievedAt: row.last_retrieved_at,
      retrievalCount: row.retrieval_count,
      labels: row.labels_csv ? row.labels_csv.split(",").sort() : [],
    }));
  }

  async recordRetrieval(ownerId: string, memoryId: string): Promise<LibraryMemoryRecord> {
    const timestamp = this.dependencies.now();
    const result = await this.database.prepare(
      `UPDATE memories SET last_retrieved_at = ?, retrieval_count = retrieval_count + 1
       WHERE owner_id = ? AND id = ? AND status IN ('active', 'superseded')`,
    ).bind(timestamp, ownerId, memoryId).run();
    if ((result.meta.changes ?? 0) !== 1) throw new MemoryConflictError("Memory is not retrievable");
    const memory = await this.getLibraryById(ownerId, memoryId);
    if (!memory) throw new Error("Retrieved memory could not be read back");
    return memory;
  }

  async addLabel(input: {
    ownerId: string;
    memoryId: string;
    label: string;
    expectedVersion: number;
  }): Promise<LibraryMemoryRecord> {
    const label = normaliseLabel(input.label);
    const current = await this.getLibraryById(input.ownerId, input.memoryId);
    if (!current || current.version !== input.expectedVersion || current.purgedAt) throw new MemoryConflictError();
    if (current.labels.includes(label)) return current;
    const timestamp = this.dependencies.now();
    const [, , update] = await this.database.batch([
      this.database.prepare(
        `INSERT INTO memory_labels (owner_id, memory_id, label, created_at)
         SELECT owner_id, id, ?, ? FROM memories
         WHERE owner_id = ? AND id = ? AND version = ? AND purged_at IS NULL`,
      ).bind(label, timestamp, input.ownerId, input.memoryId, input.expectedVersion),
      this.database.prepare(
        `INSERT INTO memory_events (
          id, memory_id, owner_id, event_type, actor_type, previous_json, next_json, created_at
        ) SELECT ?, id, owner_id, 'updated', 'human', ?, ?, ? FROM memories
          WHERE owner_id = ? AND id = ? AND version = ? AND purged_at IS NULL`,
      ).bind(
        this.dependencies.newId(),
        JSON.stringify({ labels: current.labels }),
        JSON.stringify({ labels: [...current.labels, label].sort() }),
        timestamp,
        input.ownerId,
        input.memoryId,
        input.expectedVersion,
      ),
      this.database.prepare(
        `UPDATE memories SET updated_at = ?, version = version + 1
         WHERE owner_id = ? AND id = ? AND version = ? AND purged_at IS NULL`,
      ).bind(timestamp, input.ownerId, input.memoryId, input.expectedVersion),
    ]);
    if ((update.meta.changes ?? 0) !== 1) throw new MemoryConflictError();
    const memory = await this.getLibraryById(input.ownerId, input.memoryId);
    if (!memory) throw new Error("Labelled memory could not be read back");
    return memory;
  }

  async removeLabel(input: {
    ownerId: string;
    memoryId: string;
    label: string;
    expectedVersion: number;
  }): Promise<LibraryMemoryRecord> {
    const label = normaliseLabel(input.label);
    const current = await this.getLibraryById(input.ownerId, input.memoryId);
    if (!current || current.version !== input.expectedVersion || current.purgedAt) throw new MemoryConflictError();
    if (!current.labels.includes(label)) return current;
    const timestamp = this.dependencies.now();
    const nextLabels = current.labels.filter((candidate) => candidate !== label);
    const [, , update] = await this.database.batch([
      this.database.prepare(
        `DELETE FROM memory_labels WHERE owner_id = ? AND memory_id = ? AND label = ?
          AND EXISTS (SELECT 1 FROM memories WHERE owner_id = ? AND id = ? AND version = ? AND purged_at IS NULL)`,
      ).bind(
        input.ownerId,
        input.memoryId,
        label,
        input.ownerId,
        input.memoryId,
        input.expectedVersion,
      ),
      this.database.prepare(
        `INSERT INTO memory_events (
          id, memory_id, owner_id, event_type, actor_type, previous_json, next_json, created_at
        ) SELECT ?, id, owner_id, 'updated', 'human', ?, ?, ? FROM memories
          WHERE owner_id = ? AND id = ? AND version = ? AND purged_at IS NULL`,
      ).bind(
        this.dependencies.newId(),
        JSON.stringify({ labels: current.labels }),
        JSON.stringify({ labels: nextLabels }),
        timestamp,
        input.ownerId,
        input.memoryId,
        input.expectedVersion,
      ),
      this.database.prepare(
        `UPDATE memories SET updated_at = ?, version = version + 1
         WHERE owner_id = ? AND id = ? AND version = ? AND purged_at IS NULL`,
      ).bind(timestamp, input.ownerId, input.memoryId, input.expectedVersion),
    ]);
    if ((update.meta.changes ?? 0) !== 1) throw new MemoryConflictError();
    const memory = await this.getLibraryById(input.ownerId, input.memoryId);
    if (!memory) throw new Error("Unlabelled memory could not be read back");
    return memory;
  }

  async archiveMemory(input: {
    ownerId: string;
    memoryId: string;
    expectedVersion: number;
  }): Promise<LibraryMemoryRecord> {
    const timestamp = this.dependencies.now();
    const [, update] = await this.database.batch([
      this.database.prepare(
        `INSERT INTO memory_events (
          id, memory_id, owner_id, event_type, actor_type, previous_json, next_json, created_at
        ) SELECT ?, id, owner_id, 'archived', 'human', ?, ?, ? FROM memories
          WHERE owner_id = ? AND id = ? AND version = ? AND status = 'active'`,
      ).bind(
        this.dependencies.newId(),
        JSON.stringify({ status: "active", version: input.expectedVersion }),
        JSON.stringify({ status: "archived", archivedAt: timestamp, version: input.expectedVersion + 1 }),
        timestamp,
        input.ownerId,
        input.memoryId,
        input.expectedVersion,
      ),
      this.database.prepare(
        `UPDATE memories SET status = 'archived', archived_at = ?, vector_state = 'not_required',
          updated_at = ?, version = version + 1
         WHERE owner_id = ? AND id = ? AND version = ? AND status = 'active'`,
      ).bind(timestamp, timestamp, input.ownerId, input.memoryId, input.expectedVersion),
    ]);
    if ((update.meta.changes ?? 0) !== 1) throw new MemoryConflictError();
    const memory = await this.getLibraryById(input.ownerId, input.memoryId);
    if (!memory) throw new Error("Archived memory could not be read back");
    return memory;
  }

  async restoreMemory(input: {
    ownerId: string;
    memoryId: string;
    expectedVersion: number;
  }): Promise<LibraryMemoryRecord> {
    const timestamp = this.dependencies.now();
    const [, update] = await this.database.batch([
      this.database.prepare(
        `INSERT INTO memory_events (
          id, memory_id, owner_id, event_type, actor_type, previous_json, next_json, created_at
        ) SELECT ?, id, owner_id, 'updated', 'human', ?, ?, ? FROM memories
          WHERE owner_id = ? AND id = ? AND version = ? AND status = 'archived' AND purged_at IS NULL`,
      ).bind(
        this.dependencies.newId(),
        JSON.stringify({ status: "archived", version: input.expectedVersion }),
        JSON.stringify({ status: "active", archivedAt: null, version: input.expectedVersion + 1 }),
        timestamp,
        input.ownerId,
        input.memoryId,
        input.expectedVersion,
      ),
      this.database.prepare(
        `UPDATE memories SET status = 'active', archived_at = NULL, vector_state = 'pending',
          updated_at = ?, version = version + 1
         WHERE owner_id = ? AND id = ? AND version = ? AND status = 'archived' AND purged_at IS NULL`,
      ).bind(timestamp, input.ownerId, input.memoryId, input.expectedVersion),
    ]);
    if ((update.meta.changes ?? 0) !== 1) throw new MemoryConflictError();
    const memory = await this.getLibraryById(input.ownerId, input.memoryId);
    if (!memory) throw new Error("Restored memory could not be read back");
    return memory;
  }

  async purgeMemory(input: {
    ownerId: string;
    memoryId: string;
    expectedVersion: number;
    confirmation: string;
  }): Promise<LibraryMemoryRecord> {
    if (input.confirmation !== `PURGE ${input.memoryId}`) throw new MemoryConflictError("Purge confirmation does not match");
    const timestamp = this.dependencies.now();
    const tombstone = "[Permanently purged]";
    const contentSha256 = await this.dependencies.sha256(tombstone);
    const [, , update] = await this.database.batch([
      this.database.prepare(
        `INSERT INTO memory_events (
          id, memory_id, owner_id, event_type, actor_type, previous_json, next_json, created_at
        ) SELECT ?, id, owner_id, 'updated', 'human', ?, ?, ? FROM memories
          WHERE owner_id = ? AND id = ? AND version = ? AND status = 'archived' AND purged_at IS NULL`,
      ).bind(
        this.dependencies.newId(),
        JSON.stringify({ status: "archived", version: input.expectedVersion }),
        JSON.stringify({ status: "archived", purgedAt: timestamp, version: input.expectedVersion + 1 }),
        timestamp,
        input.ownerId,
        input.memoryId,
        input.expectedVersion,
      ),
      this.database.prepare(
        `DELETE FROM memory_labels WHERE owner_id = ? AND memory_id = ?
          AND EXISTS (SELECT 1 FROM memories WHERE owner_id = ? AND id = ? AND version = ? AND status = 'archived' AND purged_at IS NULL)`,
      ).bind(
        input.ownerId,
        input.memoryId,
        input.ownerId,
        input.memoryId,
        input.expectedVersion,
      ),
      this.database.prepare(
        `UPDATE memories SET content = ?, content_sha256 = ?, summary = NULL,
          sensitivity = 'normal', source_system = NULL, source_id = NULL, source_url = NULL,
          source_client = NULL, source_model = NULL, conversation_id = NULL, message_id = NULL,
          scope_id = NULL, review_at = NULL, expires_at = NULL, vector_state = 'not_required',
          purged_at = ?, updated_at = ?, version = version + 1
         WHERE owner_id = ? AND id = ? AND version = ? AND status = 'archived' AND purged_at IS NULL`,
      ).bind(
        tombstone,
        contentSha256,
        timestamp,
        timestamp,
        input.ownerId,
        input.memoryId,
        input.expectedVersion,
      ),
    ]);
    if ((update.meta.changes ?? 0) < 1) throw new MemoryConflictError();
    const memory = await this.getLibraryById(input.ownerId, input.memoryId);
    if (
      !memory ||
      memory.version !== input.expectedVersion + 1 ||
      memory.purgedAt !== timestamp
    ) {
      throw new MemoryConflictError();
    }
    return memory;
  }

  async listMemoryEvents(ownerId: string, memoryId: string, limit = 50): Promise<MemoryEventRecord[]> {
    const result = await this.database.prepare(
      `SELECT id, memory_id, event_type, actor_type, client, model, source_url,
        correlation_id, previous_json, next_json, created_at
       FROM memory_events WHERE owner_id = ? AND memory_id = ?
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    ).bind(ownerId, memoryId, Math.max(1, Math.min(Math.floor(limit), 100))).all<{
      id: string;
      memory_id: string;
      event_type: string;
      actor_type: string;
      client: string | null;
      model: string | null;
      source_url: string | null;
      correlation_id: string | null;
      previous_json: string | null;
      next_json: string | null;
      created_at: string;
    }>();
    return result.results.map((row) => ({
      id: row.id,
      memoryId: row.memory_id,
      eventType: row.event_type,
      actorType: row.actor_type,
      client: row.client,
      model: row.model,
      sourceUrl: row.source_url,
      correlationId: row.correlation_id,
      previous: parseEventJson(row.previous_json),
      next: parseEventJson(row.next_json),
      createdAt: row.created_at,
    }));
  }

  async setVectorState(
    ownerId: string,
    id: string,
    state: "indexed" | "failed",
  ): Promise<void> {
    const timestamp = this.dependencies.now();
    const eventType = state === "indexed" ? "indexed" : "index_failed";
    const [update] = await this.database.batch([
      this.database
        .prepare(
          `UPDATE memories
           SET vector_state = ?, vector_updated_at = ?, updated_at = ?
           WHERE owner_id = ? AND id = ?`,
        )
        .bind(state, timestamp, timestamp, ownerId, id),
      this.database
        .prepare(
          `INSERT INTO memory_events (
            id, memory_id, owner_id, event_type, actor_type, next_json, created_at
          )
          SELECT ?, id, owner_id, ?, 'system', ?, ?
          FROM memories WHERE owner_id = ? AND id = ?`,
        )
        .bind(
          this.dependencies.newId(),
          eventType,
          JSON.stringify({ vectorState: state }),
          timestamp,
          ownerId,
          id,
        ),
    ]);

    if ((update.meta.changes ?? 0) !== 1) {
      throw new Error("Memory not found while updating vector state");
    }
  }

  async listNeedingVectorRepair(
    ownerId: string,
    limit: number,
  ): Promise<MemoryRecord[]> {
    const result = await this.database.prepare(
      `SELECT ${MEMORY_COLUMNS} FROM memories
       WHERE owner_id = ? AND status IN ('active', 'superseded')
         AND vector_state IN ('pending', 'failed')
       ORDER BY CASE vector_state WHEN 'failed' THEN 0 ELSE 1 END, updated_at ASC
       LIMIT ?`,
    ).bind(ownerId, limit).all<MemoryRow>();
    return result.results.map(toMemory);
  }

  async listDirectives(ownerId: string): Promise<MemoryRecord[]> {
    const result = await this.database
      .prepare(
        `SELECT ${MEMORY_COLUMNS} FROM memories
         WHERE owner_id = ? AND kind = 'directive' AND status = 'active'
         ORDER BY importance DESC, created_at ASC
         LIMIT 100`,
      )
      .bind(ownerId)
      .all<MemoryRow>();
    return result.results.map(toMemory);
  }

  async listActive(
    ownerId: string,
    limit = 100,
    includeDirectives = true,
  ): Promise<MemoryRecord[]> {
    const boundedLimit = Math.max(1, Math.min(Math.floor(limit), 100));
    const result = await this.database
      .prepare(
        `SELECT ${MEMORY_COLUMNS} FROM memories
         WHERE owner_id = ? AND status = 'active'
           AND (? = 1 OR kind = 'memory')
         ORDER BY updated_at DESC, memory_number DESC
         LIMIT ?`,
      )
      .bind(ownerId, includeDirectives ? 1 : 0, boundedLimit)
      .all<MemoryRow>();
    return result.results.map(toMemory);
  }

  async searchExact(
    ownerId: string,
    query: string,
    limit: number,
    includeDirectives: boolean,
    includeSuperseded = false,
    historicalYear?: number,
  ): Promise<MemoryRecord[]> {
    const safeQuery = buildSafeFtsQuery(query);
    if (!safeQuery) return [];
    const result = await this.database
      .prepare(
        `SELECT ${qualifiedMemoryColumns("m")}
         FROM memories_fts
         JOIN memories m ON m.memory_number = memories_fts.rowid
         WHERE memories_fts MATCH ?
           AND m.owner_id = ?
           AND (m.status = 'active' OR (? = 1 AND m.status = 'superseded'))
           AND (? IS NULL OR (
             COALESCE(m.valid_from, m.created_at) < ?
             AND (m.valid_until IS NULL OR m.valid_until > ?)
           ))
           AND (? = 1 OR m.kind = 'memory')
         ORDER BY
           CASE WHEN instr(lower(m.content), lower(?)) > 0 THEN 0 ELSE 1 END,
           memories_fts.rank,
           m.importance DESC,
           m.updated_at DESC,
           m.memory_number DESC
         LIMIT ?`,
      )
      .bind(
        safeQuery,
        ownerId,
        includeSuperseded ? 1 : 0,
        historicalYear ?? null,
        historicalYear === undefined
          ? null
          : `${historicalYear + 1}-01-01T00:00:00.000Z`,
        historicalYear === undefined
          ? null
          : `${historicalYear}-01-01T00:00:00.000Z`,
        includeDirectives ? 1 : 0,
        query,
        limit,
      )
      .all<MemoryRow>();
    return result.results.map(toMemory);
  }

  async counts(ownerId: string): Promise<{
    memories: number;
    directives: number;
    indexed: number;
    pending: number;
    failed: number;
  }> {
    const row = await this.database
      .prepare(
        `SELECT
           SUM(CASE WHEN kind = 'memory' AND status = 'active' THEN 1 ELSE 0 END) AS memories,
           SUM(CASE WHEN kind = 'directive' AND status = 'active' THEN 1 ELSE 0 END) AS directives,
           SUM(CASE WHEN status = 'active' AND vector_state = 'indexed' THEN 1 ELSE 0 END) AS indexed,
           SUM(CASE WHEN status = 'active' AND vector_state = 'pending' THEN 1 ELSE 0 END) AS pending,
           SUM(CASE WHEN status = 'active' AND vector_state = 'failed' THEN 1 ELSE 0 END) AS failed
         FROM memories
         WHERE owner_id = ?`,
      )
      .bind(ownerId)
      .first<{
        memories: number | null;
        directives: number | null;
        indexed: number | null;
        pending: number | null;
        failed: number | null;
      }>();
    return {
      memories: row?.memories ?? 0,
      directives: row?.directives ?? 0,
      indexed: row?.indexed ?? 0,
      pending: row?.pending ?? 0,
      failed: row?.failed ?? 0,
    };
  }
}
