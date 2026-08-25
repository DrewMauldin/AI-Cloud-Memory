export interface TaskStructure {
  taskId: string;
  parentTaskId: string | null;
  isMilestone: boolean;
  dependencies: string[];
  progress: TaskProgressRollup;
  version: number;
  updatedAt: string;
}

export interface TaskProgressRollup {
  childCount: number;
  completedChildCount: number;
  percent: number;
}

interface StructureRow {
  task_id: string;
  parent_task_id: string | null;
  is_milestone: number;
  version: number;
  updated_at: string;
}

export class TaskStructureStore {
  constructor(
    private readonly database: D1Database,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {}

  async get(ownerId: string, taskId: string): Promise<TaskStructure> {
    await this.ensure(ownerId, taskId);
    const structure = await this.read(ownerId, taskId);
    if (!structure) throw new Error("Task structure not found");
    return structure;
  }

  async read(ownerId: string, taskId: string): Promise<TaskStructure | null> {
    const row = await this.database.prepare(
      `SELECT task_id, parent_task_id, is_milestone, version, updated_at
       FROM task_structure WHERE owner_id = ? AND task_id = ?`,
    ).bind(ownerId, taskId).first<StructureRow>();
    if (!row) return null;
    const dependencies = await this.database.prepare(
      `SELECT depends_on_task_id FROM task_dependencies WHERE owner_id = ? AND task_id = ?
       ORDER BY depends_on_task_id LIMIT 100`,
    ).bind(ownerId, taskId).all<{ depends_on_task_id: string }>();
    const progress = await this.database.prepare(
      `SELECT COUNT(t.id) AS child_count,
         COALESCE(SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END), 0) AS completed_child_count
       FROM task_structure ts
       JOIN tasks t ON t.owner_id = ts.owner_id AND t.id = ts.task_id
       WHERE ts.owner_id = ? AND ts.parent_task_id = ? AND t.archived_at IS NULL`,
    ).bind(ownerId, taskId).first<{ child_count: number; completed_child_count: number }>();
    const childCount = progress?.child_count ?? 0;
    const completedChildCount = progress?.completed_child_count ?? 0;
    return {
      taskId: row.task_id,
      parentTaskId: row.parent_task_id,
      isMilestone: row.is_milestone === 1,
      dependencies: dependencies.results.map((dependency) => dependency.depends_on_task_id),
      progress: {
        childCount,
        completedChildCount,
        percent: childCount === 0 ? 0 : Math.round((completedChildCount / childCount) * 100),
      },
      version: row.version,
      updatedAt: row.updated_at,
    };
  }

  async update(input: {
    ownerId: string;
    taskId: string;
    expectedVersion: number;
    parentTaskId?: string | null;
    isMilestone?: boolean;
  }): Promise<TaskStructure> {
    const current = await this.get(input.ownerId, input.taskId);
    if (current.version !== input.expectedVersion) throw new Error("Task structure version conflict");
    if (input.parentTaskId) {
      await this.assertSameProject(input.ownerId, input.taskId, input.parentTaskId);
      if (await this.wouldCreateParentCycle(input.ownerId, input.taskId, input.parentTaskId)) {
        throw new Error("Task parent cycle is not allowed");
      }
    }
    const nextParent = input.parentTaskId !== undefined ? input.parentTaskId : current.parentTaskId;
    const nextMilestone = input.isMilestone ?? current.isMilestone;
    const timestamp = this.now();
    const [event, update] = await this.database.batch([
      this.database.prepare(
        `INSERT INTO task_events (
           id, task_id, owner_id, event_type, actor_type, previous_json, next_json, created_at
         ) SELECT ?, id, owner_id, 'updated', 'human', ?, ?, ?
           FROM tasks WHERE owner_id = ? AND id = ?`,
      ).bind(
        this.newId(), JSON.stringify(current),
        JSON.stringify({ parentTaskId: nextParent, isMilestone: nextMilestone, version: current.version + 1 }),
        timestamp, input.ownerId, input.taskId,
      ),
      this.database.prepare(
        `UPDATE task_structure SET parent_task_id = ?, is_milestone = ?, updated_at = ?, version = version + 1
         WHERE owner_id = ? AND task_id = ? AND version = ?`,
      ).bind(nextParent, nextMilestone ? 1 : 0, timestamp, input.ownerId, input.taskId, input.expectedVersion),
    ]);
    if (event.meta.changes !== 1 || update.meta.changes !== 1) throw new Error("Task structure version conflict");
    return this.get(input.ownerId, input.taskId);
  }

  async addDependency(input: {
    ownerId: string;
    taskId: string;
    dependsOnTaskId: string;
    expectedVersion: number;
  }): Promise<TaskStructure> {
    const current = await this.get(input.ownerId, input.taskId);
    if (current.version !== input.expectedVersion) throw new Error("Task structure version conflict");
    await this.assertSameProject(input.ownerId, input.taskId, input.dependsOnTaskId);
    if (await this.wouldCreateDependencyCycle(input.ownerId, input.taskId, input.dependsOnTaskId)) {
      throw new Error("Task dependency cycle is not allowed");
    }
    if (current.dependencies.includes(input.dependsOnTaskId)) return current;
    const timestamp = this.now();
    const [dependency, update, event] = await this.database.batch([
      this.database.prepare(
        `INSERT INTO task_dependencies (owner_id, task_id, depends_on_task_id, created_at) VALUES (?, ?, ?, ?)`,
      ).bind(input.ownerId, input.taskId, input.dependsOnTaskId, timestamp),
      this.database.prepare(
        `UPDATE task_structure SET updated_at = ?, version = version + 1
         WHERE owner_id = ? AND task_id = ? AND version = ?`,
      ).bind(timestamp, input.ownerId, input.taskId, input.expectedVersion),
      this.database.prepare(
        `INSERT INTO task_events (id, task_id, owner_id, event_type, actor_type, next_json, created_at)
         VALUES (?, ?, ?, 'linked', 'human', ?, ?)`,
      ).bind(this.newId(), input.taskId, input.ownerId, JSON.stringify({ dependsOnTaskId: input.dependsOnTaskId }), timestamp),
    ]);
    if (dependency.meta.changes !== 1 || update.meta.changes !== 1 || event.meta.changes !== 1) {
      throw new Error("Task structure version conflict");
    }
    return this.get(input.ownerId, input.taskId);
  }

  async removeDependency(input: {
    ownerId: string;
    taskId: string;
    dependsOnTaskId: string;
    expectedVersion: number;
  }): Promise<TaskStructure> {
    const current = await this.get(input.ownerId, input.taskId);
    if (current.version !== input.expectedVersion) throw new Error("Task structure version conflict");
    if (!current.dependencies.includes(input.dependsOnTaskId)) return current;
    const timestamp = this.now();
    const [dependency, update, event] = await this.database.batch([
      this.database.prepare(
        "DELETE FROM task_dependencies WHERE owner_id = ? AND task_id = ? AND depends_on_task_id = ?",
      ).bind(input.ownerId, input.taskId, input.dependsOnTaskId),
      this.database.prepare(
        `UPDATE task_structure SET updated_at = ?, version = version + 1
         WHERE owner_id = ? AND task_id = ? AND version = ?`,
      ).bind(timestamp, input.ownerId, input.taskId, input.expectedVersion),
      this.database.prepare(
        `INSERT INTO task_events (id, task_id, owner_id, event_type, actor_type, next_json, created_at)
         VALUES (?, ?, ?, 'unlinked', 'human', ?, ?)`,
      ).bind(this.newId(), input.taskId, input.ownerId, JSON.stringify({ dependsOnTaskId: input.dependsOnTaskId }), timestamp),
    ]);
    if (dependency.meta.changes !== 1 || update.meta.changes !== 1 || event.meta.changes !== 1) {
      throw new Error("Task structure version conflict");
    }
    return this.get(input.ownerId, input.taskId);
  }

  private async ensure(ownerId: string, taskId: string): Promise<void> {
    const timestamp = this.now();
    const result = await this.database.prepare(
      `INSERT INTO task_structure (owner_id, task_id, created_at, updated_at)
       SELECT owner_id, id, ?, ? FROM tasks WHERE owner_id = ? AND id = ?
       ON CONFLICT(owner_id, task_id) DO NOTHING`,
    ).bind(timestamp, timestamp, ownerId, taskId).run();
    if (result.meta.changes === 0) {
      const existing = await this.database.prepare("SELECT task_id FROM task_structure WHERE owner_id = ? AND task_id = ?")
        .bind(ownerId, taskId).first<{ task_id: string }>();
      if (!existing) throw new Error("Task not found within owner boundary");
    }
  }

  private async assertSameProject(ownerId: string, taskId: string, relatedTaskId: string): Promise<void> {
    const row = await this.database.prepare(
      `SELECT a.id FROM tasks a JOIN tasks b ON b.owner_id = a.owner_id AND b.project_id = a.project_id
       WHERE a.owner_id = ? AND a.id = ? AND b.id = ? AND a.archived_at IS NULL AND b.archived_at IS NULL`,
    ).bind(ownerId, taskId, relatedTaskId).first<{ id: string }>();
    if (!row) throw new Error("Related task must exist in the same project and owner boundary");
  }

  private async wouldCreateParentCycle(ownerId: string, taskId: string, parentTaskId: string): Promise<boolean> {
    if (taskId === parentTaskId) return true;
    const row = await this.database.prepare(
      `WITH RECURSIVE ancestors(task_id) AS (
         SELECT ? UNION ALL
         SELECT ts.parent_task_id FROM task_structure ts JOIN ancestors a ON ts.task_id = a.task_id
         WHERE ts.owner_id = ? AND ts.parent_task_id IS NOT NULL
       ) SELECT task_id FROM ancestors WHERE task_id = ? LIMIT 1`,
    ).bind(parentTaskId, ownerId, taskId).first<{ task_id: string }>();
    return Boolean(row);
  }

  private async wouldCreateDependencyCycle(ownerId: string, taskId: string, dependsOnTaskId: string): Promise<boolean> {
    if (taskId === dependsOnTaskId) return true;
    const row = await this.database.prepare(
      `WITH RECURSIVE dependencies(task_id) AS (
         SELECT ? UNION
         SELECT td.depends_on_task_id FROM task_dependencies td JOIN dependencies d ON td.task_id = d.task_id
         WHERE td.owner_id = ?
       ) SELECT task_id FROM dependencies WHERE task_id = ? LIMIT 1`,
    ).bind(dependsOnTaskId, ownerId, taskId).first<{ task_id: string }>();
    return Boolean(row);
  }
}
