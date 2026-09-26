import { createWatchApi } from './watch-api.js';
import { loadWatchBackendConfig } from './watch-backend-config.js';
import { D1WatchRepository } from './watch-repository.js';
import { createWatchService } from './watch-service.js';
import { createScheduledWatchDelivery } from './watch-scheduled-matcher.js';

const runScheduledDelivery = createScheduledWatchDelivery();

export default {
  async fetch(request, environment) {
    try {
      const config = loadWatchBackendConfig(environment);
      const repository = new D1WatchRepository(environment.WATCH_DB);
      const service = createWatchService({ repository, vapidKeyVersion: config.vapidKeyVersion });
      return createWatchApi({
        service,
        allowedOrigins: config.allowedOrigins,
        createRateLimiter: environment.WATCH_CREATE_RATE_LIMITER
      })(request);
    } catch {
      return new Response(JSON.stringify({ error: { code: 'BACKEND_MISCONFIGURED', message: 'Watch service is not configured' } }), {
        status: 503,
        headers: { 'content-type': 'application/json; charset=utf-8' }
      });
    }
  },

  async scheduled(_event, environment, context) {
    const delivery = runScheduledDelivery(environment).then(result => {
      console.log(JSON.stringify({
        event: 'watch_delivery_run',
        activeWatches: result.activeWatchCount,
        candidates: result.candidates.length,
        delivered: result.delivery.delivered,
        retries: result.delivery.retryCount,
        permanentFailures: result.delivery.permanentFailed,
        retryExhausted: result.delivery.retryExhausted,
        deliveryCeilingSkipped: result.delivery.ceilingSkipped,
        expiredDedupeRemoved: result.expiredRemoved,
        inactiveWatchesRemoved: result.inactiveRemoved
      }));
      return result;
    }, error => {
      console.error(JSON.stringify({ event: 'watch_delivery_run', failed: true }));
      throw error;
    });
    if (context?.waitUntil) context.waitUntil(delivery);
    return delivery;
  }
};
