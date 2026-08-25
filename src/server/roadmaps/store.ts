export type RoadmapHorizon = "next" | "later" | "someday";
export type RoadmapStatus = "suggested" | "considering" | "planned" | "promoted" | "dismissed" | "archived";
export type RoadmapImpact = "low" | "medium" | "high";
export type RoadmapEffort = "small" | "medium" | "large";
export type RoadmapActor = "human" | "model" | "automation" | "import" | "system";

export interface RoadmapRecord {
  id: string;
  ownerId: string;
  projectId: string;
  title: string;
  description: string | null;
  horizon: RoadmapHorizon;
  status: RoadmapStatus;
  impact: RoadmapImpact;
  effort: RoadmapEffort;
  position: number;
  sourceType: Exclude<RoadmapActor, "system">;
  sourceClient: string | null;
  sourceModel: string | null;
  sourceUrl: string | null;
  promotedTaskId: string | null;
  promotedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface RoadmapEventRecord {
  id: string;
  roadmapId: string;
  eventType: "created" | "updated" | "archived" | "restored" | "promoted";
  actorType: RoadmapActor;
  client: string | null;
  model: string | null;
  sourceUrl: string | null;
  correlationId: string | null;
  createdAt: string;
}

interface RoadmapRow {
  id: string;
  owner_id: string;
  project_id: string;
  title: string;
  description: string | null;
  horizon: RoadmapHorizon;
  status: RoadmapStatus;
  impact: RoadmapImpact;
  effort: RoadmapEffort;
  position: number;
  source_type: RoadmapRecord["sourceType"];
  source_client: string | null;
  source_model: string | null;
  source_url: string | null;
  promoted_task_id: string | null;
  promoted_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

interface Dependencies {
  now: () => string;
  newId: () => string;
}

const defaultDependencies: Dependencies = {
  now: () => new Date().toISOString(),
  newId: () => crypto.randomUUID(),
};

const ROADMAP_COLUMNS = `
  id, owner_id, project_id, title, description, horizon, status, impact, effort,
  position, source_type, source_client, source_model, source_url,
  promoted_task_id, promoted_at, archived_at, created_at, updated_at, version
`;

function toRoadmap(row: RoadmapRow): RoadmapRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    horizon: row.horizon,
    status: row.status,
    impact: row.impact,
    effort: row.effort,
    position: row.position,
    sourceType: row.source_type,
    sourceClient: row.source_client,
    sourceModel: row.source_model,
    sourceUrl: row.source_url,
    promotedTaskId: row.promoted_task_id,
    promotedAt: row.promoted_at,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

export class RoadmapNotFoundError extends Error {
  constructor(message = "Roadmap item not found") {
    super(message);
    this.name = "RoadmapNotFoundError";
  }
}

export class RoadmapVersionConflictError extends Error {
  constructor() {
    super("The roadmap item changed since it was loaded");
    this.name = "RoadmapVersionConflictError";
  }
}

export class RoadmapCorrelationConflictError extends Error {
  constructor() {
    super("The correlation ID is already bound to a different roadmap intent");
    this.name = "RoadmapCorrelationConflictError";
  }
}

export class RoadmapStore {
  constructor(
    private readonly database: D1Database,
    private readonly dependencies: Dependencies = defaultDependencies,
  ) {}

  async get(ownerId: string, roadmapId: string): Promise<RoadmapRecord | null> {
    const row = await this.database.prepare(
      `SELECT ${ROADMAP_COLUMNS} FROM roadmap_items WHERE owner_id = ? AND id = ?`,
    ).bind(ownerId, roadmapId).first<RoadmapRow>();
    return row ? toRoadmap(row) : null;
  }

  async list(ownerId: string, input: {
    projectId?: string;
    scope?: "active" | "promoted" | "archived" | "all";
    horizon?: RoadmapHorizon;
    status?: RoadmapStatus;
    limit?: number;
  } = {}): Promise<{ items: RoadmapRecord[]; total: number }> {
    const scope = input.scope ?? "active";
    const limit = Math.max(1, Math.min(Math.floor(input.limit ?? 100), 100));
    const scopeClause = scope === "all"
      ? ""
      : scope === "promoted"
        ? "AND status = 'promoted'"
        : scope === "archived"
          ? "AND status IN ('dismissed', 'archived')"
          : `AND status IN ('suggested', 'considering', 'planned')
             AND EXISTS (
               SELECT 1 FROM projects AS roadmap_project
               WHERE roadmap_project.id = roadmap_items.project_id
                 AND roadmap_project.owner_id = roadmap_items.owner_id
                 AND roadmap_project.status != 'archived'
             )`;
    const where = `owner_id = ?
      AND (? IS NULL OR project_id = ?)
      AND (? IS NULL OR horizon = ?)
      AND (? IS NULL OR status = ?)
      ${scopeClause}`;
    const bindings = [
      ownerId,
      input.projectId ?? null,
      input.projectId ?? null,
      input.horizon ?? null,
      input.horizon ?? null,
      input.status ?? null,
      input.status ?? null,
    ];
    const [rows, count] = await Promise.all([
      this.database.prepare(
        `SELECT ${ROADMAP_COLUMNS} FROM roadmap_items WHERE ${where}
         ORDER BY
           CASE horizon WHEN 'next' THEN 0 WHEN 'later' THEN 1 ELSE 2 END,
           CASE status WHEN 'planned' THEN 0 WHEN 'considering' THEN 1 WHEN 'suggested' THEN 2 ELSE 3 END,
           CASE impact WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
           CASE effort WHEN 'small' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
           position, updated_at DESC, id ASC
         LIMIT ?`,
      ).bind(...bindings, limit).all<RoadmapRow>(),
      this.database.prepare(`SELECT COUNT(*) AS total FROM roadmap_items WHERE ${where}`)
        .bind(...bindings).first<{ total: number }>(),
    ]);
    return { items: rows.results.map(toRoadmap), total: count?.total ?? 0 };
  }

  async create(input: {
    ownerId: string;
    projectId: string;
    title: string;
    description?: string;
    horizon?: RoadmapHorizon;
    impact?: RoadmapImpact;
    effort?: RoadmapEffort;
    sourceType?: RoadmapRecord["sourceType"];
    client?: string;
    model?: string;
    sourceUrl?: string;
    correlationId?: string;
  }): Promise<RoadmapRecord> {
    if (input.correlationId) {
      const replay = await this.byCorrelation(input.ownerId, input.correlationId);
      if (replay) {
        if (sameCreateIntent(replay, input)) return replay;
        throw new RoadmapCorrelationConflictError();
      }
    }
    const id = this.dependencies.newId();
    const eventId = this.dependencies.newId();
    const timestamp = this.dependencies.now();
    const sourceType = input.sourceType ?? "human";
    try {
      const [insert] = await this.database.batch([
        this.database.prepare(
          `INSERT INTO roadmap_items (
            id, owner_id, project_id, title, description, horizon, impact, effort,
            position, source_type, source_client, source_model, source_url,
            correlation_id, created_at, updated_at
          )
          SELECT ?, owner_id, id, ?, ?, ?, ?, ?,
            COALESCE((SELECT MAX(position) + 1000 FROM roadmap_items WHERE owner_id = ? AND project_id = ?), 1000),
            ?, ?, ?, ?, ?, ?, ?
          FROM projects WHERE owner_id = ? AND id = ? AND status != 'archived'`,
        ).bind(
          id,
          input.title,
          input.description ?? null,
          input.horizon ?? "later",
          input.impact ?? "medium",
          input.effort ?? "medium",
          input.ownerId,
          input.projectId,
          sourceType,
          input.client ?? null,
          input.model ?? null,
          input.sourceUrl ?? null,
          input.correlationId ?? null,
          timestamp,
          timestamp,
          input.ownerId,
          input.projectId,
        ),
        this.database.prepare(
          `INSERT INTO roadmap_events (
            id, roadmap_id, owner_id, event_type, actor_type, client, model,
            source_url, correlation_id, next_json, created_at
          ) SELECT ?, id, owner_id, 'created', source_type, source_client, source_model,
            source_url, correlation_id, ?, ? FROM roadmap_items WHERE owner_id = ? AND id = ?`,
        ).bind(
          eventId,
          JSON.stringify({ title: input.title, status: "suggested", horizon: input.horizon ?? "later" }),
          timestamp,
          input.ownerId,
          id,
        ),
      ]);
      if ((insert.meta.changes ?? 0) !== 1) throw new RoadmapNotFoundError("Project not found");
    } catch (error) {
      if (input.correlationId) {
        const replay = await this.byCorrelation(input.ownerId, input.correlationId);
        if (replay && sameCreateIntent(replay, input)) return replay;
        if (replay) throw new RoadmapCorrelationConflictError();
      }
      throw error;
    }
    const roadmap = await this.get(input.ownerId, id);
    if (!roadmap) throw new Error("Created roadmap item could not be read back");
    return roadmap;
  }

  async update(input: {
    ownerId: string;
    roadmapId: string;
    expectedVersion: number;
    title?: string;
    description?: string | null;
    horizon?: RoadmapHorizon;
    status?: "suggested" | "considering" | "planned" | "dismissed";
    impact?: RoadmapImpact;
    effort?: RoadmapEffort;
    actorType: RoadmapActor;
    client?: string;
    model?: string;
    sourceUrl?: string;
    correlationId?: string;
  }): Promise<RoadmapRecord> {
    const current = await this.get(input.ownerId, input.roadmapId);
    if (!current || current.version !== input.expectedVersion || current.status === "archived" || current.status === "promoted") {
      throw new RoadmapVersionConflictError();
    }
    const timestamp = this.dependencies.now();
    const eventId = this.dependencies.newId();
    const nextStatus = input.status ?? current.status;
    const [event, update] = await this.database.batch([
      this.database.prepare(
        `INSERT INTO roadmap_events (
          id, roadmap_id, owner_id, event_type, actor_type, client, model,
          source_url, correlation_id, previous_json, next_json, created_at
        ) SELECT ?, id, owner_id, 'updated', ?, ?, ?, ?, ?, ?, ?, ?
          FROM roadmap_items WHERE owner_id = ? AND id = ? AND version = ?
            AND status NOT IN ('archived', 'promoted')`,
      ).bind(
        eventId,
        input.actorType,
        input.client ?? null,
        input.model ?? null,
        input.sourceUrl ?? null,
        input.correlationId ?? null,
        JSON.stringify({ status: current.status, horizon: current.horizon, version: current.version }),
        JSON.stringify({ status: nextStatus, horizon: input.horizon ?? current.horizon, version: current.version + 1 }),
        timestamp,
        input.ownerId,
        input.roadmapId,
        input.expectedVersion,
      ),
      this.database.prepare(
        `UPDATE roadmap_items SET
          title = COALESCE(?, title),
          description = CASE WHEN ? = 1 THEN ? ELSE description END,
          horizon = COALESCE(?, horizon), status = COALESCE(?, status),
          impact = COALESCE(?, impact), effort = COALESCE(?, effort),
          updated_at = ?, version = version + 1
         WHERE owner_id = ? AND id = ? AND version = ? AND status NOT IN ('archived', 'promoted')`,
      ).bind(
        input.title ?? null,
        input.description !== undefined ? 1 : 0,
        input.description ?? null,
        input.horizon ?? null,
        input.status ?? null,
        input.impact ?? null,
        input.effort ?? null,
        timestamp,
        input.ownerId,
        input.roadmapId,
        input.expectedVersion,
      ),
    ]);
    if ((event.meta.changes ?? 0) !== 1 || (update.meta.changes ?? 0) !== 1) throw new RoadmapVersionConflictError();
    const roadmap = await this.get(input.ownerId, input.roadmapId);
    if (!roadmap) throw new Error("Updated roadmap item could not be read back");
    return roadmap;
  }

  async archive(input: {
    ownerId: string;
    roadmapId: string;
    expectedVersion: number;
    actorType: RoadmapActor;
    client?: string;
    model?: string;
    sourceUrl?: string;
  }): Promise<RoadmapRecord> {
    return this.lifecycle(input, "archived");
  }

  async restore(input: {
    ownerId: string;
    roadmapId: string;
    expectedVersion: number;
    actorType: RoadmapActor;
    client?: string;
    model?: string;
    sourceUrl?: string;
  }): Promise<RoadmapRecord> {
    return this.lifecycle(input, "restored");
  }

  async promote(input: {
    ownerId: string;
    roadmapId: string;
    expectedVersion: number;
    correlationId: string;
    actorType?: RoadmapActor;
    client: string;
    model?: string;
    sourceUrl?: string;
  }): Promise<{ roadmap: RoadmapRecord; task: PromotedTask; replayed: boolean }> {
    const prior = await this.promotion(input.ownerId, input.correlationId);
    if (prior) {
      if (prior.roadmapId !== input.roadmapId) throw new RoadmapCorrelationConflictError();
      return this.promotionResult(input.ownerId, prior, true);
    }
    const current = await this.get(input.ownerId, input.roadmapId);
    if (!current) throw new RoadmapNotFoundError();
    if (current.version !== input.expectedVersion || !["suggested", "considering", "planned"].includes(current.status)) {
      throw new RoadmapVersionConflictError();
    }
    const promotionId = this.dependencies.newId();
    const taskId = this.dependencies.newId();
    const taskEventId = this.dependencies.newId();
    const roadmapEventId = this.dependencies.newId();
    const timestamp = this.dependencies.now();
    const actorType = input.actorType ?? "model";
    const priority = current.impact === "high" ? "high" : current.impact === "low" ? "low" : "medium";
    const positionRow = await this.database.prepare(
      `SELECT COALESCE(MAX(position), 0) + 1000 AS position
       FROM tasks WHERE owner_id = ? AND project_id = ? AND status = 'inbox'`,
    ).bind(input.ownerId, current.projectId).first<{ position: number }>();
    try {
      const [claim, taskInsert, , , roadmapUpdate] = await this.database.batch([
        this.database.prepare(
          `INSERT INTO roadmap_promotions (id, owner_id, correlation_id, roadmap_id, task_id, created_at)
           SELECT ?, r.owner_id, ?, r.id, ?, ? FROM roadmap_items r
           JOIN projects p ON p.id = r.project_id AND p.owner_id = r.owner_id
           WHERE r.owner_id = ? AND r.id = ? AND r.version = ?
             AND r.status IN ('suggested', 'considering', 'planned') AND p.status != 'archived'`,
        ).bind(promotionId, input.correlationId, taskId, timestamp, input.ownerId, input.roadmapId, input.expectedVersion),
        this.database.prepare(
          `INSERT INTO tasks (
            id, owner_id, project_id, title, description, status, priority, position,
            source_type, source_client, source_model, source_url, created_at, updated_at
          ) SELECT p.task_id, r.owner_id, r.project_id, r.title, r.description, 'inbox', ?, ?,
            r.source_type, r.source_client, r.source_model, r.source_url, ?, ?
          FROM roadmap_promotions p JOIN roadmap_items r ON r.id = p.roadmap_id AND r.owner_id = p.owner_id
          WHERE p.owner_id = ? AND p.correlation_id = ?`,
        ).bind(priority, positionRow?.position ?? 1000, timestamp, timestamp, input.ownerId, input.correlationId),
        this.database.prepare(
          `INSERT INTO task_events (
            id, task_id, owner_id, event_type, actor_type, client, model,
            source_url, correlation_id, to_status, note, next_json, created_at
          ) SELECT ?, p.task_id, p.owner_id, 'created', ?, ?, ?, ?, ?, 'inbox', ?, ?, ?
          FROM roadmap_promotions p WHERE p.owner_id = ? AND p.correlation_id = ?`,
        ).bind(
          taskEventId,
          actorType,
          input.client,
          input.model ?? null,
          input.sourceUrl ?? null,
          input.correlationId,
          `Promoted from roadmap item ${current.id}`,
          JSON.stringify({ title: current.title, status: "inbox", roadmapId: current.id }),
          timestamp,
          input.ownerId,
          input.correlationId,
        ),
        this.database.prepare(
          `INSERT INTO roadmap_events (
            id, roadmap_id, owner_id, event_type, actor_type, client, model,
            source_url, correlation_id, previous_json, next_json, created_at
          ) SELECT ?, r.id, r.owner_id, 'promoted', ?, ?, ?, ?, ?, ?, ?, ?
          FROM roadmap_items r WHERE r.owner_id = ? AND r.id = ? AND r.version = ?`,
        ).bind(
          roadmapEventId,
          actorType,
          input.client,
          input.model ?? null,
          input.sourceUrl ?? null,
          input.correlationId,
          JSON.stringify({ status: current.status, version: current.version }),
          JSON.stringify({ status: "promoted", taskId, version: current.version + 1 }),
          timestamp,
          input.ownerId,
          input.roadmapId,
          input.expectedVersion,
        ),
        this.database.prepare(
          `UPDATE roadmap_items SET status = 'promoted', promoted_task_id = ?, promoted_at = ?,
             updated_at = ?, version = version + 1
           WHERE owner_id = ? AND id = ? AND version = ?
             AND status IN ('suggested', 'considering', 'planned')`,
        ).bind(taskId, timestamp, timestamp, input.ownerId, input.roadmapId, input.expectedVersion),
      ]);
      if ((claim.meta.changes ?? 0) !== 1 || (taskInsert.meta.changes ?? 0) !== 1 || (roadmapUpdate.meta.changes ?? 0) !== 1) {
        throw new RoadmapVersionConflictError();
      }
    } catch (error) {
      const replay = await this.promotion(input.ownerId, input.correlationId);
      if (replay) {
        if (replay.roadmapId !== input.roadmapId) throw new RoadmapCorrelationConflictError();
        return this.promotionResult(input.ownerId, replay, true);
      }
      throw error;
    }
    return this.promotionResult(input.ownerId, { roadmapId: input.roadmapId, taskId }, false);
  }

  async events(ownerId: string, roadmapId: string): Promise<RoadmapEventRecord[]> {
    const result = await this.database.prepare(
      `SELECT id, roadmap_id, event_type, actor_type, client, model, source_url,
         correlation_id, created_at FROM roadmap_events
       WHERE owner_id = ? AND roadmap_id = ? ORDER BY created_at DESC, id DESC LIMIT 100`,
    ).bind(ownerId, roadmapId).all<{
      id: string;
      roadmap_id: string;
      event_type: RoadmapEventRecord["eventType"];
      actor_type: RoadmapActor;
      client: string | null;
      model: string | null;
      source_url: string | null;
      correlation_id: string | null;
      created_at: string;
    }>();
    return result.results.map((row) => ({
      id: row.id,
      roadmapId: row.roadmap_id,
      eventType: row.event_type,
      actorType: row.actor_type,
      client: row.client,
      model: row.model,
      sourceUrl: row.source_url,
      correlationId: row.correlation_id,
      createdAt: row.created_at,
    }));
  }

  private async lifecycle(
    input: {
      ownerId: string;
      roadmapId: string;
      expectedVersion: number;
      actorType: RoadmapActor;
      client?: string;
      model?: string;
      sourceUrl?: string;
    },
    action: "archived" | "restored",
  ): Promise<RoadmapRecord> {
    const current = await this.get(input.ownerId, input.roadmapId);
    const valid = action === "archived"
      ? current && current.version === input.expectedVersion && !["archived", "promoted"].includes(current.status)
      : current && current.version === input.expectedVersion && current.status === "archived";
    if (!valid || !current) throw new RoadmapVersionConflictError();
    const timestamp = this.dependencies.now();
    const nextStatus = action === "archived" ? "archived" : "suggested";
    const eventId = this.dependencies.newId();
    const [event, update] = await this.database.batch([
      this.database.prepare(
        `INSERT INTO roadmap_events (
          id, roadmap_id, owner_id, event_type, actor_type, client, model, source_url,
          previous_json, next_json, created_at
        ) SELECT ?, id, owner_id, ?, ?, ?, ?, ?, ?, ?, ? FROM roadmap_items
          WHERE owner_id = ? AND id = ? AND version = ? AND status = ?`,
      ).bind(
        eventId,
        action,
        input.actorType,
        input.client ?? null,
        input.model ?? null,
        input.sourceUrl ?? null,
        JSON.stringify({ status: current.status, version: current.version }),
        JSON.stringify({ status: nextStatus, version: current.version + 1 }),
        timestamp,
        input.ownerId,
        input.roadmapId,
        input.expectedVersion,
        current.status,
      ),
      this.database.prepare(
        `UPDATE roadmap_items SET status = ?, archived_at = ?, updated_at = ?, version = version + 1
         WHERE owner_id = ? AND id = ? AND version = ? AND status = ?`,
      ).bind(
        nextStatus,
        action === "archived" ? timestamp : null,
        timestamp,
        input.ownerId,
        input.roadmapId,
        input.expectedVersion,
        current.status,
      ),
    ]);
    if ((event.meta.changes ?? 0) !== 1 || (update.meta.changes ?? 0) !== 1) throw new RoadmapVersionConflictError();
    const roadmap = await this.get(input.ownerId, input.roadmapId);
    if (!roadmap) throw new Error("Roadmap lifecycle result could not be read back");
    return roadmap;
  }

  private async byCorrelation(ownerId: string, correlationId: string): Promise<RoadmapRecord | null> {
    const row = await this.database.prepare(
      `SELECT ${ROADMAP_COLUMNS} FROM roadmap_items WHERE owner_id = ? AND correlation_id = ?`,
    ).bind(ownerId, correlationId).first<RoadmapRow>();
    return row ? toRoadmap(row) : null;
  }

  private async promotion(ownerId: string, correlationId: string) {
    return this.database.prepare(
      `SELECT roadmap_id, task_id FROM roadmap_promotions WHERE owner_id = ? AND correlation_id = ?`,
    ).bind(ownerId, correlationId).first<{ roadmap_id: string; task_id: string }>().then((row) => row ? ({
      roadmapId: row.roadmap_id,
      taskId: row.task_id,
    }) : null);
  }

  private async promotionResult(
    ownerId: string,
    receipt: { roadmapId: string; taskId: string },
    replayed: boolean,
  ): Promise<{ roadmap: RoadmapRecord; task: PromotedTask; replayed: boolean }> {
    const [roadmap, task] = await Promise.all([
      this.get(ownerId, receipt.roadmapId),
      this.database.prepare(
        `SELECT id, project_id, title, description, status, priority, position,
           due_at, blocker_summary, source_type, source_client, source_model,
           source_url, archived_at, created_at, updated_at, version
         FROM tasks WHERE owner_id = ? AND id = ?`,
      ).bind(ownerId, receipt.taskId).first<PromotedTaskRow>(),
    ]);
    if (!roadmap || !task) throw new Error("Roadmap promotion receipt is incomplete");
    return { roadmap, task: toPromotedTask(task), replayed };
  }
}

function sameCreateIntent(
  record: RoadmapRecord,
  input: {
    projectId: string;
    title: string;
    description?: string;
    horizon?: RoadmapHorizon;
    impact?: RoadmapImpact;
    effort?: RoadmapEffort;
    sourceType?: RoadmapRecord["sourceType"];
    client?: string;
    model?: string;
    sourceUrl?: string;
  },
): boolean {
  return record.projectId === input.projectId
    && record.title === input.title
    && record.description === (input.description ?? null)
    && record.horizon === (input.horizon ?? "later")
    && record.impact === (input.impact ?? "medium")
    && record.effort === (input.effort ?? "medium")
    && record.sourceType === (input.sourceType ?? "human")
    && record.sourceClient === (input.client ?? null)
    && record.sourceModel === (input.model ?? null)
    && record.sourceUrl === (input.sourceUrl ?? null);
}

interface PromotedTaskRow {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: "inbox";
  priority: "low" | "medium" | "high";
  position: number;
  due_at: string | null;
  blocker_summary: string | null;
  source_type: RoadmapRecord["sourceType"];
  source_client: string | null;
  source_model: string | null;
  source_url: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface PromotedTask {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: "inbox";
  priority: "low" | "medium" | "high";
  position: number;
  dueAt: string | null;
  blockerSummary: string | null;
  sourceType: RoadmapRecord["sourceType"];
  sourceClient: string | null;
  sourceModel: string | null;
  sourceUrl: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

function toPromotedTask(row: PromotedTaskRow): PromotedTask {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    position: row.position,
    dueAt: row.due_at,
    blockerSummary: row.blocker_summary,
    sourceType: row.source_type,
    sourceClient: row.source_client,
    sourceModel: row.source_model,
    sourceUrl: row.source_url,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}
