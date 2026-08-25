CREATE TABLE capability_receipts (
  owner_id TEXT NOT NULL REFERENCES users(id),
  capability TEXT NOT NULL CHECK (capability IN ('d1', 'vectorize', 'workers_ai', 'oauth', 'mcp', 'n8n', 'obsidian_projection')),
  status TEXT NOT NULL CHECK (status IN ('verified', 'degraded', 'failed', 'configured', 'unknown')),
  detail TEXT NOT NULL CHECK (length(detail) BETWEEN 1 AND 500),
  evidence_sha256 TEXT CHECK (evidence_sha256 IS NULL OR length(evidence_sha256) = 64),
  source TEXT NOT NULL CHECK (length(source) BETWEEN 1 AND 100),
  checked_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (owner_id, capability)
) STRICT, WITHOUT ROWID;

CREATE INDEX capability_receipts_checked_idx ON capability_receipts(owner_id, checked_at DESC);
