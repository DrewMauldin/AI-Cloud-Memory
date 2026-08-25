export interface LifecycleActivityRecord {
  id: string;
  subjectType: "memory" | "project" | "task";
  subjectId: string;
  subjectTitle: string;
  eventType: string;
  actorType: string;
  client: string | null;
  model: string | null;
  sourceUrl: string | null;
  createdAt: string;
}

interface ActivityRow {
  id: string;
  subject_type: LifecycleActivityRecord["subjectType"];
  subject_id: string;
  subject_title: string;
  event_type: string;
  actor_type: string;
  client: string | null;
  model: string | null;
  source_url: string | null;
  created_at: string;
}

export class LifecycleActivityStore {
  constructor(private readonly database: D1Database) {}

  async list(ownerId: string, limit = 50): Promise<LifecycleActivityRecord[]> {
    const boundedLimit = Math.max(1, Math.min(Math.floor(limit), 100));
    const result = await this.database.prepare(
      `SELECT * FROM (
        SELECT me.id, 'memory' AS subject_type, me.memory_id AS subject_id,
          CASE WHEN m.sensitivity = 'normal'
            THEN COALESCE(NULLIF(m.summary, ''), substr(m.content, 1, 90))
            ELSE 'Private memory' END AS subject_title,
          CASE
            WHEN me.event_type = 'updated' AND instr(COALESCE(me.next_json, ''), '"purgedAt"') > 0 THEN 'purged'
            WHEN me.event_type = 'updated' AND instr(COALESCE(me.previous_json, ''), '"status":"archived"') > 0 THEN 'restored'
            WHEN me.event_type = 'updated' AND instr(COALESCE(me.next_json, ''), '"labels"') > 0 THEN 'labelled'
            ELSE me.event_type END AS event_type,
          me.actor_type, me.client, me.model, me.source_url, me.created_at
        FROM memory_events me
        JOIN memories m ON m.owner_id = me.owner_id AND m.id = me.memory_id
        WHERE me.owner_id = ?
        UNION ALL
        SELECT pe.id, 'project', pe.project_id, p.name, pe.event_type,
          'human', NULL, NULL, p.source_url, pe.created_at
        FROM project_events pe
        JOIN projects p ON p.owner_id = pe.owner_id AND p.id = pe.project_id
        WHERE pe.owner_id = ?
        UNION ALL
        SELECT te.id, 'task', te.task_id, t.title, te.event_type,
          te.actor_type, te.client, te.model, te.source_url, te.created_at
        FROM task_events te
        JOIN tasks t ON t.owner_id = te.owner_id AND t.id = te.task_id
        WHERE te.owner_id = ?
      ) activity
      ORDER BY created_at DESC, id DESC LIMIT ?`,
    ).bind(ownerId, ownerId, ownerId, boundedLimit).all<ActivityRow>();
    return result.results.map((row) => ({
      id: row.id,
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      subjectTitle: row.subject_title,
      eventType: row.event_type,
      actorType: row.actor_type,
      client: row.client,
      model: row.model,
      sourceUrl: row.source_url,
      createdAt: row.created_at,
    }));
  }
}
