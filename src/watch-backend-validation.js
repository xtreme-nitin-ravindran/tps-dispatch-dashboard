import { Buffer } from 'node:buffer';
import { WATCH_CATEGORIES, WATCH_RADII_KM, WATCH_SCHEMA, WATCH_SCHEMA_VERSION, WATCH_SERVICES } from './watch-matcher.js';

export const WATCH_SUBSCRIPTION_SCHEMA = 'sirento.watch-subscription';
export const WATCH_SUBSCRIPTION_VERSION = 1;
export const WATCH_COORDINATE_DECIMALS = 4;
export const WATCH_REQUEST_MAX_BYTES = 16 * 1024;

const payloadFields = ['schema', 'version', 'watch', 'subscription'];
const watchFields = ['schema', 'version', 'id', 'centre', 'radiusKm', 'service', 'category', 'active'];
const centreFields = ['latitude', 'longitude'];
const subscriptionFields = ['endpoint', 'expirationTime', 'p256dh', 'auth'];

export class WatchRequestValidationError extends TypeError {
  constructor(errors) {
    super(`Invalid watch subscription request: ${errors.join('; ')}`);
    this.name = 'WatchRequestValidationError';
    this.code = 'INVALID_WATCH_SUBSCRIPTION';
    this.errors = Object.freeze([...errors]);
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function rejectUnknownFields(value, allowed, path, errors) {
  for (const field of Object.keys(value)) {
    if (!allowed.includes(field)) errors.push(`${path}.${field} is not allowed`);
  }
}

function byteLength(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function base64UrlBytes(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const decoded = Buffer.from(value, 'base64url');
  return decoded.toString('base64url') === value ? decoded.length : null;
}

function validateEndpoint(value, errors) {
  if (typeof value !== 'string' || value.length > 2048) {
    errors.push('subscription.endpoint must be a string of at most 2048 characters');
    return;
  }
  try {
    const endpoint = new URL(value);
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || !endpoint.hostname) {
      errors.push('subscription.endpoint must be an HTTPS URL without credentials');
    }
  } catch {
    errors.push('subscription.endpoint must be an HTTPS URL without credentials');
  }
}

export function minimizeWatchCentre(centre) {
  const scale = 10 ** WATCH_COORDINATE_DECIMALS;
  const rounded = value => Math.round((value + Number.EPSILON) * scale) / scale;
  return { latitude: rounded(centre.latitude), longitude: rounded(centre.longitude) };
}

export function validateWatchSubscriptionRequest(payload) {
  const errors = [];
  if (!isObject(payload)) return { valid: false, errors: ['request must be an object'] };
  if (byteLength(payload) > WATCH_REQUEST_MAX_BYTES) errors.push(`request must not exceed ${WATCH_REQUEST_MAX_BYTES} bytes`);
  rejectUnknownFields(payload, payloadFields, 'request', errors);
  if (payload.schema !== WATCH_SUBSCRIPTION_SCHEMA) errors.push(`schema must be ${WATCH_SUBSCRIPTION_SCHEMA}`);
  if (payload.version !== WATCH_SUBSCRIPTION_VERSION) errors.push(`version must be ${WATCH_SUBSCRIPTION_VERSION}`);

  const watch = payload.watch;
  if (!isObject(watch)) {
    errors.push('watch must be an object');
  } else {
    rejectUnknownFields(watch, watchFields, 'watch', errors);
    if (watch.schema !== WATCH_SCHEMA) errors.push(`watch.schema must be ${WATCH_SCHEMA}`);
    if (watch.version !== WATCH_SCHEMA_VERSION) errors.push(`watch.version must be ${WATCH_SCHEMA_VERSION}`);
    if (typeof watch.id !== 'string' || !watch.id.trim() || watch.id.length > 128) errors.push('watch.id must be a non-empty string of at most 128 characters');
    if (!isObject(watch.centre)) {
      errors.push('watch.centre must be an object');
    } else {
      rejectUnknownFields(watch.centre, centreFields, 'watch.centre', errors);
      if (!Number.isFinite(watch.centre.latitude) || Math.abs(watch.centre.latitude) > 90) errors.push('watch.centre.latitude must be between -90 and 90');
      if (!Number.isFinite(watch.centre.longitude) || Math.abs(watch.centre.longitude) > 180) errors.push('watch.centre.longitude must be between -180 and 180');
    }
    if (!WATCH_RADII_KM.includes(watch.radiusKm)) errors.push(`watch.radiusKm must be one of ${WATCH_RADII_KM.join(', ')}`);
    if (!WATCH_SERVICES.includes(watch.service)) errors.push(`watch.service must be one of ${WATCH_SERVICES.join(', ')}`);
    if (!WATCH_CATEGORIES.includes(watch.category)) errors.push(`watch.category must be one of ${WATCH_CATEGORIES.join(', ')}`);
    if (typeof watch.active !== 'boolean') errors.push('watch.active must be a boolean');
  }

  const subscription = payload.subscription;
  if (!isObject(subscription)) {
    errors.push('subscription must be an object');
  } else {
    rejectUnknownFields(subscription, subscriptionFields, 'subscription', errors);
    validateEndpoint(subscription.endpoint, errors);
    if (subscription.expirationTime !== null && subscription.expirationTime !== undefined &&
        (!Number.isSafeInteger(subscription.expirationTime) || subscription.expirationTime < 0)) {
      errors.push('subscription.expirationTime must be null or a non-negative integer');
    }
    if (base64UrlBytes(subscription.p256dh) !== 65) errors.push('subscription.p256dh must be a 65-byte base64url public key');
    if (base64UrlBytes(subscription.auth) !== 16) errors.push('subscription.auth must be a 16-byte base64url secret');
  }
  return { valid: errors.length === 0, errors };
}

export function normalizeWatchSubscriptionRequest(payload) {
  const validation = validateWatchSubscriptionRequest(payload);
  if (!validation.valid) throw new WatchRequestValidationError(validation.errors);
  return {
    centre: minimizeWatchCentre(payload.watch.centre),
    radiusKm: payload.watch.radiusKm,
    service: payload.watch.service,
    category: payload.watch.category,
    active: payload.watch.active,
    subscription: {
      endpoint: payload.subscription.endpoint,
      expirationTime: payload.subscription.expirationTime ?? null,
      p256dh: payload.subscription.p256dh,
      auth: payload.subscription.auth
    }
  };
}
