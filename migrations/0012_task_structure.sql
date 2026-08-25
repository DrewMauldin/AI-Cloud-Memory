CREATE TABLE task_structure (
  owner_id TEXT NOT NULL REFERENCES users(id),
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  parent_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  is_milestone INTEGER NOT NULL DEFAULT 0 CHECK (is_milestone IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (owner_id, task_id),
  CHECK (parent_task_id IS NULL OR parent_task_id <> task_id)
) STRICT, WITHOUT ROWID;

CREATE INDEX task_structure_parent_idx ON task_structure(owner_id, parent_task_id);

CREATE TABLE task_dependencies (
  owner_id TEXT NOT NULL REFERENCES users(id),
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, task_id, depends_on_task_id),
  CHECK (task_id <> depends_on_task_id)
) STRICT, WITHOUT ROWID;

CREATE INDEX task_dependencies_reverse_idx ON task_dependencies(owner_id, depends_on_task_id, task_id);
