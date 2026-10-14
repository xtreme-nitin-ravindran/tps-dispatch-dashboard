import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReplay, buildTtcPublish, withOwnership, TTC_GEOMETRY_KEY } from '../src/ttc/runtime.js';

// A capture whose payload references a raw protobuf object.
const capture = (sequence, payload) => ({
  feedId: 'ttc-vehicles',
  sequence,
  requestedAt: '2026-10-14T12:00:00.000Z',
  payload
});

test('[STORY-64] buildReplay decodes the raw payload and runs vehicle detection', async () => {
  const calls = [];
  const parse = (bytes) => { calls.push({ type: 'parse', bytes }); return { observations: ['o1'] }; };
  const detect = (previous, feed, index, now, alerts, opts) => {
    calls.push({ type: 'detect', previous, feed, index, now, alerts, log: !!opts?.log });
    return { state: { vehicle: true }, report: { tracksCreated: 1 } };
  };
  const replay = buildReplay({ getBytes: async key => (key === 'p1' ? Buffer.from('data') : null), parse, detect });
  const cap = capture(3, 'p1');
  const result = await replay(cap, { previous: { prev: true }, index: { version: 'v1' }, now: new Date('2026-10-14T12:00:00.000Z') });
  assert.deepEqual(result, { state: { vehicle: true }, report: { tracksCreated: 1 } });
  assert.deepEqual(calls, [
    { type: 'parse', bytes: Buffer.from('data') },
    { type: 'detect', previous: { prev: true }, feed: { observations: ['o1'] }, index: { version: 'v1' }, now: new Date('2026-10-14T12:00:00.000Z'), alerts: undefined, log: true }
  ]);
});

test('[STORY-64] buildReplay passes no feed for a capture without a payload', async () => {
  let detectedFeed;
  const replay = buildReplay({
    getBytes: async () => { throw new Error('must not be called'); },
    parse: () => { throw new Error('must not be called'); },
    detect: (previous, feed) => { detectedFeed = feed; return { state: {}, report: {} }; }
  });
  await replay(capture(4, null), { previous: undefined, index: { version: 'v1' }, now: new Date() });
  assert.equal(detectedFeed, null);
});

test('[STORY-64] buildReplay shares one geometry cache across captures like the spike', async () => {
  const seen = [];
  const replay = buildReplay({
    getBytes: async () => Buffer.from('x'),
    parse: () => ({ observations: [] }),
    detect: (previous, feed, index, now, alerts, opts) => { seen.push(opts.geometryCache); return { state: {}, report: {} }; }
  });
  await replay(capture(1, 'p1'), { previous: undefined, index: {}, now: new Date() });
  await replay(capture(2, 'p2'), { previous: undefined, index: {}, now: new Date() });
  assert.equal(seen.length, 2);
  assert.ok(seen[0] instanceof Map);
  assert.equal(seen[0], seen[1]);
});

test('[STORY-64] buildReplay treats a decode failure as an unavailable feed rather than throwing', async () => {
  const logged = [];
  const replay = buildReplay({
    getBytes: async () => Buffer.from('bad'),
    parse: () => { throw new Error('decode'); },
    detect: (previous, feed) => { assert.equal(feed, null); return { state: {}, report: {} }; },
    log: entry => logged.push(entry)
  });
  await replay(capture(5, 'p5'), { previous: undefined, index: {}, now: new Date() });
  assert.equal(logged.length, 1);
  assert.equal(logged[0].status, 'replay-decode-failed');
});

test('[STORY-64] buildReplay requires a getBytes function', () => {
  assert.throws(() => buildReplay({ parse: () => {}, detect: () => {} }), /getBytes/);
});

test('[STORY-64] buildReplay defaults its log when none is provided', async () => {
  // Trigger the decode-failure path so the default log body actually runs.
  const replay = buildReplay({
    getBytes: async () => Buffer.from('x'),
    parse: () => { throw new Error('decode'); },
    detect: () => ({ state: {}, report: {} })
  });
  await replay(capture(9, 'p9'), { previous: undefined, index: {}, now: new Date() });
});

test('[STORY-64] buildTtcPublish projects confirmed geometry and publishes the public key', async () => {
  const published = [];
  const sink = { publish: async ({ key, body }) => { published.push({ key, body }); return { changed: true }; } };
  const publish = buildTtcPublish({
    sink,
    project: output => ({ projected: output.diversions.length }),
    log: () => {}
  });
  const result = await publish({ diversions: [1, 2] });
  assert.deepEqual(result, { changed: true });
  assert.equal(published.length, 1);
  assert.equal(published[0].key, TTC_GEOMETRY_KEY);
  assert.equal(published[0].body, JSON.stringify({ projected: 2 }) + '\n');
});

test('[STORY-64] buildTtcPublish reports an unchanged write', async () => {
  const sink = { publish: async () => ({ changed: false }) };
  const publish = buildTtcPublish({ sink, project: () => ({}) });
  const result = await publish({ diversions: [] });
  assert.deepEqual(result, { changed: false });
});

test('[STORY-64] buildTtcPublish requires a sink with publish', () => {
  assert.throws(() => buildTtcPublish({ sink: {} }), /sink with publish/);
  assert.throws(() => buildTtcPublish({}), /sink with publish/);
});

test('[STORY-64] buildTtcPublish defaults its log and project when omitted', async () => {
  const sink = { publish: async () => ({ changed: false }) };
  const publish = buildTtcPublish({ sink });
  const output = { schemaVersion: 1, staticVersion: 'v1', status: 'ok', checkedAt: new Date().toISOString(), diversions: [] };
  const result = await publish(output);
  assert.deepEqual(result, { changed: false });
});

test('[STORY-64] withOwnership acquires, renews on interval, and releases on shutdown', async () => {
  const events = [];
  const acquire = async ({ ownerId }) => { events.push(`acquire:${ownerId}`); return { acquired: true, holder: ownerId }; };
  const renew = async ({ ownerId }) => { events.push(`renew:${ownerId}`); return true; };
  const release = async ({ ownerId }) => { events.push(`release:${ownerId}`); };
  let timerCb;
  let cleared = false;
  const signalController = new AbortController();
  const handle = await withOwnership({
    acquire, renew, release,
    sink: {}, key: 'k', ownerId: 'proc-a', ttlMs: 30000, renewIntervalMs: 100,
    signal: signalController.signal,
    setIntervalImpl: cb => { timerCb = cb; return 1; },
    clearIntervalImpl: () => { cleared = true; },
    log: () => {}
  });
  assert.equal(handle.acquired, true);
  assert.equal(handle.ownerId, 'proc-a');
  // Exercise the renewal timer; a successful renew logs nothing.
  await timerCb();
  assert.notEqual(events.indexOf('renew:proc-a'), -1);
  // A failed renew is logged but does not throw.
  const failed = handle.release; // not used; release is exercised via signal below
  void failed;
  signalController.abort();
  // Give the microtask queue a turn for the abort listener.
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(cleared, true);
  assert.notEqual(events.indexOf('release:proc-a'), -1);
});

test('[STORY-64] withOwnership returns denied when the lease is held elsewhere', async () => {
  const handle = await withOwnership({
    acquire: async () => ({ acquired: false, holder: 'other' }),
    sink: {}, key: 'k', ownerId: 'proc-a', ttlMs: 30000,
    signal: new AbortController().signal,
    log: () => {}
  });
  assert.deepEqual({ acquired: handle.acquired, holder: handle.holder, ownerId: handle.ownerId }, { acquired: false, holder: 'other', ownerId: 'proc-a' });
  assert.equal(handle.release, undefined);
});

test('[STORY-64] withOwnership requires a signal', async () => {
  await assert.rejects(() => withOwnership({ sink: {}, key: 'k', ownerId: 'a', ttlMs: 100 }), /requires a signal/);
});

test('[STORY-64] a failed renewal reports the lost lease so the service aborts instead of double-writing', async () => {
  const logged = [];
  let timerCb;
  let lost = 0;
  const handle = await withOwnership({
    acquire: async () => ({ acquired: true, holder: 'a' }),
    renew: async () => false,
    release: async () => {},
    sink: {}, key: 'k', ownerId: 'a', ttlMs: 30000, renewIntervalMs: 10,
    signal: new AbortController().signal,
    onLost: () => { lost++; },
    setIntervalImpl: cb => { timerCb = cb; return 1; },
    clearIntervalImpl: () => {},
    log: entry => logged.push(entry)
  });
  await timerCb();
  assert.equal(handle.acquired, true);
  assert.equal(lost, 1);
  assert.equal(logged[0].status, 'ownership-lost');
});

test('[STORY-64] a renew that throws is caught, logged, and reported as a lost lease', async () => {
  const logged = [];
  let timerCb;
  let lost = 0;
  await withOwnership({
    acquire: async () => ({ acquired: true, holder: 'a' }),
    renew: async () => { throw new Error('R2 down'); },
    release: async () => {},
    sink: {}, key: 'k', ownerId: 'a', ttlMs: 30000, renewIntervalMs: 10,
    signal: new AbortController().signal,
    onLost: () => { lost++; },
    setIntervalImpl: cb => { timerCb = cb; return 1; },
    clearIntervalImpl: () => {},
    log: entry => logged.push(entry)
  });
  // The renewal callback must not become an unhandled rejection.
  await timerCb();
  assert.equal(lost, 1);
  assert.equal(logged[0].status, 'ownership-renewal-error');
  assert.equal(logged[1].status, 'ownership-lost');
});

test('[STORY-64] withOwnership defaults onLost so a lost lease without a handler never throws', async () => {
  let timerCb;
  await withOwnership({
    acquire: async () => ({ acquired: true, holder: 'a' }),
    renew: async () => false,
    release: async () => {},
    sink: {}, key: 'k', ownerId: 'a', ttlMs: 30000, renewIntervalMs: 10,
    signal: new AbortController().signal,
    setIntervalImpl: cb => { timerCb = cb; return 1; },
    clearIntervalImpl: () => {},
    log: () => {}
  });
  // The default no-op onLost runs without throwing.
  await timerCb();
});

test('[STORY-64] withOwnership defaults its log when none is provided', async () => {
  // The deny path logs `ownership-denied` through the default log, exercising its
  // body without passing a logger.
  const handle = await withOwnership({
    acquire: async () => ({ acquired: false, holder: 'other' }),
    sink: {}, key: 'k', ownerId: 'a', ttlMs: 30000,
    signal: new AbortController().signal
  });
  assert.equal(handle.acquired, false);
  assert.equal(handle.holder, 'other');
});

test('[STORY-64] withOwnership release is idempotent across multiple abort firings', async () => {
  let releases = 0;
  const signalController = new AbortController();
  const handle = await withOwnership({
    acquire: async () => ({ acquired: true, holder: 'a' }),
    renew: async () => true,
    release: async () => { releases++; },
    sink: {}, key: 'k', ownerId: 'a', ttlMs: 30000,
    signal: signalController.signal,
    setIntervalImpl: () => 1,
    clearIntervalImpl: () => {},
    log: () => {}
  });
  signalController.abort();
  await new Promise(resolve => setTimeout(resolve, 0));
  await handle.release();
  await handle.release();
  assert.equal(releases, 1);
});
