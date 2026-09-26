ALTER TABLE watches ADD COLUMN updated_at TEXT;

UPDATE watches
SET updated_at = COALESCE(
  json_extract(record_json, '$.updatedAt'),
  json_extract(record_json, '$.createdAt')
)
WHERE updated_at IS NULL;

CREATE INDEX IF NOT EXISTS watches_inactive_updated
  ON watches (active, updated_at);
