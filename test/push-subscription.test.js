import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearWatchActivation,
  createHttpWatchSubscriptionAdapter,
  createPushFixtureRuntime,
  createPushSubscriptionController,
  disabledWatchSubscriptionAdapter,
  loadWatchActivation,
  pushCapability,
  pushFixtureOptions,
  saveWatchActivation,
  serializePushSubscription,
  urlBase64ToUint8Array,
  vapidPublicKeyFrom,
  watchApiBaseUrlFrom,
  watchSubscriptionPayload
} from '../src/push-subscription.js';
import { createLocalWatch } from '../src/watch-config.js';

const vapidKey = 'BEl62iUYgUivxIkv69yViEuiBIa40HIh7NTQ8mFdWEzzIaT8J7EM3I7FjHmR1pK1mPUY8R1QZ5Y9fJxw2sL7YxA';
const watch = createLocalWatch({
  id: 'watch-1', location: { latitude: 43.65, longitude: -79.38 },
  radiusKm: 1, service: 'all', category: 'fire'
});

function subscription({ expirationTime = null, events = [] } = {}) {
  const keys = { p256dh: Uint8Array.from([1, 2, 3]).buffer, auth: Uint8Array.from([4, 5]).buffer };
  return {
    endpoint: 'https://push.example/sub/secret', expirationTime,
    getKey: name => keys[name],
    async unsubscribe() { events.push('unsubscribe'); return true; }
  };
}

function runtime({ permission = 'granted', existing = null, subscribeError = null, events = [] } = {}) {
  let current = existing;
  const calls = { permission: 0, subscribe: 0, options: null };
  const registration = { pushManager: {
    async getSubscription() { return current; },
    async subscribe(options) {
      calls.subscribe += 1;
      calls.options = options;
      if (subscribeError) throw subscribeError;
      current = subscription({ events });
      return current;
    }
  } };
  const environment = {
    isSecureContext: true, PushManager: class {},
    Notification: { permission, async requestPermission() { calls.permission += 1; return permission; } },
    navigator: { serviceWorker: { ready: Promise.resolve(registration) } }
  };
  return { environment, calls };
}

test('capability detection covers secure context, APIs, denial, and detectable iOS installation', () => {
  const supported = runtime().environment;
  assert.equal(pushCapability(supported).kind, 'supported');
  assert.equal(pushCapability({ ...supported, isSecureContext: false }).kind, 'unsupported');
  assert.equal(pushCapability({ ...supported, Notification: undefined }).kind, 'unsupported');
  assert.equal(pushCapability({ ...supported, Notification: { permission: 'denied' } }).kind, 'denied');
  assert.equal(pushCapability({ isSecureContext: true, navigator: { userAgent: 'iPhone' }, matchMedia: () => ({ matches: false }) }).kind, 'ios-install');
});

test('permission is never requested without an explicit user action', async () => {
  const fixture = runtime({ permission: 'default' });
  const controller = createPushSubscriptionController({ environment: fixture.environment, vapidPublicKey: vapidKey });
  assert.equal((await controller.activate(watch)).kind, 'gesture-required');
  assert.equal(fixture.calls.permission, 0);
  assert.equal(fixture.calls.subscribe, 0);
  assert.equal(controller.capability().kind, 'supported');
});

test('granted permission subscribes with userVisibleOnly and converted public VAPID key', async () => {
  const fixture = runtime();
  let saved;
  const adapter = { async saveWatchSubscription(payload) { saved = payload; return { ok: true }; } };
  const result = await createPushSubscriptionController({ environment: fixture.environment, adapter, vapidPublicKey: vapidKey })
    .activate(watch, { explicitUserAction: true });
  assert.equal(result.kind, 'active');
  assert.equal(fixture.calls.permission, 0);
  assert.equal(fixture.calls.subscribe, 1);
  assert.equal(fixture.calls.options.userVisibleOnly, true);
  assert.deepEqual(fixture.calls.options.applicationServerKey, urlBase64ToUint8Array(vapidKey));
  assert.equal(saved.watch.id, watch.id);
  assert.equal(saved.subscription.endpoint, 'https://push.example/sub/secret');
});

test('explicit activation replaces a subscription created with an old VAPID key', async () => {
  const fixture = createPushFixtureRuntime({ hostname: 'localhost', search: '?permission=granted&subscription=valid&subscribe=success' });
  const calls = { deleted: 0 };
  const existing = await (await fixture.environment.navigator.serviceWorker.ready).pushManager.getSubscription();
  existing.options = { applicationServerKey: Uint8Array.from([9, 9, 9]).buffer };
  const controller = createPushSubscriptionController({
    environment: fixture.environment,
    vapidPublicKey: fixture.vapidPublicKey,
    adapter: {
      async deleteWatchSubscription() { calls.deleted += 1; return { ok: true }; },
      async saveWatchSubscription() { return { ok: true }; }
    }
  });
  const result = await controller.activate(watch, { explicitUserAction: true });
  assert.equal(result.kind, 'active');
  assert.equal(calls.deleted, 1);
  assert.equal(fixture.calls.unsubscribe, 1);
  assert.equal(fixture.calls.subscribe, 1);
});

test('denied and dismissed permission never subscribe or repeatedly prompt', async () => {
  const denied = runtime({ permission: 'denied' });
  const deniedResult = await createPushSubscriptionController({ environment: denied.environment, vapidPublicKey: vapidKey })
    .activate(watch, { explicitUserAction: true });
  assert.equal(deniedResult.kind, 'denied');
  assert.equal(denied.calls.permission, 0);
  assert.equal(denied.calls.subscribe, 0);

  const dismissed = runtime({ permission: 'default' });
  const dismissedResult = await createPushSubscriptionController({ environment: dismissed.environment, vapidPublicKey: vapidKey })
    .activate(watch, { explicitUserAction: true });
  assert.equal(dismissedResult.kind, 'dismissed');
  assert.equal(dismissed.calls.permission, 1);
  assert.equal(dismissed.calls.subscribe, 0);
});

test('subscription serializer and pairing contain only backend fields', () => {
  const serialized = serializePushSubscription(subscription({ expirationTime: 123 }));
  assert.deepEqual(serialized, {
    endpoint: 'https://push.example/sub/secret', expirationTime: 123,
    p256dh: 'AQID', auth: 'BAU'
  });
  const payload = watchSubscriptionPayload(watch, subscription());
  assert.deepEqual(Object.keys(payload), ['schema', 'version', 'watch', 'subscription']);
  assert.equal(JSON.stringify(payload).includes('label'), false);
});

test('subscribe failures are contained and reported', async () => {
  const fixture = runtime({ subscribeError: new Error('offline') });
  const result = await createPushSubscriptionController({ environment: fixture.environment, vapidPublicKey: vapidKey })
    .activate(watch, { explicitUserAction: true });
  assert.equal(result.kind, 'subscribe-failed');
});

test('foreground reconciliation trusts actual subscription state', async () => {
  const valid = createPushSubscriptionController({ environment: runtime({ existing: subscription() }).environment });
  assert.equal((await valid.reconcile(watch)).kind, 'active');
  assert.equal((await valid.reconcile(null)).kind, 'orphaned');
  const missing = createPushSubscriptionController({ environment: runtime().environment });
  assert.equal((await missing.reconcile(watch)).kind, 'missing');
  const expired = createPushSubscriptionController({ environment: runtime({ existing: subscription({ expirationTime: 1 }) }).environment });
  assert.equal((await expired.reconcile(watch, { now: 2 })).kind, 'expired');
});

test('unsubscribe invokes backend deletion before browser unsubscribe', async () => {
  const events = [];
  const existing = subscription({ events });
  const adapter = { async deleteWatchSubscription() { events.push('delete'); return { ok: true }; } };
  const controller = createPushSubscriptionController({ environment: runtime({ existing }).environment, adapter });
  assert.equal((await controller.unsubscribe(watch)).kind, 'unsubscribed');
  assert.deepEqual(events, ['delete', 'unsubscribe']);
});

test('loopback fixtures are deterministic and cannot activate on production hosts', async () => {
  const url = { hostname: '127.0.0.1', search: '?permission=granted&subscription=missing&subscribe=success&unsubscribe=success&push=sample&click=existing-client' };
  assert.deepEqual(pushFixtureOptions(url), {
    permission: 'granted', subscription: 'missing', subscribe: 'success', unsubscribe: 'success', push: 'sample', click: 'existing-client'
  });
  assert.equal(pushFixtureOptions({ hostname: 'sirento.example', search: url.search }), null);
  const fixture = createPushFixtureRuntime(url);
  const controller = createPushSubscriptionController(fixture);
  const result = await controller.activate(watch, { explicitUserAction: true });
  assert.equal(result.kind, 'active');
  assert.equal(fixture.calls.permission, 0);
  assert.equal(fixture.calls.subscribe, 1);
  assert.equal(fixture.calls.save, 1);
  assert.equal((await controller.unsubscribe(watch)).kind, 'unsubscribed');
  assert.equal(fixture.calls.unsubscribe, 1);
});

test('push helpers reject malformed state and tolerate absent optional browser plumbing', async () => {
  assert.equal(pushFixtureOptions({ hostname: 'localhost', search: '' }), null);
  assert.equal(pushFixtureOptions({ hostname: 'localhost' }), null);
  assert.equal(pushFixtureOptions(null), null);
  assert.equal(pushFixtureOptions({ hostname: 'localhost', search: '?permission=invalid' }), null);
  assert.equal(pushCapability({ fixtureUnsupported: true }).kind, 'unsupported');
  assert.equal(pushCapability({}).kind, 'unsupported');
  assert.equal(pushCapability({ isSecureContext: true, Notification: {}, navigator: {} }).kind, 'unsupported');
  assert.equal(pushCapability({ isSecureContext: true, Notification: {}, PushManager: class {}, navigator: null }).kind, 'unsupported');
  assert.equal(pushCapability({ isSecureContext: true, navigator: { userAgent: 'iPhone', standalone: true } }).kind, 'unsupported');
  assert.equal(vapidPublicKeyFrom(null), '');
  assert.equal(vapidPublicKeyFrom({}), '');
  assert.equal(vapidPublicKeyFrom({ querySelector: () => ({ content: ' key ' }) }), 'key');
  assert.equal(watchApiBaseUrlFrom(null), '');
  assert.equal(watchApiBaseUrlFrom({ querySelector: () => ({}) }), '');
  assert.throws(() => urlBase64ToUint8Array(''), /required/);
  assert.deepEqual([...urlBase64ToUint8Array('-_')], [251]);
  assert.throws(() => serializePushSubscription(null), /valid/);
  assert.throws(() => serializePushSubscription({ endpoint: 'https://push.example', getKey: () => null }), /keys/);
  assert.throws(() => watchSubscriptionPayload({ ...watch, radiusKm: 10 }, subscription()), /Invalid watch/);

  const disabled = disabledWatchSubscriptionAdapter();
  assert.equal((await disabled.deleteWatchSubscription()).kind, 'adapter-disabled');
});

test('activation, reconciliation, and unsubscribe cover safe fallback outcomes', async () => {
  const unsupported = createPushSubscriptionController({ environment: {} });
  assert.equal((await unsupported.activate(watch, { explicitUserAction: true })).kind, 'unsupported');
  assert.equal((await unsupported.reconcile(watch)).kind, 'unsupported');
  assert.equal((await unsupported.unsubscribe(watch)).kind, 'unsupported');

  const noKey = runtime();
  assert.equal((await createPushSubscriptionController({ environment: noKey.environment })
    .activate(watch, { explicitUserAction: true })).kind, 'backend-unavailable');

  const keylessExisting = runtime({ existing: subscription() });
  const reused = createPushSubscriptionController({
    environment: keylessExisting.environment, vapidPublicKey: vapidKey,
    adapter: { async saveWatchSubscription() { return { ok: true }; } }
  });
  assert.equal((await reused.activate(watch, { explicitUserAction: true })).kind, 'active');
  assert.equal(keylessExisting.calls.subscribe, 0);

  const existing = subscription();
  existing.options = { applicationServerKey: urlBase64ToUint8Array(vapidKey) };
  const active = createPushSubscriptionController({
    environment: runtime({ existing }).environment,
    vapidPublicKey: vapidKey,
    adapter: { async saveWatchSubscription() { return { ok: false }; } }
  });
  assert.equal((await active.activate(watch, { explicitUserAction: true })).kind, 'backend-unavailable');

  const sameLengthMismatch = subscription();
  const configured = urlBase64ToUint8Array(vapidKey);
  const changed = configured.slice();
  changed[changed.length - 1] ^= 1;
  sameLengthMismatch.options = { applicationServerKey: changed.buffer };
  const rotation = createPushSubscriptionController({
    environment: runtime({ existing: sameLengthMismatch }).environment,
    vapidPublicKey: vapidKey,
    adapter: {
      async deleteWatchSubscription() { throw new Error('backend offline'); },
      async saveWatchSubscription() { return { ok: true }; }
    }
  });
  assert.equal((await rotation.activate(watch, { explicitUserAction: true })).kind, 'active');

  const promptedDenied = runtime({ permission: 'default' });
  promptedDenied.environment.Notification.requestPermission = async () => 'denied';
  assert.equal((await createPushSubscriptionController({ environment: promptedDenied.environment, vapidPublicKey: vapidKey })
    .activate(watch, { explicitUserAction: true })).kind, 'denied');

  const idle = createPushSubscriptionController({ environment: runtime().environment });
  assert.equal((await idle.reconcile(null)).kind, 'idle');
  assert.equal((await idle.unsubscribe(watch)).kind, 'unsubscribed');

  const failed = subscription();
  failed.unsubscribe = async () => false;
  const failingController = createPushSubscriptionController({
    environment: runtime({ existing: failed }).environment,
    adapter: { async deleteWatchSubscription() { throw new Error('offline'); } }
  });
  const result = await failingController.unsubscribe(watch);
  assert.equal(result.kind, 'unsubscribe-failed');
  assert.equal(result.backendDeleted, false);
  const noWatch = subscription();
  const noWatchResult = await createPushSubscriptionController({
    environment: runtime({ existing: noWatch }).environment,
    adapter: { async deleteWatchSubscription(payload) { assert.equal(payload.watchId, null); return { ok: false }; } }
  }).unsubscribe(null);
  assert.equal(noWatchResult.backendDeleted, false);
});

test('activation storage and HTTP adapter contain corrupt credentials and backend failures', async () => {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  };
  saveWatchActivation(storage, { version: 1, watchId: 'watch-1' });
  assert.equal(loadWatchActivation(storage).watchId, 'watch-1');
  values.set('sirento.watch-activation.v1', '{broken');
  assert.equal(loadWatchActivation(storage), null);
  clearWatchActivation(storage);
  assert.equal(loadWatchActivation(storage), null);
  values.set('sirento.watch-activation.v1', JSON.stringify({ version: 2, watchId: 'watch-1' }));
  assert.equal(loadWatchActivation(storage), null);

  assert.throws(() => createHttpWatchSubscriptionAdapter({ baseUrl: 'https://watch.example', fetchImpl: null }), /fetch/);
  values.set('sirento.watch-backend-credential.v1', '{broken');
  const failedSave = createHttpWatchSubscriptionAdapter({
    baseUrl: 'https://watch.example', storage,
    fetchImpl: async () => new Response(null, { status: 503 })
  });
  assert.deepEqual(await failedSave.saveWatchSubscription({}), { ok: false, status: 503 });
  values.set('sirento.watch-backend-credential.v1', JSON.stringify({ version: 2, watchId: 'old', possessionToken: 'old' }));
  assert.deepEqual(await failedSave.saveWatchSubscription({}), { ok: false, status: 503 });
  assert.equal((await createHttpWatchSubscriptionAdapter({ baseUrl: {}, fetchImpl: assert.fail })
    .saveWatchSubscription({})).kind, 'adapter-disabled');

  const invalidCreate = createHttpWatchSubscriptionAdapter({
    baseUrl: 'https://watch.example', storage,
    fetchImpl: async () => Response.json({ watch: {}, possessionToken: null }, { status: 201 })
  });
  assert.deepEqual(await invalidCreate.saveWatchSubscription({}), { ok: false });
  assert.deepEqual(await invalidCreate.deleteWatchSubscription(), { ok: true });

  values.set('sirento.watch-backend-credential.v1', JSON.stringify({ version: 1, watchId: 'watch-1', possessionToken: 'token' }));
  const failedDelete = createHttpWatchSubscriptionAdapter({
    baseUrl: 'https://watch.example', storage,
    fetchImpl: async () => new Response(null, { status: 500 })
  });
  assert.deepEqual(await failedDelete.deleteWatchSubscription(), { ok: false, status: 500 });

  const withoutStorage = createHttpWatchSubscriptionAdapter({
    baseUrl: 'https://watch.example', storage: null,
    fetchImpl: async () => Response.json({ watch: { id: 'watch' }, possessionToken: 'token' }, { status: 201 })
  });
  assert.equal((await withoutStorage.saveWatchSubscription({})).ok, true);

});

test('loopback runtime variants exercise permission, expiry, failure, and cleanup deterministically', async () => {
  assert.equal(createPushFixtureRuntime({ hostname: 'example.test', search: '' }), null);
  const unsupported = createPushFixtureRuntime({ hostname: 'example.test', search: '' }, { unsupported: true });
  assert.equal(pushCapability(unsupported.environment).kind, 'unsupported');
  const expired = createPushFixtureRuntime({ hostname: 'localhost', search: '?subscription=expired&permission=granted' });
  const expiredSubscription = await (await expired.environment.navigator.serviceWorker.ready).pushManager.getSubscription();
  assert.equal(expiredSubscription.getKey('unknown'), null);
  assert.equal((await createPushSubscriptionController(expired).reconcile(watch)).kind, 'expired');
  assert.equal((await createPushSubscriptionController(expired).unsubscribe(watch)).kind, 'unsubscribed');
  assert.equal(expired.calls.delete, 1);
  assert.equal(expired.calls.unsubscribe, 1);
  const failing = createPushFixtureRuntime({ hostname: 'localhost', search: '?permission=granted&subscribe=failure' });
  assert.equal((await createPushSubscriptionController(failing).activate(watch, { explicitUserAction: true })).kind, 'subscribe-failed');
  const prompted = createPushFixtureRuntime({ hostname: 'example.test', search: '' }, { enabled: true });
  assert.equal((await createPushSubscriptionController(prompted).activate(watch, { explicitUserAction: true })).kind, 'dismissed');
  assert.equal(prompted.calls.permission, 1);
});
