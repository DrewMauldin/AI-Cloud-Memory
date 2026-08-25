CREATE TABLE entities (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  canonical_name TEXT NOT NULL CHECK (length(canonical_name) BETWEEN 1 AND 200),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('person', 'organisation', 'project', 'place', 'concept', 'system')),
  description TEXT CHECK (description IS NULL OR length(description) <= 1000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (owner_id, entity_type, canonical_name)
) STRICT;

CREATE INDEX entities_owner_type_idx ON entities(owner_id, entity_type, canonical_name);

CREATE TABLE entity_aliases (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  alias TEXT NOT NULL CHECK (length(alias) BETWEEN 1 AND 200),
  normalised_alias TEXT NOT NULL CHECK (length(normalised_alias) BETWEEN 1 AND 200),
  created_at TEXT NOT NULL,
  UNIQUE (owner_id, normalised_alias)
) STRICT;

CREATE INDEX entity_aliases_entity_idx ON entity_aliases(owner_id, entity_id);

CREATE TABLE memory_entities (
  owner_id TEXT NOT NULL REFERENCES users(id),
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  relation TEXT NOT NULL DEFAULT 'mentioned' CHECK (relation IN ('mentioned', 'subject', 'evidence')),
  confidence REAL NOT NULL DEFAULT 1 CHECK (confidence >= 0 AND confidence <= 1),
  created_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, memory_id, entity_id, relation)
) STRICT, WITHOUT ROWID;

CREATE INDEX memory_entities_entity_idx ON memory_entities(owner_id, entity_id, memory_id);

CREATE TABLE entity_relationships (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  from_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  to_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL CHECK (length(relationship_type) BETWEEN 1 AND 100),
  valid_from TEXT,
  valid_until TEXT,
  evidence_memory_id TEXT REFERENCES memories(id) ON DELETE SET NULL,
  confidence REAL NOT NULL DEFAULT 1 CHECK (confidence >= 0 AND confidence <= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  CHECK (from_entity_id <> to_entity_id),
  UNIQUE (owner_id, from_entity_id, to_entity_id, relationship_type, valid_from)
) STRICT;

CREATE INDEX entity_relationships_from_idx ON entity_relationships(owner_id, from_entity_id, valid_until);
CREATE INDEX entity_relationships_to_idx ON entity_relationships(owner_id, to_entity_id, valid_until);

CREATE TABLE memory_doctor_findings (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  finding_type TEXT NOT NULL CHECK (finding_type IN ('expired', 'review_due', 'vector_failed', 'missing_provenance')),
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  detail TEXT NOT NULL CHECK (length(detail) BETWEEN 1 AND 1000),
  proposal_json TEXT NOT NULL DEFAULT '{}',
  fingerprint TEXT NOT NULL CHECK (length(fingerprint) BETWEEN 1 AND 300),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'approved', 'dismissed', 'resolved')),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (owner_id, fingerprint)
) STRICT;

CREATE INDEX memory_doctor_owner_status_idx ON memory_doctor_findings(owner_id, status, severity, created_at DESC);
