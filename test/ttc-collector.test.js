import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runCollector, fetchVehicleCapture } from '../src/ttc/collector.js';
import { at, vehicle, protobuf } from './fixtures/ttc-vehicles/builders.js';
import { createCaptureStore } from '../src/ttc/capture-store.js';
import { memorySink, memorySpool } from './fixtures/ttc-capture/store.js';
import { virtualClock } from './fixtures/ttc-capture/clock.js';

const START = Date.parse('2026-10-13T12:00:00.000Z');
const feed = (contentHash, sourceUpdatedAt, outcome = 'ok') => ({ bytes: Buffer.from(contentHash), contentHash, sourceUpdatedAt, outcome });

function harness({ fetchFeed, spoolLimit, maxIterations = 3, intervalMs = 30000, signal } = {}) {
  const spool = memorySpool();
  const sink = memorySink();
  const store = createCaptureStore({ spool, sink });
  const vc = virtualClock(START);
  const logs = [];
  return { spool, sink, store, vc, logs, run: () => runCollector({ intervalMs, fetchFeed, store, clock: vc.clock, wait: vc.wait, log: e => logs.push(e), maxIterations, spoolLimit, signal }) };
}

test('[STORY-64] collector fires N polls at exactly start + n*intervalMs', async () => {
  const starts = [];
  const h = harness({ fetchFeed: async now => { starts.push(+now); return feed(`h${starts.length}`, now.toISOString()); } });
  const result = await h.run();
  assert.equal(result.polls, 3);
  assert.deepEqual(starts, [START, START + 30000, START + 60000]);
  assert.deepEqual(result.gaps, []);
});

test('[STORY-64] a slow fetch does not overlap and the next poll stays on schedule', async () => {
  const starts = [];
  let inFlight = 0, maxInFlight = 0;
  const h = harness({ fetchFeed: async now => {
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    starts.push(+now);
    // The fetch itself consumes 20s of virtual time, still inside the 30s slot.
    h.vc.advance(20000);
    inFlight--;
    return feed(`h${starts.length}`, now.toISOString());
  } });
  const result = await h.run();
  assert.equal(maxInFlight, 1);
  assert.deepEqual(starts, [START, START + 30000, START + 60000]);
  assert.equal(result.polls, 3);
});

test('[STORY-64] a fetch failure records outcome:error and the collector continues', async () => {
  let n = 0;
  const h = harness({ fetchFeed: async now => {
    n++;
    if (n === 2) throw new Error('boom');
    return feed(`h${n}`, now.toISOString());
  } });
  const result = await h.run();
  assert.equal(result.polls, 3);
  const captures = await h.store.list();
  assert.deepEqual(captures.map(c => c.outcome), ['ok', 'error', 'ok']);
  // A failed poll is never treated as zero results: it is an explicit error.
  assert.equal(captures[1].newEvidence, true);
});

test('[STORY-64] an identical feed twice is health metadata, not new evidence', async () => {
  const h = harness({ fetchFeed: async () => feed('same-hash', '2026-10-13T12:00:00.000Z') });
  await h.run();
  const captures = await h.store.list();
  assert.equal(captures[0].classification, 'new-evidence');
  assert.equal(captures[1].classification, 'duplicate');
  assert.equal(captures[1].newEvidence, false);
  assert.equal(captures[2].classification, 'duplicate');
});

test('[STORY-64] spool saturation is bounded and alerted with the oldest pending sequence', async () => {
  const h = harness({ spoolLimit: 1, fetchFeed: async now => feed(`h${+now}`, now.toISOString()) });
  // Force every commit to stay pending by failing the sink.
  h.sink.failPut = true;
  const result = await h.run();
  assert.equal(result.polls, 3);
  const saturated = h.logs.filter(e => e.status === 'spool-saturated');
  assert.ok(saturated.length >= 1);
  assert.equal(saturated[0].spoolLimit, 1);
  assert.equal(saturated[0].oldestPending, 0);
  assert.equal(result.spoolDepth, 3);
});

test('[STORY-64] graceful shutdown flushes pending spool entries to R2', async () => {
  const h = harness({ fetchFeed: async now => feed(`h${+now}`, now.toISOString()) });
  h.sink.failPut = true;
  await h.run();
  assert.equal(await h.spool.depth(), 3);
  // R2 recovers; a flush drains the spool.
  h.sink.failPut = false;
  const flushed = await h.store.flush();
  assert.deepEqual(flushed, { flushed: 3, remaining: 0 });
  assert.equal(h.sink.objects.size, 6);
});

test('[STORY-64] a signal aborts the collector between polls', async () => {
  const controller = new AbortController();
  let n = 0;
  const h = harness({ signal: controller.signal, fetchFeed: async now => { n++; if (n === 2) controller.abort(); return feed(`h${n}`, now.toISOString()); } });
  const result = await h.run();
  assert.equal(result.polls, 2);
});

test('[STORY-64] drift measurement records structured gaps for out-of-tolerance polls', async () => {
  const h = harness({ maxIterations: 4, fetchFeed: async now => {
    // The second poll's fetch overruns its slot by 45s, past the third target,
    // so the third poll starts late and is recorded as drift.
    if (+now === START + 30000) h.vc.advance(45000);
    return feed(`h${+now}`, now.toISOString());
  } });
  const result = await h.run();
  assert.equal(result.polls, 4);
  const drift = result.gaps.filter(g => g.cause === 'drift');
  assert.ok(drift.length >= 1);
  assert.ok(drift.every(g => Number.isInteger(g.sequence) && Number.isInteger(g.target) && Number.isInteger(g.start) && Number.isInteger(g.delta)));
});

test('[STORY-64] a long run keeps >=99% of polls within 10s of target', async () => {
  const starts = [];
  const h = harness({ maxIterations: 200, fetchFeed: async now => { starts.push(+now); return feed(`h${starts.length}`, now.toISOString()); } });
  const result = await h.run();
  assert.equal(result.polls, 200);
  const onTarget = starts.filter((s, i) => Math.abs(s - (START + i * 30000)) <= 10000).length;
  assert.ok(onTarget / starts.length >= 0.99);
  assert.deepEqual(result.gaps, []);
});

test('[STORY-64] an unexplained gap larger than the threshold is recorded explicitly', async () => {
  const h = harness({ maxIterations: 3, fetchFeed: async now => {
    // The first poll's fetch stalls for 100s, so the second poll starts more
    // than interval + 60s after the first: an unexplained observation gap.
    if (+now === START) h.vc.advance(100000);
    return feed(`h${+now}`, now.toISOString());
  } });
  const result = await h.run();
  const gap = result.gaps.find(g => g.cause === 'gap');
  assert.ok(gap);
  assert.equal(gap.sequence, 1);
  assert.equal(gap.delta, 100000 - 30000);
});

test('[STORY-64] runCollector works with the default clock and log', async () => {
  const spool = memorySpool();
  const sink = memorySink();
  const store = createCaptureStore({ spool, sink });
  // No clock/log injected: the real clock and the no-op log are used.
  const result = await runCollector({ maxIterations: 1, fetchFeed: async now => feed('h', now.toISOString()), store });
  assert.equal(result.polls, 1);
  assert.equal((await store.list()).length, 1);
});

test('[STORY-64] runCollector requires a complete capture store', async () => {
  await assert.rejects(runCollector({ store: undefined }), /capture store/);
  await assert.rejects(runCollector({ store: { commit: async () => ({}) } }), /capture store/);
});

test('[STORY-64] fetchVehicleCapture hashes raw bytes and classifies outcomes', async () => {
  const bytes = protobuf([vehicle(0)], 0);
  const ok = await fetchVehicleCapture(at(0), async () => ({ ok: true, status: 200, body: (async function* () { yield bytes; })() }));
  assert.equal(ok.outcome, 'ok');
  assert.equal(ok.contentHash, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(ok.sourceUpdatedAt, at(0).toISOString());
  const empty = await fetchVehicleCapture(at(0), async () => ({ ok: true, status: 200, body: (async function* () { yield protobuf([], 0); })() }));
  assert.equal(empty.outcome, 'empty');
  const http = await fetchVehicleCapture(at(0), async () => ({ ok: false, status: 503 }));
  assert.equal(http.outcome, 'unavailable');
  assert.equal(http.bytes, null);
  const oversized = await fetchVehicleCapture(at(0), async () => ({ ok: true, status: 200, body: (async function* () { yield Buffer.alloc(9 * 1024 * 1024); })() }));
  assert.equal(oversized.outcome, 'unavailable');
  // A decode failure is a local error, not an upstream outage.
  const decode = await fetchVehicleCapture(at(0), async () => ({ ok: true, status: 200, body: (async function* () { yield Buffer.from([255]); })() }));
  assert.equal(decode.outcome, 'error');
});
