export class FakePushSender {
  constructor(results = [201]) {
    this.results = [...results];
    this.calls = [];
  }

  async sendPush(subscription, payload) {
    this.calls.push({ subscription: structuredClone(subscription), payload: structuredClone(payload) });
    const result = this.results.length ? this.results.shift() : 201;
    if (result instanceof Error) throw result;
    const status = typeof result === 'object' ? result.status : result;
    const retryAfter = typeof result === 'object' ? result.retryAfter : null;
    return { status, headers: { get: name => name.toLowerCase() === 'retry-after' ? retryAfter : null } };
  }
}

export function deliveryCandidate(overrides = {}) {
  return {
    schema: 'sirento.notification-candidate', version: 1,
    watchId: 'watch-delivery-1', incidentId: 'incident-delivery-1',
    notificationKind: 'new:v1', dedupeKey: 'dedupe-delivery-1',
    incidentUrl: 'https://sirento.example/?view=1&incident=incident-delivery-1',
    incident: { source: 'TFS', description: 'Alarm', location: 'Queen St', timestamp: '2026-09-25T12:00:00.000Z' },
    subscription: { endpoint: 'https://push.example/send/redacted', p256dh: 'public-fixture-key', auth: 'auth-fixture-key' },
    ...overrides
  };
}
