CREATE TABLE IF NOT EXISTS watches (
  id TEXT PRIMARY KEY NOT NULL,
  active INTEGER NOT NULL CHECK (active IN (0, 1)),
  record_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS watches_active_id ON watches (active, id);
