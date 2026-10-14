// Story 64 — durable TTC capture contract and store.
//
// A *capture* is one immutable record of a single TTC vehicle-feed fetch
// outcome. It is the shared contract between the collector (writer) and the
// processor (reader): the collector builds and commits captures, the processor
// discovers and replays them in sequence order.
//
// The identical-feed rule is explicit and load-bearing: new vehicle evidence
// requires a *different* `contentHash`. `sourceUpdatedAt` alone never
// establishes new evidence. An identical hash with a different source timestamp
// is an identical-feed attempt (health metadata), not new evidence. A different
// hash with identical positions is still new evidence, because the bytes
// changed. `contentHash` is the discriminator; positions are never consulted.

import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createR2SignedFetch } from '../../scripts/lib/publication-sink.js';

export const CAPTURE_SCHEMA_VERSION = 1;

// Fetch outcomes. `ok` and `empty` are successful fetches (a feed with zero
// usable observations is `empty`, which is distinct from `unavailable`); an
// upstream failure is `unavailable`; a local/parse failure is `error`.
export const CAPTURE_OUTCOMES = Object.freeze(['ok', 'empty', 'unavailable', 'error']);

// Capture classifications. `duplicate` and `identical-feed` are health metadata
// only; `new-evidence` is the only classification that advances vehicle
// evidence.
export const CAPTURE_CLASSIFICATIONS = Object.freeze(['duplicate', 'identical-feed', 'new-evidence', 'no-evidence']);

const iso = s => typeof s === 'string' && Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s;
const id = s => typeof s === 'string' && s.length > 0;

// Classify a capture against the previous capture for the same feed. New
// evidence requires a different content hash; an identical hash is health
// metadata regardless of the source timestamp. Positions are never consulted.
export function classifyCapture({ contentHash, sourceUpdatedAt }, previous) {
  if (!previous) return 'new-evidence';
  if (previous.contentHash !== contentHash) return 'new-evidence';
  return previous.sourceUpdatedAt === sourceUpdatedAt ? 'duplicate' : 'identical-feed';
}

// Pure: build an immutable capture record from a fetch outcome. `previous` is
// the prior capture for the same feed (or undefined for the first capture); it
// is used only to classify the attempt, never copied into the record.
export function buildCapture({ feedId, sequence, requestedAt, completedAt,
  sourceUpdatedAt = null, bytes = 0, contentHash, outcome, previous, schemaVersion = CAPTURE_SCHEMA_VERSION }) {
  if (!id(feedId)) throw new Error('Capture requires a feedId');
  if (!Number.isInteger(sequence) || sequence < 0) throw new Error('Capture requires a non-negative integer sequence');
  if (!iso(requestedAt)) throw new Error('Capture requires an ISO requestedAt');
  if (!iso(completedAt)) throw new Error('Capture requires an ISO completedAt');
  if (Date.parse(completedAt) < Date.parse(requestedAt)) throw new Error('Capture completedAt precedes requestedAt');
  if (sourceUpdatedAt !== null && !iso(sourceUpdatedAt)) throw new Error('Capture sourceUpdatedAt must be null or ISO');
  if (!id(contentHash)) throw new Error('Capture requires a contentHash');
  if (!CAPTURE_OUTCOMES.includes(outcome)) throw new Error(`Unknown capture outcome: ${outcome}`);
  if (!Number.isInteger(bytes) || bytes < 0) throw new Error('Capture bytes must be a non-negative integer');
  // A fetch that produced no usable feed (unavailable or error) is never new
  // vehicle evidence, regardless of hash bookkeeping: it is classified as
  // `no-evidence` health metadata.
  const classification = outcome === 'ok' || outcome === 'empty'
    ? classifyCapture({ contentHash, sourceUpdatedAt }, previous)
    : 'no-evidence';
  // `bytes` is the payload byte count; zero means no payload was fetched, so the
  // payload reference is null. A non-zero count points at the raw-bytes object.
  const payload = bytes > 0 ? capturePayloadKey(feedId, sequence) : null;
  return Object.freeze({
    schemaVersion,
    feedId,
    sequence,
    requestedAt,
    completedAt,
    sourceUpdatedAt,
    bytes,
    contentHash,
    outcome,
    classification,
    newEvidence: classification === 'new-evidence',
    payload
  });
}

// Bounded capture size. A capture larger than this is rejected rather than
// committed, so a runaway feed cannot exhaust the spool or R2.
export const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;

// Pure: validate a capture record. Throws on a malformed, oversized or
// non-monotonic record. `previous` (optional) enforces sequence monotonicity:
// a capture's sequence must be strictly greater than the previous capture's.
export function validateCapture(capture, previous) {
  const fail = reason => { throw new Error(`Invalid TTC capture: ${reason}`); };
  if (!capture || typeof capture !== 'object') fail('shape');
  if (capture.schemaVersion !== CAPTURE_SCHEMA_VERSION) fail('schema-version');
  if (!id(capture.feedId)) fail('feedId');
  if (!Number.isInteger(capture.sequence) || capture.sequence < 0) fail('sequence');
  if (!iso(capture.requestedAt)) fail('requestedAt');
  if (!iso(capture.completedAt)) fail('completedAt');
  if (Date.parse(capture.completedAt) < Date.parse(capture.requestedAt)) fail('completed-before-requested');
  if (capture.sourceUpdatedAt !== null && !iso(capture.sourceUpdatedAt)) fail('sourceUpdatedAt');
  if (!id(capture.contentHash)) fail('contentHash');
  if (!CAPTURE_OUTCOMES.includes(capture.outcome)) fail('outcome');
  if (!Number.isInteger(capture.bytes) || capture.bytes < 0) fail('bytes');
  if (capture.bytes > MAX_CAPTURE_BYTES) fail('oversized');
  if (capture.payload !== null && !id(capture.payload)) fail('payload');
  if (!CAPTURE_CLASSIFICATIONS.includes(capture.classification)) fail('classification');
  if (capture.newEvidence !== (capture.classification === 'new-evidence')) fail('new-evidence');
  if (previous !== undefined) {
    if (!Number.isInteger(previous?.sequence)) fail('previous-sequence');
    if (capture.sequence <= previous.sequence) fail('non-monotonic');
  }
  return capture;
}

// --- Durable capture store --------------------------------------------------
//
// A capture is committed spool-first: the local spool is written before the R2
// PUT, so a crash or R2 outage never loses a capture that was observed. R2
// durability is established only by a successful PUT; a capture that is still
// only in the spool is explicitly not yet R2-durable (`durable:false`).
//
// The store is composed of two injectable collaborators:
//
//   - `spool`: a local durable spool with `write(capture)`, `read(sequence)`,
//     `list()`, `remove(sequence)` and `depth()`.
//   - `sink`: an object store with `put(key, body)`, `get(key)` and
//     `list(prefix)`.
//
// Both are injectable so tests can exercise R2 failure and late uploads without
// a network or a real bucket.

// Object key for a capture. The zero-padded sequence makes a lexicographic
// listing sequence-ordered, so discovery never has to sort by parsing values.
export function captureKey(feedId, sequence) {
  return `ttc-captures/${feedId}/${String(sequence).padStart(12, '0')}.json`;
}

// Object key for a capture's raw protobuf payload. The metadata references it via
// `capture.payload`; the payload is a sibling object so ordered metadata discovery
// stays small while the bytes remain age-deletable by the same sequence.
export function capturePayloadKey(feedId, sequence) {
  return `ttc-captures/${feedId}/${String(sequence).padStart(12, '0')}.pb`;
}

// Parse the sequence back out of a capture key, or null when the key is not a
// capture key for the given feed.
export function sequenceFromKey(feedId, key) {
  const prefix = `ttc-captures/${feedId}/`;
  if (!key.startsWith(prefix) || !key.endsWith('.json')) return null;
  const digits = key.slice(prefix.length, -'.json'.length);
  if (!/^\d+$/.test(digits)) return null;
  return Number(digits);
}

// Durable write: local spool first, then R2 PUT. Returns durability state. A
// failed PUT leaves the spool entry intact and reports `durable:false`; a
// successful PUT clears the spool entry and reports `durable:true`.
export async function commitCapture(capture, { spool, sink, payload }) {
  validateCapture(capture);
  const key = captureKey(capture.feedId, capture.sequence);
  const body = JSON.stringify(capture);
  // Spool the metadata and the raw payload together, so an R2 outage or a crash
  // never loses either half of a capture that was observed.
  await spool.write(capture, payload);
  try {
    // Bytes first, metadata second: the metadata object is the commit point, so
    // it never references a payload object that has not already been written.
    if (capture.payload !== null && payload !== undefined && payload !== null) {
      await sink.put(capture.payload, payload);
    }
    await sink.put(key, body);
  } catch {
    return { durable: false, key };
  }
  await spool.remove(capture.sequence);
  return { durable: true, key };
}

// Ordered discovery that cannot silently skip a late upload. Returns committed
// captures with `sequence > afterSequence`, sorted ascending and bounded by
// `limit`. A capture uploaded late with a lower sequence than a later one is
// still returned in sequence order. Discovery is a pure read: calling it twice
// with the same cursor returns the same set, so the caller owns cursor advance.
export async function listCommitted({ sink, feedId, afterSequence = -1, limit = Infinity }) {
  const keys = await sink.list(`ttc-captures/${feedId}/`);
  const sequences = keys.map(key => sequenceFromKey(feedId, key)).filter(s => s !== null && s > afterSequence).sort((a, b) => a - b);
  const captures = [];
  for (const sequence of sequences.slice(0, limit)) {
    const body = await sink.get(captureKey(feedId, sequence));
    if (body === undefined) continue;
    captures.push(JSON.parse(body));
  }
  return captures;
}

// --- Production adapters ----------------------------------------------------

// A filesystem-backed durable spool. Each capture is written atomically (temp
// file then rename) under `<dir>/<feedId>/<padded-sequence>.json`, so a crash
// mid-write never leaves a partial spool entry.
export function createFileSpool({ dir }) {
  const pathFor = (feedId, sequence) => resolve(dir, feedId, `${String(sequence).padStart(12, '0')}.json`);
  const payloadPathFor = (feedId, sequence) => resolve(dir, feedId, `${String(sequence).padStart(12, '0')}.pb`);
  const readPayload = async (feedId, sequence) => {
    try { return await readFile(payloadPathFor(feedId, sequence)); }
    catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
  };
  return {
    async write(capture, payload) {
      const target = pathFor(capture.feedId, capture.sequence);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(`${target}.tmp`, JSON.stringify(capture));
      await rename(`${target}.tmp`, target);
      if (payload !== undefined && payload !== null) {
        const ptarget = payloadPathFor(capture.feedId, capture.sequence);
        await writeFile(`${ptarget}.tmp`, payload);
        await rename(`${ptarget}.tmp`, ptarget);
      }
    },
    async read(sequence, feedId = 'ttc-vehicles') {
      let capture;
      try { capture = JSON.parse(await readFile(pathFor(feedId, sequence), 'utf8')); }
      catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
      return { capture, payload: await readPayload(feedId, sequence) };
    },
    async list(feedId = 'ttc-vehicles') {
      let names;
      try { names = await readdir(resolve(dir, feedId)); }
      catch (error) { if (error.code === 'ENOENT') return []; throw error; }
      const entries = [];
      for (const name of names.filter(n => n.endsWith('.json')).sort()) {
        const sequence = Number(name.slice(0, -'.json'.length));
        const capture = JSON.parse(await readFile(resolve(dir, feedId, name), 'utf8'));
        entries.push({ capture, payload: await readPayload(feedId, sequence) });
      }
      return entries;
    },
    async remove(sequence, feedId = 'ttc-vehicles') {
      await rm(pathFor(feedId, sequence), { force: true });
      await rm(payloadPathFor(feedId, sequence), { force: true });
    },
    async depth(feedId = 'ttc-vehicles') {
      try { return (await readdir(resolve(dir, feedId))).filter(n => n.endsWith('.json')).length; }
      catch (error) { if (error.code === 'ENOENT') return 0; throw error; }
    }
  };
}

// An R2-backed capture sink. Reuses the existing SigV4 signing from the
// publication sink so signing is defined once. `put`/`get`/`list` map onto the
// S3 API; `list` uses ListObjectsV2 with the capture prefix.
export function createR2CaptureSink({
  endpoint, bucket, accessKeyId, secretAccessKey, region = 'auto',
  fetchImpl = globalThis.fetch, now = () => new Date()
} = {}) {
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error('R2 capture sink requires endpoint, bucket, accessKeyId, and secretAccessKey');
  }
  const signedFetch = createR2SignedFetch({ endpoint, bucket, accessKeyId, secretAccessKey, region, fetchImpl, now });
  return {
    async put(key, body) {
      const response = await signedFetch('PUT', key, body);
      if (!response.ok) throw new Error(`R2 capture write failed: ${response.status}`);
    },
    async get(key) {
      const response = await signedFetch('GET', key);
      if (response.status === 404) return undefined;
      if (!response.ok) throw new Error(`R2 capture read failed: ${response.status}`);
      return response.text();
    },
    async getBytes(key) {
      const response = await signedFetch('GET', key);
      if (response.status === 404) return undefined;
      if (!response.ok) throw new Error(`R2 capture read failed: ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    },
    async delete(key) {
      const response = await signedFetch('DELETE', key);
      if (response.status === 404) return;
      if (!response.ok) throw new Error(`R2 capture delete failed: ${response.status}`);
    },
    async list(prefix) {
      const response = await signedFetch('GET', `?list-type=2&prefix=${encodeURIComponent(prefix)}`);
      if (!response.ok) throw new Error(`R2 capture list failed: ${response.status}`);
      const xml = await response.text();
      return [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map(m => m[1]);
    }
  };
}

// Select the production capture sink from the environment. R2 is the only
// durable target, so the four R2 credentials are required; a missing value
// fails loudly rather than silently dropping captures.
export function createCaptureSinkFromEnv({ env = process.env } = {}) {
  const { R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = env;
  if (!R2_ENDPOINT || !R2_BUCKET || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    throw new Error('R2 capture sink requires R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY');
  }
  return createR2CaptureSink({
    endpoint: R2_ENDPOINT, bucket: R2_BUCKET,
    accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY,
    region: env.R2_REGION || 'auto'
  });
}

// Compose a spool and a sink into the store the collector and processor use.
// `commit` is spool-first (see `commitCapture`); `flush` retries every pending
// spool entry to R2 and clears the ones that succeed, so a graceful shutdown or
// a recovery pass drains the spool without losing captures.
export function createCaptureStore({ spool, sink, feedId = 'ttc-vehicles' }) {
  return {
    async commit(capture, payload) { return commitCapture(capture, { spool, sink, payload }); },
    async list({ afterSequence = -1, limit = Infinity } = {}) { return listCommitted({ sink, feedId, afterSequence, limit }); },
    async spoolDepth() { return spool.depth(feedId); },
    async remove(sequence) {
      await sink.delete(captureKey(feedId, sequence));
      await sink.delete(capturePayloadKey(feedId, sequence));
      await spool.remove(sequence, feedId);
    },
    async pending() { return (await spool.list(feedId)).map(entry => entry.capture); },
    // Resolve the first sequence for a fresh collector boot: one past the highest
    // committed (R2) or still-pending (spool) sequence, so a restart continues the
    // ordered index instead of resetting to 0 and colliding with the previous
    // boot's objects. R2 being down at startup falls back to the spool-only max,
    // which is exactly the case where pending entries must not be overwritten.
    async nextSequence() {
      let max = -1;
      try {
        const keys = await sink.list(`ttc-captures/${feedId}/`);
        for (const key of keys) {
          const sequence = sequenceFromKey(feedId, key);
          if (sequence !== null && sequence > max) max = sequence;
        }
      } catch { /* R2 unavailable: the spool-only max below still protects pending entries */ }
      for (const capture of (await spool.list(feedId)).map(entry => entry.capture)) {
        if (Number.isInteger(capture.sequence) && capture.sequence > max) max = capture.sequence;
      }
      return max + 1;
    },
    async flush() {
      const entries = await spool.list(feedId);
      let flushed = 0;
      for (const { capture, payload } of entries) {
        try {
          if (payload !== undefined && payload !== null) {
            await sink.put(capturePayloadKey(capture.feedId, capture.sequence), payload);
          }
          await sink.put(captureKey(capture.feedId, capture.sequence), JSON.stringify(capture));
          await spool.remove(capture.sequence, capture.feedId);
          flushed++;
        } catch { /* leave the entry for the next flush */ }
      }
      return { flushed, remaining: await spool.depth(feedId) };
    }
  };
}
