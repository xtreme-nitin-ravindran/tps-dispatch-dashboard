import { formatNotificationContent } from './notification-content.js';

export const DEFAULT_MAX_DELIVERIES = 100;
export const DEFAULT_MAX_ATTEMPTS = 3;
const LEASE_MS = 2 * 60 * 1000;

function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

export function validateNotificationCandidate(candidate) {
  if (!isObject(candidate) || candidate.schema !== 'sirento.notification-candidate' || candidate.version !== 1) return false;
  for (const field of ['watchId', 'incidentId', 'notificationKind', 'dedupeKey', 'incidentUrl']) {
    if (typeof candidate[field] !== 'string' || !candidate[field]) return false;
  }
  if (!isObject(candidate.incident) || !['TFS', 'TPS'].includes(candidate.incident.source) ||
      typeof candidate.incident.description !== 'string' || typeof candidate.incident.location !== 'string') return false;
  if (candidate.incident.distanceKm !== undefined &&
      (!Number.isFinite(candidate.incident.distanceKm) || candidate.incident.distanceKm < 0)) return false;
  const subscription = candidate.subscription;
  if (!isObject(subscription) || typeof subscription.endpoint !== 'string' || !subscription.endpoint ||
      typeof subscription.p256dh !== 'string' || !subscription.p256dh ||
      typeof subscription.auth !== 'string' || !subscription.auth) return false;
  try {
    const incidentUrl = new URL(candidate.incidentUrl);
    const endpoint = new URL(subscription.endpoint);
    return incidentUrl.protocol === 'https:' && !incidentUrl.username && !incidentUrl.password &&
      endpoint.protocol === 'https:' && !endpoint.username && !endpoint.password;
  } catch { return false; }
}

export function buildPushPayload(candidate) {
  if (!validateNotificationCandidate(candidate)) throw new TypeError('Notification candidate is invalid');
  const content = formatNotificationContent(candidate);
  return {
    schema: 'sirento.push', version: 1,
    incident: {
      id: candidate.incidentId,
      title: content.title,
      body: content.body,
      url: candidate.incidentUrl
    }
  };
}

export function classifyPushResult(result) {
  const status = Number(result?.status);
  if (status >= 200 && status < 300) return { kind: 'delivered', statusCode: status };
  if (status === 404 || status === 410) return { kind: 'permanent', statusCode: status, deactivateEndpoint: true };
  if (status === 408 || status === 429 || status >= 500) return { kind: 'retryable', statusCode: status };
  return { kind: 'permanent', statusCode: Number.isInteger(status) ? status : null };
}

function retryAfterMs(response, nowMs) {
  const value = response?.headers?.get?.('retry-after');
  if (!value) return null;
  if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - nowMs) : null;
}

export function createNotificationDeliveryController({
  notificationRepository, watchRepository, sender, now = () => new Date(),
  wait = delay => new Promise(resolve => setTimeout(resolve, delay)),
  maxAttempts = DEFAULT_MAX_ATTEMPTS, maxDeliveries = DEFAULT_MAX_DELIVERIES,
  maxRetryDelayMs = 1000
} = {}) {
  if (!notificationRepository || !watchRepository || !sender?.sendPush) throw new TypeError('Delivery dependencies are required');
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) throw new TypeError('maxAttempts must be between 1 and 5');
  if (!Number.isInteger(maxDeliveries) || maxDeliveries < 1 || maxDeliveries > 1000) throw new TypeError('maxDeliveries must be between 1 and 1000');

  return {
    async deliver(candidates) {
      const summary = { received: Array.isArray(candidates) ? candidates.length : 0, processed: 0, delivered: 0, retryCount: 0, permanentFailed: 0, retryExhausted: 0, invalid: 0, ceilingSkipped: 0 };
      if (!Array.isArray(candidates)) return summary;
      const selected = candidates.slice().sort((a, b) => String(a?.dedupeKey).localeCompare(String(b?.dedupeKey)));
      for (const candidate of selected) {
        if (!validateNotificationCandidate(candidate)) { summary.invalid += 1; continue; }
        if (summary.processed >= maxDeliveries) { summary.ceilingSkipped += 1; continue; }
        const claimedAt = now();
        const claimed = await notificationRepository.claimDelivery(candidate.dedupeKey, {
          now: claimedAt.toISOString(), leaseExpiresAt: new Date(claimedAt.getTime() + LEASE_MS).toISOString()
        });
        if (!claimed) continue;
        summary.processed += 1;
        const payload = buildPushPayload(candidate);
        let final;
        let attemptsMade = 0;
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          attemptsMade += 1;
          let response;
          try { response = await sender.sendPush(candidate.subscription, payload); } catch { response = null; }
          const classification = response ? classifyPushResult(response) : { kind: 'retryable', statusCode: null };
          if (classification.kind !== 'retryable' || attempt === maxAttempts) {
            final = classification.kind === 'retryable' ? { ...classification, kind: 'retry_exhausted' } : classification;
            break;
          }
          const delay = Math.min(maxRetryDelayMs, retryAfterMs(response, now().getTime()) ?? (100 * (2 ** (attempt - 1))));
          if (delay > 0) await wait(delay);
        }
        const attemptedAt = now().toISOString();
        summary.retryCount += Math.max(0, attemptsMade - 1);
        const state = final.kind === 'permanent' ? 'permanent_failed' : final.kind;
        await notificationRepository.recordAttempt(candidate.dedupeKey, { status: state, attemptedAt, statusCode: final.statusCode, attemptCount: attemptsMade });
        if (state === 'delivered') summary.delivered += 1;
        else if (state === 'permanent_failed') {
          summary.permanentFailed += 1;
          if (final.deactivateEndpoint) {
            await watchRepository.deactivateSubscription(candidate.watchId, candidate.subscription.endpoint, attemptedAt);
          }
        } else summary.retryExhausted += 1;
      }
      return summary;
    }
  };
}
