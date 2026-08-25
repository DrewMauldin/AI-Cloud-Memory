ALTER TABLE memories ADD COLUMN supersession_token TEXT;

CREATE INDEX IF NOT EXISTS memories_supersedes_idx
  ON memories(owner_id, supersedes_id);

CREATE INDEX IF NOT EXISTS memories_validity_idx
  ON memories(owner_id, status, valid_from, valid_until);

CREATE INDEX IF NOT EXISTS memory_events_correlation_idx
  ON memory_events(owner_id, correlation_id, created_at DESC);
