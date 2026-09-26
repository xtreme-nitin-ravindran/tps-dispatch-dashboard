ALTER TABLE notification_dedupe ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (delivery_status IN ('pending', 'sending', 'retryable', 'delivered', 'permanent_failed', 'retry_exhausted'));
ALTER TABLE notification_dedupe ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notification_dedupe ADD COLUMN next_attempt_at TEXT;
ALTER TABLE notification_dedupe ADD COLUMN lease_expires_at TEXT;
ALTER TABLE notification_dedupe ADD COLUMN delivered_at TEXT;
ALTER TABLE notification_dedupe ADD COLUMN last_status_code INTEGER;

CREATE INDEX IF NOT EXISTS notification_dedupe_delivery
  ON notification_dedupe (delivery_status, next_attempt_at, lease_expires_at);
