import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planCleanup,
  planDiagnosticRetention,
  oldestObjectAge,
  runCleanup,
  runCleanupLoop,
  isRetentionScopeKey,
  RAW_RETENTION_MS,
  DIAGNOSTIC_RETENTION_MS,
  MAX_DIAGNOSTIC_BYTES
} from '../src/ttc/retention.js';
import { buildCapture, captureKey, capturePayloadKey, createCaptureStore, createR2CaptureSink } from '../src/ttc/capture-store.js';
import { memorySink, memorySpool } from './fixtures/ttc-capture/store.js';

// A fixed UTC reference instant: 2026-10-14T12:00:00.000Z.
const EPOCH = Date.parse('2026-10-14T12:00:00.000Z');
const iso = ms => new Date(ms).toISOString();
const key = sequence => captureKey('ttc-vehicles', sequence);
// A raw-capture object descriptor for planCleanup.
const obj = (sequence, completedAtMs, objectKey = key(sequence)) => ({ key: objectKey, completedAt: iso(completedAtMs), sequence });

// Age helpers in milliseconds.
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

test('[STORY-64] retention constants expose the negotiated defaults', () => {
  assert.equal(RAW_RETENTION_MS, 6 * HOUR);
  assert.equal(DIAGNOSTIC_RETENTION_MS, DAY);
  assert.equal(MAX_DIAGNOSTIC_BYTES, 256 * 1024 * 1024);
});

test('[STORY-64] planCleanup at the six-hour boundary deletes expired captures and keeps current ones', () => {
  const now = EPOCH;
  const plan = planCleanup({
    objects: [
      obj(0, now - RAW_RETENTION_MS),            // exactly six hours old: expired
      obj(1, now - RAW_RETENTION_MS - 1),        // just past six hours: expired
      obj(2, now - RAW_RETENTION_MS + 1),        // just inside six hours: current
      obj(3, now - 60 * 1000)                    // one minute old: current
    ],
    now,
    cursor: 3 // everything is consumed, so nothing is an unconsumed loss
  });
  assert.deepEqual(plan.delete.map(o => o.sequence), [0, 1]);
  assert.deepEqual(plan.keep.map(o => o.sequence), [2, 3]);
  assert.equal(plan.lostRange, null);
});

test('[STORY-64] planCleanup at the seven-hour boundary expires every raw capture and records the lost range', () => {
  const now = EPOCH;
  // Seven hours after six-hour retention, every capture is past the window.
  const plan = planCleanup({
    objects: [obj(0, now - 7 * HOUR), obj(1, now - 7 * HOUR + 60 * 1000), obj(2, now - 6 * HOUR - 1)],
    now,
    cursor: -1 // the consumer has consumed nothing, so all are lost on expiry
  });
  assert.deepEqual(plan.delete.map(o => o.sequence), [0, 1, 2]);
  assert.deepEqual(plan.keep, []);
  assert.deepEqual(plan.lostRange, { from: 0, to: 2 });
});

test('[STORY-64] planCleanup respects a replay cursor inside retention and keeps the objects it still needs', () => {
  const now = EPOCH;
  // Sequences 0 and 1 are already consumed (cursor 1); sequence 2 is still ahead
  // of the cursor but young, so it must be kept even though the cursor does not
  // yet cover it.
  const plan = planCleanup({
    objects: [obj(0, now - 7 * HOUR), obj(1, now - 7 * HOUR + 1), obj(2, now - 1 * HOUR)],
    now,
    cursor: 1
  });
  assert.deepEqual(plan.delete.map(o => o.sequence), [0, 1]);
  assert.deepEqual(plan.keep.map(o => o.sequence), [2]);
  assert.equal(plan.lostRange, null);
});

test('[STORY-64] a stuck cursor past six hours expires the data, records the lost range and requires recovery reset', () => {
  const now = EPOCH;
  // The cursor is pinned at -1 (stuck consumer) while captures age past six
  // hours: they expire anyway (no indefinite retention) and their lost range is
  // recorded, signalling that an explicit recovery reset is required.
  const plan = planCleanup({
    objects: [obj(4, now - 7 * HOUR), obj(5, now - 6 * HOUR - 1)],
    now,
    cursor: 0
  });
  assert.deepEqual(plan.delete.map(o => o.sequence), [4, 5]);
  assert.deepEqual(plan.keep, []);
  assert.deepEqual(plan.lostRange, { from: 4, to: 5 });
});

test('[STORY-64] Toronto midnight and DST arithmetic: yesterday 23:59 is still current at 00:01', () => {
  // Toronto is UTC-4 (EDT) in October: local 23:59 on 2026-10-13 is 03:59Z on
  // 2026-10-14, and local 00:01 on 2026-10-14 is 04:01Z on 2026-10-14. Age is
  // computed from absolute UTC instants, so the two-minute span is current, not
  // "yesterday vs today" in a naive local-date sense.
  const completedAt = '2026-10-14T03:59:00.000Z'; // local 23:59 -04:00
  const now = '2026-10-14T04:01:00.000Z';          // local 00:01 -04:00 (next midnight)
  const plan = planCleanup({ objects: [obj(0, Date.parse(completedAt))], now, cursor: -1 });
  assert.deepEqual(plan.keep.map(o => o.sequence), [0]);
  assert.deepEqual(plan.delete, []);

  // Six hours and one minute later the same object is expired regardless of the
  // midnight or DST wall-clock: age is the only clock input.
  const later = '2026-10-14T10:00:00.000Z'; // local 06:00 -04:00
  const expired = planCleanup({ objects: [obj(0, Date.parse(completedAt))], now: later, cursor: -1 });
  assert.deepEqual(expired.delete.map(o => o.sequence), [0]);
});

test('[STORY-64] cleanup never touches the public production prefix', () => {
  assert.equal(isRetentionScopeKey('ttc-captures/ttc-vehicles/000000000000.json'), true);
  assert.equal(isRetentionScopeKey('ttc-diagnostics/ttc-vehicles/000000000000.json'), true);
  assert.equal(isRetentionScopeKey('data/current.json'), false);
  assert.equal(isRetentionScopeKey('data/ttc-diversions.json'), false);
  assert.equal(isRetentionScopeKey(undefined), false);
  assert.equal(isRetentionScopeKey(123), false);

  const now = EPOCH;
  const plan = planCleanup({
    objects: [
      obj(0, now - 7 * HOUR, 'data/current.json'),
      { key: 'data/ttc-diversions.json', completedAt: iso(now - 7 * HOUR), sequence: 1 },
      obj(2, now - 7 * HOUR) // genuine private raw capture, expired
    ],
    now,
    cursor: -1
  });
  // The public objects are out of scope and preserved verbatim; only the private
  // capture is deleted. A key-less object is treated as in-scope (the caller
  // already scoped the listing) and so is expired normally.
  assert.deepEqual(plan.delete.map(o => o.key), [key(2)]);
  assert.deepEqual(plan.keep.map(o => o.key), ['data/current.json', 'data/ttc-diversions.json']);

  const keyless = planCleanup({ objects: [{ completedAt: iso(now - 7 * HOUR), sequence: 9 }], now, cursor: -1 });
  assert.deepEqual(keyless.delete.map(o => o.sequence), [9]);
  assert.deepEqual(keyless.keep, []);
});

test('[STORY-64] a failure bundle over 256 MB evicts oldest first', () => {
  const now = EPOCH;
  const bundle = (id, recordedAtMs, bytes) => ({ key: `ttc-diagnostics/ttc-vehicles/${String(id).padStart(12, '0')}.json`, recordedAt: iso(recordedAtMs), bytes });
  const objects = [
    bundle(0, now - 1 * HOUR, 100 * 1024 * 1024),   // 100 MB, newest
    bundle(1, now - 2 * HOUR, 100 * 1024 * 1024),   // 100 MB
    bundle(2, now - 3 * HOUR, 100 * 1024 * 1024)    // 100 MB, oldest -> total 300 MB
  ];
  const plan = planDiagnosticRetention({ objects, now });
  // 300 MB > 256 MB: the oldest 100 MB bundle (id 2) is evicted to 200 MB. The
  // retained set is returned oldest-first, matching the sorted input.
  assert.deepEqual(plan.delete.map(o => o.key).map(k => k.replace(/^.*\//, '')), ['000000000002.json']);
  assert.deepEqual(plan.keep.map(o => o.key).map(k => k.replace(/^.*\//, '')), ['000000000001.json', '000000000000.json']);
});

test('[STORY-64] planDiagnosticRetention expires bundles past 24 hours and keeps the rest', () => {
  const now = EPOCH;
  const bundle = (id, recordedAtMs, bytes = 1) => ({ key: `ttc-diagnostics/ttc-vehicles/${String(id).padStart(12, '0')}.json`, recordedAt: iso(recordedAtMs), bytes });
  const plan = planDiagnosticRetention({
    objects: [
      bundle(0, now - DIAGNOSTIC_RETENTION_MS),        // exactly 24h: expired
      bundle(1, now - DIAGNOSTIC_RETENTION_MS + 1),    // inside 24h: kept
      bundle(2, now - 1 * HOUR)
    ],
    now
  });
  assert.deepEqual(plan.delete.map(o => o.key).map(k => k.replace(/^.*\//, '')), ['000000000000.json']);
  assert.deepEqual(plan.keep.map(o => o.key).map(k => k.replace(/^.*\//, '')), ['000000000001.json', '000000000002.json']);
});

test('[STORY-64] planDiagnosticRetention handles an empty set and a custom cap', () => {
  assert.deepEqual(planDiagnosticRetention({ objects: [], now: EPOCH }), { delete: [], keep: [] });
  const now = EPOCH;
  const bundle = (id, recordedAtMs, bytes) => ({ key: id, recordedAt: iso(recordedAtMs), bytes });
  const plan = planDiagnosticRetention({
    objects: [bundle('a', now - 1 * HOUR, 60), bundle('b', now - 2 * HOUR, 50), bundle('c', now - 3 * HOUR, 40)],
    now,
    maxBytes: 100
  });
  // 150 bytes over a 100-byte cap: oldest first means 'c' (40) then 'b' (50) are
  // evicted, leaving 'a' (60).
  assert.deepEqual(plan.delete.map(o => o.key), ['c', 'b']);
  assert.deepEqual(plan.keep.map(o => o.key), ['a']);
});

test('[STORY-64] oldestObjectAge monitors the lifecycle safety net for raw and diagnostic objects', () => {
  const now = EPOCH;
  assert.equal(oldestObjectAge({ objects: [], now }), null);
  // Raw captures use completedAt; the oldest is seven hours behind.
  const age = oldestObjectAge({
    objects: [obj(0, now - 7 * HOUR), obj(1, now - 1 * HOUR), obj(2, now - 3 * HOUR)],
    now
  });
  assert.equal(age, 7 * HOUR);
  // Diagnostic bundles use recordedAt.
  const dAge = oldestObjectAge({
    objects: [
      { recordedAt: iso(now - 2 * HOUR) },
      { recordedAt: iso(now - DAY) }
    ],
    now
  });
  assert.equal(dAge, DAY);
});

test('[STORY-64] runCleanup deletes expired raw captures and records a lost range for a stuck cursor', async () => {
  const sink = memorySink();
  const spool = memorySpool();
  const store = createCaptureStore({ spool, sink });
  const now = EPOCH;

  const make = (sequence, completedAtMs, bytes = 1) => buildCapture({
    feedId: 'ttc-vehicles', sequence, requestedAt: iso(completedAtMs), completedAt: iso(completedAtMs),
    sourceUpdatedAt: iso(completedAtMs), bytes, contentHash: `hash-${sequence}`, outcome: 'ok'
  });

  // Two expired, committed captures (with a payload object for one) and two current.
  await store.commit(make(0, now - 7 * HOUR, 4), Buffer.from('aaaa'));
  await store.commit(make(1, now - 6 * HOUR - 1), null);
  await store.commit(make(2, now - 1 * HOUR), null);
  await store.commit(make(3, now - 60 * 1000), null);
  assert.equal(sink.objects.has(capturePayloadKey('ttc-vehicles', 0)), true);

  const logs = [];
  const result = await runCleanup({ store, spool, now, cursor: -1, log: e => logs.push(e) });

  assert.equal(result.deleted, 2);
  assert.equal(result.retained, 2);
  assert.deepEqual(result.lostRange, { from: 0, to: 1 });
  // The expired .json/.pb objects are gone; the current ones remain.
  assert.equal(sink.objects.has(captureKey('ttc-vehicles', 0)), false);
  assert.equal(sink.objects.has(capturePayloadKey('ttc-vehicles', 0)), false);
  assert.equal(sink.objects.has(captureKey('ttc-vehicles', 1)), false);
  assert.equal(sink.objects.has(captureKey('ttc-vehicles', 2)), true);
  assert.equal(sink.objects.has(captureKey('ttc-vehicles', 3)), true);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].status, 'cleanup');
  assert.equal(logs[0].deleted, 2);
  assert.equal(logs[0].retained, 2);
});

test('[STORY-64] runCleanup keeps objects the cursor still needs and reports no lost range', async () => {
  const sink = memorySink();
  const spool = memorySpool();
  const store = createCaptureStore({ spool, sink });
  const now = EPOCH;
  const make = (sequence, completedAtMs) => buildCapture({
    feedId: 'ttc-vehicles', sequence, requestedAt: iso(completedAtMs), completedAt: iso(completedAtMs),
    sourceUpdatedAt: iso(completedAtMs), bytes: 0, contentHash: `hash-${sequence}`, outcome: 'empty'
  });

  await store.commit(make(0, now - 7 * HOUR));
  await store.commit(make(1, now - 1 * HOUR));

  const result = await runCleanup({ store, spool, now, cursor: 0 });
  assert.equal(result.deleted, 1);
  assert.equal(result.retained, 1);
  assert.equal(result.lostRange, null);
  assert.equal(sink.objects.has(captureKey('ttc-vehicles', 0)), false);
  assert.equal(sink.objects.has(captureKey('ttc-vehicles', 1)), true);
});

test('[STORY-64] runCleanup validates its store collaborator', async () => {
  await assert.rejects(runCleanup({ store: undefined, spool: memorySpool(), now: EPOCH }), /requires a capture store with list and remove/);
  await assert.rejects(runCleanup({ store: {}, spool: memorySpool(), now: EPOCH }), /requires a capture store with list and remove/);
  await assert.rejects(runCleanup({ store: { list: async () => [] }, spool: memorySpool(), now: EPOCH }), /requires a capture store with list and remove/);
});

test('[STORY-64] runCleanup unions a half-flushed pending spool entry without deleting it twice', async () => {
  const sink = memorySink();
  const spool = memorySpool();
  const store = createCaptureStore({ spool, sink });
  const now = EPOCH;
  const make = (sequence, completedAtMs) => buildCapture({
    feedId: 'ttc-vehicles', sequence, requestedAt: iso(completedAtMs), completedAt: iso(completedAtMs),
    sourceUpdatedAt: iso(completedAtMs), bytes: 0, contentHash: `hash-${sequence}`, outcome: 'empty'
  });

  // An expired capture committed to R2 (capture 0) AND still present in the spool
  // (a failed flush would leave it pending), plus a second expired capture (1)
  // that only reached the spool and never R2. Cleanup plans each exactly once.
  const capture = make(0, now - 7 * HOUR);
  await store.commit(capture);
  await spool.write(capture, null); // simulate a failed flush leaving it pending
  await spool.write(make(1, now - 7 * HOUR + 60 * 1000), null); // pending-only

  const result = await runCleanup({ store, spool, now, cursor: -1 });
  assert.equal(result.deleted, 2);
  assert.equal(result.retained, 0);
  assert.deepEqual(result.lostRange, { from: 0, to: 1 });
  assert.equal(sink.objects.has(captureKey('ttc-vehicles', 0)), false);
  assert.equal(spool.entries.size, 0);
});

test('[STORY-64] createR2CaptureSink.delete signs a DELETE, tolerates a missing object, and surfaces failures', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, method: options.method });
    if (url.includes('missing')) return { ok: false, status: 404 };
    if (url.includes('boom')) return { ok: false, status: 500 };
    return { ok: true, status: 204 };
  };
  const sink = createR2CaptureSink({ endpoint: 'https://example.invalid', bucket: 'b', accessKeyId: 'a', secretAccessKey: 's', fetchImpl, now: () => new Date(EPOCH) });
  await sink.delete('ttc-captures/ttc-vehicles/000000000000.json');
  await sink.delete('missing');
  await assert.rejects(sink.delete('boom'), /R2 capture delete failed: 500/);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].method, 'DELETE');
});

test('[STORY-64] runCleanupLoop requires a signal', async () => {
  await assert.rejects(runCleanupLoop({ store: {}, spool: {} }), /requires a signal/);
});

test('[STORY-64] runCleanupLoop runs a pass, reads the cursor, and stops on abort', async () => {
  const passes = [];
  const controller = new AbortController();
  let calls = 0;
  const result = await runCleanupLoop({
    store: {}, spool: {},
    getCursor: async () => 5,
    run: async ({ cursor }) => { calls++; if (calls >= 2) controller.abort(); passes.push(cursor); return { deleted: 0, retained: 0, lostRange: null }; },
    intervalMs: 1,
    signal: controller.signal,
    wait: async () => {}
  });
  assert.equal(result.aborted, true);
  assert.deepEqual(passes, [5, 5]);
});

test('[STORY-64] runCleanupLoop isolates a failing pass and continues to the next pass', async () => {
  const logged = [];
  const controller = new AbortController();
  let calls = 0;
  await runCleanupLoop({
    store: {}, spool: {},
    getCursor: async () => -1,
    run: async () => { calls++; if (calls === 1) throw new Error('R2 down'); if (calls === 2) controller.abort(); return { deleted: 0, retained: 0, lostRange: null }; },
    intervalMs: 1,
    signal: controller.signal,
    wait: async () => {},
    log: e => logged.push(e)
  });
  assert.equal(calls, 2);
  assert.equal(logged[0].status, 'cleanup-failed');
});

test('[STORY-64] runCleanupLoop stops immediately when the signal is already aborted', async () => {
  const controller = new AbortController();
  controller.abort();
  let ran = false;
  const result = await runCleanupLoop({
    store: {}, spool: {},
    getCursor: async () => -1,
    run: async () => { ran = true; return { deleted: 0, retained: 0, lostRange: null }; },
    signal: controller.signal
  });
  assert.equal(result.aborted, true);
  assert.equal(ran, false);
});

test('[STORY-64] runCleanupLoop defaults its getCursor and wait collaborators', async () => {
  const controller = new AbortController();
  let calls = 0;
  await runCleanupLoop({
    store: {}, spool: {},
    run: async ({ cursor }) => { calls++; assert.equal(cursor, -1); if (calls === 2) controller.abort(); return { deleted: 0, retained: 0, lostRange: null }; },
    intervalMs: 1,
    signal: controller.signal
  });
  assert.equal(calls, 2);
});
