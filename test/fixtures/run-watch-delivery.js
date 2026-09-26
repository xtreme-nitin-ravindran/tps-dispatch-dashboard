import { D1NotificationRepository } from '../../src/notification-repository.js';
import { createNotificationDeliveryController } from '../../src/notification-delivery.js';
import { D1WatchRepository } from '../../src/watch-repository.js';
import { FakeD1Database } from './watch-production-backend.js';
import { FakePushSender, deliveryCandidate } from './watch-delivery-backend.js';
import { matchingNow, matchingWatch } from './watch-matching-backend.js';

const database = new FakeD1Database();
const notifications = new D1NotificationRepository(database);
const watches = new D1WatchRepository(database);
const candidate = deliveryCandidate();
await watches.createWatch({ ...structuredClone(matchingWatch), id: candidate.watchId, subscription: structuredClone(candidate.subscription) });
await notifications.claimCandidate(candidate, { createdAt: matchingNow.toISOString(), expiresAt: '2026-10-25T12:06:00.000Z' });
const sender = new FakePushSender([429, 201]);
const delays = [];
const controller = createNotificationDeliveryController({
  notificationRepository: notifications, watchRepository: watches, sender,
  now: () => new Date(matchingNow), wait: async delay => { delays.push(delay); }
});
const first = await controller.deliver([candidate]);
const duplicate = await controller.deliver([candidate]);
const row = database.notifications.get(candidate.dedupeKey);

process.stdout.write(`${JSON.stringify({
  delivered: first.delivered,
  transportCalls: sender.calls.length,
  retryDelaysMs: delays,
  deliveryStatus: row.delivery_status,
  attemptCount: row.attempt_count,
  duplicateProcessed: duplicate.processed,
  endpointPersistedInDedupe: JSON.stringify(row).includes('push.example')
}, null, 2)}\n`);
