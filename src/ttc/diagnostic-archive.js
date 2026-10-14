// Story 64 — failure-path R2 archival of the Story 57 diagnostic bundle.
//
// Piece 4 is the durable-transport version of the Story 57 failure-only
// diagnostic seam. When the inference validator rejects a state, instead of
// writing the bounded diagnostic to a local file, it is archived to a private
// R2 prefix with a bounded local retry spool during R2 failure. The original
// processing error is always preserved: archival failure is reported explicitly
// and the rejection is re-thrown, never masked or swallowed.
//
// This reuses the Story 57 diagnostic vocabulary directly:
//
//   - `diversionValidationDiagnostic(state, index)` names the first failing
//     record and its stable reason key (never record values, geometry or raw
//     evidence), so the next failure is exactly replayable.
//   - `error.rejectedState` is the bounded inference state attached by
//     `diversionOutput`/`validateOrAttach` before the rejection is thrown.
//
// `writeDiversionDiagnostic` itself is file-coupled and lives in the frozen
// spike (`scripts/ttc-vehicles.js`), so the bundle reuses its field shape and
// its oversize contract (`state:null`, `truncated:true`) while the reason
// classifier and the rejected state are imported rather than duplicated.
//
// The bundle is failure-only and inert on the happy path: a valid state has a
// null diagnostic and never reaches the archive. It never turns malformed
// geometry into accepted geometry — the rejected state is preserved verbatim
// (and, when oversized, dropped rather than rewritten), never "fixed".

import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { diversionValidationDiagnostic, DIVERSION_POLICY } from './diversion-inference.js';

export const DIAGNOSTIC_SCHEMA_VERSION = 1;

// Object key for a diagnostic bundle. Keyed by the triggering capture so
// re-archiving the same failure overwrites the same object (idempotent); the
// zero-padded sequence keeps listing sequence-ordered. The private prefix is
// distinct from the public geometry and raw-capture sinks.
export function diagnosticKey(feedId, sequence) {
  return `ttc-diagnostics/${feedId}/${String(sequence).padStart(12, '0')}.json`;
}

// Pure: build a diagnostic bundle from a rejection and its replay inputs. The
// bundle carries everything needed to reproduce the exact validation failure
// and the transition that created it: the rejected state (bounded), the
// triggering capture identity, the raw capture payload (base64), and the build/
// static/logical-clock/checkpoint/advisory context. Oversize drops the rejected
// state and marks the bundle `truncated` + `incomplete` — it never claims exact
// replay on the degraded path.
export function buildDiagnosticBundle({ error, index, capture, checkpoint = null,
  buildVersion, staticVersion, logicalClock, advisoryRefs = [], payload = null,
  now = new Date() }) {
  if (!error) throw new Error('Diagnostic bundle requires an error');
  if (!capture) throw new Error('Diagnostic bundle requires a capture');
  if (!buildVersion) throw new Error('Diagnostic bundle requires a buildVersion');
  if (!staticVersion) throw new Error('Diagnostic bundle requires a staticVersion');
  if (logicalClock == null) throw new Error('Diagnostic bundle requires a logicalClock');
  const state = error.rejectedState ?? null;
  const diagnostic = diversionValidationDiagnostic(state, index);
  const bundle = {
    schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
    recordedAt: new Date(now).toISOString(),
    error: error.message || String(error),
    diagnostic,
    state,
    buildVersion,
    staticVersion,
    logicalClock,
    checkpoint,
    capture,
    advisoryRefs,
    rawPayload: payload == null ? null : payload.toString('base64'),
    truncated: false,
    incomplete: false
  };
  // Oversize: drop the rejected state, mark the bundle truncated + incomplete,
  // and never claim exact replay (the same degraded contract as
  // writeDiversionDiagnostic). The raw payload and replay context are retained.
  if (Buffer.byteLength(JSON.stringify(bundle)) > DIVERSION_POLICY.maxArtifactBytes) {
    return { ...bundle, state: null, truncated: true, incomplete: true };
  }
  return bundle;
}

// Durable transport. PUT the bundle to the private R2 prefix; on R2 failure,
// spool it for a later retry and report `durable:false` without throwing, so the
// original processing error remains the only error a caller must propagate.
export async function archiveDiagnostic(bundle, { sink, spool }) {
  if (!sink) throw new Error('archiveDiagnostic requires a sink');
  if (typeof sink.put !== 'function') throw new Error('archiveDiagnostic requires a sink with put');
  if (!spool) throw new Error('archiveDiagnostic requires a spool');
  if (typeof spool.write !== 'function') throw new Error('archiveDiagnostic requires a spool with write');
  const key = diagnosticKey(bundle.capture.feedId, bundle.capture.sequence);
  const body = JSON.stringify(bundle);
  try {
    await sink.put(key, body);
  } catch {
    await spool.write(key, body);
    return { durable: false, key };
  }
  return { durable: true, key };
}

// Failure-only seam: build the bundle (fetching the raw payload when the
// trigger capture references one), archive it durably, report an archival
// failure explicitly, and always re-throw the original rejection. This is the
// durable-transport version of the spike's `runVehiclePolling` diagnostic seam
// and is inert unless invoked on a rejection.
export async function archiveDiagnosticFailure({
  error, index, capture, checkpoint, buildVersion, staticVersion, logicalClock,
  advisoryRefs, sink, spool, log = () => { }, now = new Date(),
  getBytes = async () => null
}) {
  const payload = capture.payload ? await getBytes(capture.payload) : null;
  const bundle = buildDiagnosticBundle({ error, index, capture, checkpoint, buildVersion, staticVersion, logicalClock, advisoryRefs, payload, now });
  const result = await archiveDiagnostic(bundle, { sink, spool });
  if (!result.durable) {
    log({ source: 'ttc-diagnostic-archive', status: 'archival-failed', key: result.key, error: error.message || String(error) });
  }
  throw error;
}

// A filesystem-backed diagnostic spool. Each bundle is written atomically (temp
// file then rename) under `<dir>/<key>`, where the key is the diagnostic object
// key (`ttc-diagnostics/...`), so the retry pass re-PUTs the exact object.
export function createDiagnosticFileSpool({ dir }) {
  return {
    async write(key, body) {
      const target = resolve(dir, key);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(`${target}.tmp`, body);
      await rename(`${target}.tmp`, target);
    },
    async list() {
      const files = [];
      const walk = async (base, prefix) => {
        let names;
        try { names = await readdir(base, { withFileTypes: true }); }
        catch (error) { if (error.code === 'ENOENT') return; throw error; }
        for (const entry of names) {
          const path = resolve(base, entry.name);
          const key = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) await walk(path, key);
          else files.push({ key, body: await readFile(path) });
        }
      };
      await walk(resolve(dir), '');
      return files;
    },
    async remove(key) {
      await rm(resolve(dir, key), { force: true });
    }
  };
}

// Retry every spooled diagnostic bundle to R2, removing the spool entry on
// success. Returns the flushed/remaining counts; a failure leaves the entry for
// the next pass, so a transient R2 outage never loses a diagnostic bundle.
export async function retryDiagnosticSpool({ spool, sink, log = () => {} }) {
  if (!spool || typeof spool.list !== 'function' || typeof spool.remove !== 'function') throw new Error('Diagnostic spool retry requires a spool with list and remove');
  if (!sink || typeof sink.put !== 'function') throw new Error('Diagnostic spool retry requires a sink with put');
  const entries = await spool.list();
  let flushed = 0;
  for (const { key, body } of entries) {
    try {
      await sink.put(key, body);
      await spool.remove(key);
      flushed++;
    } catch { /* leave the entry for the next pass */ }
  }
  const remaining = (await spool.list()).length;
  if (flushed) log({ source: 'ttc-diagnostic-archive', status: 'spool-flushed', flushed, remaining });
  return { flushed, remaining };
}
