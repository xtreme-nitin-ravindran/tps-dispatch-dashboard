function requiredCandidateField(candidate, field) {
  const value = candidate?.[field];
  if (typeof value !== 'string' || !value) throw new TypeError(`${field} must be a non-empty string`);
  return value;
}

export class D1NotificationRepository {
  constructor(database) {
    if (!database?.prepare) throw new TypeError('A D1 database binding is required');
    this.database = database;
  }

  async claimCandidate(candidate, { createdAt, expiresAt }) {
    const result = await this.database.prepare(
      `INSERT OR IGNORE INTO notification_dedupe
       (dedupe_key, watch_id, incident_id, notification_kind, created_at, expires_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
    ).bind(
      requiredCandidateField(candidate, 'dedupeKey'),
      requiredCandidateField(candidate, 'watchId'),
      requiredCandidateField(candidate, 'incidentId'),
      requiredCandidateField(candidate, 'notificationKind'),
      createdAt,
      expiresAt
    ).run();
    return Boolean(result?.meta?.changes);
  }

  async claimDelivery(dedupeKey, { now, leaseExpiresAt }) {
    const result = await this.database.prepare(
      `UPDATE notification_dedupe
       SET delivery_status = 'sending', lease_expires_at = ?2
       WHERE dedupe_key = ?1
         AND (delivery_status = 'pending'
           OR (delivery_status = 'retryable' AND (next_attempt_at IS NULL OR next_attempt_at <= ?3))
           OR (delivery_status = 'sending' AND lease_expires_at <= ?3))`
    ).bind(dedupeKey, leaseExpiresAt, now).run();
    return Boolean(result?.meta?.changes);
  }

  async recordAttempt(dedupeKey, { status, attemptedAt, nextAttemptAt = null, statusCode = null, attemptCount = 1 }) {
    const deliveredAt = status === 'delivered' ? attemptedAt : null;
    const result = await this.database.prepare(
      `UPDATE notification_dedupe
       SET delivery_status = ?2, attempt_count = attempt_count + ?6,
           next_attempt_at = ?3, lease_expires_at = NULL, delivered_at = ?4,
           last_status_code = ?5
       WHERE dedupe_key = ?1 AND delivery_status = 'sending'`
    ).bind(dedupeKey, status, nextAttemptAt, deliveredAt, statusCode, attemptCount).run();
    return Boolean(result?.meta?.changes);
  }

  async cleanupExpired(now) {
    const result = await this.database.prepare(
      'DELETE FROM notification_dedupe WHERE expires_at <= ?1'
    ).bind(now).run();
    return result?.meta?.changes || 0;
  }
}
