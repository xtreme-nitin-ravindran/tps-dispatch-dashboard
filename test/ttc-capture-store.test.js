import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCapture, classifyCapture, validateCapture, commitCapture, listCommitted, captureKey, capturePayloadKey, sequenceFromKey, createFileSpool, createR2CaptureSink, createCaptureSinkFromEnv, CAPTURE_SCHEMA_VERSION, MAX_CAPTURE_BYTES } from '../src/ttc/capture-store.js';
import { memorySink, memorySpool } from './fixtures/ttc-capture/store.js';

// Golden fixture for the identical-feed rule. New vehicle evidence requires a
// different contentHash; sourceUpdatedAt alone never establishes new evidence.
// `positions` is carried only to prove it is never consulted: case E has
// identical positions and a different timestamp but is still an identical feed.
const GOLDEN = [
  { case: 'A', contentHash: 'hash-1', sourceUpdatedAt: '2026-10-13T12:00:00.000Z', positions: 'p1', expected: 'duplicate' },
  { case: 'B', contentHash: 'hash-1', sourceUpdatedAt: '2026-10-13T12:00:30.000Z', positions: 'p1', expected: 'identical-feed' },
  { case: 'C', contentHash: 'hash-2', sourceUpdatedAt: '2026-10-13T12:00:00.000Z', positions: 'p2', expected: 'new-evidence' },
  { case: 'D', contentHash: 'hash-2', sourceUpdatedAt: '2026-10-13T12:00:30.000Z', positions: 'p2', expected: 'new-evidence' },
  { case: 'E', contentHash: 'hash-1', sourceUpdatedAt: '2026-10-13T12:00:30.000Z', positions: 'p1', expected: 'identical-feed' }
];

const base = { feedId: 'ttc-vehicles', sequence: 0, requestedAt: '2026-10-13T12:00:00.000Z', completedAt: '2026-10-13T12:00:00.500Z', bytes: 1024, outcome: 'ok' };

test('[STORY-64] buildCapture golden fixture covers identical-feed cases A-E', () => {
  // The previous capture is the case-A baseline: hash-1 at 12:00:00.
  const previous = buildCapture({ ...base, contentHash: 'hash-1', sourceUpdatedAt: '2026-10-13T12:00:00.000Z' });
  for (const row of GOLDEN) {
    const capture = buildCapture({ ...base, sequence: 1, contentHash: row.contentHash, sourceUpdatedAt: row.sourceUpdatedAt, previous });
    assert.equal(capture.classification, row.expected, `case ${row.case}`);
    assert.equal(capture.newEvidence, row.expected === 'new-evidence', `case ${row.case} newEvidence`);
  }
});

test('[STORY-64] new evidence requires a different contentHash; sourceUpdatedAt alone never establishes it', () => {
  const previous = buildCapture({ ...base, contentHash: 'hash-1', sourceUpdatedAt: '2026-10-13T12:00:00.000Z' });
  // Identical hash, different timestamp: health metadata, not new evidence.
  const identical = buildCapture({ ...base, sequence: 1, contentHash: 'hash-1', sourceUpdatedAt: '2026-10-13T12:05:00.000Z', previous });
  assert.equal(identical.newEvidence, false);
  // Different hash, identical timestamp: new evidence despite the same source time.
  const changed = buildCapture({ ...base, sequence: 1, contentHash: 'hash-9', sourceUpdatedAt: '2026-10-13T12:00:00.000Z', previous });
  assert.equal(changed.newEvidence, true);
});

test('[STORY-64] the first capture for a feed is new evidence', () => {
  const first = buildCapture({ ...base, contentHash: 'hash-1', sourceUpdatedAt: '2026-10-13T12:00:00.000Z' });
  assert.equal(first.classification, 'new-evidence');
  assert.equal(first.newEvidence, true);
});

test('[STORY-64] classifyCapture is a pure comparison over hash and source timestamp', () => {
  assert.equal(classifyCapture({ contentHash: 'h', sourceUpdatedAt: 't' }, undefined), 'new-evidence');
  assert.equal(classifyCapture({ contentHash: 'h', sourceUpdatedAt: 't' }, { contentHash: 'h', sourceUpdatedAt: 't' }), 'duplicate');
  assert.equal(classifyCapture({ contentHash: 'h', sourceUpdatedAt: 't2' }, { contentHash: 'h', sourceUpdatedAt: 't' }), 'identical-feed');
  assert.equal(classifyCapture({ contentHash: 'h2', sourceUpdatedAt: 't' }, { contentHash: 'h', sourceUpdatedAt: 't' }), 'new-evidence');
});

test('[STORY-64] buildCapture produces an immutable record carrying the contract fields', () => {
  const capture = buildCapture({ ...base, contentHash: 'hash-1', sourceUpdatedAt: '2026-10-13T12:00:00.000Z' });
  assert.equal(capture.schemaVersion, CAPTURE_SCHEMA_VERSION);
  assert.equal(capture.feedId, 'ttc-vehicles');
  assert.equal(capture.sequence, 0);
  assert.equal(capture.requestedAt, '2026-10-13T12:00:00.000Z');
  assert.equal(capture.completedAt, '2026-10-13T12:00:00.500Z');
  assert.equal(capture.sourceUpdatedAt, '2026-10-13T12:00:00.000Z');
  assert.equal(capture.bytes, 1024);
  assert.equal(capture.contentHash, 'hash-1');
  assert.equal(capture.outcome, 'ok');
  assert.ok(Object.isFrozen(capture));
  assert.throws(() => { capture.sequence = 5; }, TypeError);
});

test('[STORY-64] buildCapture rejects malformed inputs', () => {
  const ok = { ...base, contentHash: 'hash-1', sourceUpdatedAt: '2026-10-13T12:00:00.000Z' };
  assert.throws(() => buildCapture({ ...ok, feedId: '' }), /feedId/);
  assert.throws(() => buildCapture({ ...ok, sequence: -1 }), /sequence/);
  assert.throws(() => buildCapture({ ...ok, sequence: 1.5 }), /sequence/);
  assert.throws(() => buildCapture({ ...ok, requestedAt: 'nope' }), /requestedAt/);
  assert.throws(() => buildCapture({ ...ok, completedAt: 'nope' }), /completedAt/);
  assert.throws(() => buildCapture({ ...ok, completedAt: '2026-10-13T11:59:59.000Z' }), /precedes/);
  assert.throws(() => buildCapture({ ...ok, sourceUpdatedAt: 'nope' }), /sourceUpdatedAt/);
  assert.throws(() => buildCapture({ ...ok, contentHash: '' }), /contentHash/);
  assert.throws(() => buildCapture({ ...ok, outcome: 'weird' }), /outcome/);
  assert.throws(() => buildCapture({ ...ok, bytes: -1 }), /bytes/);
  assert.throws(() => buildCapture({ ...ok, bytes: 1.5 }), /bytes/);
});

test('[STORY-64] validateCapture accepts a well-formed capture and enforces sequence monotonicity', () => {
  const first = buildCapture({ ...base, contentHash: 'hash-1', sourceUpdatedAt: '2026-10-13T12:00:00.000Z' });
  assert.equal(validateCapture(first), first);
  const second = buildCapture({ ...base, sequence: 1, contentHash: 'hash-2', sourceUpdatedAt: '2026-10-13T12:00:30.000Z', previous: first });
  assert.equal(validateCapture(second, first), second);
  // A capture whose sequence does not advance past the previous is rejected.
  assert.throws(() => validateCapture(first, first), /non-monotonic/);
  assert.throws(() => validateCapture(first, { sequence: 5 }), /non-monotonic/);
  assert.throws(() => validateCapture(first, {}), /previous-sequence/);
});

test('[STORY-64] validateCapture rejects malformed, oversized and inconsistent records', () => {
  const capture = buildCapture({ ...base, contentHash: 'hash-1', sourceUpdatedAt: '2026-10-13T12:00:00.000Z' });
  assert.throws(() => validateCapture(undefined), /shape/);
  assert.throws(() => validateCapture({ ...capture, schemaVersion: 2 }), /schema-version/);
  assert.throws(() => validateCapture({ ...capture, feedId: '' }), /feedId/);
  assert.throws(() => validateCapture({ ...capture, sequence: -1 }), /sequence/);
  assert.throws(() => validateCapture({ ...capture, requestedAt: 'nope' }), /requestedAt/);
  assert.throws(() => validateCapture({ ...capture, completedAt: 'nope' }), /completedAt/);
  assert.throws(() => validateCapture({ ...capture, completedAt: '2026-10-13T11:00:00.000Z' }), /completed-before-requested/);
  assert.throws(() => validateCapture({ ...capture, sourceUpdatedAt: 'nope' }), /sourceUpdatedAt/);
  assert.throws(() => validateCapture({ ...capture, contentHash: '' }), /contentHash/);
  assert.throws(() => validateCapture({ ...capture, outcome: 'weird' }), /outcome/);
  assert.throws(() => validateCapture({ ...capture, bytes: -1 }), /bytes/);
  assert.throws(() => validateCapture({ ...capture, bytes: MAX_CAPTURE_BYTES + 1 }), /oversized/);
  assert.throws(() => validateCapture({ ...capture, classification: 'weird' }), /classification/);
  assert.throws(() => validateCapture({ ...capture, newEvidence: false }), /new-evidence/);
  assert.throws(() => validateCapture({ ...capture, payload: '' }), /payload/);
});

const captureAt = (sequence, contentHash, sourceUpdatedAt, previous) =>
  buildCapture({ ...base, sequence, contentHash, sourceUpdatedAt, previous });

test('[STORY-64] commitCapture writes the spool first and reports R2 durability on success', async () => {
  const spool = memorySpool();
  const sink = memorySink();
  const capture = captureAt(0, 'hash-1', '2026-10-13T12:00:00.000Z');
  const result = await commitCapture(capture, { spool, sink });
  assert.deepEqual(result, { durable: true, key: captureKey('ttc-vehicles', 0) });
  // R2 holds the capture and the spool entry is cleared once durable.
  assert.equal(sink.objects.get(captureKey('ttc-vehicles', 0)), JSON.stringify(capture));
  assert.equal(await spool.depth(), 0);
});

test('[STORY-64] commitCapture keeps the spool intact and reports durable:false when R2 fails', async () => {
  const spool = memorySpool();
  const sink = memorySink({ failPut: true });
  const capture = captureAt(0, 'hash-1', '2026-10-13T12:00:00.000Z');
  const result = await commitCapture(capture, { spool, sink });
  assert.deepEqual(result, { durable: false, key: captureKey('ttc-vehicles', 0) });
  // The capture is still recoverable from the spool and was never written to R2.
  assert.equal(await spool.depth(), 1);
  assert.equal((await spool.read(0)).capture.contentHash, 'hash-1');
  assert.equal(sink.objects.size, 0);
});

test('[STORY-64] commitCapture validates before writing anything', async () => {
  const spool = memorySpool();
  const sink = memorySink();
  await assert.rejects(commitCapture({ ...captureAt(0, 'hash-1', '2026-10-13T12:00:00.000Z'), bytes: -1 }, { spool, sink }), /bytes/);
  assert.equal(await spool.depth(), 0);
  assert.equal(sink.objects.size, 0);
});

test('[STORY-64] listCommitted returns captures in sequence order above the cursor', async () => {
  const spool = memorySpool();
  const sink = memorySink();
  for (const sequence of [0, 1, 2]) await commitCapture(captureAt(sequence, `hash-${sequence}`, '2026-10-13T12:00:00.000Z'), { spool, sink });
  const all = await listCommitted({ sink, feedId: 'ttc-vehicles' });
  assert.deepEqual(all.map(c => c.sequence), [0, 1, 2]);
  const after = await listCommitted({ sink, feedId: 'ttc-vehicles', afterSequence: 0 });
  assert.deepEqual(after.map(c => c.sequence), [1, 2]);
  const limited = await listCommitted({ sink, feedId: 'ttc-vehicles', limit: 2 });
  assert.deepEqual(limited.map(c => c.sequence), [0, 1]);
});

test('[STORY-64] listCommitted finds a late lower-sequence upload in order', async () => {
  const spool = memorySpool();
  const sink = memorySink();
  // Sequences 7 and 8 land first; sequence 6 is uploaded late.
  await commitCapture(captureAt(7, 'hash-7', '2026-10-13T12:00:00.000Z'), { spool, sink });
  await commitCapture(captureAt(8, 'hash-8', '2026-10-13T12:00:00.000Z'), { spool, sink });
  await commitCapture(captureAt(6, 'hash-6', '2026-10-13T12:00:00.000Z'), { spool, sink });
  const found = await listCommitted({ sink, feedId: 'ttc-vehicles', afterSequence: 5 });
  assert.deepEqual(found.map(c => c.sequence), [6, 7, 8]);
});

test('[STORY-64] listCommitted does not double-return across calls with the same cursor', async () => {
  const spool = memorySpool();
  const sink = memorySink();
  for (const sequence of [0, 1]) await commitCapture(captureAt(sequence, `hash-${sequence}`, '2026-10-13T12:00:00.000Z'), { spool, sink });
  const first = await listCommitted({ sink, feedId: 'ttc-vehicles', afterSequence: -1 });
  const second = await listCommitted({ sink, feedId: 'ttc-vehicles', afterSequence: -1 });
  assert.deepEqual(first.map(c => c.sequence), second.map(c => c.sequence));
  // Discovery is a pure read: the caller owns cursor advance.
  assert.deepEqual(first.map(c => c.sequence), [0, 1]);
});

test('[STORY-64] captureKey and sequenceFromKey round-trip and reject foreign keys', () => {
  assert.equal(captureKey('ttc-vehicles', 42), 'ttc-captures/ttc-vehicles/000000000042.json');
  assert.equal(sequenceFromKey('ttc-vehicles', captureKey('ttc-vehicles', 42)), 42);
  assert.equal(sequenceFromKey('ttc-vehicles', 'ttc-captures/other/000000000042.json'), null);
  assert.equal(sequenceFromKey('ttc-vehicles', 'ttc-captures/ttc-vehicles/not-a-number.json'), null);
  assert.equal(sequenceFromKey('ttc-vehicles', 'ttc-captures/ttc-vehicles/000000000042.txt'), null);
});

test('[STORY-64] createFileSpool round-trips captures atomically and reports depth', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'capture-spool-'));
  try {
    const spool = createFileSpool({ dir });
    assert.equal(await spool.depth(), 0);
    assert.equal(await spool.read(0), undefined);
    assert.deepEqual(await spool.list(), []);
    const capture = captureAt(0, 'hash-1', '2026-10-13T12:00:00.000Z');
    await spool.write(capture);
    assert.equal(await spool.depth(), 1);
    assert.equal((await spool.read(0)).capture.contentHash, 'hash-1');
    assert.deepEqual((await spool.list()).map(e => e.capture.sequence), [0]);
    await spool.remove(0);
    assert.equal(await spool.depth(), 0);
    // Removing a missing entry is a no-op.
    await spool.remove(99);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('[STORY-64] createR2CaptureSink signs PUT/GET/LIST and parses the listing', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, method: options.method });
    if (options.method === 'PUT') return { ok: true, status: 200 };
    if (url.includes('list-type=2')) return { ok: true, status: 200, text: async () => '<ListBucketResult><Contents><Key>ttc-captures/ttc-vehicles/000000000000.json</Key></Contents></ListBucketResult>' };
    return { ok: true, status: 200, text: async () => '{"sequence":0}' };
  };
  const sink = createR2CaptureSink({ endpoint: 'https://r2.example.com', bucket: 'b', accessKeyId: 'a', secretAccessKey: 's', fetchImpl, now: () => new Date('2026-10-13T12:00:00.000Z') });
  await sink.put('ttc-captures/ttc-vehicles/000000000000.json', '{}');
  assert.equal(await sink.get('ttc-captures/ttc-vehicles/000000000000.json'), '{"sequence":0}');
  assert.deepEqual(await sink.list('ttc-captures/ttc-vehicles/'), ['ttc-captures/ttc-vehicles/000000000000.json']);
  assert.ok(calls.every(c => c.url.startsWith('https://r2.example.com/b')));
});

test('[STORY-64] createR2CaptureSink reports a missing object and surfaces failures', async () => {
  const notFound = createR2CaptureSink({ endpoint: 'https://r2.example.com', bucket: 'b', accessKeyId: 'a', secretAccessKey: 's', fetchImpl: async () => ({ ok: false, status: 404 }) });
  assert.equal(await notFound.get('missing'), undefined);
  const failing = createR2CaptureSink({ endpoint: 'https://r2.example.com', bucket: 'b', accessKeyId: 'a', secretAccessKey: 's', fetchImpl: async () => ({ ok: false, status: 500 }) });
  await assert.rejects(failing.put('k', '{}'), /write failed: 500/);
  await assert.rejects(failing.get('k'), /read failed: 500/);
  await assert.rejects(failing.list('p'), /list failed: 500/);
});

test('[STORY-64] createR2CaptureSink and createCaptureSinkFromEnv require credentials', () => {
  assert.throws(() => createR2CaptureSink({}), /requires endpoint/);
  assert.throws(() => createCaptureSinkFromEnv({ env: {} }), /requires R2_ENDPOINT/);
  const sink = createCaptureSinkFromEnv({ env: { R2_ENDPOINT: 'https://r2.example.com', R2_BUCKET: 'b', R2_ACCESS_KEY_ID: 'a', R2_SECRET_ACCESS_KEY: 's' } });
  assert.equal(typeof sink.put, 'function');
});

test('[STORY-64] listCommitted skips a listed key whose object is missing', async () => {
  const spool = memorySpool();
  const sink = memorySink();
  await commitCapture(captureAt(0, 'hash-0', '2026-10-13T12:00:00.000Z'), { spool, sink });
  // A key is listed but its object has been removed (e.g. lifecycle expiry).
  sink.objects.set(captureKey('ttc-vehicles', 1), undefined);
  const found = await listCommitted({ sink, feedId: 'ttc-vehicles' });
  assert.deepEqual(found.map(c => c.sequence), [0]);
});

test('[STORY-64] createFileSpool surfaces non-ENOENT read/list/depth failures', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'capture-spool-err-'));
  try {
    const spool = createFileSpool({ dir });
    // A malformed spool entry is a real error, not a missing entry.
    await mkdir(join(dir, 'ttc-vehicles'), { recursive: true });
    await writeFile(join(dir, 'ttc-vehicles', '000000000000.json'), 'not json');
    await assert.rejects(spool.read(0), SyntaxError);
    await assert.rejects(spool.list(), SyntaxError);
    // A path that is a file, not a directory, is a real error for list/depth.
    const fileDir = await mkdtemp(join(tmpdir(), 'capture-spool-file-'));
    await writeFile(join(fileDir, 'ttc-vehicles'), 'x');
    await assert.rejects(createFileSpool({ dir: fileDir }).list(), /ENOTDIR/);
    await assert.rejects(createFileSpool({ dir: fileDir }).depth(), /ENOTDIR/);
    await rm(fileDir, { recursive: true, force: true });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('[STORY-64] capturePayloadKey is a sibling .pb key and sequenceFromKey rejects it', () => {
  assert.equal(capturePayloadKey('ttc-vehicles', 42), 'ttc-captures/ttc-vehicles/000000000042.pb');
  assert.equal(sequenceFromKey('ttc-vehicles', capturePayloadKey('ttc-vehicles', 42)), null);
});

test('[STORY-64] commitCapture writes the raw payload before the metadata and the metadata references it', async () => {
  const spool = memorySpool();
  const sink = memorySink();
  const capture = captureAt(0, 'hash-1', '2026-10-13T12:00:00.000Z');
  const payload = Buffer.from('raw-protobuf-bytes');
  const result = await commitCapture(capture, { spool, sink, payload });
  assert.equal(result.durable, true);
  assert.equal(capture.payload, capturePayloadKey('ttc-vehicles', 0));
  assert.deepEqual(sink.objects.get(capturePayloadKey('ttc-vehicles', 0)), payload);
  assert.equal(sink.objects.get(captureKey('ttc-vehicles', 0)), JSON.stringify(capture));
  assert.equal(await spool.depth(), 0);
});

test('[STORY-64] commitCapture keeps the payload in the spool when R2 fails', async () => {
  const spool = memorySpool();
  const sink = memorySink({ failPut: true });
  const capture = captureAt(0, 'hash-1', '2026-10-13T12:00:00.000Z');
  const payload = Buffer.from('raw-protobuf-bytes');
  const result = await commitCapture(capture, { spool, sink, payload });
  assert.equal(result.durable, false);
  assert.equal(await spool.depth(), 1);
  assert.deepEqual((await spool.read(0)).payload, payload);
  assert.equal((await spool.read(0)).capture.contentHash, 'hash-1');
});

test('[STORY-64] an unavailable capture has a null payload reference', () => {
  const capture = buildCapture({ ...base, bytes: 0, contentHash: 'hash-1', sourceUpdatedAt: null, outcome: 'unavailable' });
  assert.equal(capture.payload, null);
});

test('[STORY-64] createFileSpool round-trips the raw payload alongside the capture', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'capture-spool-payload-'));
  try {
    const spool = createFileSpool({ dir });
    const capture = captureAt(0, 'hash-1', '2026-10-13T12:00:00.000Z');
    const payload = Buffer.from('raw-bytes');
    await spool.write(capture, payload);
    assert.deepEqual((await spool.read(0)).payload, payload);
    assert.deepEqual((await spool.list())[0].payload, payload);
    await spool.remove(0);
    assert.equal(await spool.depth(), 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('[STORY-64] createR2CaptureSink.getBytes returns the raw bytes', async () => {
  const sink = createR2CaptureSink({ endpoint: 'https://r2.example.com', bucket: 'b', accessKeyId: 'a', secretAccessKey: 's', fetchImpl: async (url, options) => {
    if (options.method === 'GET') return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([0, 1, 2, 255]).buffer };
    return { ok: true, status: 200 };
  } });
  assert.deepEqual(await sink.getBytes('k'), Buffer.from([0, 1, 2, 255]));
});

test('[STORY-64] createFileSpool writes no payload file for a null payload', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'capture-spool-null-'));
  try {
    const spool = createFileSpool({ dir });
    const capture = captureAt(0, 'hash-1', '2026-10-13T12:00:00.000Z');
    await spool.write(capture, null);
    assert.equal((await spool.read(0)).payload, undefined);
    await spool.remove(0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('[STORY-64] createFileSpool surfaces a non-ENOENT payload read failure', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'capture-spool-payload-err-'));
  try {
    const spool = createFileSpool({ dir });
    await mkdir(join(dir, 'ttc-vehicles'), { recursive: true });
    await writeFile(join(dir, 'ttc-vehicles', '000000000000.json'), JSON.stringify(captureAt(0, 'hash-1', '2026-10-13T12:00:00.000Z')));
    // A directory where the payload file is expected is a real read error.
    await mkdir(join(dir, 'ttc-vehicles', '000000000000.pb'), { recursive: true });
    await assert.rejects(spool.read(0), /EISDIR/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('[STORY-64] createR2CaptureSink.getBytes reports a missing object and surfaces failures', async () => {
  const notFound = createR2CaptureSink({ endpoint: 'https://r2.example.com', bucket: 'b', accessKeyId: 'a', secretAccessKey: 's', fetchImpl: async () => ({ ok: false, status: 404 }) });
  assert.equal(await notFound.getBytes('missing'), undefined);
  const failing = createR2CaptureSink({ endpoint: 'https://r2.example.com', bucket: 'b', accessKeyId: 'a', secretAccessKey: 's', fetchImpl: async () => ({ ok: false, status: 500 }) });
  await assert.rejects(failing.getBytes('k'), /read failed: 500/);
});
