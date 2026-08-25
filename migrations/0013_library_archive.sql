ALTER TABLE memories ADD COLUMN archived_at TEXT;
ALTER TABLE memories ADD COLUMN purged_at TEXT;
ALTER TABLE memories ADD COLUMN last_retrieved_at TEXT;
ALTER TABLE memories ADD COLUMN retrieval_count INTEGER NOT NULL DEFAULT 0
  CHECK (retrieval_count >= 0);

CREATE TABLE memory_labels (
  owner_id TEXT NOT NULL REFERENCES users(id),
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 40),
  created_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, memory_id, label)
) WITHOUT ROWID;

CREATE INDEX memory_labels_owner_label_idx
  ON memory_labels(owner_id, label, memory_id);

CREATE INDEX memories_owner_archive_idx
  ON memories(owner_id, status, archived_at DESC, memory_number DESC);

ALTER TABLE projects ADD COLUMN archived_at TEXT;

CREATE TABLE project_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('archived', 'restored')),
  previous_json TEXT,
  next_json TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX project_events_project_idx
  ON project_events(owner_id, project_id, created_at DESC);
