import { normalizeWatch, validateWatch } from './watch-matcher.js';

export const WATCH_ACTIVATION_STORAGE_KEY = 'sirento.watch-activation.v1';
export const WATCH_BACKEND_CREDENTIAL_STORAGE_KEY = 'sirento.watch-backend-credential.v1';
export const PUSH_FIXTURE_VALUES = Object.freeze({
  permission: ['granted', 'denied', 'default'],
  subscription: ['valid', 'missing', 'expired'],
  subscribe: ['success', 'failure'],
  unsubscribe: ['success'],
  push: ['sample', 'new-tfs', 'new-tps', 'update', 'no-distance', 'malformed', 'external'],
  arrival: ['present', 'missing'],
  click: ['existing-client', 'no-client']
});

const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1']);
const fixtureVapidKey = 'BEl62iUYgUivxIkv69yViEuiBIa40HIh7NTQ8mFdWEzzIaT8J7EM3I7FjHmR1pK1mPUY8R1QZ5Y9fJxw2sL7YxA';

export function pushFixtureOptions(locationLike) {
  if (!loopbackHosts.has(locationLike?.hostname)) return null;
  const params = new URLSearchParams(locationLike.search || '');
  const fixtures = {};
  for (const [name, values] of Object.entries(PUSH_FIXTURE_VALUES)) {
    const value = params.get(name);
    if (values.includes(value)) fixtures[name] = value;
  }
  return Object.keys(fixtures).length ? fixtures : null;
}

export function pushCapability(environment = globalThis) {
  if (environment.fixtureUnsupported) return { kind: 'unsupported', message: 'Notifications are not supported in this browser or platform.' };
  if (environment.isSecureContext !== true) return { kind: 'unsupported', message: 'Notifications require a secure connection.' };
  const notificationSupported = typeof environment.Notification !== 'undefined';
  const pushSupported = typeof environment.PushManager !== 'undefined' && 'serviceWorker' in (environment.navigator || {});
  if (!notificationSupported || !pushSupported) {
    const ios = /iPad|iPhone|iPod/.test(environment.navigator?.userAgent || '');
    const standalone = environment.matchMedia?.('(display-mode: standalone)').matches || environment.navigator?.standalone === true;
    if (ios && !standalone) return { kind: 'ios-install', message: 'Add SirenTO to your Home Screen before notifications can be enabled.' };
    return { kind: 'unsupported', message: 'Notifications are not supported in this browser or platform.' };
  }
  if (environment.Notification.permission === 'denied') {
    return { kind: 'denied', message: 'Notifications are blocked. You can change this in your browser or device settings.' };
  }
  return { kind: 'supported', message: 'This browser can receive watch notifications.' };
}

export function vapidPublicKeyFrom(documentLike) {
  return documentLike?.querySelector?.('meta[name="sirento-vapid-public-key"]')?.content?.trim() || '';
}

export function watchApiBaseUrlFrom(documentLike) {
  return documentLike?.querySelector?.('meta[name="sirento-watch-api-base-url"]')?.content?.trim().replace(/\/+$/, '') || '';
}

export function urlBase64ToUint8Array(value) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError('A VAPID public key is required');
  const normalized = value.trim().replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function bytesToBase64Url(value) {
  if (!value) return null;
  const bytes = new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function serializePushSubscription(subscription) {
  if (!subscription || typeof subscription.endpoint !== 'string' || !subscription.endpoint) {
    throw new TypeError('A valid PushSubscription is required');
  }
  const p256dh = bytesToBase64Url(subscription.getKey?.('p256dh'));
  const auth = bytesToBase64Url(subscription.getKey?.('auth'));
  if (!p256dh || !auth) throw new TypeError('PushSubscription keys are required');
  return {
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime ?? null,
    p256dh,
    auth
  };
}

export function watchSubscriptionPayload(watch, subscription) {
  const validation = validateWatch(watch);
  if (!validation.valid) throw new TypeError(`Invalid watch: ${validation.errors.join('; ')}`);
  return {
    schema: 'sirento.watch-subscription',
    version: 1,
    watch: normalizeWatch(watch),
    subscription: serializePushSubscription(subscription)
  };
}

export function disabledWatchSubscriptionAdapter() {
  return {
    async saveWatchSubscription() { return { ok: false, kind: 'adapter-disabled' }; },
    async deleteWatchSubscription() { return { ok: false, kind: 'adapter-disabled' }; }
  };
}

function backendCredential(storage) {
  try {
    const value = JSON.parse(storage?.getItem(WATCH_BACKEND_CREDENTIAL_STORAGE_KEY));
    return value?.version === 1 && typeof value.watchId === 'string' && typeof value.possessionToken === 'string'
      ? value : null;
  } catch {
    return null;
  }
}

export function createHttpWatchSubscriptionAdapter({ baseUrl, fetchImpl = globalThis.fetch, storage = globalThis.localStorage } = {}) {
  const apiBase = typeof baseUrl === 'string' ? baseUrl.trim().replace(/\/+$/, '') : '';
  if (!apiBase) return disabledWatchSubscriptionAdapter();
  if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required');

  return {
    async saveWatchSubscription(payload) {
      let credential = backendCredential(storage);
      const send = current => {
        const url = current ? `${apiBase}/watches/${encodeURIComponent(current.watchId)}` : `${apiBase}/watches`;
        const headers = { 'content-type': 'application/json' };
        if (current) headers['x-sirento-possession-token'] = current.possessionToken;
        return fetchImpl(url, {
          method: current ? 'PATCH' : 'POST',
          headers,
          body: JSON.stringify(payload)
        });
      };
      let response = await send(credential);
      if (credential && response.status === 404) {
        storage.removeItem(WATCH_BACKEND_CREDENTIAL_STORAGE_KEY);
        credential = null;
        response = await send(null);
      }
      if (!response.ok) return { ok: false, status: response.status };
      const result = await response.json();
      if (!credential) {
        if (typeof result?.watch?.id !== 'string' || typeof result?.possessionToken !== 'string') return { ok: false };
        storage?.setItem(WATCH_BACKEND_CREDENTIAL_STORAGE_KEY, JSON.stringify({
          version: 1, watchId: result.watch.id, possessionToken: result.possessionToken
        }));
      }
      return { ok: true, watch: result.watch };
    },

    async deleteWatchSubscription() {
      const credential = backendCredential(storage);
      if (!credential) return { ok: true };
      const response = await fetchImpl(`${apiBase}/watches/${encodeURIComponent(credential.watchId)}`, {
        method: 'DELETE',
        headers: { 'x-sirento-possession-token': credential.possessionToken }
      });
      if (!response.ok) return { ok: false, status: response.status };
      storage.removeItem(WATCH_BACKEND_CREDENTIAL_STORAGE_KEY);
      return { ok: true };
    }
  };
}

function subscriptionUsesKey(subscription, vapidPublicKey) {
  const configured = urlBase64ToUint8Array(vapidPublicKey);
  const existing = subscription?.options?.applicationServerKey;
  if (!existing) return true;
  const bytes = new Uint8Array(existing);
  return bytes.length === configured.length && bytes.every((value, index) => value === configured[index]);
}

export function saveWatchActivation(storage, value) {
  storage.setItem(WATCH_ACTIVATION_STORAGE_KEY, JSON.stringify(value));
}

export function loadWatchActivation(storage) {
  try {
    const value = JSON.parse(storage.getItem(WATCH_ACTIVATION_STORAGE_KEY));
    return value && value.version === 1 && typeof value.watchId === 'string' ? value : null;
  } catch {
    return null;
  }
}

export function clearWatchActivation(storage) {
  storage.removeItem(WATCH_ACTIVATION_STORAGE_KEY);
}

export function createPushSubscriptionController({ environment = globalThis, adapter = disabledWatchSubscriptionAdapter(), vapidPublicKey = '' } = {}) {
  async function registration() {
    return environment.navigator.serviceWorker.ready;
  }

  return {
    capability() { return pushCapability(environment); },

    async activate(watch, { explicitUserAction = false } = {}) {
      if (!explicitUserAction) return { kind: 'gesture-required' };
      const capability = pushCapability(environment);
      if (capability.kind !== 'supported') return capability;
      if (!vapidPublicKey) return { kind: 'backend-unavailable' };

      let permission = environment.Notification.permission;
      if (permission === 'default') permission = await environment.Notification.requestPermission();
      if (permission === 'denied') return { kind: 'denied' };
      if (permission !== 'granted') return { kind: 'dismissed' };

      const ready = await registration();
      let subscription = await ready.pushManager.getSubscription();
      try {
        if (subscription && !subscriptionUsesKey(subscription, vapidPublicKey)) {
          try { await adapter.deleteWatchSubscription(); } catch { /* Rotation can still replace the local subscription. */ }
          await subscription.unsubscribe();
          subscription = null;
        }
        if (!subscription) {
          subscription = await ready.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
          });
        }
        const payload = watchSubscriptionPayload({ ...watch, active: true }, subscription);
        const saved = await adapter.saveWatchSubscription(payload);
        if (!saved?.ok) return { kind: 'backend-unavailable', subscription, payload };
        return { kind: 'active', subscription, payload };
      } catch (error) {
        return { kind: 'subscribe-failed', error };
      }
    },

    async reconcile(watch, { now = Date.now() } = {}) {
      const capability = pushCapability(environment);
      if (capability.kind !== 'supported') return capability;
      const ready = await registration();
      const subscription = await ready.pushManager.getSubscription();
      const expired = subscription?.expirationTime != null && subscription.expirationTime <= now;
      if (watch && (!subscription || expired)) return { kind: expired ? 'expired' : 'missing', subscription: null };
      if (!watch && subscription) return { kind: 'orphaned', subscription };
      if (watch && subscription) return { kind: 'active', subscription };
      return { kind: 'idle', subscription: null };
    },

    async unsubscribe(watch) {
      const capability = pushCapability(environment);
      if (capability.kind !== 'supported') return capability;
      const ready = await registration();
      const subscription = await ready.pushManager.getSubscription();
      let backendDeleted = false;
      if (subscription) {
        try {
          const result = await adapter.deleteWatchSubscription({
            watchId: watch?.id || null,
            subscription: serializePushSubscription(subscription)
          });
          backendDeleted = result?.ok === true;
        } catch { /* Local cleanup still proceeds if the future backend is unavailable. */ }
        const unsubscribed = await subscription.unsubscribe();
        return { kind: unsubscribed === false ? 'unsubscribe-failed' : 'unsubscribed', backendDeleted };
      }
      return { kind: 'unsubscribed', backendDeleted };
    }
  };
}

function fixtureSubscription({ expired = false } = {}) {
  const keys = { p256dh: Uint8Array.from([1, 2, 3, 4]).buffer, auth: Uint8Array.from([5, 6, 7, 8]).buffer };
  return {
    endpoint: 'https://push.fixture.invalid/subscription/test',
    expirationTime: expired ? Date.now() - 1000 : null,
    getKey: name => keys[name] || null,
    async unsubscribe() { return true; }
  };
}

export function createPushFixtureRuntime(locationLike, { unsupported = false, permissionOverride = null, enabled = false } = {}) {
  const options = pushFixtureOptions(locationLike);
  if (!options && !unsupported && !permissionOverride && !enabled) return null;
  let subscription = options?.subscription === 'valid' ? fixtureSubscription() :
    options?.subscription === 'expired' ? fixtureSubscription({ expired: true }) : null;
  const permission = options?.permission || permissionOverride || 'default';
  const calls = { permission: 0, subscribe: 0, unsubscribe: 0, save: 0, delete: 0 };
  if (subscription) {
    const original = subscription.unsubscribe;
    subscription.unsubscribe = async () => { calls.unsubscribe += 1; return original(); };
  }
  const registration = {
    pushManager: {
      async getSubscription() { return subscription; },
      async subscribe() {
        calls.subscribe += 1;
        if (options?.subscribe === 'failure') throw new Error('Fixture subscription failure');
        subscription = fixtureSubscription();
        const original = subscription.unsubscribe;
        subscription.unsubscribe = async () => { calls.unsubscribe += 1; return original(); };
        return subscription;
      }
    }
  };
  const environment = {
    isSecureContext: true,
    fixtureUnsupported: unsupported,
    PushManager: class {},
    Notification: {
      permission,
      async requestPermission() { calls.permission += 1; return permission; }
    },
    navigator: { serviceWorker: { ready: Promise.resolve(registration) } }
  };
  const adapter = {
    async saveWatchSubscription() { calls.save += 1; return { ok: true }; },
    async deleteWatchSubscription() { calls.delete += 1; return { ok: true }; }
  };
  return { environment, adapter, vapidPublicKey: fixtureVapidKey, calls };
}
