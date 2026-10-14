// Story 64 — continuous TTC capture processor.
//
// The processor is the reader half of the capture contract (piece 1). It
// discovers committed captures in sequence order above a durable cursor,
// replays each one through the vehicle detector and diversion inference, and
// persists a checkpoint that binds the inference state to the consumed cursor.
//
// Three properties are load-bearing:
//
//   1. Checkpoint atomicity. The checkpoint (state + cursor + static version) is
//      written as one atomic unit: a complete temp file is renamed into place,
//      and the previous complete checkpoint is retained for recovery. A crash
//      mid-write therefore leaves either the previous complete checkpoint or the
//      new complete checkpoint, never a partial one, and the state and cursor are
//      always from the same write.
//   2. Idempotent replay. Reprocessing the same captures from the same checkpoint
//      produces identical output and identical Story 57 counters, because the
//      cursor only advances after the checkpoint is durable and inference is
//      deterministic for identical inputs.
//   3. Fixed three-minute evaluation windows. `completeDiversionCapture` is called
//      once per window, never once per poll. A window that is unavailable or
//      incomplete (fewer than the expected polls) is completed with `healthy:false`
//      so it never increments healthy absences.
//
// The capture contract carries health metadata (outcome, content hash, source
// timestamp, byte count), not the raw feed bytes, so the vehicle-detection step
// is an injected `replay` collaborator. This keeps the processor pure
// orchestration and fully testable without a network or a real bucket.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { loadStaticGtfs } from './static-source.js';
import { inferDiversions, completeDiversionCapture } from './diversion-inference.js';

// The fixed three-minute evaluation window. At the collector's 30 s cadence this
// is six polls per window; the window is time-based, so it is independent of the
// poll count, restarts and publication frequency.
export const PROCESSOR_WINDOW_MS = 180000;
export const CAPTURES_PER_WINDOW = 6;
export const CHECKPOINT_SCHEMA_VERSION = 1;

// A capture outcome that carries usable vehicle evidence. `unavailable` and
// `error` are health metadata: they never establish new evidence and they make
// their window unavailable.
const AVAILABLE_OUTCOMES = Object.freeze(['ok', 'empty']);

// Pure: apply wall-clock expiry to a completed output before publication. A
// replayed old sample must never be advertised as current, so any diversion whose
// `expiresAt` is at or before the wall clock is dropped. The output header is
// preserved so the caller still sees the source status and checked time.
export function applyWallClockExpiry(output, wallNow) {
  const now = +wallNow;
  const diversions = (output.diversions || []).filter(d => !d.expiresAt || Date.parse(d.expiresAt) > now);
  return { ...output, diversions };
}

// Atomic checkpoint write. The new checkpoint is serialized to a complete temp
// file, the previous complete checkpoint is retained as `<path>.prev`, and the
// temp file is renamed into place. A crash at any boundary leaves the previous
// complete checkpoint or the new complete checkpoint, never a partial one, and
// the state and cursor are always from the same write. `rename`/`writeFile` are
// injectable so the temp-file and rename boundaries can be exercised in tests.
export async function writeCheckpoint(path, { state, cursor, staticVersion }, { rename: renameImpl = rename, writeFile: writeImpl = writeFile } = {}) {
  if (!Number.isInteger(cursor) || cursor < -1) throw new Error('Checkpoint requires an integer cursor');
  if (typeof staticVersion !== 'string' || staticVersion.length === 0) throw new Error('Checkpoint requires a staticVersion');
  const payload = { schemaVersion: CHECKPOINT_SCHEMA_VERSION, cursor, staticVersion, state };
  const body = JSON.stringify(payload);
  await mkdir(dirname(path), { recursive: true });
  await writeImpl(`${path}.tmp`, body);
  // Retain the previous complete checkpoint for recovery, then atomically replace.
  try { await renameImpl(path, `${path}.prev`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await renameImpl(`${path}.tmp`, path);
  return payload;
}

// Read the current checkpoint, falling back to the retained previous checkpoint
// when the current one is missing or unreadable. Returns undefined when neither
// is a complete, schema-compatible checkpoint.
export async function readCheckpoint(path) {
  for (const candidate of [path, `${path}.prev`]) {
    let parsed;
    try { parsed = JSON.parse(await readFile(candidate, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) continue; throw error; }
    if (parsed && parsed.schemaVersion === CHECKPOINT_SCHEMA_VERSION && Number.isInteger(parsed.cursor) && typeof parsed.staticVersion === 'string') return parsed;
  }
  return undefined;
}

// Run the processor until every committed capture above the cursor is consumed,
// `maxIterations` captures are processed, or `signal` aborts. Returns a bounded
// run summary: processed/rejected counts, the final cursor and the number of
// completed evaluation windows. `replay`, `infer`, `complete`, `publish`,
// `loadStatic` and `clock` are injectable so replay, windowing and the static
// reset are deterministic in tests.
export async function runProcessor({
  store,
  loadStatic = loadStaticGtfs,
  replay,
  infer = inferDiversions,
  complete = completeDiversionCapture,
  publish = async () => { },
  checkpointPath,
  clock = () => new Date(),
  log = () => { },
  signal,
  windowMs = PROCESSOR_WINDOW_MS,
  maxIterations = Infinity,
  advisories,
  writeCheckpoint: writeCheckpointImpl = writeCheckpoint
}) {
  if (!store || typeof store.list !== 'function') throw new Error('Processor requires a capture store');
  if (typeof replay !== 'function') throw new Error('Processor requires a replay function');
  if (!checkpointPath) throw new Error('Processor requires a checkpointPath');

  const loaded = await loadStatic({ now: clock(), log });
  const index = loaded.index;

  let checkpoint = await readCheckpoint(checkpointPath);
  let reset = false;
  // A checkpoint whose static version differs from the current index cannot be
  // reused: reset explicitly and warm up from empty rather than bridging an
  // unsupported gap or waiting indefinitely.
  if (checkpoint && checkpoint.staticVersion !== index.version) {
    log({ source: 'ttc-processor', status: 'static-reset', from: checkpoint.staticVersion, to: index.version });
    checkpoint = undefined;
    reset = true;
  }
  let cursor = checkpoint ? checkpoint.cursor : -1;
  let vehicle = checkpoint?.state?.vehicle;
  let inference = checkpoint?.state?.inference;

  let processed = 0, rejected = 0, windows = 0;
  // The in-flight three-minute evaluation window is durable state: a restart
  // resumes the same window instead of reopening it, so a window split across
  // runs is completed exactly once.
  let windowIndex = checkpoint?.state?.window?.index ?? null;
  let windowHealthy = checkpoint?.state?.window?.healthy ?? true;
  let windowCount = checkpoint?.state?.window?.count ?? 0;

  // Persist the full durable state (vehicle + inference + in-flight window) with
  // the consumed cursor as one atomic unit, so state and cursor always come from
  // the same write.
  const persist = () => writeCheckpointImpl(checkpointPath, {
    state: {
      vehicle, inference,
      window: windowIndex === null ? null : { index: windowIndex, healthy: windowHealthy, count: windowCount }
    },
    cursor,
    staticVersion: index.version
  });

  // Close the current window: complete once per window, persist the completed
  // counters, then apply wall-clock expiry and publish. An unavailable or
  // incomplete window is completed with `healthy:false` so it never increments
  // healthy absences. The completed state is made durable before the output is
  // emitted so a crash cannot double-advance the counters.
  const closeWindow = async () => {
    if (windowIndex === null) return;
    const closedIndex = windowIndex, closedCount = windowCount, closedHealthy = windowHealthy;
    const healthy = closedHealthy && closedCount >= CAPTURES_PER_WINDOW;
    const completed = complete(inference, { healthy, sourceHealthy: closedHealthy });
    inference = completed.state;
    windows++;
    windowIndex = null; windowHealthy = true; windowCount = 0;
    await persist();
    const output = applyWallClockExpiry(completed.output, clock());
    await publish(output);
    log({ source: 'ttc-processor', status: 'window', window: closedIndex, polls: closedCount, healthy, published: output.diversions.length });
  };

  const captures = await store.list({ afterSequence: cursor });
  for (const capture of captures) {
    if (signal?.aborted || processed >= maxIterations) break;
    const now = new Date(capture.requestedAt);
    const wi = Math.floor(+now / windowMs);
    if (windowIndex !== null && wi !== windowIndex) await closeWindow();
    windowIndex = wi;
    windowCount++;
    if (!AVAILABLE_OUTCOMES.includes(capture.outcome)) windowHealthy = false;
    try {
      const replayed = replay(capture, { previous: vehicle, index, now });
      vehicle = replayed.state;
      const inferred = infer(inference, vehicle, index, now, undefined, { advisories });
      inference = inferred.state;
      processed++;
    } catch (error) {
      // A rejected capture is counted and skipped; the cursor still advances so a
      // poison capture cannot wedge the processor forever.
      rejected++;
      log({ source: 'ttc-processor', status: 'rejected', sequence: capture.sequence, error: error.message });
    }
    cursor = capture.sequence;
    await persist();
  }
  // A graceful shutdown closes the final (possibly incomplete) window. A normal
  // drain end leaves the window open and persisted so the next drain resumes it.
  if (signal?.aborted) await closeWindow();
  return { processed, rejected, cursor, windows, reset };
}
