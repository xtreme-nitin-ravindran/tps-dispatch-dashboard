import { Buffer } from 'node:buffer';

const key = length => Buffer.from(Array.from({ length }, (_, index) => index + 1)).toString('base64url');

export const deterministicWatchId = 'watch_01J_TEST_OPAQUE';
export const deterministicPossessionToken = 'test-possession-token-00000000000000000001';
export const fixtureTimestamp = '2026-09-25T14:00:00.000Z';

export const validWatchSubscriptionRequest = Object.freeze({
  schema: 'sirento.watch-subscription',
  version: 1,
  watch: Object.freeze({
    schema: 'sirento.watch',
    version: 1,
    id: 'client-local-watch-id',
    centre: Object.freeze({ latitude: 43.6532267, longitude: -79.3831843 }),
    radiusKm: 0.5,
    service: 'TFS',
    category: 'fire',
    active: true
  }),
  subscription: Object.freeze({
    endpoint: 'https://push.example.test/subscriptions/sensitive-endpoint',
    expirationTime: null,
    p256dh: key(65),
    auth: key(16)
  })
});

export function backendFixtureRequest({ watch = {}, subscription = {}, ...payload } = {}) {
  return {
    ...validWatchSubscriptionRequest,
    ...payload,
    watch: {
      ...validWatchSubscriptionRequest.watch,
      ...watch,
      centre: watch.centre ?? { ...validWatchSubscriptionRequest.watch.centre }
    },
    subscription: { ...validWatchSubscriptionRequest.subscription, ...subscription }
  };
}
