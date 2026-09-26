function clone(value) {
  return value == null ? value : structuredClone(value);
}

export class InMemoryWatchRepository {
  #records = new Map();

  async createWatch(record) {
    if (this.#records.has(record.id)) throw new Error('Watch ID already exists');
    this.#records.set(record.id, clone(record));
    return clone(record);
  }

  async getWatch(id) {
    return clone(this.#records.get(id) ?? null);
  }

  async updateWatch(id, record) {
    if (!this.#records.has(id)) return null;
    this.#records.set(id, clone(record));
    return clone(record);
  }

  async deleteWatch(id) {
    return this.#records.delete(id);
  }

  async listActiveWatches() {
    return [...this.#records.values()].filter(record => record.active).map(clone);
  }

  async cleanupInactive(before) {
    let removed = 0;
    for (const [id, record] of this.#records) {
      if (!record.active && record.updatedAt <= before) {
        this.#records.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  reset() {
    this.#records.clear();
  }
}

function serializedRecord(record) {
  return JSON.stringify(clone(record));
}

function deserializedRecord(value, expectedId) {
  let record;
  try {
    record = JSON.parse(value);
  } catch {
    throw new Error('Stored watch record is invalid');
  }
  if (!record || typeof record !== 'object' || Array.isArray(record) ||
      typeof record.id !== 'string' || record.id !== expectedId || typeof record.active !== 'boolean') {
    throw new Error('Stored watch record is invalid');
  }
  return clone(record);
}

export class D1WatchRepository {
  constructor(database) {
    if (!database?.prepare) throw new TypeError('A D1 database binding is required');
    this.database = database;
  }

  async createWatch(record) {
    await this.database.prepare(
      'INSERT INTO watches (id, active, record_json, updated_at) VALUES (?1, ?2, ?3, ?4)'
    ).bind(record.id, record.active ? 1 : 0, serializedRecord(record), record.updatedAt).run();
    return clone(record);
  }

  async getWatch(id) {
    const row = await this.database.prepare(
      'SELECT id, record_json FROM watches WHERE id = ?1'
    ).bind(id).first();
    return row ? deserializedRecord(row.record_json, row.id) : null;
  }

  async updateWatch(id, record) {
    const result = await this.database.prepare(
      'UPDATE watches SET active = ?1, record_json = ?2, updated_at = ?3 WHERE id = ?4'
    ).bind(record.active ? 1 : 0, serializedRecord(record), record.updatedAt, id).run();
    return result?.meta?.changes ? clone(record) : null;
  }

  async deleteWatch(id) {
    const result = await this.database.prepare('DELETE FROM watches WHERE id = ?1').bind(id).run();
    return Boolean(result?.meta?.changes);
  }

  async listActiveWatches() {
    const result = await this.database.prepare(
      'SELECT id, record_json FROM watches WHERE active = 1 ORDER BY id'
    ).bind().all();
    const records = [];
    for (const row of result?.results || []) {
      try {
        records.push(deserializedRecord(row.record_json, row.id));
      } catch {
        // A corrupt private row is ignored so it cannot suppress every valid watch.
      }
    }
    return records;
  }

  async cleanupInactive(before) {
    const result = await this.database.prepare(
      'DELETE FROM watches WHERE active = 0 AND updated_at IS NOT NULL AND updated_at <= ?1'
    ).bind(before).run();
    return result?.meta?.changes || 0;
  }

  async deactivateSubscription(id, expectedEndpoint, deactivatedAt = new Date().toISOString()) {
    const record = await this.getWatch(id);
    if (!record || !record.active || record.subscription?.endpoint !== expectedEndpoint) return false;
    const replacement = clone(record);
    replacement.active = false;
    replacement.updatedAt = deactivatedAt;
    delete replacement.subscription;
    return Boolean(await this.updateWatch(id, replacement));
  }
}

const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1']);

export function createLoopbackWatchRepository({ enabled = false, hostname = '' } = {}) {
  if (!enabled || !loopbackHosts.has(hostname)) {
    throw new Error('The process-local watch repository requires an explicit switch and loopback hostname');
  }
  return new InMemoryWatchRepository();
}
