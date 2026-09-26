import test from 'node:test';
import assert from 'node:assert/strict';
import { createWatchApi } from '../src/watch-api.js';
import { loadWatchBackendConfig } from '../src/watch-backend-config.js';
import { D1NotificationRepository } from '../src/notification-repository.js';
import { D1WatchRepository } from '../src/watch-repository.js';
import { createWatchService } from '../src/watch-service.js';
import {
  createHttpWatchSubscriptionAdapter,
  pushFixtureOptions,
  WATCH_BACKEND_CREDENTIAL_STORAGE_KEY,
  watchApiBaseUrlFrom
} from '../src/push-subscription.js';
import {
  backendFixtureRequest,
  deterministicPossessionToken,
  deterministicWatchId,
  fixtureTimestamp,
  validWatchSubscriptionRequest
} from './fixtures/watch-backend.js';
import { FakeD1Database, memoryStorage } from './fixtures/watch-production-backend.js';

const productionOrigin = 'https://sirento.nitin.run';
const localOrigin = 'http://127.0.0.1:4173';
const allowingRateLimiter = { limit: async () => ({ success: true }) };

function fixtureApi(database = new FakeD1Database(), createRateLimiter = allowingRateLimiter) {
  const repository = new D1WatchRepository(database);
  const service = createWatchService({
    repository,
    idGenerator: () => deterministicWatchId,
    possessionTokenGenerator: () => deterministicPossessionToken,
    now: () => fixtureTimestamp,
    vapidKeyVersion: 'test-v1'
  });
  return {
    repository,
    service,
    api: createWatchApi({ service, allowedOrigins: [productionOrigin, localOrigin], createRateLimiter })
  };
}

function request(path, { method = 'POST', origin = productionOrigin, body = validWatchSubscriptionRequest, headers = {} } = {}) {
  const init = { method, headers: { origin, ...headers } };
  if (body !== null) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    if (!Object.keys(init.headers).some(name => name.toLowerCase() === 'content-type')) {
      init.headers['content-type'] = 'application/json';
    }
  }
  return new Request(`https://watch-api.example.test${path}`, init);
}

test('real API and durable adapter create, update, sanitize, delete, and idempotently re-delete', async () => {
  const { api, repository } = fixtureApi();
  const createdResponse = await api(request('/watches'));
  assert.equal(createdResponse.status, 201);
  assert.equal(createdResponse.headers.get('access-control-allow-origin'), productionOrigin);
  const created = await createdResponse.json();
  assert.equal(created.watch.id, deterministicWatchId);
  assert.equal(created.possessionToken, deterministicPossessionToken);
  assert.deepEqual(Object.keys(created.watch).sort(), [
    'active', 'category', 'centre', 'createdAt', 'id', 'lastConfirmedAt', 'radiusKm', 'service', 'updatedAt', 'vapidKeyVersion'
  ]);
  const rendered = JSON.stringify(created);
  assert.equal(rendered.includes(validWatchSubscriptionRequest.subscription.endpoint), false);
  assert.equal(rendered.includes(validWatchSubscriptionRequest.subscription.p256dh), false);
  assert.equal(rendered.includes('possessionTokenHash'), false);

  const stored = await repository.getWatch(deterministicWatchId);
  assert.equal(stored.subscription.endpoint, validWatchSubscriptionRequest.subscription.endpoint);
  const restartedRepository = new D1WatchRepository(repository.database);
  assert.equal((await restartedRepository.getWatch(deterministicWatchId)).id, deterministicWatchId);
  stored.centre.latitude = 0;
  assert.equal((await repository.getWatch(deterministicWatchId)).centre.latitude, 43.6532);

  const changed = backendFixtureRequest({ watch: { radiusKm: 5, active: false } });
  const updatedResponse = await api(request(`/watches/${deterministicWatchId}`, {
    method: 'PATCH', body: changed, headers: { 'x-sirento-possession-token': deterministicPossessionToken }
  }));
  assert.equal(updatedResponse.status, 200);
  assert.equal((await updatedResponse.json()).watch.radiusKm, 5);
  assert.deepEqual(await repository.listActiveWatches(), []);

  const deleteRequest = () => request(`/watches/${deterministicWatchId}`, {
    method: 'DELETE', body: null, headers: { 'x-sirento-possession-token': deterministicPossessionToken }
  });
  assert.equal((await api(deleteRequest())).status, 204);
  assert.equal((await api(deleteRequest())).status, 204);
  assert.equal(await repository.getWatch(deterministicWatchId), null);
});

test('API enforces routes, methods, JSON media type, size, parsing, validation, token, and origin', async () => {
  const { api, repository } = fixtureApi();
  assert.equal((await api(request('/watches', { method: 'GET', body: null }))).status, 405);
  assert.equal((await api(request('/watches/not.valid', { method: 'PATCH' }))).status, 404);
  assert.equal((await api(request('/watches', { origin: 'https://attacker.example' }))).status, 403);

  const preflight = await api(request('/watches', { method: 'OPTIONS', origin: localOrigin, body: null }));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), localOrigin);
  assert.match(preflight.headers.get('access-control-allow-headers'), /x-sirento-possession-token/);

  assert.equal((await api(request('/watches', { headers: { 'content-type': 'text/plain' } }))).status, 415);
  assert.equal((await api(request('/watches', { headers: { 'content-type': '' } }))).status, 415);
  assert.equal((await api(request('/watches', { body: '{broken' }))).status, 400);
  assert.equal((await api(request('/watches', { body: ' '.repeat(16 * 1024 + 1) }))).status, 413);
  assert.equal((await api(request('/watches', { headers: { 'content-length': String(16 * 1024 + 1) } }))).status, 413);
  const invalidResponse = await api(request('/watches', {
    body: backendFixtureRequest({ watch: { centre: { latitude: 100, longitude: -79 } } })
  }));
  assert.equal(invalidResponse.status, 400);
  const invalidRendered = await invalidResponse.text();
  assert.equal(invalidRendered.includes('100'), false);
  assert.equal(invalidRendered.includes(validWatchSubscriptionRequest.subscription.endpoint), false);

  await api(request('/watches'));
  const wrongPatch = await api(request(`/watches/${deterministicWatchId}`, {
    method: 'PATCH', headers: { 'x-sirento-possession-token': 'wrong-secret-token' }
  }));
  assert.equal(wrongPatch.status, 404);
  const wrongDelete = await api(request(`/watches/${deterministicWatchId}`, {
    method: 'DELETE', body: null, headers: { 'x-sirento-possession-token': 'wrong-secret-token' }
  }));
  assert.equal(wrongDelete.status, 204);
  assert.ok(await repository.getWatch(deterministicWatchId));
  assert.equal((await wrongPatch.text()).includes('wrong-secret-token'), false);
  assert.equal((await api(request('/watches/missing', { method: 'PATCH' }))).status, 404);
  assert.equal((await api(request('/watches/missing', { method: 'PATCH', body: '{broken' }))).status, 400);
  assert.equal((await api(request(`/watches/${deterministicWatchId}`, { method: 'GET', body: null }))).status, 405);
});

test('watch creation fails closed without the Cloudflare limiter and returns a bounded 429', async () => {
  const unavailable = fixtureApi(new FakeD1Database(), null);
  assert.equal((await unavailable.api(request('/watches'))).status, 503);
  assert.equal(await unavailable.repository.getWatch(deterministicWatchId), null);

  const keys = [];
  const limited = fixtureApi(new FakeD1Database(), {
    async limit({ key }) { keys.push(key); return { success: false }; }
  });
  const response = await limited.api(request('/watches', { headers: { 'cf-connecting-ip': '192.0.2.8' } }));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '60');
  assert.deepEqual(keys, ['watch-create:192.0.2.8']);
  assert.equal((await response.text()).includes(validWatchSubscriptionRequest.subscription.endpoint), false);

  const originKeys = [];
  const byOrigin = fixtureApi(new FakeD1Database(), { async limit({ key }) { originKeys.push(key); return { success: false }; } });
  await byOrigin.api(request('/watches'));
  assert.deepEqual(originKeys, [`watch-create:${productionOrigin}`]);
  const nullResult = fixtureApi(new FakeD1Database(), { async limit() { return null; } });
  assert.equal((await nullResult.api(request('/watches'))).status, 429);
});

test('D1 failures become small non-sensitive service failures and corrupt rows are rejected', async () => {
  const failing = fixtureApi(new FakeD1Database({ fail: true }));
  const response = await failing.api(request('/watches'));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: { code: 'BACKEND_UNAVAILABLE', message: 'Watch service is temporarily unavailable' }
  });
  await assert.rejects(failing.repository.getWatch('unavailable'), /storage failure/);
  const failedRead = await failing.api(request('/watches/unavailable', {
    method: 'PATCH', headers: { 'x-sirento-possession-token': 'not-logged' }
  }));
  assert.equal(failedRead.status, 503);
  assert.equal((await failedRead.text()).includes('not-logged'), false);

  const database = new FakeD1Database();
  database.records.set('bad', { id: 'bad', active: 1, record_json: '{bad' });
  await assert.rejects(new D1WatchRepository(database).getWatch('bad'), /invalid/);
  database.records.set('mismatch', { id: 'mismatch', active: 1, record_json: JSON.stringify({ id: 'other', active: true }) });
  await assert.rejects(new D1WatchRepository(database).getWatch('mismatch'), /invalid/);
  assert.throws(() => new D1WatchRepository(), /binding/);
  assert.throws(() => new D1NotificationRepository(), /binding/);
  await assert.rejects(database.prepare('UNEXPECTED').bind().run(), /Unexpected/);
});

test('VAPID config keeps sending secrets server-side and fails clearly when required values are absent', () => {
  const base = { WATCH_ALLOWED_ORIGINS: `${productionOrigin},${localOrigin}` };
  const prepared = loadWatchBackendConfig(base);
  assert.equal(prepared.vapidPublicKey, '');
  assert.equal('vapidPrivateKey' in prepared, false);
  assert.throws(() => loadWatchBackendConfig(base, { requireSendingSecrets: true }), /VAPID_PUBLIC_KEY/);
  const complete = loadWatchBackendConfig({
    ...base,
    VAPID_PUBLIC_KEY: 'public-key',
    VAPID_PRIVATE_KEY: 'private-secret',
    VAPID_SUBJECT: 'mailto:ops@example.test',
    VAPID_KEY_VERSION: 'v1'
  }, { requireSendingSecrets: true });
  assert.equal(complete.vapidPrivateKey, 'private-secret');
  assert.equal(complete.vapidKeyVersion, 'v1');
  assert.throws(() => loadWatchBackendConfig({ ...base, WATCH_ALLOWED_ORIGINS: '*' }), /exact/);
  assert.throws(() => loadWatchBackendConfig({ WATCH_ALLOWED_ORIGINS: 'ftp://example.test' }), /exact/);
  assert.throws(() => loadWatchBackendConfig({ WATCH_ALLOWED_ORIGINS: 'not a url' }), /exact/);
  assert.throws(() => loadWatchBackendConfig({ WATCH_ALLOWED_ORIGINS: ', ,' }), /at least one/);
  assert.throws(() => loadWatchBackendConfig({}), /WATCH_ALLOWED_ORIGINS/);
  assert.throws(() => loadWatchBackendConfig({
    ...base, VAPID_PUBLIC_KEY: 'public', VAPID_PRIVATE_KEY: 'private', VAPID_SUBJECT: 'tel:123'
  }, { requireSendingSecrets: true }), /VAPID_SUBJECT/);
});

test('API and D1 adapters reject missing dependencies and preserve empty mutation results', async () => {
  assert.throws(() => createWatchApi({}), /service/);
  const noOrigins = createWatchApi({ service: {}, allowedOrigins: undefined });
  assert.equal((await noOrigins(new Request('https://watch.example/watches'))).status, 403);
  const database = new FakeD1Database();
  const repository = new D1WatchRepository(database);
  assert.equal(await repository.updateWatch('missing', { id: 'missing', active: true, updatedAt: fixtureTimestamp }), null);
  assert.equal(await repository.deleteWatch('missing'), false);
  assert.equal(await repository.cleanupInactive(fixtureTimestamp), 0);
  database.records.set('inactive-without-time', {
    id: 'inactive-without-time', active: 0,
    record_json: JSON.stringify({ id: 'inactive-without-time', active: false }), updated_at: null
  });
  assert.equal(await repository.cleanupInactive(fixtureTimestamp), 0);
  assert.equal(await repository.deactivateSubscription('missing', 'https://push.example'), false);
  database.records.set('corrupt', { id: 'corrupt', active: 1, record_json: '{bad' });
  assert.deepEqual(await repository.listActiveWatches(), []);

  const emptyDatabase = { prepare() { return { bind() { return { async run() {}, async all() {} }; } }; } };
  const notifications = new D1NotificationRepository(emptyDatabase);
  const candidate = { dedupeKey: 'key', watchId: 'watch', incidentId: 'incident', notificationKind: 'new:v1' };
  await assert.rejects(notifications.claimCandidate(null, { createdAt: fixtureTimestamp, expiresAt: fixtureTimestamp }), /dedupeKey/);
  assert.equal(await notifications.claimCandidate(candidate, { createdAt: fixtureTimestamp, expiresAt: fixtureTimestamp }), false);
  assert.equal(await notifications.claimDelivery('key', { now: fixtureTimestamp, leaseExpiresAt: fixtureTimestamp }), false);
  assert.equal(await notifications.recordAttempt('key', { status: 'delivered', attemptedAt: fixtureTimestamp }), false);
  assert.equal(await notifications.cleanupExpired(fixtureTimestamp), 0);
  assert.deepEqual(await new D1WatchRepository(emptyDatabase).listActiveWatches(), []);
});

test('production D1 fixture covers reachable write conflicts and storage failures', async () => {
  const database = new FakeD1Database();
  const repository = new D1WatchRepository(database);
  const record = { id: 'fixture-coverage', active: true, updatedAt: fixtureTimestamp };

  await repository.createWatch(record);
  await assert.rejects(repository.createWatch(record), /duplicate/);
  assert.equal(await repository.updateWatch('missing', record), null);
  assert.deepEqual(await repository.updateWatch(record.id, record), record);
  assert.equal(await repository.deleteWatch(record.id), true);
  assert.equal(await repository.deleteWatch(record.id), false);
  await assert.rejects(new D1WatchRepository(new FakeD1Database({ fail: true })).listActiveWatches(), /storage failure/);
});

test('HTTP client adapter creates, updates, deletes, and stores credentials only in browser storage', async () => {
  const storage = memoryStorage();
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (options.method === 'POST') return Response.json({
      watch: { id: deterministicWatchId }, possessionToken: deterministicPossessionToken
    }, { status: 201 });
    if (options.method === 'PATCH') return Response.json({ watch: { id: deterministicWatchId } });
    return new Response(null, { status: 204 });
  };
  const adapter = createHttpWatchSubscriptionAdapter({ baseUrl: 'https://watch.example/', fetchImpl, storage });
  assert.equal((await adapter.saveWatchSubscription(validWatchSubscriptionRequest)).ok, true);
  const credential = JSON.parse(storage.getItem(WATCH_BACKEND_CREDENTIAL_STORAGE_KEY));
  assert.deepEqual(credential, {
    version: 1, watchId: deterministicWatchId, possessionToken: deterministicPossessionToken
  });
  assert.equal(calls[0].url, 'https://watch.example/watches');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.body.includes(deterministicPossessionToken), false);

  assert.equal((await adapter.saveWatchSubscription(validWatchSubscriptionRequest)).ok, true);
  assert.equal(calls[1].options.method, 'PATCH');
  assert.equal(calls[1].options.headers['x-sirento-possession-token'], deterministicPossessionToken);
  assert.equal(calls[1].url.includes(deterministicPossessionToken), false);
  assert.equal((await adapter.deleteWatchSubscription()).ok, true);
  assert.equal(calls[2].options.method, 'DELETE');
  assert.equal(calls[2].url.includes(deterministicPossessionToken), false);
  assert.equal(storage.getItem(WATCH_BACKEND_CREDENTIAL_STORAGE_KEY), null);

  const unavailable = createHttpWatchSubscriptionAdapter({ baseUrl: '', fetchImpl, storage });
  assert.equal((await unavailable.saveWatchSubscription({})).kind, 'adapter-disabled');
  assert.equal(watchApiBaseUrlFrom({ querySelector: () => ({ content: 'https://watch.example///' }) }), 'https://watch.example');
});

test('HTTP client recreates a watch when retention removed its stale backend credential', async () => {
  const storage = memoryStorage();
  storage.setItem(WATCH_BACKEND_CREDENTIAL_STORAGE_KEY, JSON.stringify({
    version: 1, watchId: deterministicWatchId, possessionToken: deterministicPossessionToken
  }));
  const calls = [];
  const adapter = createHttpWatchSubscriptionAdapter({
    baseUrl: 'https://watch.example', storage,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (options.method === 'PATCH') return Response.json({}, { status: 404 });
      return Response.json({ watch: { id: 'replacement-watch' }, possessionToken: 'replacement-token' }, { status: 201 });
    }
  });
  assert.equal((await adapter.saveWatchSubscription(validWatchSubscriptionRequest)).ok, true);
  assert.deepEqual(calls.map(call => call.options.method), ['PATCH', 'POST']);
  assert.deepEqual(JSON.parse(storage.getItem(WATCH_BACKEND_CREDENTIAL_STORAGE_KEY)), {
    version: 1, watchId: 'replacement-watch', possessionToken: 'replacement-token'
  });
});

test('production fixture query parameters have no effect', () => {
  assert.equal(pushFixtureOptions({
    hostname: 'sirento.nitin.run', search: '?watchFixture=current&permission=granted&subscribe=success'
  }), null);
});
