import { normalizeWatch, validateWatch, WATCH_CATEGORIES, WATCH_RADII_KM, WATCH_SERVICES } from './watch-matcher.js';

export const WATCH_STORAGE_KEY = 'sirento.local-watch.v1';
export const WATCH_FIXTURE_PARAMETER = 'watchFixture';
export const WATCH_FIXTURE_STATES = Object.freeze(['supported', 'unsupported', 'denied', 'ios', 'current', 'saved', 'none']);

const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1']);

export function watchFixtureState(locationLike) {
  if (!loopbackHosts.has(locationLike?.hostname)) return null;
  const fixture = new URLSearchParams(locationLike.search || '').get(WATCH_FIXTURE_PARAMETER);
  return WATCH_FIXTURE_STATES.includes(fixture) ? fixture : null;
}

export function watchSupportState(environment = globalThis) {
  const fixture = watchFixtureState(environment.location);
  if (fixture === 'unsupported') return { kind: 'unsupported', message: 'Notifications are not supported in this browser or platform.' };
  if (fixture === 'denied') return { kind: 'denied', message: 'Notifications are blocked. You can change this in your browser or device settings.' };
  if (fixture === 'ios') return { kind: 'ios-install', message: 'Add SirenTO to your Home Screen before notifications can be enabled.' };
  if (fixture) return { kind: 'supported', message: 'Watch settings can be saved on this device.' };

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
  return { kind: 'supported', message: 'Watch settings can be saved on this device.' };
}

export function watchLocationContext({ fixture, locationContext, savedLocation, coordinates, originKind }) {
  if (fixture === 'none') return null;
  if (fixture === 'saved') return { label: 'Home', latitude: 43.6532, longitude: -79.3832 };
  if (fixture === 'current') return { label: 'Current location', latitude: 43.7001, longitude: -79.42 };
  if (savedLocation) return { label: savedLocation.label, latitude: savedLocation.latitude, longitude: savedLocation.longitude };
  if (!Array.isArray(coordinates) || coordinates.length !== 2 || !coordinates.every(Number.isFinite)) return null;
  return {
    label: originKind === 'map' ? 'Selected map area' : locationContext?.type === 'current' ? 'Current location' : 'Selected location',
    latitude: coordinates[0],
    longitude: coordinates[1]
  };
}

export function defaultWatchRadius(radiusKm) {
  return WATCH_RADII_KM.includes(radiusKm) ? radiusKm : 2;
}

export function createLocalWatch({ id, location, radiusKm, service, category }) {
  return normalizeWatch({
    schema: 'sirento.watch',
    version: 1,
    id,
    centre: { latitude: location?.latitude, longitude: location?.longitude },
    radiusKm,
    service,
    category,
    active: true
  });
}

export function saveLocalWatch(storage, watch) {
  const normalized = normalizeWatch(watch);
  storage.setItem(WATCH_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function loadLocalWatch(storage) {
  try {
    const watch = JSON.parse(storage.getItem(WATCH_STORAGE_KEY));
    return validateWatch(watch).valid ? normalizeWatch(watch) : null;
  } catch {
    return null;
  }
}

export { WATCH_CATEGORIES, WATCH_RADII_KM, WATCH_SERVICES };
