import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, rename, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProcessor, writeCheckpoint, readCheckpoint, applyWallClockExpiry, PROCESSOR_WINDOW_MS, CAPTURES_PER_WINDOW, CHECKPOINT_SCHEMA_VERSION } from '../src/ttc/processor.js';
import { buildCapture, createCaptureStore } from '../src/ttc/capture-store.js';
import { detectVehicles } from '../src/ttc/vehicle-detector.js';
import { DIVERSION_POLICY } from '../src/ttc/diversion-inference.js';
import { parseTtcVehicles } from '../src/ttc/vehicle-feed.js';
import { at, vehicle, protobuf, staticIndex } from './fixtures/ttc-vehicles/builders.js';
import { memorySink, memorySpool } from './fixtures/ttc-capture/store.js';

const index = staticIndex();
// A six-point path that departs and rejoins within one three-minute window: the
// vehicle is on-route at point 0, off-route at points 1-2, and back on-route at
// points 3-5, so a completed episode (and a confirmed record) fits in six polls.
const path = [[43.65, -79.404], [43.652, -79.403], [43.652, -79.402], [43.65, -79.400], [43.65, -79.398], [43.65, -79.396]];

// A deterministic replay: the raw protobuf bytes for each capture are held in a
// side map (the capture contract carries health metadata, not raw bytes), and
// replay runs the real detector. This mirrors the production wiring where the
// caller supplies the vehicle-detection step.
function makeReplay(frames) {
  return (capture, { previous, index: idx, now }) => {
    const feed = parseTtcVehicles(Buffer.from(frames.get(capture.sequence), 'base64'), now);
    return detectVehicles(previous, feed, idx, now, undefined);
  };
}

// Build a capture for one poll. `seconds` is the poll time; `rows` are the
// vehicle observations for that poll.
function capture(sequence, seconds, rows, previous) {
  const bytes = protobuf(rows, seconds);
  return buildCapture({
    feedId: 'ttc-vehicles', sequence,
    requestedAt: at(seconds).toISOString(), completedAt: at(seconds).toISOString(),
    sourceUpdatedAt: at(seconds).toISOString(), bytes: bytes.length,
    contentHash: `hash-${sequence}`, outcome: 'ok', previous
  });
}

// A store backed by the in-memory sink/spool, seeded with captures.
function storeWith(captures) {
  const spool = memorySpool();
  const sink = memorySink();
  for (const c of captures) sink.objects.set(`ttc-captures/ttc-vehicles/${String(c.sequence).padStart(12, '0')}.json`, JSON.stringify(c));
  return createCaptureStore({ spool, sink });
}

// A run of `count` polls at 30 s cadence, each carrying the same two-vehicle
// diversion path so inference produces a confirmed path. Returns the captures
// and the matching replay function.
function diversionRun(count, { start = 0, step = 30, outcome = 'ok', sequenceOffset = 0 } = {}) {
  const captures = [];
  const frames = new Map();
  let previous;
  for (let i = 0; i < count; i++) {
    const sequence = sequenceOffset + i;
    const seconds = start + i * step;
    const rows = [0, 1].map(j => vehicle(seconds, { vehicle: { id: String(j) }, position: { latitude: path[i % path.length][0], longitude: path[i % path.length][1] } }));
    const bytes = protobuf(rows, seconds);
    frames.set(sequence, Buffer.from(bytes).toString('base64'));
    const c = capture(sequence, seconds, rows, previous);
    captures.push(outcome === 'ok' ? c : { ...c, outcome });
    previous = c;
  }
  return { captures, frames, replay: makeReplay(frames) };
}

// Combine several runs into one store seed and one replay covering every frame.
function combine(...runs) {
  const frames = new Map();
  const captures = [];
  for (const run of runs) {
    for (const [sequence, frame] of run.frames) frames.set(sequence, frame);
    captures.push(...run.captures);
  }
  return { captures, replay: makeReplay(frames) };
}

// A checkpoint path inside a fresh temp directory.
async function tempCheckpoint() {
  const dir = await mkdtemp(join(tmpdir(), 'ttc-processor-'));
  return { dir, path: join(dir, 'checkpoint.json') };
}

// Abort the signal after the last capture is replayed, so the final window is
// completed on the shutdown path. A window only closes at a boundary or on a
// graceful shutdown, never at the end of a normal drain.
function withShutdown(captures, replay) {
  const controller = new AbortController();
  const last = captures.at(-1).sequence;
  return {
    signal: controller.signal,
    replay: (c, ctx) => {
      const r = replay(c, ctx);
      if (c.sequence === last) controller.abort();
      return r;
    }
  };
}

test('[STORY-64] a single capture is replayed, the checkpoint is written and the cursor advances', async () => {
  const { dir, path: checkpointPath } = await tempCheckpoint();
  try {
    const { captures, replay } = diversionRun(1);
    const store = storeWith(captures);
    const published = [];
    const result = await runProcessor({ store, replay, checkpointPath, loadStatic: async () => ({ index }), publish: async o => published.push(o), clock: () => at(0) });
    assert.equal(result.processed, 1);
    assert.equal(result.rejected, 0);
    assert.equal(result.cursor, 0);
    const checkpoint = await readCheckpoint(checkpointPath);
    assert.equal(checkpoint.cursor, 0);
    assert.equal(checkpoint.staticVersion, index.version);
    assert.ok(checkpoint.state.inference);
    assert.ok(checkpoint.state.vehicle);
    // A single poll is an open window, not a completed one: nothing is published.
    assert.equal(checkpoint.state.window.count, 1);
    assert.equal(checkpoint.state.window.healthy, true);
    assert.equal(published.length, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('[STORY-64] a crash after inference but before the checkpoint resumes with identical state and counters', async () => {
  const { dir, path: checkpointPath } = await tempCheckpoint();
  try {
    const { captures, replay } = diversionRun(6);
    const store = storeWith(captures);
    // First run: crash on the checkpoint write after the first capture.
    let writes = 0;
    const failing = async (p, payload, opts) => {
      writes++;
      if (writes === 2) throw new Error('crash');
      return writeCheckpoint(p, payload, opts);
    };
    await assert.rejects(runProcessor({ store, replay, checkpointPath, loadStatic: async () => ({ index }), publish: async () => { }, clock: () => at(0), writeCheckpoint: failing }), /crash/);
    const afterCrash = await readCheckpoint(checkpointPath);
    assert.equal(afterCrash.cursor, 0);
    // The in-flight window is durable: the crash preserved the partial window.
    assert.equal(afterCrash.state.window.count, 1);
    assert.equal(afterCrash.state.window.healthy, true);
    // Second run: resume from the durable checkpoint and finish.
    const resumed = await runProcessor({ store, replay, checkpointPath, loadStatic: async () => ({ index }), publish: async () => { }, clock: () => at(0) });
    assert.equal(resumed.cursor, 5);
    // A clean run from scratch reaches the same durable checkpoint (state, window
    // and cursor): the Story 57 counters and the open window are identical.
    const { dir: dir2, path: checkpointPath2 } = await tempCheckpoint();
    await runProcessor({ store: storeWith(captures), replay, checkpointPath: checkpointPath2, loadStatic: async () => ({ index }), publish: async () => { }, clock: () => at(0) });
    assert.deepEqual(await readCheckpoint(checkpointPath), await readCheckpoint(checkpointPath2));
    await rm(dir2, { recursive: true, force: true });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('[STORY-64] a duplicate capture is processed once semantically and does not double-count', async () => {
  const { dir, path: checkpointPath } = await tempCheckpoint();
  try {
    // Six polls, but polls 2-5 repeat poll 1's content hash (identical feed).
    const run = diversionRun(6);
    const captures = run.captures.map((c, i) => (i >= 1 && i <= 4 ? { ...c, contentHash: run.captures[0].contentHash, classification: 'duplicate', newEvidence: false } : c));
    const store = storeWith(captures);
    const { signal, replay } = withShutdown(captures, run.replay);
    const published = [];
    // A stub complete counts confirmations: one per window, never per poll.
    let completions = 0;
    const result = await runProcessor({
      store, replay, signal, checkpointPath, loadStatic: async () => ({ index }), publish: async o => published.push(o), clock: () => at(0),
      infer: (previous, vehicles, idx, now) => ({ state: { checkedAt: now.toISOString(), records: [] } }),
      complete: (state) => { completions++; return { state, output: { status: 'ok', checkedAt: state.checkedAt, diversions: [] } }; }
    });
    assert.equal(result.processed, 6);
    // One window, one completion: duplicates never add a second confirmation.
    assert.equal(result.windows, 1);
    assert.equal(completions, 1);
    assert.equal(published.length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('[STORY-64] an out-of-order upload is processed in sequence order, not skipped', async () => {
  const { dir, path: checkpointPath } = await tempCheckpoint();
  try {
    const { captures, replay } = diversionRun(6);
    // Sequence 2 is uploaded late: the store lists it after 3, 4, 5.
    const store = storeWith([captures[0], captures[1], captures[3], captures[4], captures[5], captures[2]]);
    const seen = [];
    const result = await runProcessor({ store, replay: (c, ctx) => { seen.push(c.sequence); return replay(c, ctx); }, checkpointPath, loadStatic: async () => ({ index }), publish: async () => { }, clock: () => at(0) });
    assert.deepEqual(seen, [0, 1, 2, 3, 4, 5]);
    assert.equal(result.cursor, 5);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('[STORY-64] a static version mismatch resets explicitly and warms up from empty', async () => {
  const { dir, path: checkpointPath } = await tempCheckpoint();
  try {
    const { captures, replay } = diversionRun(6);
    // Seed a checkpoint from a previous static version with a stale cursor.
    await writeCheckpoint(checkpointPath, { state: { vehicle: undefined, inference: undefined }, cursor: 99, staticVersion: 'old-version' });
    const logs = [];
    const result = await runProcessor({ store: storeWith(captures), replay, checkpointPath, loadStatic: async () => ({ index }), publish: async () => { }, clock: () => at(0), log: e => logs.push(e) });
    assert.equal(result.reset, true);
    assert.equal(result.cursor, 5);
    assert.ok(logs.some(e => e.status === 'static-reset'));
    const checkpoint = await readCheckpoint(checkpointPath);
    assert.equal(checkpoint.staticVersion, index.version);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('[STORY-64] a matching static version resumes from the durable cursor', async () => {
  const { dir, path: checkpointPath } = await tempCheckpoint();
  try {
    const { captures, replay } = diversionRun(6);
    await writeCheckpoint(checkpointPath, { state: { vehicle: undefined, inference: undefined }, cursor: 2, staticVersion: index.version });
    const seen = [];
    const result = await runProcessor({ store: storeWith(captures), replay: (c, ctx) => { seen.push(c.sequence); return replay(c, ctx); }, checkpointPath, loadStatic: async () => ({ index }), publish: async () => { }, clock: () => at(0) });
    assert.equal(result.reset, false);
    assert.deepEqual(seen, [3, 4, 5]);
    assert.equal(result.cursor, 5);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('[STORY-64] six polls form one open window; the seventh poll closes it and starts the next', async () => {
  const { dir, path: checkpointPath } = await tempCheckpoint();
  try {
    // Six polls all fall in one window: the window is open, not yet completed.
    const run = diversionRun(6);
    const published = [];
    const result = await runProcessor({ store: storeWith(run.captures), replay: run.replay, checkpointPath, loadStatic: async () => ({ index }), publish: async o => published.push(o), clock: () => at(0) });
    assert.equal(result.windows, 0);
    assert.equal(published.length, 0);
    // The seventh poll starts a new window: the first window completes once.
    const { dir: dir2, path: checkpointPath2 } = await tempCheckpoint();
    const published2 = [];
    const run7 = diversionRun(7);
    const result2 = await runProcessor({ store: storeWith(run7.captures), replay: run7.replay, checkpointPath: checkpointPath2, loadStatic: async () => ({ index }), publish: async o => published2.push(o), clock: () => at(0) });
    assert.equal(result2.windows, 1);
    assert.equal(published2.length, 1);
    await rm(dir2, { recursive: true, force: true });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('[STORY-64] an unavailable window is completed with healthy:false', async () => {
  const { dir, path: checkpointPath } = await tempCheckpoint();
  try {
    // First window is available; the second window's captures are unavailable.
    const first = diversionRun(6);
    const second = diversionRun(6, { start: 180, sequenceOffset: 6 });
    const combined = combine(first, { ...second, captures: second.captures.map(c => ({ ...c, outcome: 'unavailable' })) });
    const { signal, replay } = withShutdown(combined.captures, combined.replay);
    const completions = [];
    const result = await runProcessor({
      store: storeWith(combined.captures), replay, signal, checkpointPath, loadStatic: async () => ({ index }), publish: async () => { }, clock: () => at(0),
      infer: (previous, vehicles, idx, now) => ({ state: { checkedAt: now.toISOString(), records: [] } }),
      complete: (state, opts) => { completions.push(opts); return { state, output: { status: 'ok', checkedAt: state.checkedAt, diversions: [] } }; }
    });
    assert.equal(result.windows, 2);
    // The unavailable window must not be completed as healthy.
    assert.deepEqual(completions.map(c => c.healthy), [true, false]);
    assert.deepEqual(completions.map(c => c.sourceHealthy), [true, false]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('[STORY-64] an incomplete window is completed with healthy:false', async () => {
  const { dir, path: checkpointPath } = await tempCheckpoint();
  try {
    // A full first window, then a second window with only two polls.
    const combined = combine(diversionRun(6), diversionRun(2, { start: 180, sequenceOffset: 6 }));
    const { signal, replay } = withShutdown(combined.captures, combined.replay);
    const completions = [];
    const result = await runProcessor({
      store: storeWith(combined.captures), replay, signal, checkpointPath, loadStatic: async () => ({ index }), publish: async () => { }, clock: () => at(0),
      infer: (previous, vehicles, idx, now) => ({ state: { checkedAt: now.toISOString(), records: [] } }),
      complete: (state, opts) => { completions.push(opts); return { state, output: { status: 'ok', checkedAt: state.checkedAt, diversions: [] } }; }
    });
    assert.equal(result.windows, 2);
    // The incomplete window must not be completed as healthy.
    assert.deepEqual(completions.map(c => c.healthy), [true, false]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('[STORY-64] a healthy complete window is completed with healthy:true once per window', async () => {
  const { dir, path: checkpointPath } = await tempCheckpoint();
  try {
    // Two complete windows: complete is called once per window, both healthy.
    const combined = combine(diversionRun(6), diversionRun(6, { start: 180, sequenceOffset: 6 }));
    const { signal, replay } = withShutdown(combined.captures, combined.replay);
    const completions = [];
    const result = await runProcessor({
      store: storeWith(combined.captures), replay, signal, checkpointPath, loadStatic: async () => ({ index }), publish: async () => { }, clock: () => at(0),
      infer: (previous, vehicles, idx, now) => ({ state: { checkedAt: now.toISOString(), records: [] } }),
      complete: (state, opts) => { completions.push(opts); return { state, output: { status: 'ok', checkedAt: state.checkedAt, diversions: [] } }; }
    });
    assert.equal(result.windows, 2);
    assert.deepEqual(completions.map(c => c.healthy), [true, true]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('[STORY-64] complete is called once per window, never once per poll', async () => {
  const { dir, path: checkpointPath } = await tempCheckpoint();
  try {
    const combined = combine(diversionRun(6), diversionRun(6, { start: 180, sequenceOffset: 6 }));
    const { signal, replay } = withShutdown(combined.captures, combined.replay);
    let completions = 0;
    const result = await runProcessor({
      store: storeWith(combined.captures), replay, signal, checkpointPath, loadStatic: async () => ({ index }), publish: async () => { }, clock: () => at(0),
      infer: (previous, vehicles, idx, now) => ({ state: { checkedAt: now.toISOString(), records: [] } }),
      complete: (state) => { completions++; return { state, output: { status: 'ok', checkedAt: state.checkedAt, diversions: [] } }; }
    });
    assert.equal(result.processed, 12);
    assert.equal(completions, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('[STORY-64] a replayed old sample is expired before publication', async () => {
  const { dir, path: checkpointPath } = await tempCheckpoint();
  try {
    // The captures are old (epoch 2026-09-28); the wall clock is far ahead.
    const { captures, replay } = diversionRun(6);
    const { signal, replay: shutdownReplay } = withShutdown(captures, replay);
    const published = [];
    const wallNow = new Date(at(0).getTime() + DIVERSION_POLICY.evidenceMs + 60000);
    // A stub complete returns a diversion whose expiry is in the past relative to
    // the wall clock, so the processor must drop it before publication.
    const stale = { id: 'stale', lastObservedAt: at(0).toISOString(), expiresAt: at(DIVERSION_POLICY.evidenceMs / 1000).toISOString() };
    await runProcessor({
      store: storeWith(captures), replay: shutdownReplay, signal, checkpointPath, loadStatic: async () => ({ index }), publish: async o => published.push(o), clock: () => wallNow,
      infer: (previous, vehicles, idx, now) => ({ state: { checkedAt: now.toISOString(), records: [] } }),
      complete: (state) => ({ state, output: { status: 'ok', checkedAt: state.checkedAt, diversions: [stale] } })
    });
    assert.equal(published.length, 1);
    // The replayed old sample is never advertised as current.
    assert.deepEqual(published[0].diversions, []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('[STORY-64] applyWallClockExpiry drops only diversions whose expiry has passed', () => {
  const output = {
    status: 'ok', checkedAt: at(0).toISOString(), diversions: [
      { id: 'fresh', expiresAt: at(600).toISOString() },
      { id: 'stale', expiresAt: at(60).toISOString() },
      { id: 'no-expiry' }
    ]
  };
  const expired = applyWallClockExpiry(output, at(120));
  assert.deepEqual(expired.diversions.map(d => d.id), ['fresh', 'no-expiry']);
  assert.equal(expired.status, 'ok');
  assert.equal(expired.checkedAt, output.checkedAt);
});

test('[STORY-64] writeCheckpoint and readCheckpoint round-trip state, cursor and static version', async () => {
  const { dir, path: checkpointPath } = await tempCheckpoint();
  try {
    assert.equal(await readCheckpoint(checkpointPath), undefined);
    const state = { vehicle: { tracks: [] }, inference: { records: [] } };
    await writeCheckpoint(checkpointPath, { state, cursor: 7, staticVersion: 'v1' });
    const read = await readCheckpoint(checkpointPath);
    assert.equal(read.schemaVersion, CHECKPOINT_SCHEMA_VERSION);
    assert.equal(read.cursor, 7);
    assert.equal(read.staticVersion, 'v1');
    assert.deepEqual(read.state, state);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('[STORY-64] writeCheckpoint rejects a malformed cursor or static version', async () => {
  const { dir, path: checkpointPath } = await tempCheckpoint();
  try {
    await assert.rejects(writeCheckpoint(checkpointPath, { state: {}, cursor: 1.5, staticVersion: 'v1' }), /cursor/);
    await assert.rejects(writeCheckpoint(checkpointPath, { state: {}, cursor: -2, staticVersion: 'v1' }), /cursor/);
    await assert.rejects(writeCheckpoint(checkpointPath, { state: {}, cursor: 0, staticVersion: '' }), /staticVersion/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('[STORY-64] a crash after the temp write but before the rename leaves the previous checkpoint', async () => {
  const { dir, path: checkpointPath } = await tempCheckpoint();
  try {
    await writeCheckpoint(checkpointPath, { state: { marker: 'previous' }, cursor: 3, staticVersion: 'v1' });
    // The temp write succeeds, then the process dies before any rename.
    await assert.rejects(writeCheckpoint(checkpointPath, { state: { marker: 'new' }, cursor: 4, staticVersion: 'v1' }, {
      writeFile: async (p, body) => { await writeFile(p, body); },
      rename: async () => { throw new Error('crash'); }
    }), /crash/);
    const read = await readCheckpoint(checkpointPath);
    assert.equal(read.cursor, 3);
    assert.deepEqual(read.state, { marker: 'previous' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('[STORY-64] a crash between the two renames recovers the retained previous checkpoint', async () => {
  const { dir, path: checkpointPath } = await tempCheckpoint();
  try {
    await writeCheckpoint(checkpointPath, { state: { marker: 'previous' }, cursor: 3, staticVersion: 'v1' });
    // The first rename (current -> prev) succeeds; the second (temp -> current) dies.
    let renames = 0;
    await assert.rejects(writeCheckpoint(checkpointPath, { state: { marker: 'new' }, cursor: 4, staticVersion: 'v1' }, {
      rename: async (from, to) => { renames++; if (renames === 2) throw new Error('crash'); return rename(from, to); }
    }), /crash/);
    // The current checkpoint is gone, but the retained previous one is complete.
    const read = await readCheckpoint(checkpointPath);
    assert.equal(read.cursor, 3);
    assert.deepEqual(read.state, { marker: 'previous' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('[STORY-64] a crash after the final rename leaves the new complete checkpoint', async () => {
  const { dir, path: checkpointPath } = await tempCheckpoint();
  try {
    await writeCheckpoint(checkpointPath, { state: { marker: 'previous' }, cursor: 3, staticVersion: 'v1' });
    await writeCheckpoint(checkpointPath, { state: { marker: 'new' }, cursor: 4, staticVersion: 'v1' });
    const read = await readCheckpoint(checkpointPath);
    assert.equal(read.cursor, 4);
    assert.deepEqual(read.state, { marker: 'new' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('[STORY-64] the state and cursor are always from the same write, never mixed', async () => {
  const { dir, path: checkpointPath } = await tempCheckpoint();
  try {
    // Each write pairs a distinct cursor with a distinct state marker.
    for (let i = 0; i < 5; i++) await writeCheckpoint(checkpointPath, { state: { marker: i }, cursor: i, staticVersion: 'v1' });
    const read = await readCheckpoint(checkpointPath);
    assert.equal(read.cursor, read.state.marker);
    // A partial temp file is never read as the checkpoint.
    await writeFile(`${checkpointPath}.tmp`, '{"schemaVersion":1,"cursor":99');
    const still = await readCheckpoint(checkpointPath);
    assert.equal(still.cursor, 4);
    assert.deepEqual(still.state, { marker: 4 });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('[STORY-64] readCheckpoint ignores an unreadable current checkpoint and falls back to the previous', async () => {
  const { dir, path: checkpointPath } = await tempCheckpoint();
  try {
    await writeCheckpoint(checkpointPath, { state: { marker: 'previous' }, cursor: 3, staticVersion: 'v1' });
    await writeCheckpoint(checkpointPath, { state: { marker: 'new' }, cursor: 4, staticVersion: 'v1' });
    // Corrupt the current checkpoint; the retained previous one is still complete.
    await writeFile(checkpointPath, 'not json');
    const read = await readCheckpoint(checkpointPath);
    assert.equal(read.cursor, 3);
    assert.deepEqual(read.state, { marker: 'previous' });
    // A schema-incompatible current checkpoint also falls back.
    await writeFile(checkpointPath, JSON.stringify({ schemaVersion: 99, cursor: 4, staticVersion: 'v1' }));
    assert.equal((await readCheckpoint(checkpointPath)).cursor, 3);
    // Neither readable: undefined.
    await rm(`${checkpointPath}.prev`);
    assert.equal(await readCheckpoint(checkpointPath), undefined);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('[STORY-64] a rejected capture is counted, skipped and does not wedge the cursor', async () => {
  const { dir, path: checkpointPath } = await tempCheckpoint();
  try {
    const { captures, replay } = diversionRun(3);
    const store = storeWith(captures);
    const result = await runProcessor({
      store, checkpointPath, loadStatic: async () => ({ index }), publish: async () => { }, clock: () => at(0),
      replay: (c, ctx) => { if (c.sequence === 1) throw new Error('bad capture'); return replay(c, ctx); }
    });
    assert.equal(result.processed, 2);
    assert.equal(result.rejected, 1);
    assert.equal(result.cursor, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('[STORY-64] a signal aborts the processor between captures', async () => {
  const { dir, path: checkpointPath } = await tempCheckpoint();
  try {
    const controller = new AbortController();
    const { captures, replay } = diversionRun(6);
    const result = await runProcessor({
      store: storeWith(captures), checkpointPath, loadStatic: async () => ({ index }), publish: async () => { }, clock: () => at(0), signal: controller.signal,
      replay: (c, ctx) => { if (c.sequence === 2) controller.abort(); return replay(c, ctx); }
    });
    assert.equal(result.processed, 3);
    assert.equal(result.cursor, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('[STORY-64] maxIterations bounds the number of processed captures', async () => {
  const { dir, path: checkpointPath } = await tempCheckpoint();
  try {
    const { captures, replay } = diversionRun(6);
    const result = await runProcessor({ store: storeWith(captures), replay, checkpointPath, loadStatic: async () => ({ index }), publish: async () => { }, clock: () => at(0), maxIterations: 2 });
    assert.equal(result.processed, 2);
    assert.equal(result.cursor, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('[STORY-64] runProcessor requires a store, a replay function and a checkpoint path', async () => {
  const { replay } = diversionRun(1);
  await assert.rejects(runProcessor({ store: undefined, replay, checkpointPath: 'x' }), /capture store/);
  await assert.rejects(runProcessor({ store: { list: async () => [] }, replay: undefined, checkpointPath: 'x' }), /replay function/);
  await assert.rejects(runProcessor({ store: { list: async () => [] }, replay, checkpointPath: undefined }), /checkpointPath/);
});

test('[STORY-64] runProcessor works with the default clock, log and publish', async () => {
  const { dir, path: checkpointPath } = await tempCheckpoint();
  try {
    // Seven polls: the sixth poll closes the first window, so the default
    // no-op publish is exercised, and the seventh starts a new window.
    const { captures, replay } = diversionRun(7);
    const result = await runProcessor({ store: storeWith(captures), replay, checkpointPath, loadStatic: async () => ({ index }) });
    assert.equal(result.processed, 7);
    assert.equal(result.cursor, 6);
    assert.equal(result.windows, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('[STORY-64] an empty store completes no window and leaves the cursor at -1', async () => {
  const { dir, path: checkpointPath } = await tempCheckpoint();
  try {
    const { replay } = diversionRun(1);
    const result = await runProcessor({ store: storeWith([]), replay, checkpointPath, loadStatic: async () => ({ index }), publish: async () => { }, clock: () => at(0) });
    assert.equal(result.processed, 0);
    assert.equal(result.windows, 0);
    assert.equal(result.cursor, -1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('[STORY-64] the window constants match the approved three-minute policy', () => {
  assert.equal(PROCESSOR_WINDOW_MS, 180000);
  assert.equal(CAPTURES_PER_WINDOW, 6);
});

test('[STORY-64] applyWallClockExpiry tolerates an output without a diversions array', () => {
  const expired = applyWallClockExpiry({ status: 'unavailable', checkedAt: at(0).toISOString() }, at(120));
  assert.deepEqual(expired.diversions, []);
  assert.equal(expired.status, 'unavailable');
});

test('[STORY-64] readCheckpoint surfaces a non-ENOENT, non-syntax read failure', async () => {
  const { dir, path: checkpointPath } = await tempCheckpoint();
  try {
    // A directory where the checkpoint file is expected is a real read error.
    await mkdir(checkpointPath, { recursive: true });
    await assert.rejects(readCheckpoint(checkpointPath), /EISDIR/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('[STORY-64] a window split across two drains completes exactly once at the boundary', async () => {
  const { dir, path: checkpointPath } = await tempCheckpoint();
  try {
    const combined = combine(diversionRun(6), diversionRun(6, { start: 180, sequenceOffset: 6 }));
    const store = storeWith(combined.captures);
    const completions = [];
    const infer = (previous, vehicles, idx, now) => ({ state: { checkedAt: now.toISOString(), records: [] } });
    const complete = (state, opts) => { completions.push(opts); return { state, output: { status: 'ok', checkedAt: state.checkedAt, diversions: [] } }; };
    // First drain processes only the first three polls of window 1.
    await runProcessor({ store, replay: combined.replay, checkpointPath, loadStatic: async () => ({ index }), publish: async () => { }, clock: () => at(0), infer, complete, maxIterations: 3 });
    assert.equal(completions.length, 0);
    let checkpoint = await readCheckpoint(checkpointPath);
    assert.equal(checkpoint.cursor, 2);
    assert.deepEqual(checkpoint.state.window, { index: Math.floor(+at(0) / PROCESSOR_WINDOW_MS), healthy: true, count: 3 });
    // Second drain resumes the same window and crosses the boundary.
    await runProcessor({ store, replay: combined.replay, checkpointPath, loadStatic: async () => ({ index }), publish: async () => { }, clock: () => at(0), infer, complete });
    // Window 1 completes exactly once; window 2 is left open.
    assert.equal(completions.length, 1);
    assert.deepEqual(completions[0], { healthy: true, sourceHealthy: true });
    checkpoint = await readCheckpoint(checkpointPath);
    assert.equal(checkpoint.cursor, 11);
    assert.deepEqual(checkpoint.state.window, { index: Math.floor(+at(180) / PROCESSOR_WINDOW_MS), healthy: true, count: 6 });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('[STORY-64] a shutdown signal with no open window completes nothing', async () => {
  const { dir, path: checkpointPath } = await tempCheckpoint();
  try {
    const controller = new AbortController();
    controller.abort();
    const { replay } = diversionRun(1);
    const result = await runProcessor({ store: storeWith([]), replay, checkpointPath, loadStatic: async () => ({ index }), publish: async () => { }, clock: () => at(0), signal: controller.signal });
    assert.equal(result.processed, 0);
    assert.equal(result.windows, 0);
    assert.equal(result.cursor, -1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
