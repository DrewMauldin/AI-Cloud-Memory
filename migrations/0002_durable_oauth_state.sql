CREATE TABLE oauth_states (
  key TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX oauth_states_expiry_idx ON oauth_states(expires_at);
