// Story 64 — production runtime wiring (Piece 6).
//
// `src/ttc/collector.js` and `src/ttc/processor.js` are library services: they
// take their collaborators (feed, store, replay, publish, ownership) as
// parameters and never read the environment or the network themselves. This
// module is the thin, injectable composition layer that turns them into a
// runnable service, supplying the *real* collaborators the plan names as the
// outstanding Piece 6 wiring:
//
//   - `buildReplay` — the processor's `replay(capture, { previous, index, now })`
//     collaborator: it reads the capture's raw protobuf payload, parses it, and
//     runs vehicle detection. It is the production wiring for the injected
//     `replay` seam that `runProcessor` requires.
//   - `buildTtcPublish` — the processor's `publish(output)` collaborator: it
//     projects the confirmed geometry and writes `data/ttc-diversions.json`
//     through the shared R2 sink. It deliberately publishes only the public
//     geometry key; the incident snapshot (`data/current.json`) is written by
//     the independent incident ETL, so the two datasets can never conflict.
//   - `withOwnership` — acquire the single-writer lease, renew it on an interval
//     until a shutdown `signal` fires, and release it on the way out. This is
//     the graceful-shutdown interlock that lets the Compose restart policy bring
//     a crashed process back without two live writers.
//
// Everything is injectable so the wiring is deterministic and fully testable
// without a network or a real bucket, and no default depends on ambient `R2_*`
// credentials.

import { parseTtcVehicles } from './vehicle-feed.js';
import { detectVehicles } from './vehicle-detector.js';
import { acquireOwnership, renewOwnership, releaseOwnership } from './ownership.js';
import { publicTtcGeometry } from '../../scripts/publish-ttc-geometry.js';

// The public geometry key the processor publishes. It is the only key this
// runtime writes; the incident snapshot is owned by the independent ETL.
export const TTC_GEOMETRY_KEY = 'data/ttc-diversions.json';

// Build the processor's `replay` collaborator. `getBytes(key)` returns the raw
// protobuf payload (or a falsy value); `parse` decodes it into a feed; `detect`
// advances the vehicle-detection state. A capture with no payload (an empty or
// unavailable fetch) has no new vehicle evidence, so it is passed through
// `detect` with no feed, mirroring the spike's unavailable-source path.
export function buildReplay({
  getBytes,
  parse = parseTtcVehicles,
  detect = detectVehicles,
  geometryCache = new Map(),
  log = () => { }
} = {}) {
  if (typeof getBytes !== 'function') throw new Error('buildReplay requires a getBytes function');
  return async function replay(capture, { previous, index, now }) {
    const bytes = capture.payload ? await getBytes(capture.payload) : null;
    let feed = null;
    if (bytes) {
      try {
        feed = parse(bytes, now);
      } catch (error) {
        log({ source: 'ttc-runtime', status: 'replay-decode-failed', sequence: capture.sequence, error: error.message });
        feed = null;
      }
    }
    const result = detect(previous, feed, index, now, undefined, { geometryCache, log });
    return { state: result.state, report: result.report };
  };
}

// Build the processor's `publish` collaborator. `sink` is the shared R2 sink
// (`publish({ key, body }) -> { changed }`); `project` turns the completed
// diversion output into the public geometry artifact. Returns the changed flag
// so the caller can log a committed/unchanged verdict.
export function buildTtcPublish({ sink, project = publicTtcGeometry, log = () => { } } = {}) {
  if (!sink || typeof sink.publish !== 'function') throw new Error('buildTtcPublish requires a sink with publish');
  return async function publish(output) {
    const geometry = project(output);
    const { changed } = await sink.publish({ key: TTC_GEOMETRY_KEY, body: `${JSON.stringify(geometry)}\n` });
    log({ source: 'ttc-runtime', status: changed ? 'ttc-committed' : 'ttc-unchanged' });
    return { changed };
  };
}

// Acquire the single-writer lease, renew it on an injected interval, and release
// it on shutdown. `signal` is an abort signal; when it aborts, the renewal timer
// is cleared and the lease is released so a successor can take over. Returns a
// `{ acquired, ownerId }` result. The timer callbacks are injected so renewal
// timing is deterministic in tests.
export async function withOwnership({
  acquire = acquireOwnership,
  renew = renewOwnership,
  release = releaseOwnership,
  sink,
  key,
  ownerId,
  ttlMs,
  renewIntervalMs = ttlMs / 2,
  signal,
  onLost = () => {},
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
  log = () => { }
}) {
  if (!signal) throw new Error('withOwnership requires a signal');
  const acquired = await acquire({ sink, key, ownerId, ttlMs });
  if (!acquired.acquired) {
    log({ source: 'ttc-runtime', status: 'ownership-denied', holder: acquired.holder });
    return { acquired: false, holder: acquired.holder, ownerId };
  }
  let timer;
  let released = false;
  const releaseOnce = async () => {
    if (released) return;
    released = true;
    if (timer !== undefined) clearIntervalImpl(timer);
    await release({ sink, key, ownerId });
    log({ source: 'ttc-runtime', status: 'ownership-released', ownerId });
  };
  timer = setIntervalImpl(async () => {
    // A renewal that fails (or throws, for example a transient R2 error) means
    // the lease is no longer ours to hold. Continuing would risk a second live
    // writer, so the loss is reported to the caller, which aborts the service
    // and lets the ownership TTL arbitrate a successor. Renewal errors must
    // never become unhandled rejections.
    let ok = false;
    try { ok = await renew({ sink, key, ownerId, ttlMs }); }
    catch (error) { log({ source: 'ttc-runtime', status: 'ownership-renewal-error', ownerId, error: error.message }); }
    if (!ok) {
      log({ source: 'ttc-runtime', status: 'ownership-lost', ownerId });
      onLost();
    }
  }, renewIntervalMs);
  signal.addEventListener('abort', releaseOnce, { once: true });
  return { acquired: true, ownerId, release: releaseOnce };
}
