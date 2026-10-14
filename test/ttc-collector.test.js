import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runCollector, fetchVehicleCapture } from '../src/ttc/collector.js';
import { at, vehicle, protobuf } from './fixtures/ttc-vehicles/builders.js';
import { createCaptureStore, captureKey } from '../src/ttc/capture-store.js';
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
  // A failed poll is never treated as zero results and never counts as new
  // vehicle evidence: it is explicit `no-evidence` health metadata.
  assert.equal(captures[1].newEvidence, false);
  assert.equal(captures[1].classification, 'no-evidence');
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

test('[STORY-64] a collector restart continues the ordered index instead of resetting to sequence 0', async () => {
  const spool = memorySpool();
  const sink = memorySink();
  const store = createCaptureStore({ spool, sink });
  // The previous boot committed sequences 0..4; the processor cursor is at 4.
  for (let sequence = 0; sequence < 5; sequence++) {
    sink.objects.set(`ttc-captures/ttc-vehicles/${String(sequence).padStart(12, '0')}.json`, JSON.stringify({
      feedId: 'ttc-vehicles', sequence, requestedAt: at(sequence * 30).toISOString(), completedAt: at(sequence * 30).toISOString(),
      sourceUpdatedAt: null, bytes: 0, contentHash: `hash-${sequence}`, outcome: 'empty'
    }));
  }
  const vc = virtualClock(START);
  const result = await runCollector({ intervalMs: 30000, maxIterations: 3, store, clock: vc.clock, wait: vc.wait, fetchFeed: async now => feed(`h${+now}`, now.toISOString()) });
  assert.equal(result.polls, 3);
  // The new boot's captures continue above the previous boot's maximum, so the
  // processor cursor (4) never skips a post-restart capture.
  const captures = await store.list();
  assert.deepEqual(captures.map(c => c.sequence).slice(-3), [5, 6, 7]);
});

test('[STORY-64] a collector restart recovers pending spool entries before collecting', async () => {
  const spool = memorySpool();
  const sink = memorySink();
  const store = createCaptureStore({ spool, sink });
  // A previous boot spooled sequence 2 during an R2 outage and never flushed it.
  const pending = { feedId: 'ttc-vehicles', sequence: 2, requestedAt: at(60).toISOString(), completedAt: at(60).toISOString(), sourceUpdatedAt: null, bytes: 0, contentHash: 'hash-2', outcome: 'empty' };
  await spool.write(pending, null);
  const vc = virtualClock(START);
  const logs = [];
  await runCollector({ intervalMs: 30000, maxIterations: 2, store, clock: vc.clock, wait: vc.wait, log: e => logs.push(e), fetchFeed: async now => feed(`h${+now}`, now.toISOString()) });
  // The startup flush recovered the pending entry to R2 and reported it.
  assert.ok(sink.objects.has(captureKey('ttc-vehicles', 2)));
  assert.ok(logs.some(e => e.status === 'spool-recovered' && e.flushed === 1));
  // New captures start above both the recovered and the committed sequences.
  const captures = await store.list();
  assert.deepEqual(captures.map(c => c.sequence), [2, 3, 4]);
});

test('[STORY-64] the collector reports capture and spool health telemetry per poll', async () => {
  const spool = memorySpool();
  const sink = memorySink();
  const store = createCaptureStore({ spool, sink });
  const vc = virtualClock(START);
  const health = [];
  await runCollector({ intervalMs: 30000, maxIterations: 2, store, clock: vc.clock, wait: vc.wait, onHealth: (component, snapshot) => health.push({ component, snapshot }), fetchFeed: async now => feed(`h${+now}`, now.toISOString()) });
  const captures = health.filter(h => h.component === 'capture');
  assert.equal(captures.length, 2);
  assert.deepEqual(captures.map(h => h.snapshot.status), ['ok', 'ok']);
  assert.deepEqual(captures.map(h => h.snapshot.sequence), [0, 1]);
  const spools = health.filter(h => h.component === 'spool');
  assert.equal(spools.length, 2);
  assert.deepEqual(spools.map(h => h.snapshot.depth), [0, 0]);
});

test('[STORY-64] the collector reports an upstream outage as unavailable health, never zero results', async () => {
  const spool = memorySpool();
  const sink = memorySink();
  const store = createCaptureStore({ spool, sink });
  const vc = virtualClock(START);
  const health = [];
  await runCollector({ intervalMs: 30000, maxIterations: 1, store, clock: vc.clock, wait: vc.wait, onHealth: (component, snapshot) => health.push({ component, snapshot }), fetchFeed: async () => ({ bytes: null, sourceUpdatedAt: null, outcome: 'unavailable' }) });
  const capture = health.find(h => h.component === 'capture');
  assert.equal(capture.snapshot.status, 'unavailable');
  assert.equal(capture.snapshot.outcome, 'unavailable');
});

test('[STORY-64] runCollector requires a complete capture store', async () => {
  await assert.rejects(runCollector({ store: undefined }), /capture store/);
  await assert.rejects(runCollector({ store: { commit: async () => ({}) } }), /capture store/);
});

test('[STORY-64] fetchVehicleCapture combines its timeout with the caller\'s abort signal', async () => {
  const controller = new AbortController();
  controller.abort();
  const aborted = await fetchVehicleCapture(at(0), async (url, options) => {
    assert.equal(options.signal.aborted, true);
    throw Object.assign(new Error('aborted'), { name: 'AbortError' });
  }, controller.signal);
  assert.equal(aborted.outcome, 'unavailable');
  assert.equal(aborted.bytes, null);
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
