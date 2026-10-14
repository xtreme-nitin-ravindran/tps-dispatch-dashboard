// Story 64 — long-running service composition and private health endpoint.
//
// `runtime.js` supplies the injectable collaborators (replay, publish,
// ownership); this module composes them with the existing `runCollector` /
// `runProcessor` libraries and a loopback-only health HTTP server. It is the
// last wiring the Compose stack needs: the collector and processor entrypoints
// run a service loop under an ownership lease and expose a private `/health`
// endpoint that reports capture/processing/publication independently.
//
// The health endpoint is loopback-only and exposes only operational status,
// never vehicle positions, geometry, or other evidence.

import { createServer } from 'node:http';

// Build a loopback-only Health endpoint. `getHealth()` returns the component
// snapshots; the response body is the JSON of the aggregated Health report. The
// `host`/`port` and `createServer` are injected so the endpoint is testable
// without a real socket. Only `GET /health` is served; anything else is a 404.
export function createHealthServer({
  getHealth,
  host = '127.0.0.1',
  port = 8764,
  createServerImpl = createServer
} = {}) {
  if (typeof getHealth !== 'function') throw new Error('createHealthServer requires a getHealth function');
  const server = createServerImpl(async (request, response) => {
    if (request.method !== 'GET' || request.url !== '/health') {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end('{"error":"not found"}');
      return;
    }
    const report = await getHealth();
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(report));
  });
  return {
    server,
    host,
    port,
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => resolve({ host, port }));
      });
    },
    close() {
      return new Promise(resolve => server.close(() => resolve()));
    }
  };
}
