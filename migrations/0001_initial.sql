PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  github_login TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE memories (
  memory_number INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL REFERENCES users(id),
  namespace TEXT NOT NULL DEFAULT 'default',
  kind TEXT NOT NULL CHECK (kind IN ('memory', 'directive')),
  content TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  summary TEXT,
  importance REAL NOT NULL DEFAULT 0.5 CHECK (importance >= 0 AND importance <= 1),
  confidence REAL NOT NULL DEFAULT 1 CHECK (confidence >= 0 AND confidence <= 1),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('proposed', 'active', 'superseded', 'rejected', 'archived')),
  sensitivity TEXT NOT NULL DEFAULT 'normal' CHECK (sensitivity IN ('normal', 'private', 'sensitive')),
  source_system TEXT,
  source_id TEXT,
  source_url TEXT,
  source_client TEXT,
  source_model TEXT,
  conversation_id TEXT,
  message_id TEXT,
  supersedes_id TEXT REFERENCES memories(id),
  valid_from TEXT,
  valid_until TEXT,
  vector_state TEXT NOT NULL DEFAULT 'pending' CHECK (vector_state IN ('pending', 'indexed', 'failed', 'not_required')),
  vector_updated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (owner_id, namespace, source_system, source_id)
) STRICT;

CREATE INDEX memories_owner_status_idx
  ON memories(owner_id, status, updated_at DESC);
CREATE INDEX memories_owner_kind_idx
  ON memories(owner_id, kind, status, created_at DESC);
CREATE INDEX memories_hash_idx
  ON memories(owner_id, namespace, content_sha256);
CREATE INDEX memories_vector_state_idx
  ON memories(owner_id, vector_state, updated_at);

CREATE TABLE memory_events (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL REFERENCES memories(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('created', 'updated', 'superseded', 'rejected', 'archived', 'indexed', 'index_failed', 'imported')),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('human', 'model', 'automation', 'import', 'system')),
  actor_id TEXT,
  client TEXT,
  model TEXT,
  source_url TEXT,
  correlation_id TEXT,
  previous_json TEXT,
  next_json TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX memory_events_memory_idx
  ON memory_events(memory_id, created_at DESC);
CREATE INDEX memory_events_owner_idx
  ON memory_events(owner_id, created_at DESC);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  description TEXT,
  colour TEXT NOT NULL DEFAULT '#c9ff3b',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'archived')),
  source_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0)
) STRICT;

CREATE INDEX projects_owner_status_idx
  ON projects(owner_id, status, updated_at DESC);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'inbox' CHECK (status IN ('inbox', 'planned', 'in_progress', 'blocked', 'review', 'done')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  position REAL NOT NULL DEFAULT 0,
  due_at TEXT,
  blocker_summary TEXT,
  source_type TEXT NOT NULL DEFAULT 'human' CHECK (source_type IN ('human', 'model', 'automation', 'import')),
  source_client TEXT,
  source_model TEXT,
  source_url TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0)
) STRICT;

CREATE INDEX tasks_board_idx
  ON tasks(owner_id, status, position, updated_at DESC);
CREATE INDEX tasks_project_idx
  ON tasks(owner_id, project_id, status, position);
CREATE INDEX tasks_provenance_idx
  ON tasks(owner_id, source_model, source_client, updated_at DESC);

CREATE TABLE task_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('created', 'updated', 'moved', 'linked', 'unlinked', 'archived')),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('human', 'model', 'automation', 'import', 'system')),
  actor_id TEXT,
  client TEXT,
  model TEXT,
  source_url TEXT,
  correlation_id TEXT,
  from_status TEXT,
  to_status TEXT,
  note TEXT,
  previous_json TEXT,
  next_json TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX task_events_task_idx
  ON task_events(task_id, created_at DESC);
CREATE INDEX task_events_owner_idx
  ON task_events(owner_id, created_at DESC);

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  title TEXT,
  client TEXT,
  model TEXT,
  source_url TEXT,
  external_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (owner_id, client, external_id)
) STRICT;

CREATE TABLE task_conversations (
  task_id TEXT NOT NULL REFERENCES tasks(id),
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (task_id, conversation_id)
) WITHOUT ROWID;

CREATE TABLE memory_links (
  memory_id TEXT NOT NULL REFERENCES memories(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('project', 'task')),
  target_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (memory_id, target_type, target_id)
) WITHOUT ROWID;

CREATE INDEX memory_links_target_idx
  ON memory_links(owner_id, target_type, target_id);

CREATE TABLE import_runs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  source_system TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  manifest_sha256 TEXT NOT NULL,
  snapshot_sha256 TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('dry_run', 'approved', 'applying', 'completed', 'failed')),
  examined_count INTEGER NOT NULL DEFAULT 0,
  new_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  probable_duplicate_count INTEGER NOT NULL DEFAULT 0,
  conflict_count INTEGER NOT NULL DEFAULT 0,
  malformed_count INTEGER NOT NULL DEFAULT 0,
  sensitive_count INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  approved_at TEXT,
  completed_at TEXT,
  UNIQUE (owner_id, source_system, snapshot_sha256)
) STRICT;

CREATE TABLE import_items (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES import_runs(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  source_system TEXT NOT NULL,
  source_memory_id TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  target_memory_id TEXT REFERENCES memories(id),
  outcome TEXT NOT NULL CHECK (outcome IN ('new', 'duplicate', 'probable_duplicate', 'conflict', 'malformed', 'sensitive', 'imported', 'failed')),
  reason_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (run_id, source_system, source_memory_id)
) STRICT;

CREATE INDEX import_items_run_outcome_idx
  ON import_items(run_id, outcome);

CREATE TABLE export_runs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  format TEXT NOT NULL CHECK (format IN ('encrypted_jsonl', 'redacted_markdown', 'receipt')),
  status TEXT NOT NULL CHECK (status IN ('generated', 'encrypted', 'committed', 'pushed', 'failed')),
  record_count INTEGER NOT NULL DEFAULT 0,
  content_sha256 TEXT,
  repository TEXT,
  repository_path TEXT,
  commit_sha TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
) STRICT;

CREATE INDEX export_runs_owner_idx
  ON export_runs(owner_id, created_at DESC);

CREATE TABLE idempotency_keys (
  owner_id TEXT NOT NULL REFERENCES users(id),
  key TEXT NOT NULL,
  operation TEXT NOT NULL,
  request_sha256 TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('in_progress', 'succeeded', 'failed')),
  response_status INTEGER,
  response_json TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, key)
) WITHOUT ROWID;

CREATE TABLE automation_tokens (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  label TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes_json TEXT NOT NULL,
  expires_at TEXT,
  last_used_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
) STRICT;
