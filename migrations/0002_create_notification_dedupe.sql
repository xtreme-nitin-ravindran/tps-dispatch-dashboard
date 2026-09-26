CREATE TABLE IF NOT EXISTS notification_dedupe (
  dedupe_key TEXT PRIMARY KEY NOT NULL,
  watch_id TEXT NOT NULL,
  incident_id TEXT NOT NULL,
  notification_kind TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS notification_dedupe_expiry ON notification_dedupe (expires_at);
