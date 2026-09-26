import { WATCH_SCHEMA, WATCH_SCHEMA_VERSION } from '../../src/watch-matcher.js';

export const matchingNow = new Date('2026-09-25T12:06:00.000Z');
export const matchingWatch = Object.freeze({
  id: 'watch-active',
  centre: Object.freeze({ latitude: 43.65, longitude: -79.38 }),
  radiusKm: 1,
  service: 'TFS',
  category: 'fire',
  active: true,
  subscription: Object.freeze({
    endpoint: 'https://push.example.test/send/opaque',
    expirationTime: null,
    p256dh: 'private-public-key-material',
    auth: 'private-auth-material'
  }),
  createdAt: '2026-09-25T11:00:00.000Z',
  updatedAt: '2026-09-25T11:00:00.000Z',
  lastConfirmedAt: '2026-09-25T11:00:00.000Z',
  possessionTokenHash: 'private-token-hash'
});

const latitudeDegreesPerKm = 180 / (Math.PI * 6371);
export function matchingIncident(id = 'incident-1', distanceKm = 0.5, overrides = {}) {
  return {
    id,
    source: 'TFS',
    description: 'Fire - Residential',
    location: 'Published intersection',
    timestamp: '2026-09-25T12:00:00.000Z',
    firstSeenAt: '2026-09-25T12:00:00.000Z',
    lastSeenAt: '2026-09-25T12:05:00.000Z',
    eventCategory: 'fire',
    isOngoing: true,
    geography: {
      coordinates: [matchingWatch.centre.latitude + distanceKm * latitudeDegreesPerKm, matchingWatch.centre.longitude]
    },
    ...overrides
  };
}

export function matchingSnapshot({
  incidents = [matchingIncident()],
  status = 'ok',
  fetchedAt = '2026-09-25T12:05:00.000Z'
} = {}) {
  return {
    schemaVersion: 1,
    source: 'TFS',
    fetchedAt,
    feeds: { TFS: { status, fetchedAt } },
    incidents
  };
}

export function matcherContractWatch(record = matchingWatch) {
  return {
    schema: WATCH_SCHEMA,
    version: WATCH_SCHEMA_VERSION,
    id: record.id,
    centre: record.centre,
    radiusKm: record.radiusKm,
    service: record.service,
    category: record.category,
    active: record.active
  };
}
