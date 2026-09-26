export class FakeD1Database {
  constructor({ fail = false } = {}) {
    this.records = new Map();
    this.notifications = new Map();
    this.fail = fail;
  }

  prepare(sql) {
    const database = this;
    return {
      bind(...values) {
        return {
          async run() {
            if (database.fail) throw new Error('deterministic storage failure');
            if (sql.includes('INSERT OR IGNORE INTO notification_dedupe')) {
              const [dedupeKey, watchId, incidentId, notificationKind, createdAt, expiresAt] = values;
              if (database.notifications.has(dedupeKey)) return { meta: { changes: 0 } };
              database.notifications.set(dedupeKey, {
                dedupe_key: dedupeKey, watch_id: watchId, incident_id: incidentId,
                notification_kind: notificationKind, created_at: createdAt, expires_at: expiresAt,
                delivery_status: 'pending', attempt_count: 0, next_attempt_at: null,
                lease_expires_at: null, delivered_at: null, last_status_code: null
              });
              return { meta: { changes: 1 } };
            }
            if (sql.includes("SET delivery_status = 'sending'")) {
              const [dedupeKey, leaseExpiresAt, now] = values;
              const row = database.notifications.get(dedupeKey);
              const eligible = row && (row.delivery_status === 'pending' ||
                (row.delivery_status === 'retryable' && (!row.next_attempt_at || row.next_attempt_at <= now)) ||
                (row.delivery_status === 'sending' && row.lease_expires_at <= now));
              if (!eligible) return { meta: { changes: 0 } };
              Object.assign(row, { delivery_status: 'sending', lease_expires_at: leaseExpiresAt });
              return { meta: { changes: 1 } };
            }
            if (sql.includes('attempt_count = attempt_count +')) {
              const [dedupeKey, status, nextAttemptAt, deliveredAt, statusCode, attemptCount] = values;
              const row = database.notifications.get(dedupeKey);
              if (!row || row.delivery_status !== 'sending') return { meta: { changes: 0 } };
              Object.assign(row, {
                delivery_status: status, attempt_count: row.attempt_count + attemptCount,
                next_attempt_at: nextAttemptAt, lease_expires_at: null,
                delivered_at: deliveredAt, last_status_code: statusCode
              });
              return { meta: { changes: 1 } };
            }
            if (sql.startsWith('INSERT INTO watches')) {
              const [id, active, recordJson, updatedAt] = values;
              if (database.records.has(id)) throw new Error('duplicate');
              database.records.set(id, { id, active, record_json: recordJson, updated_at: updatedAt });
              return { meta: { changes: 1 } };
            }
            if (sql.startsWith('UPDATE watches')) {
              const [active, recordJson, updatedAt, id] = values;
              if (!database.records.has(id)) return { meta: { changes: 0 } };
              database.records.set(id, { id, active, record_json: recordJson, updated_at: updatedAt });
              return { meta: { changes: 1 } };
            }
            if (sql.startsWith('DELETE FROM notification_dedupe')) {
              let changes = 0;
              for (const [key, row] of database.notifications) {
                if (row.expires_at <= values[0]) {
                  database.notifications.delete(key);
                  changes += 1;
                }
              }
              return { meta: { changes } };
            }
            if (sql.startsWith('DELETE FROM watches')) {
              if (sql.includes('active = 0')) {
                let changes = 0;
                for (const [id, row] of database.records) {
                  if (row.active === 0 && row.updated_at && row.updated_at <= values[0]) {
                    database.records.delete(id);
                    changes += 1;
                  }
                }
                return { meta: { changes } };
              }
              return { meta: { changes: database.records.delete(values[0]) ? 1 : 0 } };
            }
            throw new Error('Unexpected D1 run statement');
          },
          async first() {
            if (database.fail) throw new Error('deterministic storage failure');
            return database.records.get(values[0]) || null;
          },
          async all() {
            if (database.fail) throw new Error('deterministic storage failure');
            return {
              results: [...database.records.values()]
                .filter(row => row.active === 1)
                .sort((left, right) => left.id.localeCompare(right.id))
            };
          }
        };
      }
    };
  }
}

export function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}
