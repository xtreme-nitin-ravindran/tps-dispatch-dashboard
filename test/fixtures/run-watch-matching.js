import { D1NotificationRepository } from '../../src/notification-repository.js';
import { D1WatchRepository } from '../../src/watch-repository.js';
import { createWatchNotificationPipeline } from '../../src/watch-notification-pipeline.js';
import { FakeD1Database } from './watch-production-backend.js';
import { matchingIncident, matchingNow, matchingSnapshot, matchingWatch } from './watch-matching-backend.js';

const database = new FakeD1Database();
const watchRepository = new D1WatchRepository(database);
await watchRepository.createWatch(structuredClone(matchingWatch));

function pipeline() {
  return createWatchNotificationPipeline({
    watchRepository: new D1WatchRepository(database),
    notificationRepository: new D1NotificationRepository(database),
    incidentBaseUrl: 'https://sirento.example/',
    now: () => matchingNow
  });
}

const first = await pipeline().evaluateSnapshot(matchingSnapshot());
const dedupeRowsAfterFirst = database.notifications.size;
const repeated = await pipeline().evaluateSnapshot(matchingSnapshot());
const meaningful = await pipeline().evaluateSnapshot(matchingSnapshot({ incidents: [
  matchingIncident('incident-1', 0.5, { lastMeaningfulUpdateAt: '2026-09-25T12:05:45.000Z' })
] }));
const stale = await pipeline().evaluateSnapshot(matchingSnapshot({ status: 'stale', incidents: [matchingIncident('stale-new')] }));
const unavailable = await pipeline().evaluateSnapshot(matchingSnapshot({ status: 'unavailable', incidents: [matchingIncident('unavailable-new')] }));
const overlapSnapshot = matchingSnapshot({ incidents: [matchingIncident('overlap-new')] });
const overlap = await Promise.all([
  pipeline().evaluateSnapshot(overlapSnapshot),
  pipeline().evaluateSnapshot(overlapSnapshot)
]);

console.log(JSON.stringify({
  first: first.candidates.length,
  dedupeRowsAfterFirst,
  repeat: repeated.candidates.length,
  meaningfulUpdate: meaningful.candidates.length,
  stale: stale.candidates.length,
  unavailable: unavailable.candidates.length,
  overlappingTotal: overlap.reduce((count, result) => count + result.candidates.length, 0),
  durableDedupeRows: database.notifications.size
}, null, 2));
