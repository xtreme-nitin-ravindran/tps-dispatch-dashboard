import { D1NotificationRepository } from './notification-repository.js';
import { D1WatchRepository } from './watch-repository.js';
import { createWatchNotificationPipeline } from './watch-notification-pipeline.js';
import { createNotificationDeliveryController } from './notification-delivery.js';
import { loadWatchBackendConfig } from './watch-backend-config.js';
import { createWebPushSender } from './web-push-sender.js';

const SNAPSHOT_MAX_BYTES = 4 * 1024 * 1024;

function requiredUrl(environment, name) {
  const value = environment?.[name];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  const url = new URL(value.trim());
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error(`${name} must be an HTTPS URL without credentials`);
  return url.href;
}

async function loadSnapshot(url, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: { accept: 'application/json' },
    cf: { cacheTtl: 0, cacheEverything: false }
  });
  if (!response.ok) throw new Error('Normalized incident snapshot is unavailable');
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > SNAPSHOT_MAX_BYTES) throw new Error('Normalized incident snapshot is too large');
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > SNAPSHOT_MAX_BYTES) throw new Error('Normalized incident snapshot is too large');
  try {
    return JSON.parse(body);
  } catch {
    throw new Error('Normalized incident snapshot is invalid JSON');
  }
}

export function createScheduledWatchMatcher({ fetchImpl = fetch, now } = {}) {
  return async function scheduled(environment) {
    const snapshotUrl = requiredUrl(environment, 'WATCH_SNAPSHOT_URL');
    const incidentBaseUrl = requiredUrl(environment, 'WATCH_INCIDENT_BASE_URL');
    const snapshot = await loadSnapshot(snapshotUrl, fetchImpl);
    const pipeline = createWatchNotificationPipeline({
      watchRepository: new D1WatchRepository(environment.WATCH_DB),
      notificationRepository: new D1NotificationRepository(environment.WATCH_DB),
      incidentBaseUrl,
      ...(now ? { now } : {})
    });
    return pipeline.evaluateSnapshot(snapshot);
  };
}

export function createScheduledWatchDelivery({ fetchImpl = fetch, now, sender, wait } = {}) {
  return async function scheduled(environment) {
    const config = loadWatchBackendConfig(environment, { requireSendingSecrets: !sender });
    const snapshotUrl = requiredUrl(environment, 'WATCH_SNAPSHOT_URL');
    const incidentBaseUrl = requiredUrl(environment, 'WATCH_INCIDENT_BASE_URL');
    const snapshot = await loadSnapshot(snapshotUrl, fetchImpl);
    const watchRepository = new D1WatchRepository(environment.WATCH_DB);
    const notificationRepository = new D1NotificationRepository(environment.WATCH_DB);
    const pipeline = createWatchNotificationPipeline({
      watchRepository, notificationRepository, incidentBaseUrl, ...(now ? { now } : {})
    });
    const matching = await pipeline.evaluateSnapshot(snapshot);
    const pushSender = sender || createWebPushSender({ config, fetchImpl, ...(now ? { now: () => now().getTime() } : {}) });
    const controller = createNotificationDeliveryController({
      notificationRepository, watchRepository, sender: pushSender,
      ...(now ? { now } : {}), ...(wait ? { wait } : {})
    });
    const delivery = await controller.deliver(matching.deliveryCandidates);
    return {
      candidates: matching.candidates,
      expiredRemoved: matching.expiredRemoved,
      inactiveRemoved: matching.inactiveRemoved,
      activeWatchCount: matching.activeWatchCount,
      delivery
    };
  };
}
