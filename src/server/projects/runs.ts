export type AgentRunStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "awaiting_human"
  | "cancelled";
export type AgentRunActorType = "human" | "model" | "automation" | "import" | "system";
export type AgentRunMemoryRelation = "read" | "created" | "superseded";

export const MAX_RECEIPT_CHARS = 2_000;
export const MAX_RUN_LIST_LIMIT = 100;
export const MAX_EVENT_LIST_LIMIT = 100;
export const MAX_MEMORY_LIST_LIMIT = 100;
const MAX_BATCH_IDS = 80;
const MAX_BATCH_TASKS = 500;
const MAX_BATCH_RUNS = 100;

interface RunStoreDependencies {
  now: () => string;
  newId: () => string;
}

const defaultDependencies: RunStoreDependencies = {
  now: () => new Date().toISOString(),
  newId: () => crypto.randomUUID(),
};

const RUN_COLUMNS = `
  id, owner_id, task_id, conversation_id, correlation_id, actor_type,
  client, model, source_url, status, receipt, started_at, heartbeat_at,
  finished_at, created_at, updated_at, version
`;

interface AgentRunRow {
  id: string;
  owner_id: string;
  task_id: string | null;
  conversation_id: string | null;
  correlation_id: string;
  actor_type: AgentRunActorType;
  client: string | null;
  model: string | null;
  source_url: string | null;
  status: AgentRunStatus;
  receipt: string | null;
  started_at: string;
  heartbeat_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface AgentRunRecord {
  id: string;
  ownerId: string;
  taskId: string | null;
  conversationId: string | null;
  correlationId: string;
  actorType: AgentRunActorType;
  client: string | null;
  model: string | null;
  sourceUrl: string | null;
  status: AgentRunStatus;
  receipt: string | null;
  startedAt: string;
  heartbeatAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface AgentRunEventRecord {
  id: string;
  runId: string;
  eventType: "started" | "heartbeat" | "finished";
  fromStatus: AgentRunStatus | null;
  toStatus: AgentRunStatus;
  receipt: string | null;
  createdAt: string;
}

export interface AgentRunMemoryRecord {
  memoryId: string;
  relation: AgentRunMemoryRelation;
  createdAt: string;
}

export interface AgentRunMemoryBundle {
  memories: AgentRunMemoryRecord[];
  linkedMemoryCount: number;
}

export interface AgentRunMutationResult {
  run: AgentRunRecord;
  idempotent: boolean;
}

export class AgentRunNotFoundError extends Error {
  constructor(message = "Agent run not found") {
    super(message);
    this.name = "AgentRunNotFoundError";
  }
}

export class AgentRunTransitionError extends Error {
  constructor(message = "Agent run transition is not allowed") {
    super(message);
    this.name = "AgentRunTransitionError";
  }
}

export class AgentRunCorrelationConflictError extends Error {
  constructor() {
    super("The correlation ID is already bound to a different agent run");
    this.name = "AgentRunCorrelationConflictError";
  }
}

export class AgentRunValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentRunValidationError";
  }
}

function toRun(row: AgentRunRow): AgentRunRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    taskId: row.task_id,
    conversationId: row.conversation_id,
    correlationId: row.correlation_id,
    actorType: row.actor_type,
    client: row.client,
    model: row.model,
    sourceUrl: row.source_url,
    status: row.status,
    receipt: row.receipt,
    startedAt: row.started_at,
    heartbeatAt: row.heartbeat_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

function boundReceipt(receipt: string | undefined): string | null {
  if (receipt === undefined) return null;
  const characters = Array.from(receipt.trim());
  if (characters.length === 0) return null;
  return characters.length > MAX_RECEIPT_CHARS
    ? `${characters.slice(0, MAX_RECEIPT_CHARS - 1).join("")}…`
    : characters.join("");
}

function boundedLimit(value: number | undefined, fallback: number, maximum: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(maximum, Math.floor(value!)));
}

function boundedIds(values: readonly string[], maximum: number): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0))).slice(0, maximum);
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) result.push(values.slice(offset, offset + size));
  return result;
}

function optionalId(value: string | undefined): string | null {
  return value ?? null;
}

export class AgentRunStore {
  private readonly dependencies: RunStoreDependencies;

  constructor(
    private readonly database: D1Database,
    dependencies: Partial<RunStoreDependencies> = {},
  ) {
    this.dependencies = {
      now: dependencies.now ?? defaultDependencies.now,
      newId: dependencies.newId ?? defaultDependencies.newId,
    };
  }

  async getRun(ownerId: string, runId: string): Promise<AgentRunRecord | null> {
    const row = await this.database
      .prepare(`SELECT ${RUN_COLUMNS} FROM agent_runs WHERE owner_id = ? AND id = ?`)
      .bind(ownerId, runId)
      .first<AgentRunRow>();
    return row ? toRun(row) : null;
  }

  async getRunByCorrelation(ownerId: string, correlationId: string): Promise<AgentRunRecord | null> {
    return this.getByCorrelation(ownerId, correlationId);
  }

  private async getByCorrelation(ownerId: string, correlationId: string): Promise<AgentRunRecord | null> {
    const row = await this.database
      .prepare(`SELECT ${RUN_COLUMNS} FROM agent_runs WHERE owner_id = ? AND correlation_id = ?`)
      .bind(ownerId, correlationId)
      .first<AgentRunRow>();
    return row ? toRun(row) : null;
  }

  private async assertOwnerRecord(
    ownerId: string,
    table: "tasks" | "conversations" | "memories",
    id: string,
    label: string,
  ): Promise<void> {
    const row = await this.database
      .prepare(`SELECT id FROM ${table} WHERE owner_id = ? AND id = ?`)
      .bind(ownerId, id)
      .first<{ id: string }>();
    if (!row) throw new AgentRunNotFoundError(`${label} not found`);
  }

  private sameStart(
    run: AgentRunRecord,
    input: {
      taskId?: string;
      conversationId?: string;
      actorType: AgentRunActorType;
      client?: string;
      model?: string;
      sourceUrl?: string;
    },
  ): boolean {
    return run.taskId === optionalId(input.taskId)
      && run.conversationId === optionalId(input.conversationId)
      && run.actorType === input.actorType
      && run.client === optionalId(input.client)
      && run.model === optionalId(input.model)
      && run.sourceUrl === optionalId(input.sourceUrl);
  }

  async startRun(input: {
    ownerId: string;
    correlationId: string;
    taskId?: string;
    conversationId?: string;
    actorType: AgentRunActorType;
    client?: string;
    model?: string;
    sourceUrl?: string;
    receipt?: string;
  }): Promise<AgentRunMutationResult> {
    const correlationId = input.correlationId.trim();
    if (correlationId.length === 0 || correlationId.length > 200) {
      throw new AgentRunValidationError("Correlation ID must be between 1 and 200 characters");
    }
    if (input.taskId) await this.assertOwnerRecord(input.ownerId, "tasks", input.taskId, "Task");
    if (input.conversationId) {
      await this.assertOwnerRecord(input.ownerId, "conversations", input.conversationId, "Conversation");
    }

    const existing = await this.getByCorrelation(input.ownerId, correlationId);
    if (existing) {
      if (!this.sameStart(existing, input)) throw new AgentRunCorrelationConflictError();
      if (existing.status !== "running") {
        throw new AgentRunTransitionError("A completed agent run cannot be started again");
      }
      return { run: existing, idempotent: true };
    }

    const id = this.dependencies.newId();
    const timestamp = this.dependencies.now();
    const receipt = boundReceipt(input.receipt);
    try {
      await this.database.batch([
        this.database.prepare(
          `INSERT INTO agent_runs (
            id, owner_id, task_id, conversation_id, correlation_id, actor_type,
            client, model, source_url, status, receipt, started_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?)`,
        ).bind(
          id,
          input.ownerId,
          input.taskId ?? null,
          input.conversationId ?? null,
          correlationId,
          input.actorType,
          input.client ?? null,
          input.model ?? null,
          input.sourceUrl ?? null,
          receipt,
          timestamp,
          timestamp,
          timestamp,
        ),
        this.database.prepare(
          `INSERT INTO agent_run_events (
            id, run_id, owner_id, event_type, from_status, to_status, receipt, created_at
          ) VALUES (?, ?, ?, 'started', NULL, 'running', ?, ?)`,
        ).bind(this.dependencies.newId(), id, input.ownerId, receipt, timestamp),
      ]);
    } catch (error) {
      const raced = await this.getByCorrelation(input.ownerId, correlationId);
      if (raced) {
        if (!this.sameStart(raced, input)) throw new AgentRunCorrelationConflictError();
        if (raced.status !== "running") {
          throw new AgentRunTransitionError("A completed agent run cannot be started again");
        }
        return { run: raced, idempotent: true };
      }
      throw error;
    }

    const run = await this.getRun(input.ownerId, id);
    if (!run) throw new Error("Started agent run could not be read back");
    return { run, idempotent: false };
  }

  async heartbeat(input: {
    ownerId: string;
    runId: string;
    at?: string;
  }): Promise<AgentRunMutationResult> {
    const current = await this.getRun(input.ownerId, input.runId);
    if (!current) throw new AgentRunNotFoundError();
    if (current.status !== "running") {
      throw new AgentRunTransitionError("Only running agent runs can receive a heartbeat");
    }
    const timestamp = input.at ?? this.dependencies.now();
    if (current.heartbeatAt === timestamp) return { run: current, idempotent: true };

    const [event, update] = await this.database.batch([
      this.database.prepare(
        `INSERT INTO agent_run_events (
          id, run_id, owner_id, event_type, from_status, to_status, created_at
        ) SELECT ?, id, owner_id, 'heartbeat', status, status, ?
          FROM agent_runs WHERE owner_id = ? AND id = ? AND status = 'running' AND version = ?`,
      ).bind(this.dependencies.newId(), timestamp, input.ownerId, input.runId, current.version),
      this.database.prepare(
        `UPDATE agent_runs SET heartbeat_at = ?, updated_at = ?, version = version + 1
         WHERE owner_id = ? AND id = ? AND status = 'running' AND version = ?`,
      ).bind(timestamp, timestamp, input.ownerId, input.runId, current.version),
    ]);
    if ((event.meta.changes ?? 0) !== 1 || (update.meta.changes ?? 0) !== 1) {
      throw new AgentRunTransitionError("The agent run changed before its heartbeat was recorded");
    }
    const run = await this.getRun(input.ownerId, input.runId);
    if (!run) throw new AgentRunNotFoundError();
    return { run, idempotent: false };
  }

  async finishRun(input: {
    ownerId: string;
    runId: string;
    status: Exclude<AgentRunStatus, "running">;
    receipt?: string;
    finishedAt?: string;
  }): Promise<AgentRunMutationResult> {
    const current = await this.getRun(input.ownerId, input.runId);
    if (!current) throw new AgentRunNotFoundError();
    if (current.status === input.status) return { run: current, idempotent: true };
    if (current.status !== "running") {
      throw new AgentRunTransitionError("A terminal agent run cannot change outcome");
    }

    const timestamp = input.finishedAt ?? this.dependencies.now();
    const receipt = boundReceipt(input.receipt);
    const [event, update] = await this.database.batch([
      this.database.prepare(
        `INSERT INTO agent_run_events (
          id, run_id, owner_id, event_type, from_status, to_status, receipt, created_at
        ) SELECT ?, id, owner_id, 'finished', status, ?, ?, ?
          FROM agent_runs WHERE owner_id = ? AND id = ? AND status = 'running' AND version = ?`,
      ).bind(
        this.dependencies.newId(), input.status, receipt, timestamp,
        input.ownerId, input.runId, current.version,
      ),
      this.database.prepare(
        `UPDATE agent_runs SET status = ?, receipt = ?, finished_at = ?, updated_at = ?, version = version + 1
         WHERE owner_id = ? AND id = ? AND status = 'running' AND version = ?`,
      ).bind(
        input.status, receipt, timestamp, timestamp,
        input.ownerId, input.runId, current.version,
      ),
    ]);
    if ((event.meta.changes ?? 0) !== 1 || (update.meta.changes ?? 0) !== 1) {
      throw new AgentRunTransitionError("The agent run changed before its outcome was recorded");
    }
    const run = await this.getRun(input.ownerId, input.runId);
    if (!run) throw new AgentRunNotFoundError();
    return { run, idempotent: false };
  }

  async listRunsByTask(ownerId: string, taskId: string, limit = 50): Promise<AgentRunRecord[]> {
    const result = await this.database.prepare(
      `SELECT ${RUN_COLUMNS} FROM agent_runs
       WHERE owner_id = ? AND task_id = ?
       ORDER BY updated_at DESC, id DESC LIMIT ?`,
    ).bind(ownerId, taskId, boundedLimit(limit, 50, MAX_RUN_LIST_LIMIT)).all<AgentRunRow>();
    return result.results.map(toRun);
  }

  async listRecent(ownerId: string, limit = 50): Promise<AgentRunRecord[]> {
    const result = await this.database.prepare(
      `SELECT ${RUN_COLUMNS} FROM agent_runs
       WHERE owner_id = ?
       ORDER BY updated_at DESC, id DESC LIMIT ?`,
    ).bind(ownerId, boundedLimit(limit, 50, MAX_RUN_LIST_LIMIT)).all<AgentRunRow>();
    return result.results.map(toRun);
  }

  async listLatestRelevantByTask(
    ownerId: string,
    taskIds: readonly string[],
    perTaskLimit = 20,
  ): Promise<Map<string, AgentRunRecord[]>> {
    const ids = boundedIds(taskIds, MAX_BATCH_TASKS);
    const result = new Map<string, AgentRunRecord[]>();
    if (ids.length === 0) return result;
    const rowLimit = boundedLimit(perTaskLimit, 20, MAX_RUN_LIST_LIMIT);
    for (const batch of chunks(ids, MAX_BATCH_IDS)) {
      const placeholders = batch.map(() => "?").join(", ");
      const rows = await this.database.prepare(
        `SELECT ${RUN_COLUMNS}, row_number FROM (
           SELECT ${RUN_COLUMNS},
             ROW_NUMBER() OVER (PARTITION BY task_id ORDER BY updated_at DESC, id DESC) AS row_number
           FROM agent_runs
           WHERE owner_id = ? AND task_id IN (${placeholders})
             AND status IN ('failed', 'awaiting_human')
         ) ranked
         WHERE row_number <= ?
         ORDER BY task_id, updated_at DESC, id DESC`,
      ).bind(ownerId, ...batch, rowLimit).all<AgentRunRow & { row_number: number }>();
      for (const row of rows.results) {
        const runs = result.get(row.task_id ?? "") ?? [];
        runs.push(toRun(row));
        result.set(row.task_id ?? "", runs);
      }
    }
    return result;
  }

  async listRunEvents(ownerId: string, runId: string, limit = 100): Promise<AgentRunEventRecord[]> {
    const result = await this.database.prepare(
      `SELECT id, run_id, event_type, from_status, to_status, receipt, created_at
       FROM agent_run_events
       WHERE owner_id = ? AND run_id = ?
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    ).bind(ownerId, runId, boundedLimit(limit, 100, MAX_EVENT_LIST_LIMIT)).all<{
      id: string;
      run_id: string;
      event_type: AgentRunEventRecord["eventType"];
      from_status: AgentRunStatus | null;
      to_status: AgentRunStatus;
      receipt: string | null;
      created_at: string;
    }>();
    return result.results.map((row) => ({
      id: row.id,
      runId: row.run_id,
      eventType: row.event_type,
      fromStatus: row.from_status,
      toStatus: row.to_status,
      receipt: row.receipt,
      createdAt: row.created_at,
    }));
  }

  async linkMemory(input: {
    ownerId: string;
    runId: string;
    memoryId: string;
    relation: AgentRunMemoryRelation;
  }): Promise<AgentRunMemoryRecord> {
    const run = await this.getRun(input.ownerId, input.runId);
    if (!run) throw new AgentRunNotFoundError();
    await this.assertOwnerRecord(input.ownerId, "memories", input.memoryId, "Memory");
    const createdAt = this.dependencies.now();
    await this.database.prepare(
      `INSERT OR IGNORE INTO agent_run_memories (run_id, memory_id, owner_id, relation, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(input.runId, input.memoryId, input.ownerId, input.relation, createdAt).run();
    const row = await this.database.prepare(
      `SELECT relation, created_at FROM agent_run_memories
       WHERE run_id = ? AND memory_id = ? AND relation = ?`,
    ).bind(input.runId, input.memoryId, input.relation).first<{
      relation: AgentRunMemoryRelation;
      created_at: string;
    }>();
    if (!row) throw new Error("Agent run memory link could not be read back");
    return { memoryId: input.memoryId, relation: row.relation, createdAt: row.created_at };
  }

  async listRunMemories(ownerId: string, runId: string, limit = 100): Promise<AgentRunMemoryRecord[]> {
    const result = await this.database.prepare(
      `SELECT memory_id, relation, created_at
       FROM agent_run_memories
       WHERE owner_id = ? AND run_id = ?
       ORDER BY created_at DESC, memory_id DESC LIMIT ?`,
    ).bind(ownerId, runId, boundedLimit(limit, 100, MAX_MEMORY_LIST_LIMIT)).all<{
      memory_id: string;
      relation: AgentRunMemoryRelation;
      created_at: string;
    }>();
    return result.results.map((row) => ({
      memoryId: row.memory_id,
      relation: row.relation,
      createdAt: row.created_at,
    }));
  }

  async listRunMemoryBundles(
    ownerId: string,
    runIds: readonly string[],
    limitPerRun = 100,
  ): Promise<Map<string, AgentRunMemoryBundle>> {
    const ids = boundedIds(runIds, MAX_BATCH_RUNS);
    const result = new Map<string, AgentRunMemoryBundle>();
    if (ids.length === 0) return result;
    const rowLimit = boundedLimit(limitPerRun, 100, MAX_MEMORY_LIST_LIMIT);
    for (const batch of chunks(ids, MAX_BATCH_IDS)) {
      const placeholders = batch.map(() => "?").join(", ");
      const rows = await this.database.prepare(
        `SELECT memory_id, run_id, relation, created_at, linked_memory_count, row_number
         FROM (
           SELECT memory_id, run_id, relation, created_at,
             COUNT(*) OVER (PARTITION BY run_id) AS linked_memory_count,
             ROW_NUMBER() OVER (PARTITION BY run_id ORDER BY created_at DESC, memory_id DESC) AS row_number
           FROM agent_run_memories
           WHERE owner_id = ? AND run_id IN (${placeholders})
         ) ranked
         WHERE row_number <= ?
         ORDER BY run_id, created_at DESC, memory_id DESC`,
      ).bind(ownerId, ...batch, rowLimit).all<{
        memory_id: string;
        run_id: string;
        relation: AgentRunMemoryRelation;
        created_at: string;
        linked_memory_count: number;
        row_number: number;
      }>();
      for (const row of rows.results) {
        const bundle = result.get(row.run_id) ?? { memories: [], linkedMemoryCount: row.linked_memory_count };
        bundle.memories.push({ memoryId: row.memory_id, relation: row.relation, createdAt: row.created_at });
        result.set(row.run_id, bundle);
      }
    }
    return result;
  }
}
