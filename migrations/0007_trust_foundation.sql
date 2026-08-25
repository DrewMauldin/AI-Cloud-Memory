ALTER TABLE memories ADD COLUMN memory_type TEXT NOT NULL DEFAULT 'fact'
  CHECK (memory_type IN ('preference', 'decision', 'fact', 'episode', 'procedure', 'project_state', 'correction'));
ALTER TABLE memories ADD COLUMN scope_type TEXT NOT NULL DEFAULT 'global'
  CHECK (scope_type IN ('global', 'project', 'repository', 'client'));
ALTER TABLE memories ADD COLUMN scope_id TEXT;
ALTER TABLE memories ADD COLUMN retention_tier TEXT NOT NULL DEFAULT 'durable'
  CHECK (retention_tier IN ('core', 'durable', 'dynamic', 'archive'));
ALTER TABLE memories ADD COLUMN review_at TEXT;
ALTER TABLE memories ADD COLUMN expires_at TEXT;
ALTER TABLE memories ADD COLUMN observed_at TEXT;
ALTER TABLE memories ADD COLUMN recorded_at TEXT;

CREATE INDEX memories_owner_type_idx
  ON memories(owner_id, memory_type, status, updated_at DESC);
CREATE INDEX memories_owner_scope_idx
  ON memories(owner_id, scope_type, scope_id, status, updated_at DESC);
CREATE INDEX memories_owner_review_idx
  ON memories(owner_id, status, review_at, expires_at);

UPDATE memories
SET memory_type = CASE WHEN kind = 'directive' THEN 'preference' ELSE 'fact' END,
    retention_tier = CASE WHEN kind = 'directive' THEN 'core' ELSE 'durable' END,
    observed_at = COALESCE(valid_from, created_at),
    recorded_at = created_at;
