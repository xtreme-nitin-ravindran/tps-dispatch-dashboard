import test from 'node:test';
import assert from 'node:assert/strict';
import {
  minimizeWatchCentre,
  normalizeWatchSubscriptionRequest,
  validateWatchSubscriptionRequest,
  WatchRequestValidationError,
  WATCH_COORDINATE_DECIMALS
} from '../src/watch-backend-validation.js';
import { createLoopbackWatchRepository, InMemoryWatchRepository } from '../src/watch-repository.js';
import { createWatchService, WatchAuthorizationError } from '../src/watch-service.js';
import {
  backendFixtureRequest,
  deterministicPossessionToken,
  deterministicWatchId,
  fixtureTimestamp,
  validWatchSubscriptionRequest
} from './fixtures/watch-backend.js';

function fixtureService(repository = new InMemoryWatchRepository(), overrides = {}) {
  return {
    repository,
    service: createWatchService({
      repository,
      idGenerator: () => deterministicWatchId,
      possessionTokenGenerator: () => deterministicPossessionToken,
      now: () => fixtureTimestamp,
      vapidKeyVersion: 'test-v1',
      ...overrides
    })
  };
}

test('valid creation stores the minimal backend record and returns only client-safe data', async () => {
  const { repository, service } = fixtureService();
  const result = await service.createWatch(validWatchSubscriptionRequest);
  assert.equal(result.watch.id, deterministicWatchId);
  assert.equal(result.possessionToken, deterministicPossessionToken);
  assert.equal(result.watch.centre.latitude, 43.6532);
  assert.equal(result.watch.centre.longitude, -79.3832);
  assert.equal(result.watch.vapidKeyVersion, 'test-v1');
  assert.equal(JSON.stringify(result).includes('sensitive-endpoint'), false);
  assert.equal(JSON.stringify(result).includes(validWatchSubscriptionRequest.subscription.p256dh), false);
  assert.equal(JSON.stringify(result).includes(validWatchSubscriptionRequest.subscription.auth), false);

  const stored = await repository.getWatch(deterministicWatchId);
  assert.equal(stored.id, deterministicWatchId);
  assert.equal(stored.subscription.endpoint, validWatchSubscriptionRequest.subscription.endpoint);
  assert.equal(stored.createdAt, fixtureTimestamp);
  assert.equal(stored.updatedAt, fixtureTimestamp);
  assert.equal(stored.lastConfirmedAt, fixtureTimestamp);
  assert.notEqual(stored.possessionTokenHash, deterministicPossessionToken);
  assert.equal('schema' in stored, false);
  assert.equal('version' in stored, false);
  assert.equal(JSON.stringify(stored).includes('client-local-watch-id'), false);
});

test('validation rejects malformed coordinates, radii, filters, subscriptions, and active state', () => {
  const invalidRequests = [
    null,
    [],
    { ...validWatchSubscriptionRequest, watch: null },
    { ...validWatchSubscriptionRequest, watch: { ...validWatchSubscriptionRequest.watch, centre: null } },
    backendFixtureRequest({ watch: { id: '', centre: null } }),
    backendFixtureRequest({ watch: { centre: { latitude: NaN, longitude: Infinity, extra: true } } }),
    backendFixtureRequest({ watch: { centre: { latitude: 91, longitude: -79 } } }),
    backendFixtureRequest({ watch: { radiusKm: 10 } }),
    backendFixtureRequest({ watch: { service: 'EMS' } }),
    backendFixtureRequest({ watch: { category: 'crime' } }),
    backendFixtureRequest({ watch: { active: 'yes' } }),
    backendFixtureRequest({ subscription: { endpoint: 'http://push.example.test/secret' } }),
    { ...validWatchSubscriptionRequest, subscription: null },
    backendFixtureRequest({ subscription: { endpoint: 'not a url', extra: true } }),
    backendFixtureRequest({ subscription: { endpoint: `https://${'x'.repeat(2050)}` } }),
    backendFixtureRequest({ subscription: { p256dh: 'bad-key' } }),
    backendFixtureRequest({ subscription: { p256dh: 'A' } }),
    backendFixtureRequest({ subscription: { p256dh: null } }),
    backendFixtureRequest({ subscription: { auth: '' } }),
    backendFixtureRequest({ subscription: { expirationTime: -1 } })
  ];
  for (const request of invalidRequests) assert.equal(validateWatchSubscriptionRequest(request).valid, false);
  assert.equal(validateWatchSubscriptionRequest(backendFixtureRequest({ subscription: { expirationTime: undefined } })).valid, true);
  assert.throws(() => normalizeWatchSubscriptionRequest(invalidRequests[0]), WatchRequestValidationError);
});

test('schema versions, unknown fields, and oversized payloads are rejected explicitly', () => {
  assert.match(validateWatchSubscriptionRequest(backendFixtureRequest({ schema: 'wrong' })).errors.join(' '), /schema/);
  assert.match(validateWatchSubscriptionRequest(backendFixtureRequest({ version: 2 })).errors.join(' '), /version/);
  assert.match(validateWatchSubscriptionRequest(backendFixtureRequest({ watch: { schema: 'wrong', version: 2 } })).errors.join(' '), /watch.schema/);
  assert.match(validateWatchSubscriptionRequest(backendFixtureRequest({ watch: { label: 'Home' } })).errors.join(' '), /label is not allowed/);
  assert.match(validateWatchSubscriptionRequest({ ...backendFixtureRequest(), padding: 'x'.repeat(17_000) }).errors.join(' '), /16384 bytes/);
  const circular = backendFixtureRequest();
  circular.circular = circular;
  assert.match(validateWatchSubscriptionRequest(circular).errors.join(' '), /16384 bytes/);
});

test('coordinate minimization uses four decimals without mutating the request', () => {
  const centre = { latitude: 43.6532267, longitude: -79.3831843 };
  assert.equal(WATCH_COORDINATE_DECIMALS, 4);
  assert.deepEqual(minimizeWatchCentre(centre), { latitude: 43.6532, longitude: -79.3832 });
  assert.deepEqual(centre, { latitude: 43.6532267, longitude: -79.3831843 });
});

test('opaque ID and possession token generators are injectable and deterministic', async () => {
  const { repository, service } = fixtureService();
  const created = await service.createWatch(validWatchSubscriptionRequest);
  const stored = await repository.getWatch(created.watch.id);
  assert.equal(created.watch.id, deterministicWatchId);
  assert.equal(created.possessionToken, deterministicPossessionToken);
  assert.doesNotMatch(created.watch.id, /43\.6532|-79\.3832|sensitive-endpoint/);
  assert.match(stored.possessionTokenHash, /^[a-f0-9]{64}$/);
});

test('service rejects broken generators and handles absent or malformed authorization state', async () => {
  assert.throws(() => createWatchService(), /repository/);
  for (const overrides of [
    { idGenerator: () => '' },
    { idGenerator: () => null },
    { possessionTokenGenerator: () => null },
    { possessionTokenGenerator: () => '' }
  ]) {
    const { service } = fixtureService(undefined, overrides);
    await assert.rejects(service.createWatch(validWatchSubscriptionRequest), /generators/);
  }
  const repository = new InMemoryWatchRepository();
  const { service } = fixtureService(repository);
  assert.equal(await service.updateWatch('missing', null, validWatchSubscriptionRequest), null);
  await repository.createWatch({ id: 'bad-hash', active: true, possessionTokenHash: '00' });
  await assert.rejects(service.updateWatch('bad-hash', null, validWatchSubscriptionRequest), WatchAuthorizationError);
  await assert.rejects(service.deleteWatch('bad-hash', 'token'), WatchAuthorizationError);

  const defaults = createWatchService({ repository: new InMemoryWatchRepository() });
  const created = await defaults.createWatch(validWatchSubscriptionRequest);
  assert.equal(typeof created.watch.id, 'string');
  assert.equal(typeof created.possessionToken, 'string');
  assert.equal('vapidKeyVersion' in created.watch, false);
});

test('authorized update replaces mutable domain data and preserves internal fields', async () => {
  const { repository, service } = fixtureService(undefined, { now: (() => {
    const values = [fixtureTimestamp, '2026-09-25T15:00:00.000Z'];
    return () => values.shift();
  })() });
  await service.createWatch(validWatchSubscriptionRequest);
  const updated = await service.updateWatch(deterministicWatchId, deterministicPossessionToken, backendFixtureRequest({
    watch: { radiusKm: 5, service: 'all', category: 'all', active: false },
    subscription: { expirationTime: 1 }
  }));
  assert.equal(updated.watch.radiusKm, 5);
  assert.equal(updated.watch.active, false);
  assert.equal(updated.watch.createdAt, fixtureTimestamp);
  assert.equal(updated.watch.updatedAt, '2026-09-25T15:00:00.000Z');
  const stored = await repository.getWatch(deterministicWatchId);
  assert.equal(stored.subscription.expirationTime, 1);
  assert.equal(stored.id, deterministicWatchId);
});

test('wrong possession token cannot update or delete an existing watch', async () => {
  const { service } = fixtureService();
  await service.createWatch(validWatchSubscriptionRequest);
  await assert.rejects(service.updateWatch(deterministicWatchId, 'wrong-token', validWatchSubscriptionRequest), WatchAuthorizationError);
  await assert.rejects(service.deleteWatch(deterministicWatchId, 'wrong-token'), WatchAuthorizationError);
  assert.ok(await service.getWatch(deterministicWatchId));
});

test('delete is authorized and duplicate deletion is idempotent', async () => {
  const { service } = fixtureService();
  await service.createWatch(validWatchSubscriptionRequest);
  assert.deepEqual(await service.deleteWatch(deterministicWatchId, deterministicPossessionToken), { deleted: true });
  assert.deepEqual(await service.deleteWatch(deterministicWatchId, deterministicPossessionToken), { deleted: false });
  assert.equal(await service.getWatch(deterministicWatchId), null);
});

test('repository supports multiple watches, active filtering, defensive copies, and reset', async () => {
  const repository = new InMemoryWatchRepository();
  const first = fixtureService(repository, { idGenerator: () => 'opaque-active' }).service;
  const second = fixtureService(repository, { idGenerator: () => 'opaque-disabled' }).service;
  await first.createWatch(validWatchSubscriptionRequest);
  await second.createWatch(backendFixtureRequest({ watch: { active: false } }));
  await assert.rejects(first.createWatch(validWatchSubscriptionRequest), /already exists/);
  const read = await repository.getWatch('opaque-active');
  read.centre.latitude = 0;
  assert.notEqual((await repository.getWatch('opaque-active')).centre.latitude, 0);
  assert.deepEqual((await repository.listActiveWatches()).map(record => record.id), ['opaque-active']);
  assert.equal(await repository.updateWatch('missing', {}), null);
  assert.equal(await repository.deleteWatch('missing'), false);
  assert.equal(await first.listActiveWatches().then(records => records.length), 1);
  const old = await repository.getWatch('opaque-disabled');
  old.updatedAt = '2026-08-01T00:00:00.000Z';
  await repository.updateWatch(old.id, old);
  assert.equal(await repository.cleanupInactive('2026-09-01T00:00:00.000Z'), 1);
  repository.reset();
  assert.deepEqual(await repository.listActiveWatches(), []);
});

test('expired subscription metadata is retained for later reconciliation', async () => {
  const { repository, service } = fixtureService();
  await service.createWatch(backendFixtureRequest({ subscription: { expirationTime: 1 } }));
  assert.equal((await repository.getWatch(deterministicWatchId)).subscription.expirationTime, 1);
});

test('validation and authorization errors never echo sensitive request values', async () => {
  const malformed = backendFixtureRequest({ subscription: { p256dh: 'secret-malformed-key' } });
  const validation = validateWatchSubscriptionRequest(malformed);
  const rendered = JSON.stringify(validation);
  assert.equal(rendered.includes(malformed.subscription.endpoint), false);
  assert.equal(rendered.includes(malformed.subscription.p256dh), false);
  const { service } = fixtureService();
  await service.createWatch(validWatchSubscriptionRequest);
  await assert.rejects(service.deleteWatch(deterministicWatchId, 'secret-wrong-token'), error => {
    assert.equal(error.message.includes('secret-wrong-token'), false);
    return true;
  });
});

test('process-local fixture repository requires an explicit switch and loopback host', () => {
  assert.throws(() => createLoopbackWatchRepository({ enabled: true, hostname: 'sirento.example' }), /loopback/);
  assert.throws(() => createLoopbackWatchRepository({ enabled: false, hostname: '127.0.0.1' }), /explicit switch/);
  assert.ok(createLoopbackWatchRepository({ enabled: true, hostname: 'localhost' }) instanceof InMemoryWatchRepository);
});
