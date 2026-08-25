CREATE TABLE memory_review_items (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  review_type TEXT NOT NULL CHECK (review_type IN ('probable_duplicate', 'source_conflict')),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'approved', 'rejected', 'dismissed')),
  candidate_content TEXT NOT NULL CHECK (length(candidate_content) BETWEEN 1 AND 12000),
  candidate_sha256 TEXT NOT NULL CHECK (length(candidate_sha256) = 64),
  candidate_namespace TEXT NOT NULL CHECK (length(candidate_namespace) BETWEEN 1 AND 100),
  candidate_kind TEXT NOT NULL CHECK (candidate_kind IN ('memory', 'directive')),
  matched_memory_id TEXT REFERENCES memories(id),
  similarity REAL CHECK (similarity IS NULL OR (similarity >= 0 AND similarity <= 1)),
  source_system TEXT CHECK (source_system IS NULL OR length(source_system) BETWEEN 1 AND 200),
  source_id TEXT CHECK (source_id IS NULL OR length(source_id) BETWEEN 1 AND 200),
  source_url TEXT CHECK (source_url IS NULL OR length(source_url) BETWEEN 1 AND 2048),
  client TEXT CHECK (client IS NULL OR length(client) BETWEEN 1 AND 100),
  model TEXT CHECK (model IS NULL OR length(model) BETWEEN 1 AND 100),
  correlation_id TEXT,
  request_sha256 TEXT NOT NULL CHECK (length(request_sha256) = 64),
  resolved_at TEXT,
  resolved_by TEXT CHECK (resolved_by IS NULL OR length(resolved_by) BETWEEN 1 AND 200),
  resolution_note TEXT CHECK (resolution_note IS NULL OR length(resolution_note) BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (owner_id, correlation_id)
) STRICT;

CREATE INDEX memory_review_items_owner_status_idx
  ON memory_review_items(owner_id, status, created_at DESC);
CREATE INDEX memory_review_items_match_idx
  ON memory_review_items(owner_id, matched_memory_id, created_at DESC);

CREATE TABLE memory_relevance_feedback (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  memory_id TEXT NOT NULL REFERENCES memories(id),
  query_sha256 TEXT NOT NULL CHECK (length(query_sha256) = 64),
  label TEXT NOT NULL
    CHECK (label IN ('helpful', 'not_helpful', 'incorrect', 'outdated', 'confirmed')),
  mode TEXT NOT NULL CHECK (mode IN ('exact', 'semantic', 'hybrid')),
  result_rank INTEGER CHECK (result_rank IS NULL OR (result_rank >= 1 AND result_rank <= 50)),
  result_score REAL CHECK (result_score IS NULL OR (result_score >= 0 AND result_score <= 1)),
  result_set_id TEXT CHECK (result_set_id IS NULL OR length(result_set_id) BETWEEN 1 AND 200),
  correlation_id TEXT,
  request_sha256 TEXT NOT NULL CHECK (length(request_sha256) = 64),
  client TEXT CHECK (client IS NULL OR length(client) BETWEEN 1 AND 100),
  model TEXT CHECK (model IS NULL OR length(model) BETWEEN 1 AND 100),
  created_at TEXT NOT NULL,
  UNIQUE (owner_id, correlation_id)
) STRICT;

CREATE INDEX memory_relevance_feedback_owner_created_idx
  ON memory_relevance_feedback(owner_id, created_at DESC);
CREATE INDEX memory_relevance_feedback_memory_idx
  ON memory_relevance_feedback(owner_id, memory_id, created_at DESC);
