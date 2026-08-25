#!/bin/sh
set -eu

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 /path/to/memories.db /path/to/truememory-import.jsonl" >&2
  exit 2
fi

source_db=$1
output_file=$2

if [ ! -f "$source_db" ]; then
  echo "TrueMemory database not found: $source_db" >&2
  exit 1
fi
case "$output_file" in
  *.jsonl) ;;
  *) echo "Output must end in .jsonl" >&2; exit 2 ;;
esac
if [ -e "$output_file" ]; then
  echo "Refusing to overwrite existing output: $output_file" >&2
  exit 1
fi
command -v sqlite3 >/dev/null 2>&1 || { echo "sqlite3 is required" >&2; exit 1; }
command -v shasum >/dev/null 2>&1 || { echo "shasum is required" >&2; exit 1; }

probe_dir=$(mktemp -d)
snapshot_db="$probe_dir/truememory-snapshot.db"
output_dir=$(dirname "$output_file")
mkdir -p "$output_dir"
staging_file=$(mktemp "$output_dir/.truememory-export.XXXXXX")
records_file=$(mktemp "$output_dir/.truememory-records.XXXXXX")
cleanup() {
  rm -rf "$probe_dir"
  rm -f "$staging_file" "$records_file"
}
trap cleanup EXIT INT TERM

# SQLite's online backup API creates a consistent point-in-time copy without
# mutating or locking the source for the duration of the export.
sqlite3 "$source_db" ".backup \"$snapshot_db\""
integrity=$(sqlite3 "$snapshot_db" "PRAGMA integrity_check;")
if [ "$integrity" != "ok" ]; then
  echo "Snapshot integrity check failed" >&2
  exit 1
fi
foreign_key_issues=$(sqlite3 "$snapshot_db" "PRAGMA foreign_key_check;")
if [ -n "$foreign_key_issues" ]; then
  echo "Snapshot foreign-key check failed" >&2
  exit 1
fi

record_count=$(sqlite3 "$snapshot_db" "SELECT COUNT(*) FROM messages;")
snapshot_sha=$(shasum -a 256 "$snapshot_db" | awk '{print $1}')
exported_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

sqlite3 -batch "$snapshot_db" "
SELECT json_object(
  'type', 'memory',
  'sourceMemoryId', CAST(id AS TEXT),
  'content', content,
  'directive', CASE WHEN directive = 1 THEN json('true') ELSE json('false') END,
  'timestamp', COALESCE(timestamp, ''),
  'sender', COALESCE(sender, ''),
  'recipient', COALESCE(recipient, ''),
  'category', COALESCE(category, ''),
  'modality', COALESCE(modality, ''),
  'metadata', json(CASE WHEN json_valid(metadata) AND json_type(metadata) = 'object' THEN metadata ELSE '{}' END)
)
FROM messages
ORDER BY id;
" > "$records_file"

payload_sha=$(shasum -a 256 "$records_file" | awk '{print $1}')
printf '{"type":"manifest","schemaVersion":2,"sourceSystem":"truememory","snapshotSha256":"%s","payloadSha256":"%s","recordCount":%s,"exportedAt":"%s"}\n' \
  "$snapshot_sha" "$payload_sha" "$record_count" "$exported_at" > "$staging_file"
cat "$records_file" >> "$staging_file"

actual_count=$(($(wc -l < "$staging_file") - 1))
if [ "$actual_count" -ne "$record_count" ]; then
  echo "Export count mismatch: expected $record_count, wrote $actual_count" >&2
  exit 1
fi

chmod 600 "$staging_file"
mv "$staging_file" "$output_file"
trap - EXIT INT TERM
rm -rf "$probe_dir"
rm -f "$records_file"

echo "Created $output_file with $record_count records from an integrity-checked snapshot."
echo "This file contains plaintext memory. Keep it in an ignored import directory and remove it after migration."
