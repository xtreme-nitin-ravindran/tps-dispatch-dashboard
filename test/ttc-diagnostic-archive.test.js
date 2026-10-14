import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import assert from 'node:assert/strict';
import { buildDiagnosticBundle, archiveDiagnostic, archiveDiagnosticFailure, diagnosticKey, createDiagnosticFileSpool, retryDiagnosticSpool, DIAGNOSTIC_SCHEMA_VERSION } from '../src/ttc/diagnostic-archive.js';
import { buildCapture } from '../src/ttc/capture-store.js';
import { diversionValidationDiagnostic, diversionOutput, inferDiversions } from '../src/ttc/diversion-inference.js';
import { detectVehicles } from '../src/ttc/vehicle-detector.js';
import { parseTtcVehicles } from '../src/ttc/vehicle-feed.js';
import { at, vehicle, protobuf, staticIndex } from './fixtures/ttc-vehicles/builders.js';
import { memorySink } from './fixtures/ttc-capture/store.js';

const index = staticIndex();
// A six-point path that departs and rejoins within one three-minute window so a
// confirmed record is produced, then rejected deterministically by a mutation.
const path = [[43.65, -79.404], [43.652, -79.403], [43.652, -79.402], [43.652, -79.400], [43.65, -79.398], [43.65, -79.397], [43.65, -79.396]];

// A deterministic inference run mirroring the ttc-diversions helper: two vehicles
// follow the confirmed diversion path, producing a valid inference state.
function run({ paths = [path, path], start = 0, step = 30 } = {}) {
  let state, vehicles, result;
  for (let i = 0; i < Math.max(...paths.map(p => p.length)); i++) {
    const seconds = start + i * step;
    const rows = paths.flatMap((p, j) => p[i] ? [vehicle(seconds, { vehicle: { id: String(j) }, position: { latitude: p[i][0], longitude: p[i][1] } })] : []);
    const feed = parseTtcVehicles(protobuf(rows, seconds), at(seconds));
    vehicles = detectVehicles(vehicles, feed, index, at(seconds)).state;
    result = inferDiversions(state, vehicles, index, at(seconds)); state = result.state;
  }
  return { state, vehicles };
}

// A capture with a non-empty payload (bytes > 0), so it references a `.pb` object.
function makeCapture(sequence, bytes = protobuf([vehicle(0)], 0)) {
  return buildCapture({ feedId: 'ttc-vehicles', sequence, requestedAt: at(0).toISOString(), completedAt: at(0).toISOString(), sourceUpdatedAt: at(0).toISOString(), bytes: bytes.length, contentHash: `hash-${sequence}`, outcome: 'ok' });
}

// A rejection carrying the rejected state, as diversionOutput/validateOrAttach attach it.
function rejectedError(state) {
  const error = new Error('Invalid TTC diversion output');
  error.rejectedState = state;
  return error;
}

// In-memory diagnostic spool: `write(key, body)` records the key -> JSON body.
function memoryDiagnosticSpool() {
  const entries = new Map();
  return { entries, async write(key, body) { entries.set(key, body); } };
}

// A mutable state that fails validation with the stable 'identity' reason.
function badState() {
  const bad = structuredClone(run().state);
  bad.records[0].geometrySource = 'ttc-official';
  return bad;
}

test('[STORY-64] a validation failure archives the bundle to R2 and still throws the original error', async () => {
  const error = rejectedError(badState());
  const capture = makeCapture(0);
  const sink = memorySink();
  const logs = [];
  await assert.rejects(
    archiveDiagnosticFailure({ error, index, capture, checkpoint: { cursor: -1 }, buildVersion: 'build-1', staticVersion: index.version, logicalClock: +at(0), advisoryRefs: ['ttc-service-change:0504'], sink, spool: memoryDiagnosticSpool(), log: e => logs.push(e), now: at(0), getBytes: async () => null }),
    /Invalid TTC diversion output/
  );
  const key = diagnosticKey('ttc-vehicles', 0);
  assert.equal(key, 'ttc-diagnostics/ttc-vehicles/000000000000.json');
  assert.ok(sink.objects.has(key));
  const bundle = JSON.parse(sink.objects.get(key));
  assert.equal(bundle.diagnostic.reason, 'identity');
  assert.equal(bundle.state.records[0].id, error.rejectedState.records[0].id);
  assert.equal(bundle.truncated, false);
  assert.equal(bundle.incomplete, false);
  // Durable archival: no archival-failure report.
  assert.equal(logs.length, 0);
});

test('[STORY-64] an R2 failure during archival is spooled for retry and the original error is preserved', async () => {
  const error = rejectedError(badState());
  const capture = makeCapture(0);
  const sink = memorySink({ failPut: true });
  const spool = memoryDiagnosticSpool();
  const logs = [];
  await assert.rejects(
    archiveDiagnosticFailure({ error, index, capture, checkpoint: null, buildVersion: 'build-1', staticVersion: index.version, logicalClock: +at(0), advisoryRefs: [], sink, spool, log: e => logs.push(e), now: at(0), getBytes: async () => null }),
    /Invalid TTC diversion output/
  );
  const key = diagnosticKey('ttc-vehicles', 0);
  assert.equal(sink.objects.size, 0);
  const body = spool.entries.get(key);
  assert.ok(body);
  const bundle = JSON.parse(body);
  assert.equal(bundle.error, 'Invalid TTC diversion output');
  assert.equal(logs.length, 1);
  assert.equal(logs[0].status, 'archival-failed');
  assert.equal(logs[0].key, key);
});

test('[STORY-64] an oversized rejected state is truncated and marked incomplete, never claiming exact replay', () => {
  const bad = structuredClone(run().state);
  bad.records[0].geometry = Array(3000000).fill([0, 0]);
  const bundle = buildDiagnosticBundle({ error: rejectedError(bad), index, capture: makeCapture(0), buildVersion: 'build-1', staticVersion: index.version, logicalClock: +at(0), advisoryRefs: [], now: at(0) });
  assert.equal(bundle.truncated, true);
  assert.equal(bundle.state, null);
  assert.equal(bundle.incomplete, true);
});

test('[STORY-64] a valid state has no rejection diagnostic, so archival never runs on the happy path', () => {
  const valid = run().state;
  // Nothing failed, so nothing is archiveable.
  assert.equal(diversionValidationDiagnostic(valid, index), null);
  // The bundle builder refuses without a rejection, so it cannot be invoked on
  // the happy path by a healthy capture.
  assert.throws(() => buildDiagnosticBundle({ index, capture: makeCapture(0), buildVersion: 'build-1', staticVersion: index.version, logicalClock: +at(0) }), /requires an error/);
});

test('[STORY-64] the bundle carries every replay input including the raw capture payload', () => {
  const bytes = protobuf([vehicle(0)], 0);
  const capture = makeCapture(0, bytes);
  const checkpoint = { cursor: 0, staticVersion: index.version, state: { vehicle: {}, inference: {} } };
  const bundle = buildDiagnosticBundle({
    error: rejectedError(badState()), index, capture, checkpoint,
    buildVersion: 'build-9', staticVersion: index.version, logicalClock: 123456,
    advisoryRefs: ['ttc-service-change:0504'], payload: bytes, now: at(0)
  });
  assert.equal(bundle.schemaVersion, DIAGNOSTIC_SCHEMA_VERSION);
  assert.equal(bundle.buildVersion, 'build-9');
  assert.equal(bundle.staticVersion, index.version);
  assert.equal(bundle.logicalClock, 123456);
  assert.deepEqual(bundle.checkpoint, checkpoint);
  assert.equal(bundle.capture.sequence, 0);
  assert.equal(bundle.capture.payload, capture.payload);
  assert.deepEqual(bundle.advisoryRefs, ['ttc-service-change:0504']);
  assert.equal(bundle.rawPayload, bytes.toString('base64'));
  assert.equal(bundle.recordedAt, at(0).toISOString());
  assert.equal(bundle.diagnostic.reason, 'identity');
});

test('[STORY-64] a complete bundle plus pre-transition state reproduces the known validator error', () => {
  // The exact Story 57 rejection: geometrySource outside the accepted vocabulary.
  const bad = structuredClone(run().state);
  bad.records[0].geometrySource = 'ttc-official';
  const bundle = buildDiagnosticBundle({ error: rejectedError(bad), index, capture: makeCapture(0), buildVersion: 'build-1', staticVersion: index.version, logicalClock: +at(0), advisoryRefs: [], now: at(0) });
  assert.equal(bundle.diagnostic.reason, 'identity');
  // Round-trip through the archive's serialization, then replay the state through
  // the validator: the identical failure is reproduced from the bundle alone.
  const serialized = JSON.parse(JSON.stringify(bundle));
  assert.throws(() => diversionOutput(serialized.state), /Invalid TTC diversion output/);
  assert.equal(diversionValidationDiagnostic(serialized.state, index).reason, 'identity');
});

test('[STORY-64] buildDiagnosticBundle requires an error, capture, build version, static version and logical clock', () => {
  const full = { error: rejectedError(undefined), index, capture: makeCapture(0), buildVersion: 'build-1', staticVersion: index.version, logicalClock: 0, now: at(0) };
  assert.throws(() => buildDiagnosticBundle({ ...full, error: undefined }), /requires an error/);
  assert.throws(() => buildDiagnosticBundle({ ...full, capture: undefined }), /requires a capture/);
  assert.throws(() => buildDiagnosticBundle({ ...full, buildVersion: '' }), /requires a buildVersion/);
  assert.throws(() => buildDiagnosticBundle({ ...full, staticVersion: undefined }), /requires a staticVersion/);
  assert.throws(() => buildDiagnosticBundle({ ...full, logicalClock: null }), /requires a logicalClock/);
});

test('[STORY-64] a non-Error rejection and a missing rejected state are carried safely', () => {
  const bundle = buildDiagnosticBundle({ error: 'plain failure', index, capture: makeCapture(0), buildVersion: 'build-1', staticVersion: index.version, logicalClock: 0, now: at(0) });
  assert.equal(bundle.error, 'plain failure');
  assert.equal(bundle.state, null);
  assert.equal(bundle.diagnostic.reason, 'state-shape');
  assert.equal(bundle.diagnostic.recordId, null);
  assert.equal(bundle.rawPayload, null);
});

test('[STORY-64] a capture without a raw payload archives a bundle with a null raw payload', async () => {
  const capture = buildCapture({ feedId: 'ttc-vehicles', sequence: 7, requestedAt: at(0).toISOString(), completedAt: at(0).toISOString(), sourceUpdatedAt: at(0).toISOString(), bytes: 0, contentHash: 'hash-7', outcome: 'empty' });
  const sink = memorySink();
  let fetched = false;
  await assert.rejects(
    archiveDiagnosticFailure({ error: rejectedError(badState()), index, capture, buildVersion: 'build-1', staticVersion: index.version, logicalClock: 0, advisoryRefs: [], sink, spool: memoryDiagnosticSpool(), now: at(0), getBytes: async () => { fetched = true; return null; } }),
    /Invalid TTC diversion output/
  );
  assert.equal(fetched, false);
  const bundle = JSON.parse(sink.objects.get(diagnosticKey('ttc-vehicles', 7)));
  assert.equal(bundle.rawPayload, null);
});

test('[STORY-64] archiveDiagnostic requires a sink with put and a spool with write', async () => {
  const bundle = buildDiagnosticBundle({ error: rejectedError(undefined), index, capture: makeCapture(0), buildVersion: 'build-1', staticVersion: index.version, logicalClock: 0, now: at(0) });
  await assert.rejects(archiveDiagnostic(bundle, {}), /requires a sink/);
  await assert.rejects(archiveDiagnostic(bundle, { sink: {} }), /requires a sink with put/);
  await assert.rejects(archiveDiagnostic(bundle, { sink: { put() {} } }), /requires a spool/);
  await assert.rejects(archiveDiagnostic(bundle, { sink: { put() {} }, spool: {} }), /requires a spool with write/);
});

test('[STORY-64] an archival failure with a plain-string rejection uses the default log and getBytes', async () => {
  // A failing sink, no injected `log`/`getBytes`, and a string error exercise the
  // default collaborators plus the String(error) fallback in the archival report.
  const sink = memorySink({ failPut: true });
  await assert.rejects(
    archiveDiagnosticFailure({ error: 'plain failure', index, capture: makeCapture(0), buildVersion: 'build-1', staticVersion: index.version, logicalClock: 0, advisoryRefs: [], sink, spool: memoryDiagnosticSpool(), now: at(0) }),
    /plain failure/
  );
});

test('[STORY-64] createDiagnosticFileSpool writes atomically, lists, and removes bundles', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'diag-spool-'));
  try {
    const spool = createDiagnosticFileSpool({ dir });
    assert.deepEqual(await spool.list(), []);
    const key = diagnosticKey('ttc-vehicles', 3);
    await spool.write(key, '{"schemaVersion":1}');
    const entries = await spool.list();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].key, key);
    assert.equal(entries[0].body.toString(), '{"schemaVersion":1}');
    // A partial temp write is never listed: only the renamed target is durable.
    assert.equal((await spool.list()).every(entry => !entry.key.endsWith('.tmp')), true);
    await spool.remove(key);
    assert.deepEqual(await spool.list(), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('[STORY-64] retryDiagnosticSpool re-PUTs spooled bundles and clears successes only', async () => {
  const sink = memorySink();
  const entries = new Map();
  const spool = {
    entries,
    async write(key, body) { entries.set(key, body); },
    async list() { return [...entries].map(([key, body]) => ({ key, body })); },
    async remove(key) { entries.delete(key); }
  };
  spool.entries.set('ttc-diagnostics/ttc-vehicles/000000000000.json', JSON.stringify({ recordedAt: '2026-10-14T12:00:00.000Z' }));
  spool.entries.set('ttc-diagnostics/ttc-vehicles/000000000001.json', JSON.stringify({ recordedAt: '2026-10-14T12:01:00.000Z' }));
  sink.failPut = true;
  const failed = await retryDiagnosticSpool({ spool, sink });
  assert.deepEqual(failed, { flushed: 0, remaining: 2 });
  assert.equal(spool.entries.size, 2);
  sink.failPut = false;
  const flushed = await retryDiagnosticSpool({ spool, sink });
  assert.deepEqual(flushed, { flushed: 2, remaining: 0 });
  assert.equal(spool.entries.size, 0);
  assert.equal(sink.objects.size, 2);
});

test('[STORY-64] retryDiagnosticSpool validates its collaborators', async () => {
  await assert.rejects(retryDiagnosticSpool({ spool: {}, sink: memorySink() }), /spool with list and remove/);
  await assert.rejects(retryDiagnosticSpool({ spool: { list: async () => [], remove: async () => {} }, sink: {} }), /sink with put/);
});

test('[STORY-64] createDiagnosticFileSpool lists an absent directory as empty and surfaces walk failures', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'diag-spool-'));
  try {
    // A missing spool directory is an empty spool, not an error.
    assert.deepEqual(await createDiagnosticFileSpool({ dir: join(dir, 'absent') }).list(), []);
    // A spool path that is actually a file makes the walk throw (ENOTDIR), which
    // the spool surfaces rather than swallowing.
    await writeFile(join(dir, 'file'), 'x');
    await assert.rejects(createDiagnosticFileSpool({ dir: join(dir, 'file') }).list());
  } finally { await rm(dir, { recursive: true, force: true }); }
});
