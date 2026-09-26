import {
  evaluateWatchMatch,
  WATCH_SCHEMA,
  WATCH_SCHEMA_VERSION
} from './watch-matcher.js';
import { incidentDeepLink } from './view-controls.js';

export const NOTIFICATION_CANDIDATE_SCHEMA = 'sirento.notification-candidate';
export const NOTIFICATION_CANDIDATE_VERSION = 1;
export const DEFAULT_DEDUPE_RETENTION_DAYS = 30;
export const DEFAULT_INACTIVE_WATCH_RETENTION_DAYS = 30;
export const DEFAULT_SNAPSHOT_MAX_AGE_MS = 10 * 60 * 1000;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

export function validateIncidentSnapshot(snapshot) {
  const errors = [];
  if (!isObject(snapshot)) return { valid: false, errors: ['snapshot must be an object'] };
  if (snapshot.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (!validTimestamp(snapshot.fetchedAt)) errors.push('fetchedAt must be an ISO timestamp');
  if (!Array.isArray(snapshot.incidents)) {
    errors.push('incidents must be an array');
  } else {
    snapshot.incidents.forEach((incident, index) => {
      if (!isObject(incident) || typeof incident.id !== 'string' || !incident.id ||
          !['TFS', 'TPS'].includes(incident.source) || !validTimestamp(incident.timestamp)) {
        errors.push(`incidents[${index}] is invalid`);
      }
    });
  }
  if (snapshot.feeds !== undefined && !isObject(snapshot.feeds)) {
    errors.push('feeds must be an object');
  } else {
    for (const source of ['TFS', 'TPS']) {
      const feed = snapshot.feeds?.[source];
      if (feed === undefined) continue;
      if (!isObject(feed) || !['ok', 'stale', 'unavailable'].includes(feed.status) ||
          (feed.status !== 'unavailable' && !validTimestamp(feed.fetchedAt))) {
        errors.push(`feeds.${source} is invalid`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

function sourceState(snapshot, source, nowMs, maxAgeMs) {
  const feed = snapshot.feeds?.[source] || { fetchedAt: snapshot.fetchedAt, status: 'ok' };
  if (feed.status !== 'ok' && feed.status !== 'stale') return 'unavailable';
  if (feed.status === 'stale') return 'stale';
  const fetchedAt = Date.parse(feed.fetchedAt);
  return Number.isFinite(fetchedAt) && nowMs - fetchedAt <= maxAgeMs ? 'fresh' : 'stale';
}

function matcherWatch(record) {
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

function validSubscription(subscription) {
  if (!isObject(subscription) || typeof subscription.endpoint !== 'string' || !subscription.endpoint ||
      typeof subscription.p256dh !== 'string' || !subscription.p256dh ||
      typeof subscription.auth !== 'string' || !subscription.auth) return false;
  try {
    const endpoint = new URL(subscription.endpoint);
    return endpoint.protocol === 'https:' && !endpoint.username && !endpoint.password;
  } catch {
    return false;
  }
}

function candidateFor(watch, incident, match, baseUrl) {
  if (!validSubscription(watch.subscription)) return null;
  return {
    schema: NOTIFICATION_CANDIDATE_SCHEMA,
    version: NOTIFICATION_CANDIDATE_VERSION,
    watchId: watch.id,
    incidentId: incident.id,
    notificationKind: match.kind,
    dedupeKey: match.dedupeKey,
    incidentUrl: incidentDeepLink(baseUrl, incident.id),
    incident: {
      source: incident.source,
      description: String(incident.description || ''),
      location: String(incident.location || ''),
      timestamp: incident.timestamp,
      distanceKm: match.distanceKm
    },
    subscription: structuredClone(watch.subscription)
  };
}

export function createWatchNotificationPipeline({
  watchRepository,
  notificationRepository,
  incidentBaseUrl,
  now = () => new Date(),
  dedupeRetentionDays = DEFAULT_DEDUPE_RETENTION_DAYS,
  inactiveWatchRetentionDays = DEFAULT_INACTIVE_WATCH_RETENTION_DAYS,
  snapshotMaxAgeMs = DEFAULT_SNAPSHOT_MAX_AGE_MS
} = {}) {
  if (!watchRepository || !notificationRepository) throw new TypeError('Watch and notification repositories are required');
  const canonicalBase = new URL(incidentBaseUrl);
  if (canonicalBase.username || canonicalBase.password ||
      (canonicalBase.protocol !== 'https:' && canonicalBase.hostname !== 'localhost' && canonicalBase.hostname !== '127.0.0.1')) {
    throw new TypeError('Incident base URL must use HTTPS outside loopback');
  }
  if (!Number.isInteger(dedupeRetentionDays) || dedupeRetentionDays < 8 || dedupeRetentionDays > 365) {
    throw new TypeError('Dedupe retention must be between 8 and 365 days');
  }
  if (!Number.isInteger(inactiveWatchRetentionDays) || inactiveWatchRetentionDays < 1 || inactiveWatchRetentionDays > 365) {
    throw new TypeError('Inactive watch retention must be between 1 and 365 days');
  }

  return {
    async evaluateSnapshot(snapshot) {
      const validation = validateIncidentSnapshot(snapshot);
      if (!validation.valid) throw new TypeError(`Invalid incident snapshot: ${validation.errors.join('; ')}`);
      const runAt = now();
      const runAtMs = runAt.getTime();
      if (!Number.isFinite(runAtMs)) throw new TypeError('Pipeline clock returned an invalid date');
      const createdAt = runAt.toISOString();
      const expiresAt = new Date(runAtMs + dedupeRetentionDays * 24 * 60 * 60 * 1000).toISOString();
      const inactiveBefore = new Date(runAtMs - inactiveWatchRetentionDays * 24 * 60 * 60 * 1000).toISOString();
      const expiredRemoved = await notificationRepository.cleanupExpired(createdAt);
      const inactiveRemoved = await watchRepository.cleanupInactive(inactiveBefore);
      const watches = await watchRepository.listActiveWatches();
      const candidates = [];
      const deliveryCandidates = [];

      for (const record of watches) {
        const watch = matcherWatch(record);
        for (const incident of snapshot.incidents) {
          const match = evaluateWatchMatch(watch, incident, {
            sourceState: sourceState(snapshot, incident.source, runAtMs, snapshotMaxAgeMs)
          });
          if (!match.matches) continue;
          const candidate = candidateFor(record, incident, match, canonicalBase);
          if (!candidate) continue;
          deliveryCandidates.push(candidate);
          if (await notificationRepository.claimCandidate(candidate, { createdAt, expiresAt })) {
            candidates.push(candidate);
          }
        }
      }

      return { candidates, deliveryCandidates, expiredRemoved, inactiveRemoved, activeWatchCount: watches.length };
    }
  };
}
