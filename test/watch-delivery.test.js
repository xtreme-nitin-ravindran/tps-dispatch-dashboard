import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { D1NotificationRepository } from '../src/notification-repository.js';
import { D1WatchRepository } from '../src/watch-repository.js';
import {
  buildPushPayload, classifyPushResult, createNotificationDeliveryController,
  validateNotificationCandidate
} from '../src/notification-delivery.js';
import { createScheduledWatchDelivery } from '../src/watch-scheduled-matcher.js';
import { createWebPushSender } from '../src/web-push-sender.js';
import { FakeD1Database } from './fixtures/watch-production-backend.js';
import { FakePushSender, deliveryCandidate } from './fixtures/watch-delivery-backend.js';
import { matchingNow, matchingSnapshot, matchingWatch } from './fixtures/watch-matching-backend.js';

const clock = () => new Date(matchingNow);

function base64url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

async function setup({ results = [201], maxAttempts = 3, maxDeliveries = 100, candidates = [deliveryCandidate()] } = {}) {
  const database = new FakeD1Database();
  const notifications = new D1NotificationRepository(database);
  const watches = new D1WatchRepository(database);
  for (const candidate of candidates) {
    await watches.createWatch({ ...structuredClone(matchingWatch), id: candidate.watchId, subscription: structuredClone(candidate.subscription) });
    await notifications.claimCandidate(candidate, { createdAt: clock().toISOString(), expiresAt: '2026-10-25T12:06:00.000Z' });
  }
  const sender = new FakePushSender(results);
  const waits = [];
  const controller = createNotificationDeliveryController({
    notificationRepository: notifications, watchRepository: watches, sender, now: clock,
    wait: async delay => { waits.push(delay); }, maxAttempts, maxDeliveries
  });
  return { database, notifications, watches, sender, waits, controller, candidates };
}

test('payload is compact, versioned, and excludes private watch and subscription data', () => {
  const payload = buildPushPayload(deliveryCandidate());
  assert.deepEqual(payload, { schema: 'sirento.push', version: 1, incident: {
    id: 'incident-delivery-1', title: 'SirenTO — New incident nearby', body: 'Alarm · Toronto Fire Services',
    url: 'https://sirento.example/?view=1&incident=incident-delivery-1'
  } });
  assert.doesNotMatch(JSON.stringify(payload), /push\.example|p256dh|auth|latitude|possession/i);
});

test('payload wording distinguishes updates and includes only a reliable derived distance', () => {
  const withDistance = buildPushPayload(deliveryCandidate({
    notificationKind: 'updated:2026-09-25T12:05:45.000Z',
    incident: { source: 'TPS', description: 'Robbery', location: 'Published location',
      timestamp: '2026-09-25T12:00:00.000Z', distanceKm: 0.84 }
  }));
  assert.equal(withDistance.incident.title, 'SirenTO — Incident update nearby');
  assert.equal(withDistance.incident.body, 'Robbery · 0.8 km away · Toronto Police Service');
  const withoutDistance = buildPushPayload(deliveryCandidate());
  assert.doesNotMatch(withoutDistance.incident.body, /km away/);
  assert.throws(() => buildPushPayload(deliveryCandidate({
    incident: { source: 'TFS', description: 'Alarm', location: '', timestamp: '2026-09-25T12:00:00.000Z', distanceKm: Infinity }
  })), /invalid/);
});

test('successful delivery is persisted and a duplicate run sends nothing', async () => {
  const fixture = await setup();
  assert.equal((await fixture.controller.deliver(fixture.candidates)).delivered, 1);
  assert.equal(fixture.sender.calls.length, 1);
  assert.equal(fixture.database.notifications.get('dedupe-delivery-1').delivery_status, 'delivered');
  assert.equal((await fixture.controller.deliver(fixture.candidates)).processed, 0);
  assert.equal(fixture.sender.calls.length, 1);
});

for (const status of [404, 410]) test(`permanent ${status} deactivates only the current failed subscription`, async () => {
  const fixture = await setup({ results: [status] });
  assert.equal((await fixture.controller.deliver(fixture.candidates)).permanentFailed, 1);
  const row = fixture.database.notifications.get('dedupe-delivery-1');
  assert.equal(row.delivery_status, 'permanent_failed');
  assert.equal((await fixture.watches.getWatch('watch-delivery-1')).active, false);
  assert.equal((await fixture.watches.getWatch('watch-delivery-1')).updatedAt, matchingNow.toISOString());
  assert.equal(fixture.sender.calls.length, 1);
});

test('a replaced endpoint is not deactivated by an old permanent failure', async () => {
  const fixture = await setup({ results: [410] });
  const replacement = await fixture.watches.getWatch('watch-delivery-1');
  replacement.subscription.endpoint = 'https://push.example/send/replacement';
  await fixture.watches.updateWatch(replacement.id, replacement);
  await fixture.controller.deliver(fixture.candidates);
  assert.equal((await fixture.watches.getWatch(replacement.id)).active, true);
});

test('429 honors bounded Retry-After and succeeds on the second attempt', async () => {
  const fixture = await setup({ results: [{ status: 429, retryAfter: '30' }, 201] });
  const result = await fixture.controller.deliver(fixture.candidates);
  assert.equal(result.delivered, 1);
  assert.equal(result.retryCount, 1);
  assert.deepEqual(fixture.waits, [1000]);
  assert.equal(fixture.sender.calls.length, 2);
  assert.equal(fixture.database.notifications.get('dedupe-delivery-1').attempt_count, 2);
});

for (const status of [408, 500, 503]) test(`transient ${status} exhausts bounded retries`, async () => {
  const fixture = await setup({ results: [status, status, status] });
  assert.equal((await fixture.controller.deliver(fixture.candidates)).retryExhausted, 1);
  assert.equal(fixture.sender.calls.length, 3);
  assert.deepEqual(fixture.waits, [100, 200]);
  assert.equal(fixture.database.notifications.get('dedupe-delivery-1').delivery_status, 'retry_exhausted');
});

test('network failure retries and can succeed', async () => {
  const fixture = await setup({ results: [new Error('private transport detail'), 201] });
  assert.equal((await fixture.controller.deliver(fixture.candidates)).delivered, 1);
  assert.equal(fixture.sender.calls.length, 2);
});

test('delivery fixture falls back after configured responses and exposes non-retry headers', async () => {
  const sender = new FakePushSender([]);
  const response = await sender.sendPush(deliveryCandidate().subscription, buildPushPayload(deliveryCandidate()));
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('content-type'), null);
});

test('pending and expired sending leases can retry, while delivered candidates cannot', async () => {
  const fixture = await setup();
  const row = fixture.database.notifications.get('dedupe-delivery-1');
  row.delivery_status = 'sending'; row.lease_expires_at = '2026-09-25T12:05:00.000Z';
  assert.equal((await fixture.controller.deliver(fixture.candidates)).delivered, 1);
  assert.equal((await fixture.controller.deliver(fixture.candidates)).processed, 0);

  const activeLease = await setup();
  const activeRow = activeLease.database.notifications.get('dedupe-delivery-1');
  activeRow.delivery_status = 'sending'; activeRow.lease_expires_at = '2026-09-25T12:07:00.000Z';
  assert.equal((await activeLease.controller.deliver(activeLease.candidates)).processed, 0);

  const futureRetry = await setup();
  const retryRow = futureRetry.database.notifications.get('dedupe-delivery-1');
  assert.equal(await futureRetry.notifications.recordAttempt('dedupe-delivery-1', {
    status: 'delivered', attemptedAt: matchingNow.toISOString()
  }), false);
  retryRow.delivery_status = 'retryable'; retryRow.next_attempt_at = '2026-09-25T12:07:00.000Z';
  assert.equal((await futureRetry.controller.deliver(futureRetry.candidates)).processed, 0);
  assert.equal(await futureRetry.notifications.claimDelivery('missing', {
    now: matchingNow.toISOString(), leaseExpiresAt: matchingNow.toISOString()
  }), false);
  retryRow.next_attempt_at = null;
  assert.equal(await futureRetry.notifications.claimDelivery('dedupe-delivery-1', {
    now: matchingNow.toISOString(), leaseExpiresAt: matchingNow.toISOString()
  }), true);
  assert.equal(await futureRetry.notifications.recordAttempt('missing', {
    status: 'delivered', attemptedAt: matchingNow.toISOString()
  }), false);
  assert.equal(await futureRetry.notifications.recordAttempt('dedupe-delivery-1', {
    status: 'delivered', attemptedAt: matchingNow.toISOString()
  }), true);
});

test('a due retryable row can be reclaimed for the same logical notification', async () => {
  const fixture = await setup();
  const row = fixture.database.notifications.get('dedupe-delivery-1');
  row.delivery_status = 'retryable'; row.next_attempt_at = '2026-09-25T12:05:00.000Z';
  assert.equal((await fixture.controller.deliver(fixture.candidates)).delivered, 1);
  assert.equal(fixture.sender.calls.length, 1);
});

test('one failed candidate does not block another and the ceiling is deterministic', async () => {
  const candidates = [deliveryCandidate({ dedupeKey: 'b', watchId: 'watch-b' }), deliveryCandidate({ dedupeKey: 'a', watchId: 'watch-a' })];
  const fixture = await setup({ candidates, results: [410], maxAttempts: 1, maxDeliveries: 1 });
  const summary = await fixture.controller.deliver(candidates);
  assert.equal(summary.processed, 1); assert.equal(summary.ceilingSkipped, 1);
  assert.equal(fixture.database.notifications.get('a').delivery_status, 'permanent_failed');
  assert.equal(fixture.database.notifications.get('b').delivery_status, 'pending');
});

test('already-delivered rows do not consume the send ceiling or starve pending rows', async () => {
  const candidates = [deliveryCandidate({ dedupeKey: 'a', watchId: 'watch-a' }), deliveryCandidate({ dedupeKey: 'b', watchId: 'watch-b' })];
  const fixture = await setup({ candidates, results: [201, 201], maxDeliveries: 1 });
  await fixture.controller.deliver([candidates[0]]);
  const summary = await fixture.controller.deliver(candidates);
  assert.equal(summary.processed, 1); assert.equal(summary.delivered, 1);
  assert.equal(fixture.database.notifications.get('b').delivery_status, 'delivered');
});

test('a permanent failure does not prevent the remaining batch from succeeding', async () => {
  const candidates = [deliveryCandidate({ dedupeKey: 'a', watchId: 'watch-a' }), deliveryCandidate({ dedupeKey: 'b', watchId: 'watch-b' })];
  const fixture = await setup({ candidates, results: [410, 201], maxAttempts: 1 });
  const summary = await fixture.controller.deliver(candidates);
  assert.equal(summary.permanentFailed, 1); assert.equal(summary.delivered, 1);
  assert.equal(fixture.sender.calls.length, 2);
});

test('malformed candidates and subscriptions are isolated without a send', async () => {
  const fixture = await setup();
  const malformed = [null, {}, deliveryCandidate({ incidentUrl: 'http://unsafe.example/' }), deliveryCandidate({ subscription: {} })];
  const summary = await fixture.controller.deliver(malformed);
  assert.equal(summary.invalid, 4); assert.equal(fixture.sender.calls.length, 0);
  assert.equal(validateNotificationCandidate(deliveryCandidate()), true);
  const invalid = [
    deliveryCandidate({ schema: 'wrong' }), deliveryCandidate({ version: 2 }),
    deliveryCandidate({ watchId: '' }), deliveryCandidate({ incident: null }),
    deliveryCandidate({ incident: { source: 'EMS', description: 'x', location: 'x' } }),
    deliveryCandidate({ incident: { source: 'TFS', description: null, location: 'x' } }),
    deliveryCandidate({ incident: { source: 'TFS', description: 'x', location: null } }),
    deliveryCandidate({ incident: { source: 'TFS', description: 'x', location: 'x', distanceKm: -1 } }),
    deliveryCandidate({ subscription: { endpoint: '', p256dh: 'x', auth: 'x' } }),
    deliveryCandidate({ subscription: { endpoint: 'https://push.example', p256dh: '', auth: 'x' } }),
    deliveryCandidate({ subscription: { endpoint: 'https://push.example', p256dh: 'x', auth: '' } }),
    deliveryCandidate({ incidentUrl: 'not a url' }),
    deliveryCandidate({ incidentUrl: 'https://user:pass@sirento.example/' }),
    deliveryCandidate({ subscription: { endpoint: 'https://user:pass@push.example', p256dh: 'x', auth: 'x' } })
  ];
  for (const candidate of invalid) assert.equal(validateNotificationCandidate(candidate), false);
});

test('response classification separates success, permanent, and transient outcomes', () => {
  assert.equal(classifyPushResult({ status: 201 }).kind, 'delivered');
  assert.equal(classifyPushResult({ status: 404 }).kind, 'permanent');
  assert.equal(classifyPushResult({ status: 410 }).kind, 'permanent');
  assert.equal(classifyPushResult({ status: 429 }).kind, 'retryable');
  assert.equal(classifyPushResult({ status: 503 }).kind, 'retryable');
  assert.equal(classifyPushResult({ status: 408 }).kind, 'retryable');
  assert.deepEqual(classifyPushResult(null), { kind: 'permanent', statusCode: null });
  assert.deepEqual(classifyPushResult({ status: 400 }), { kind: 'permanent', statusCode: 400 });
});

test('delivery validates dependencies and limits, handles non-arrays, and parses Retry-After dates', async () => {
  assert.throws(() => createNotificationDeliveryController(), /dependencies/);
  const dependencies = { notificationRepository: {}, watchRepository: {}, sender: { sendPush: assert.fail } };
  for (const maxAttempts of [0, 6, 1.5]) {
    assert.throws(() => createNotificationDeliveryController({ ...dependencies, maxAttempts }), /maxAttempts/);
  }
  for (const maxDeliveries of [0, 1001, 1.5]) {
    assert.throws(() => createNotificationDeliveryController({ ...dependencies, maxDeliveries }), /maxDeliveries/);
  }
  const inert = createNotificationDeliveryController({
    notificationRepository: { async claimDelivery() { return false; } },
    watchRepository: {}, sender: { sendPush: assert.fail }
  });
  assert.deepEqual(await inert.deliver(null), {
    received: 0, processed: 0, delivered: 0, retryCount: 0, permanentFailed: 0,
    retryExhausted: 0, invalid: 0, ceilingSkipped: 0
  });
  assert.equal((await inert.deliver([deliveryCandidate()])).processed, 0);

  const dateFixture = await setup({ results: [{ status: 429, retryAfter: matchingNow.toUTCString() }, 201] });
  assert.equal((await dateFixture.controller.deliver(dateFixture.candidates)).delivered, 1);
  assert.deepEqual(dateFixture.waits, []);
  const invalidDate = await setup({ results: [{ status: 429, retryAfter: 'later' }, 201] });
  await invalidDate.controller.deliver(invalidDate.candidates);
  assert.deepEqual(invalidDate.waits, [100]);
});

test('default delivery clock and wait adapters are reachable without external services', async () => {
  const candidate = deliveryCandidate({ dedupeKey: 'default-adapters' });
  const attempts = [];
  const controller = createNotificationDeliveryController({
    notificationRepository: {
      async claimDelivery() { return true; },
      async recordAttempt(key, value) { attempts.push({ key, value }); }
    },
    watchRepository: {},
    sender: { responses: [500, 201], async sendPush() { return { status: this.responses.shift(), headers: new Headers() }; } },
    maxAttempts: 2,
    maxRetryDelayMs: 1
  });
  assert.equal((await controller.deliver([candidate])).delivered, 1);
  assert.equal(attempts.length, 1);
});

test('non-endpoint permanent errors do not deactivate the subscription', async () => {
  const fixture = await setup({ results: [400] });
  assert.equal((await fixture.controller.deliver(fixture.candidates)).permanentFailed, 1);
  assert.equal((await fixture.watches.getWatch('watch-delivery-1')).active, true);
});

test('production sender creates encrypted aes128gcm Web Push with VAPID authorization', async () => {
  const vapidKeys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const vapidPublic = new Uint8Array(await crypto.subtle.exportKey('raw', vapidKeys.publicKey));
  const vapidPrivate = await crypto.subtle.exportKey('jwk', vapidKeys.privateKey);
  const receiverKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const receiverPublic = new Uint8Array(await crypto.subtle.exportKey('raw', receiverKeys.publicKey));
  const requests = [];
  const sender = createWebPushSender({
    config: { vapidPublicKey: base64url(vapidPublic), vapidPrivateKey: vapidPrivate.d, vapidSubject: 'mailto:ops@example.test' },
    now: () => matchingNow.getTime(),
    fetchImpl: async (url, options) => { requests.push({ url, options }); return { status: 201 }; }
  });
  const response = await sender.sendPush({
    endpoint: 'https://push.example/send/private-id', p256dh: base64url(receiverPublic), auth: base64url(new Uint8Array(16).fill(7))
  }, buildPushPayload(deliveryCandidate()));
  assert.equal(response.status, 201); assert.equal(requests.length, 1);
  assert.equal(requests[0].options.headers['content-encoding'], 'aes128gcm');
  assert.match(requests[0].options.headers.authorization, /^vapid t=[^.]+\.[^.]+\.[^,]+, k=/);
  assert.ok(requests[0].options.body.byteLength > 86);

  const defaultClockSender = createWebPushSender({
    config: { vapidPublicKey: base64url(vapidPublic), vapidPrivateKey: vapidPrivate.d, vapidSubject: 'https://example.test/push' },
    fetchImpl: async () => ({ status: 202 })
  });
  assert.equal((await defaultClockSender.sendPush({
    endpoint: 'https://push.example/send/another', p256dh: base64url(receiverPublic), auth: base64url(new Uint8Array(16).fill(8))
  }, {})).status, 202);
  await assert.rejects(defaultClockSender.sendPush({
    endpoint: 'http://push.example/send', p256dh: base64url(receiverPublic), auth: base64url(new Uint8Array(16).fill(8))
  }, {}), /endpoint/);
  await assert.rejects(defaultClockSender.sendPush({
    endpoint: 'https://user:pass@push.example/send', p256dh: base64url(receiverPublic), auth: base64url(new Uint8Array(16).fill(8))
  }, {}), /endpoint/);
  await assert.rejects(defaultClockSender.sendPush({
    endpoint: 'https://push.example/send', p256dh: 'AQ', auth: base64url(new Uint8Array(16).fill(8))
  }, {}), /Subscription key material/);
  const wrongReceiverPrefix = receiverPublic.slice(); wrongReceiverPrefix[0] = 3;
  await assert.rejects(defaultClockSender.sendPush({
    endpoint: 'https://push.example/send', p256dh: base64url(wrongReceiverPrefix), auth: base64url(new Uint8Array(16).fill(8))
  }, {}), /Subscription key material/);
  await assert.rejects(defaultClockSender.sendPush({
    endpoint: 'https://push.example/send', p256dh: base64url(receiverPublic), auth: base64url(new Uint8Array(15).fill(8))
  }, {}), /Subscription key material/);
});

test('scheduled delivery default adapters can complete an empty deterministic run', async () => {
  const database = new FakeD1Database();
  const scheduled = createScheduledWatchDelivery({
    sender: new FakePushSender(),
    fetchImpl: async () => Response.json(matchingSnapshot({ incidents: [], fetchedAt: new Date().toISOString() })),
    wait: assert.fail
  });
  const result = await scheduled({
    WATCH_DB: database, WATCH_ALLOWED_ORIGINS: 'https://sirento.example',
    WATCH_SNAPSHOT_URL: 'https://sirento.example/data/current.json', WATCH_INCIDENT_BASE_URL: 'https://sirento.example/'
  });
  assert.equal(result.delivery.processed, 0);
});

test('scheduled production sender stays deterministic behind an injected transport', async () => {
  const vapidKeys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const vapidPublic = new Uint8Array(await crypto.subtle.exportKey('raw', vapidKeys.publicKey));
  const vapidPrivate = await crypto.subtle.exportKey('jwk', vapidKeys.privateKey);
  const receiverKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const receiverPublic = new Uint8Array(await crypto.subtle.exportKey('raw', receiverKeys.publicKey));
  const database = new FakeD1Database();
  await new D1WatchRepository(database).createWatch({
    ...structuredClone(matchingWatch),
    subscription: {
      endpoint: 'https://push.example/send/injected-only',
      p256dh: base64url(receiverPublic), auth: base64url(new Uint8Array(16).fill(4))
    }
  });
  const requests = [];
  const scheduled = createScheduledWatchDelivery({
    now: clock,
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return String(url).includes('current.json') ? Response.json(matchingSnapshot()) : new Response(null, { status: 201 });
    }
  });
  const result = await scheduled({
    WATCH_DB: database, WATCH_ALLOWED_ORIGINS: 'https://sirento.example',
    WATCH_SNAPSHOT_URL: 'https://sirento.example/data/current.json', WATCH_INCIDENT_BASE_URL: 'https://sirento.example/',
    VAPID_PUBLIC_KEY: base64url(vapidPublic), VAPID_PRIVATE_KEY: vapidPrivate.d,
    VAPID_SUBJECT: 'mailto:ops@example.test'
  });
  assert.equal(result.delivery.delivered, 1);
  assert.deepEqual(requests.map(entry => new URL(entry.url).hostname), ['sirento.example', 'push.example']);

  const defaultClockResult = await createScheduledWatchDelivery({
    fetchImpl: async () => Response.json(matchingSnapshot({ incidents: [], fetchedAt: new Date().toISOString() }))
  })({
    WATCH_DB: new FakeD1Database(), WATCH_ALLOWED_ORIGINS: 'https://sirento.example',
    WATCH_SNAPSHOT_URL: 'https://sirento.example/data/current.json', WATCH_INCIDENT_BASE_URL: 'https://sirento.example/',
    VAPID_PUBLIC_KEY: base64url(vapidPublic), VAPID_PRIVATE_KEY: vapidPrivate.d,
    VAPID_SUBJECT: 'mailto:ops@example.test'
  });
  assert.equal(defaultClockResult.delivery.processed, 0);
});

test('production sender rejects malformed VAPID keys before transport', () => {
  assert.throws(() => createWebPushSender(), /Complete VAPID/);
  assert.throws(() => createWebPushSender({ config: { vapidPublicKey: 'public' } }), /Complete VAPID/);
  assert.throws(() => createWebPushSender({ config: { vapidPublicKey: 'public', vapidPrivateKey: 'private' } }), /Complete VAPID/);
  assert.throws(() => createWebPushSender({
    config: { vapidPublicKey: 'invalid', vapidPrivateKey: 'invalid', vapidSubject: 'mailto:ops@example.test' }
  }), /VAPID key material is invalid/);
  assert.throws(() => createWebPushSender({
    config: { vapidPublicKey: '$', vapidPrivateKey: 'invalid', vapidSubject: 'mailto:ops@example.test' }
  }), /public key is invalid/);
  const wrongPrefix = new Uint8Array(65); wrongPrefix[0] = 3;
  assert.throws(() => createWebPushSender({
    config: { vapidPublicKey: base64url(wrongPrefix), vapidPrivateKey: base64url(new Uint8Array(32)), vapidSubject: 'mailto:ops@example.test' }
  }), /key material/);
  const validPrefix = new Uint8Array(65); validPrefix[0] = 4;
  assert.throws(() => createWebPushSender({
    config: { vapidPublicKey: base64url(validPrefix), vapidPrivateKey: base64url(new Uint8Array(31)), vapidSubject: 'mailto:ops@example.test' }
  }), /key material/);
});

test('scheduled production delivery requires VAPID secrets before changing dedupe state', async () => {
  const database = new FakeD1Database();
  await new D1WatchRepository(database).createWatch(structuredClone(matchingWatch));
  const scheduled = createScheduledWatchDelivery({ fetchImpl: assert.fail, now: clock });
  await assert.rejects(scheduled({
    WATCH_DB: database, WATCH_ALLOWED_ORIGINS: 'https://sirento.example',
    WATCH_SNAPSHOT_URL: 'https://sirento.example/data/current.json', WATCH_INCIDENT_BASE_URL: 'https://sirento.example/'
  }), /VAPID_PUBLIC_KEY/);
  assert.equal(database.notifications.size, 0);
  await assert.rejects(createScheduledWatchDelivery()({}), /WATCH_ALLOWED_ORIGINS/);
});

test('scheduled delivery sends once and a duplicate snapshot does not send again', async () => {
  const database = new FakeD1Database();
  await new D1WatchRepository(database).createWatch(structuredClone(matchingWatch));
  const sender = new FakePushSender([201]);
  const scheduled = createScheduledWatchDelivery({
    sender, fetchImpl: async () => Response.json(matchingSnapshot()), now: clock
  });
  const environment = {
    WATCH_DB: database, WATCH_ALLOWED_ORIGINS: 'https://sirento.example',
    WATCH_SNAPSHOT_URL: 'https://sirento.example/data/current.json', WATCH_INCIDENT_BASE_URL: 'https://sirento.example/'
  };
  assert.equal((await scheduled(environment)).delivery.delivered, 1);
  assert.equal((await scheduled(environment)).delivery.processed, 0);
  assert.equal(sender.calls.length, 1);
});

test('delivery source has no console logging and worker logs aggregate fields only', async () => {
  const source = await readFile(new URL('../src/notification-delivery.js', import.meta.url), 'utf8');
  const worker = await readFile(new URL('../src/watch-worker.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /console\./);
  assert.match(worker, /watch_delivery_run/);
  assert.doesNotMatch(worker, /console\.(?:log|error)\([^\n]*(?:endpoint|subscription|possession|coordinate|label)/i);
  assert.doesNotMatch(worker, /FakePushSender|fixture/);
});
