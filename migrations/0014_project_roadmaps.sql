CREATE TABLE roadmap_items (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 240),
  description TEXT,
  horizon TEXT NOT NULL DEFAULT 'later' CHECK (horizon IN ('next', 'later', 'someday')),
  status TEXT NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested', 'considering', 'planned', 'promoted', 'dismissed', 'archived')),
  impact TEXT NOT NULL DEFAULT 'medium' CHECK (impact IN ('low', 'medium', 'high')),
  effort TEXT NOT NULL DEFAULT 'medium' CHECK (effort IN ('small', 'medium', 'large')),
  position REAL NOT NULL DEFAULT 0,
  source_type TEXT NOT NULL DEFAULT 'human' CHECK (source_type IN ('human', 'model', 'automation', 'import')),
  source_client TEXT,
  source_model TEXT,
  source_url TEXT,
  correlation_id TEXT,
  promoted_task_id TEXT REFERENCES tasks(id),
  promoted_at TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0)
) STRICT;

CREATE INDEX roadmap_items_owner_active_idx
  ON roadmap_items(owner_id, status, horizon, project_id, position, updated_at DESC);
CREATE INDEX roadmap_items_project_idx
  ON roadmap_items(owner_id, project_id, status, horizon, position);
CREATE UNIQUE INDEX roadmap_items_owner_correlation_idx
  ON roadmap_items(owner_id, correlation_id) WHERE correlation_id IS NOT NULL;

CREATE TABLE roadmap_events (
  id TEXT PRIMARY KEY,
  roadmap_id TEXT NOT NULL REFERENCES roadmap_items(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('created', 'updated', 'archived', 'restored', 'promoted')),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('human', 'model', 'automation', 'import', 'system')),
  client TEXT,
  model TEXT,
  source_url TEXT,
  correlation_id TEXT,
  previous_json TEXT,
  next_json TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX roadmap_events_item_idx
  ON roadmap_events(owner_id, roadmap_id, created_at DESC, id DESC);

CREATE TABLE roadmap_promotions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  correlation_id TEXT NOT NULL,
  roadmap_id TEXT NOT NULL REFERENCES roadmap_items(id),
  task_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (owner_id, correlation_id)
) STRICT;

CREATE INDEX roadmap_promotions_roadmap_idx
  ON roadmap_promotions(owner_id, roadmap_id, created_at DESC);
