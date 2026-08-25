CREATE TABLE automation_runs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  operation TEXT NOT NULL CHECK (operation IN ('obsidian_projection', 'encrypted_export', 'reflection')),
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('manual', 'scheduled')),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  target_type TEXT NOT NULL CHECK (target_type IN ('webdav', 'github', 'd1', 'none')),
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'skipped')),
  item_count INTEGER NOT NULL DEFAULT 0 CHECK (item_count >= 0),
  content_sha256 TEXT CHECK (content_sha256 IS NULL OR length(content_sha256) = 64),
  error_class TEXT CHECK (error_class IS NULL OR length(error_class) BETWEEN 1 AND 100),
  scheduled_for TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (owner_id, operation, idempotency_key)
) STRICT;

CREATE INDEX automation_runs_owner_started_idx
  ON automation_runs(owner_id, started_at DESC);

CREATE TABLE connector_runs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  adapter_id TEXT NOT NULL CHECK (adapter_id IN ('cloud_memory_jsonl', 'truememory_jsonl', 'markdown_bundle', 'github_markdown')),
  source_ref TEXT CHECK (source_ref IS NULL OR length(source_ref) <= 500),
  input_sha256 TEXT NOT NULL CHECK (length(input_sha256) = 64),
  preview_sha256 TEXT NOT NULL CHECK (length(preview_sha256) = 64),
  status TEXT NOT NULL CHECK (status IN ('previewed', 'applying', 'completed', 'failed')),
  examined_count INTEGER NOT NULL DEFAULT 0 CHECK (examined_count >= 0),
  importable_count INTEGER NOT NULL DEFAULT 0 CHECK (importable_count >= 0),
  duplicate_count INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
  rejected_count INTEGER NOT NULL DEFAULT 0 CHECK (rejected_count >= 0),
  imported_count INTEGER NOT NULL DEFAULT 0 CHECK (imported_count >= 0),
  error_class TEXT CHECK (error_class IS NULL OR length(error_class) BETWEEN 1 AND 100),
  created_at TEXT NOT NULL,
  completed_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0)
) STRICT;

CREATE INDEX connector_runs_owner_created_idx
  ON connector_runs(owner_id, created_at DESC);

CREATE TABLE client_compatibility_receipts (
  owner_id TEXT NOT NULL REFERENCES users(id),
  client_id TEXT NOT NULL CHECK (client_id IN ('codex', 'claude_code', 'opencode', 'claude_web', 'chatgpt')),
  client_version TEXT CHECK (client_version IS NULL OR length(client_version) <= 100),
  endpoint TEXT NOT NULL CHECK (length(endpoint) BETWEEN 1 AND 2048),
  configured_status TEXT NOT NULL CHECK (configured_status IN ('unknown', 'configured', 'failed')),
  authenticated_status TEXT NOT NULL CHECK (authenticated_status IN ('unknown', 'authenticated', 'failed', 'not_supported')),
  verified_status TEXT NOT NULL CHECK (verified_status IN ('unknown', 'verified', 'degraded', 'failed')),
  expected_tool_count INTEGER NOT NULL CHECK (expected_tool_count BETWEEN 1 AND 100),
  discovered_tool_count INTEGER CHECK (discovered_tool_count IS NULL OR discovered_tool_count BETWEEN 0 AND 100),
  model TEXT CHECK (model IS NULL OR length(model) <= 100),
  evidence TEXT CHECK (evidence IS NULL OR length(evidence) <= 500),
  checked_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (owner_id, client_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE profile_facets (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  facet_type TEXT NOT NULL CHECK (facet_type IN ('identity', 'communication', 'working_style', 'preferences', 'constraints', 'goals')),
  content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 4000),
  summary TEXT CHECK (summary IS NULL OR length(summary) <= 500),
  sensitivity TEXT NOT NULL DEFAULT 'normal' CHECK (sensitivity IN ('normal', 'private', 'sensitive')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (owner_id, facet_type)
) STRICT;

CREATE INDEX profile_facets_owner_enabled_idx
  ON profile_facets(owner_id, enabled, archived_at, facet_type);

CREATE TABLE context_packs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  description TEXT CHECK (description IS NULL OR length(description) <= 500),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'project', 'repository', 'client')),
  scope_id TEXT CHECK (scope_id IS NULL OR length(scope_id) <= 200),
  facet_types_json TEXT NOT NULL DEFAULT '[]' CHECK (length(facet_types_json) <= 500),
  memory_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (length(memory_ids_json) <= 4000),
  query TEXT CHECK (query IS NULL OR length(query) <= 500),
  memory_limit INTEGER NOT NULL DEFAULT 5 CHECK (memory_limit BETWEEN 0 AND 10),
  directive_limit INTEGER NOT NULL DEFAULT 5 CHECK (directive_limit BETWEEN 0 AND 10),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (owner_id, name)
) STRICT;

CREATE INDEX context_packs_owner_scope_idx
  ON context_packs(owner_id, enabled, archived_at, scope_type, scope_id);

CREATE TABLE reflection_proposals (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  proposal_type TEXT NOT NULL CHECK (proposal_type IN ('exact_duplicate', 'probable_duplicate', 'stale_dynamic', 'expiry_review', 'supersession_review')),
  primary_memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  related_memory_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (length(related_memory_ids_json) <= 4000),
  evidence_json TEXT NOT NULL DEFAULT '{}' CHECK (length(evidence_json) <= 4000),
  suggested_action TEXT NOT NULL CHECK (suggested_action IN ('review', 'keep', 'archive', 'supersede')),
  impact TEXT NOT NULL CHECK (impact IN ('low', 'medium', 'high')),
  fingerprint TEXT NOT NULL CHECK (length(fingerprint) BETWEEN 1 AND 300),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'kept', 'dismissed', 'applied')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (owner_id, fingerprint)
) STRICT;

CREATE INDEX reflection_proposals_owner_status_idx
  ON reflection_proposals(owner_id, status, impact, updated_at DESC);
