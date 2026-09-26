import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { D1NotificationRepository } from '../src/notification-repository.js';
import { D1WatchRepository } from '../src/watch-repository.js';
import {
  createWatchNotificationPipeline,
  validateIncidentSnapshot
} from '../src/watch-notification-pipeline.js';
import { createScheduledWatchMatcher } from '../src/watch-scheduled-matcher.js';
import { FakeD1Database } from './fixtures/watch-production-backend.js';
import {
  matchingIncident,
  matchingNow,
  matchingSnapshot,
  matchingWatch,
  matcherContractWatch
} from './fixtures/watch-matching-backend.js';

const incidentBaseUrl = 'https://sirento.example/';

async function fixture(overrides = {}) {
  const database = overrides.database || new FakeD1Database();
  const watchRepository = new D1WatchRepository(database);
  for (const watch of overrides.watches || [matchingWatch]) await watchRepository.createWatch(structuredClone(watch));
  const pipeline = createWatchNotificationPipeline({
    watchRepository,
    notificationRepository: new D1NotificationRepository(database),
    incidentBaseUrl,
    now: () => matchingNow,
    ...overrides.pipeline
  });
  return { database, watchRepository, pipeline };
}

test('matching creates the minimal candidate and one durable private dedupe row', async () => {
  const { database, pipeline } = await fixture();
  const result = await pipeline.evaluateSnapshot(matchingSnapshot());
  assert.equal(result.candidates.length, 1);
  assert.equal(database.notifications.size, 1);
  const [candidate] = result.candidates;
  assert.deepEqual(Object.keys(candidate).sort(), [
    'dedupeKey', 'incident', 'incidentId', 'incidentUrl', 'notificationKind',
    'schema', 'subscription', 'version', 'watchId'
  ]);
  assert.equal(candidate.notificationKind, 'new:v1');
  assert.equal(new URL(candidate.incidentUrl).searchParams.get('incident'), 'incident-1');
  assert.equal('geography' in candidate.incident, false);
  assert.equal(JSON.stringify([...database.notifications.values()]).includes('push.example'), false);

  const blank = matchingIncident('incident-blank', 0.5, { description: '', location: '' });
  const blankResult = await pipeline.evaluateSnapshot(matchingSnapshot({ incidents: [blank] }));
  assert.equal(blankResult.candidates[0].incident.description, '');
  assert.equal(blankResult.candidates[0].incident.location, '');
  assert.equal(Number.isFinite(blankResult.candidates[0].incident.distanceKm), true);
});

test('radius, service, category, and inactive watch filtering reuse backend matcher behavior', async () => {
  const cases = [
    { watch: matchingWatch, incident: matchingIncident('outside', 1.5) },
    { watch: matchingWatch, incident: matchingIncident('service', 0.5, { source: 'TPS' }) },
    { watch: matchingWatch, incident: matchingIncident('category', 0.5, { eventCategory: 'medical', description: 'Medical' }) },
    { watch: { ...matchingWatch, id: 'disabled', active: false }, incident: matchingIncident('disabled') }
  ];
  for (const { watch, incident } of cases) {
    const { pipeline } = await fixture({ watches: [watch] });
    assert.equal((await pipeline.evaluateSnapshot(matchingSnapshot({ incidents: [incident] }))).candidates.length, 0);
  }
});

test('fresh feeds may match while stale and unavailable feeds preserve watches without candidates', async () => {
  for (const status of ['stale', 'unavailable']) {
    const { pipeline, watchRepository } = await fixture();
    assert.equal((await pipeline.evaluateSnapshot(matchingSnapshot({ status }))).candidates.length, 0);
    assert.equal((await watchRepository.listActiveWatches()).length, 1);
  }
  const { pipeline } = await fixture();
  assert.equal((await pipeline.evaluateSnapshot(matchingSnapshot())).candidates.length, 1);
  const old = matchingSnapshot({ fetchedAt: '2026-09-25T11:00:00.000Z' });
  assert.equal((await (await fixture()).pipeline.evaluateSnapshot(old)).candidates.length, 0);
});

test('first sighting, routine refresh, and meaningful update follow stable lifecycle dedupe semantics', async () => {
  const { database, pipeline } = await fixture();
  assert.equal((await pipeline.evaluateSnapshot(matchingSnapshot())).candidates.length, 1);
  const refreshed = matchingIncident('incident-1', 0.5, { lastSeenAt: '2026-09-25T12:05:30.000Z' });
  assert.equal((await pipeline.evaluateSnapshot(matchingSnapshot({ incidents: [refreshed] }))).candidates.length, 0);
  const updated = matchingIncident('incident-1', 0.5, { lastMeaningfulUpdateAt: '2026-09-25T12:05:45.000Z' });
  const updateResult = await pipeline.evaluateSnapshot(matchingSnapshot({ incidents: [updated] }));
  assert.equal(updateResult.candidates.length, 1);
  assert.equal(updateResult.candidates[0].notificationKind, 'updated:2026-09-25T12:05:45.000Z');
  assert.equal(database.notifications.size, 2);
});

test('duplicate and overlapping processing atomically produce exactly one candidate', async () => {
  const database = new FakeD1Database();
  const first = await fixture({ database });
  const second = await fixture({ database, watches: [] });
  const [left, right] = await Promise.all([
    first.pipeline.evaluateSnapshot(matchingSnapshot()),
    second.pipeline.evaluateSnapshot(matchingSnapshot())
  ]);
  assert.equal(left.candidates.length + right.candidates.length, 1);
  assert.equal(database.notifications.size, 1);
  assert.equal((await first.pipeline.evaluateSnapshot(matchingSnapshot())).candidates.length, 0);
});

test('multiple watches and incidents create one candidate for each eligible pair', async () => {
  const watches = [matchingWatch, { ...matchingWatch, id: 'watch-second' }];
  const incidents = [matchingIncident('incident-1'), matchingIncident('incident-2', 0.7)];
  const { database, pipeline } = await fixture({ watches });
  assert.equal((await pipeline.evaluateSnapshot(matchingSnapshot({ incidents }))).candidates.length, 4);
  assert.equal(database.notifications.size, 4);
});

test('corrupt stored watches are skipped independently and expired dedupe rows are cleaned deterministically', async () => {
  const { database, pipeline } = await fixture();
  database.records.set('corrupt-json', { id: 'corrupt-json', active: 1, record_json: '{private broken' });
  database.records.set('invalid-watch', {
    id: 'invalid-watch', active: 1,
    record_json: JSON.stringify({ ...matchingWatch, id: 'invalid-watch', centre: { latitude: 999, longitude: 999 } })
  });
  database.notifications.set('expired-private-key', {
    dedupe_key: 'expired-private-key', watch_id: 'old-watch', incident_id: 'old-incident',
    notification_kind: 'new:v1', created_at: '2026-08-01T00:00:00.000Z', expires_at: '2026-09-25T12:05:59.000Z'
  });
  const result = await pipeline.evaluateSnapshot(matchingSnapshot());
  assert.equal(result.candidates.length, 1);
  assert.equal(result.expiredRemoved, 1);
  assert.equal(database.notifications.has('expired-private-key'), false);
  const row = [...database.notifications.values()][0];
  assert.equal(row.expires_at, '2026-10-25T12:06:00.000Z');
});

test('inactive watches expire after 30 days while active and recently disabled watches remain', async () => {
  const expired = { ...structuredClone(matchingWatch), id: 'inactive-expired', active: false,
    updatedAt: '2026-08-25T12:05:59.000Z' };
  const boundary = { ...structuredClone(matchingWatch), id: 'inactive-boundary', active: false,
    updatedAt: '2026-08-26T12:06:00.000Z' };
  const recent = { ...structuredClone(matchingWatch), id: 'inactive-recent', active: false,
    updatedAt: '2026-09-24T12:06:00.000Z' };
  const { pipeline, watchRepository } = await fixture({ watches: [matchingWatch, expired, boundary, recent] });
  const result = await pipeline.evaluateSnapshot(matchingSnapshot());
  assert.equal(result.inactiveRemoved, 2);
  assert.equal(result.activeWatchCount, 1);
  assert.equal(await watchRepository.getWatch('inactive-expired'), null);
  assert.equal(await watchRepository.getWatch('inactive-boundary'), null);
  assert.ok(await watchRepository.getWatch('inactive-recent'));
  assert.ok(await watchRepository.getWatch(matchingWatch.id));
});

test('malformed snapshots fail before watches or dedupe are changed', async () => {
  const { database, pipeline } = await fixture();
  for (const snapshot of [null, {}, matchingSnapshot({ incidents: [{ id: 'bad' }] })]) {
    assert.equal(validateIncidentSnapshot(snapshot).valid, false);
    await assert.rejects(pipeline.evaluateSnapshot(snapshot), /Invalid incident snapshot/);
  }
  assert.equal(database.notifications.size, 0);
  assert.equal(database.records.size, 1);
});

test('snapshot validation covers malformed feeds, timestamps, and incident shapes', () => {
  const malformed = [
    { ...matchingSnapshot(), schemaVersion: 2 },
    { ...matchingSnapshot(), fetchedAt: 'never' },
    { ...matchingSnapshot(), incidents: null },
    { ...matchingSnapshot(), feeds: [] },
    { ...matchingSnapshot(), feeds: { TFS: null } },
    { ...matchingSnapshot(), feeds: { TFS: { status: 'unknown', fetchedAt: matchingNow.toISOString() } } },
    { ...matchingSnapshot(), feeds: { TFS: { status: 'ok', fetchedAt: 'never' } } },
    matchingSnapshot({ incidents: [null] }),
    matchingSnapshot({ incidents: [{ ...matchingIncident(), source: 'EMS' }] }),
    matchingSnapshot({ incidents: [{ ...matchingIncident(), timestamp: 'never' }] })
  ];
  for (const snapshot of malformed) assert.equal(validateIncidentSnapshot(snapshot).valid, false);
  assert.equal(validateIncidentSnapshot({ ...matchingSnapshot(), feeds: { TPS: { status: 'unavailable' } } }).valid, true);
  assert.equal(matcherContractWatch().schema, 'sirento.watch');
});

test('pipeline rejects unsafe configuration and invalid clocks without touching storage', async () => {
  const database = new FakeD1Database();
  const dependencies = {
    watchRepository: new D1WatchRepository(database),
    notificationRepository: new D1NotificationRepository(database)
  };
  assert.throws(() => createWatchNotificationPipeline(), /repositories/);
  assert.throws(() => createWatchNotificationPipeline({ ...dependencies, incidentBaseUrl: 'http://example.test' }), /HTTPS/);
  assert.throws(() => createWatchNotificationPipeline({ ...dependencies, incidentBaseUrl: 'https://user:pass@example.test' }), /HTTPS/);
  for (const dedupeRetentionDays of [7, 366, 8.5]) {
    assert.throws(() => createWatchNotificationPipeline({ ...dependencies, incidentBaseUrl, dedupeRetentionDays }), /Dedupe/);
  }
  for (const inactiveWatchRetentionDays of [0, 366, 1.5]) {
    assert.throws(() => createWatchNotificationPipeline({ ...dependencies, incidentBaseUrl, inactiveWatchRetentionDays }), /Inactive/);
  }
  const pipeline = createWatchNotificationPipeline({ ...dependencies, incidentBaseUrl, now: () => new Date('invalid') });
  await assert.rejects(pipeline.evaluateSnapshot(matchingSnapshot()), /invalid date/);

  const defaults = createWatchNotificationPipeline({ ...dependencies, incidentBaseUrl });
  const currentSnapshot = matchingSnapshot({ incidents: [], fetchedAt: new Date().toISOString() });
  delete currentSnapshot.feeds;
  assert.equal((await defaults.evaluateSnapshot(currentSnapshot)).candidates.length, 0);
  const loopback = createWatchNotificationPipeline({ ...dependencies, incidentBaseUrl: 'http://localhost:4173/' });
  assert.equal((await loopback.evaluateSnapshot(currentSnapshot)).candidates.length, 0);
});

test('invalid subscriptions are skipped independently before durable claims', async () => {
  for (const subscription of [null, {}, { endpoint: 'not a url', p256dh: 'key', auth: 'auth' },
    { endpoint: 'http://push.example/send', p256dh: 'key', auth: 'auth' },
    { endpoint: 'https://user:pass@push.example/send', p256dh: 'key', auth: 'auth' },
    { endpoint: 'https://push.example/send', p256dh: '', auth: 'auth' },
    { endpoint: 'https://push.example/send', p256dh: 'key', auth: '' }]) {
    const invalid = { ...matchingWatch, id: `invalid-${JSON.stringify(subscription)}`, subscription };
    const { database, pipeline } = await fixture({ watches: [invalid] });
    assert.equal((await pipeline.evaluateSnapshot(matchingSnapshot())).candidates.length, 0);
    assert.equal(database.notifications.size, 0);
  }
});

test('scheduled handler fetches the normalized snapshot and has no public fixture or push path', async () => {
  const database = new FakeD1Database();
  await new D1WatchRepository(database).createWatch(structuredClone(matchingWatch));
  const calls = [];
  const scheduled = createScheduledWatchMatcher({
    now: () => matchingNow,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return Response.json(matchingSnapshot());
    }
  });
  const result = await scheduled({
    WATCH_DB: database,
    WATCH_SNAPSHOT_URL: 'https://sirento.example/data/current.json',
    WATCH_INCIDENT_BASE_URL: incidentBaseUrl
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://sirento.example/data/current.json');
  await assert.rejects(scheduled({ WATCH_DB: database, WATCH_SNAPSHOT_URL: 'http://localhost/fixture', WATCH_INCIDENT_BASE_URL: incidentBaseUrl }), /HTTPS/);
  const worker = await readFile(new URL('../src/watch-worker.js', import.meta.url), 'utf8');
  assert.doesNotMatch(worker, /fixture|pushManager|webpush/i);
});

test('scheduled snapshot loading rejects unavailable, oversized, and malformed sources', async () => {
  const environment = {
    WATCH_DB: new FakeD1Database(),
    WATCH_SNAPSHOT_URL: 'https://sirento.example/data/current.json',
    WATCH_INCIDENT_BASE_URL: incidentBaseUrl
  };
  const productionSized = createScheduledWatchMatcher({
    fetchImpl: async () => Response.json({
      ...matchingSnapshot({ incidents: [], fetchedAt: new Date().toISOString() }),
      padding: 'x'.repeat(5 * 1024 * 1024)
    })
  });
  assert.equal((await productionSized(environment)).candidates.length, 0);
  const cases = [
    new Response('', { status: 503 }),
    new Response('{}', { headers: { 'content-length': String(8 * 1024 * 1024 + 1) } }),
    new Response('x'.repeat(8 * 1024 * 1024 + 1)),
    new Response('{broken')
  ];
  for (const response of cases) {
    const scheduled = createScheduledWatchMatcher({ fetchImpl: async () => response });
    await assert.rejects(scheduled(environment));
  }
  const missing = createScheduledWatchMatcher({ fetchImpl: assert.fail });
  await assert.rejects(missing({ WATCH_DB: environment.WATCH_DB }), /WATCH_SNAPSHOT_URL/);
  await assert.rejects(missing({ ...environment, WATCH_SNAPSHOT_URL: '   ' }), /WATCH_SNAPSHOT_URL/);
  await assert.rejects(missing({ ...environment, WATCH_INCIDENT_BASE_URL: 'https://user:pass@example.test' }), /credentials/);
  await assert.rejects(missing({ ...environment, WATCH_INCIDENT_BASE_URL: 'https://:pass@example.test' }), /credentials/);
  await assert.rejects(createScheduledWatchMatcher()({}), /WATCH_SNAPSHOT_URL/);

  const defaults = createScheduledWatchMatcher({
    fetchImpl: async () => Response.json(matchingSnapshot({ incidents: [], fetchedAt: new Date().toISOString() }), {
      headers: { 'content-length': 'unknown' }
    })
  });
  assert.equal((await defaults(environment)).candidates.length, 0);
});
