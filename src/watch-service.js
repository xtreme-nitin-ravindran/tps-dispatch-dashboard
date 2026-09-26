import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { normalizeWatchSubscriptionRequest } from './watch-backend-validation.js';

export class WatchAuthorizationError extends Error {
  constructor() {
    super('Watch possession token is invalid');
    this.name = 'WatchAuthorizationError';
    this.code = 'INVALID_POSSESSION_TOKEN';
  }
}

function tokenHash(token) {
  return createHash('sha256').update(token, 'utf8').digest();
}

function tokenMatches(token, expectedHex) {
  if (typeof token !== 'string' || !token) return false;
  const actual = tokenHash(token);
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function clientWatch(record) {
  return {
    id: record.id,
    centre: { ...record.centre },
    radiusKm: record.radiusKm,
    service: record.service,
    category: record.category,
    active: record.active,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastConfirmedAt: record.lastConfirmedAt,
    ...(record.vapidKeyVersion ? { vapidKeyVersion: record.vapidKeyVersion } : {})
  };
}

export function createWatchService({
  repository,
  idGenerator = () => randomUUID(),
  possessionTokenGenerator = () => randomBytes(32).toString('base64url'),
  now = () => new Date().toISOString(),
  vapidKeyVersion
} = {}) {
  if (!repository) throw new TypeError('A watch repository is required');

  return {
    async createWatch(request) {
      const normalized = normalizeWatchSubscriptionRequest(request);
      const id = idGenerator();
      const possessionToken = possessionTokenGenerator();
      if (typeof id !== 'string' || !id || typeof possessionToken !== 'string' || !possessionToken) {
        throw new TypeError('Watch ID and possession token generators must return non-empty strings');
      }
      const timestamp = now();
      const record = {
        id,
        ...normalized,
        createdAt: timestamp,
        updatedAt: timestamp,
        lastConfirmedAt: timestamp,
        possessionTokenHash: tokenHash(possessionToken).toString('hex'),
        ...(vapidKeyVersion ? { vapidKeyVersion } : {})
      };
      await repository.createWatch(record);
      return { watch: clientWatch(record), possessionToken };
    },

    async getWatch(id) {
      const record = await repository.getWatch(id);
      return record ? clientWatch(record) : null;
    },

    async updateWatch(id, possessionToken, request) {
      const current = await repository.getWatch(id);
      if (!current) return null;
      if (!tokenMatches(possessionToken, current.possessionTokenHash)) throw new WatchAuthorizationError();
      const normalized = normalizeWatchSubscriptionRequest(request);
      const timestamp = now();
      const record = {
        ...current,
        ...normalized,
        id: current.id,
        createdAt: current.createdAt,
        updatedAt: timestamp,
        lastConfirmedAt: timestamp,
        possessionTokenHash: current.possessionTokenHash
      };
      await repository.updateWatch(id, record);
      return { watch: clientWatch(record) };
    },

    async deleteWatch(id, possessionToken) {
      const current = await repository.getWatch(id);
      if (!current) return { deleted: false };
      if (!tokenMatches(possessionToken, current.possessionTokenHash)) throw new WatchAuthorizationError();
      await repository.deleteWatch(id);
      return { deleted: true };
    },

    async listActiveWatches() {
      return repository.listActiveWatches();
    }
  };
}
