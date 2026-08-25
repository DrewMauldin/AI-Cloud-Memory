CREATE TABLE agent_runs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  task_id TEXT REFERENCES tasks(id),
  conversation_id TEXT REFERENCES conversations(id),
  correlation_id TEXT NOT NULL CHECK (length(correlation_id) BETWEEN 1 AND 200),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('human', 'model', 'automation', 'import', 'system')),
  client TEXT CHECK (client IS NULL OR length(client) <= 100),
  model TEXT CHECK (model IS NULL OR length(model) <= 100),
  source_url TEXT CHECK (source_url IS NULL OR length(source_url) <= 2048),
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'awaiting_human', 'cancelled')),
  receipt TEXT CHECK (receipt IS NULL OR length(receipt) <= 2000),
  started_at TEXT NOT NULL,
  heartbeat_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (owner_id, correlation_id)
) STRICT;

CREATE INDEX agent_runs_owner_recent_idx
  ON agent_runs(owner_id, updated_at DESC, id DESC);
CREATE INDEX agent_runs_owner_task_idx
  ON agent_runs(owner_id, task_id, updated_at DESC, id DESC);

CREATE TABLE agent_run_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('started', 'heartbeat', 'finished')),
  from_status TEXT,
  to_status TEXT NOT NULL CHECK (to_status IN ('running', 'succeeded', 'failed', 'awaiting_human', 'cancelled')),
  receipt TEXT CHECK (receipt IS NULL OR length(receipt) <= 2000),
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX agent_run_events_run_idx
  ON agent_run_events(owner_id, run_id, created_at DESC, id DESC);

CREATE TABLE agent_run_memories (
  run_id TEXT NOT NULL REFERENCES agent_runs(id),
  memory_id TEXT NOT NULL REFERENCES memories(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  relation TEXT NOT NULL CHECK (relation IN ('read', 'created', 'superseded')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id, memory_id, relation)
) WITHOUT ROWID;

CREATE INDEX agent_run_memories_owner_memory_idx
  ON agent_run_memories(owner_id, memory_id, created_at DESC);
