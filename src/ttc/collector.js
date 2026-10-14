// Story 64 — continuous TTC vehicle-feed collector.
//
// The collector polls the TTC vehicle feed on a *monotonic* schedule: the next
// poll target is `start + n*intervalMs`, never `now + intervalMs`. A slow fetch
// therefore cannot push the schedule forward and accumulate drift. At most one
// fetch is in flight at a time; a fetch that overruns its slot is reported as a
// gap rather than overlapped.
//
// Every poll produces one immutable capture (piece 1) and commits it spool-first
// through the capture store. Identical-feed attempts are health metadata, not new
// vehicle evidence. Unavoidable observation gaps are reported explicitly and are
// never treated as zero results.

import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { TTC_VEHICLES_URL, MAX_FEED_BYTES, parseTtcVehicles } from './vehicle-feed.js';
import { buildCapture, validateCapture } from './capture-store.js';

// Default raw-feed fetch. Returns the raw protobuf bytes, the source timestamp
// and a fetch outcome. The content hash is over the raw bytes, so an identical
// feed is detected even when the header timestamp advances.
export async function fetchVehicleCapture(now = new Date(), fetchImpl = fetch) {
  let bytes;
  try {
    const response = await fetchImpl(TTC_VEHICLES_URL, { signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(`TTC vehicles HTTP ${response.status}`);
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > MAX_FEED_BYTES) throw new Error('Vehicle feed exceeds size limit');
      chunks.push(chunk);
    }
    bytes = Buffer.concat(chunks);
  } catch (error) {
    return { bytes: null, sourceUpdatedAt: null, outcome: 'unavailable', error: error.message };
  }
  const contentHash = createHash('sha256').update(bytes).digest('hex');
  try {
    const parsed = parseTtcVehicles(bytes, now);
    const outcome = parsed.observations.length === 0 ? 'empty' : 'ok';
    return { bytes, contentHash, sourceUpdatedAt: parsed.sourceUpdatedAt, outcome };
  } catch (error) {
    // A decode/stale failure is a local error, not an upstream outage.
    return { bytes, contentHash, sourceUpdatedAt: null, outcome: 'error', error: error.message };
  }
}

// Run the collector until `maxIterations` polls complete or `signal` aborts.
// Returns a bounded run summary: poll count, structured gap records and the
// final spool depth. `fetchFeed`, `clock` and `wait` are injectable so the
// schedule, drift and failure paths are deterministic in tests.
export async function runCollector({
  feedId = 'ttc-vehicles',
  intervalMs = 30000,
  fetchFeed = fetchVehicleCapture,
  store,
  clock = () => new Date(),
  wait = sleep,
  log = () => {},
  signal,
  maxIterations = Infinity,
  spoolLimit = 720,
  driftToleranceMs = 10000,
  gapThresholdMs = 60000
}) {
  if (!store || typeof store.commit !== 'function' || typeof store.spoolDepth !== 'function' || typeof store.pending !== 'function' || typeof store.flush !== 'function') throw new Error('Collector requires a capture store');
  const start = +clock();
  const gaps = [];
  let polls = 0, previousStart = null, previousCapture, spoolDepth = 0;
  for (let n = 0; n < maxIterations; n++) {
    if (signal?.aborted) break;
    const target = start + n * intervalMs;
    const delay = target - +clock();
    if (delay > 0) await wait(delay);
    const actualStart = +clock();
    // A poll that starts outside tolerance, or a gap between consecutive polls
    // larger than the interval plus the threshold, is recorded explicitly.
    if (Math.abs(actualStart - target) > driftToleranceMs) {
      gaps.push({ sequence: n, target, start: actualStart, delta: actualStart - target, cause: 'drift' });
    }
    if (previousStart !== null && actualStart - previousStart > intervalMs + gapThresholdMs) {
      gaps.push({ sequence: n, target, start: actualStart, delta: actualStart - previousStart - intervalMs, cause: 'gap' });
    }
    previousStart = actualStart;
    const requestedAt = new Date(actualStart).toISOString();
    let outcome;
    try {
      outcome = await fetchFeed(new Date(actualStart));
    } catch (error) {
      outcome = { bytes: null, sourceUpdatedAt: null, outcome: 'error', error: error.message };
    }
    const completedAt = new Date(+clock()).toISOString();
    const capture = buildCapture({
      feedId, sequence: n, requestedAt, completedAt,
      sourceUpdatedAt: outcome.sourceUpdatedAt ?? null,
      bytes: outcome.bytes ? outcome.bytes.length : 0,
      contentHash: outcome.contentHash ?? `error-${n}`,
      outcome: outcome.outcome,
      previous: previousCapture
    });
    validateCapture(capture, previousCapture);
    previousCapture = capture;
    const result = await store.commit(capture, outcome.bytes ?? null);
    spoolDepth = await store.spoolDepth();
    // Spool saturation is bounded and alerted, never silently dropped. The
    // oldest pending sequence comes from the spool, not the sink, because a
    // saturated spool is exactly the case where R2 has not accepted the entry.
    if (spoolDepth > spoolLimit) {
      const pending = await store.pending();
      log({ source: 'ttc-collector', status: 'spool-saturated', spoolDepth, spoolLimit, oldestPending: pending[0].sequence });
    }
    log({ source: 'ttc-collector', sequence: n, outcome: capture.outcome, classification: capture.classification, durable: result.durable, spoolDepth });
    polls++;
  }
  // Graceful shutdown flushes any pending spool entries to R2.
  await store.flush();
  return { polls, gaps, spoolDepth };
}
