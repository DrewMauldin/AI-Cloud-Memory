-- D1 supports SQLite FTS5: https://developers.cloudflare.com/d1/sql-api/sql-statements/
CREATE VIRTUAL TABLE memories_fts USING fts5(
  content,
  content = 'memories',
  content_rowid = 'memory_number',
  tokenize = 'unicode61'
);

INSERT INTO memories_fts(rowid, content)
SELECT memory_number, content FROM memories;

CREATE TRIGGER memories_fts_after_insert AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content)
  VALUES (new.memory_number, new.content);
END;

CREATE TRIGGER memories_fts_after_delete AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content)
  VALUES ('delete', old.memory_number, old.content);
END;

CREATE TRIGGER memories_fts_after_update AFTER UPDATE OF content ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content)
  VALUES ('delete', old.memory_number, old.content);
  INSERT INTO memories_fts(rowid, content)
  VALUES (new.memory_number, new.content);
END;
