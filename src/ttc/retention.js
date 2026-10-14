// Story 64 — durable R2 raw-capture retention and cleanup.
//
// Piece 5 owns the bounded lifetime of the two private R2 archives:
//
//   - Raw captures (and their capture indexes / replay context): a six-hour
//     rolling window, cleaned hourly, for a normal maximum physical age of seven
//     hours. Cleanup is replay-cursor-aware: objects the processor has not yet
//     consumed are retained *within* the retention window, but a stuck consumer
//     cannot pin raw data forever — at six hours it is expired and the lost
//     replay range is recorded so the caller can require an explicit recovery
//     reset.
//   - Failure/diagnostic bundles (Story 57): capped at 24 hours and 256 MB total,
//     oldest first.
//
// The prefix-scoped one-day R2 lifecycle rule is only an asynchronous safety
// net for when the cleaner stops; it is *not* a strict six-hour guarantee, so
// the oldest-object age is exposed for monitoring.
//
// Cleanup is scoped to the private `ttc-captures/` and `ttc-diagnostics/`
// prefixes only. It never deletes public production objects (`data/*`), unrelated
// data, another project's bucket, or checkpoint/static configuration, which live
// under separately scoped prefixes.

import { captureKey } from './capture-store.js';

// Rolling raw-capture retention: six hours.
export const RAW_RETENTION_MS = 6 * 3600 * 1000;

// Failure/diagnostic bundle retention: 24 hours.
export const DIAGNOSTIC_RETENTION_MS = 24 * 3600 * 1000;

// Failure/diagnostic bundle storage cap: 256 MB total, oldest first.
export const MAX_DIAGNOSTIC_BYTES = 256 * 1024 * 1024;

// The private prefixes cleanup may ever touch. Public production objects live
// under `data/` (and other project prefixes) and are never in this scope.
const RETAIN_SCOPE_PREFIXES = Object.freeze(['ttc-captures/', 'ttc-diagnostics/']);

// A monotonic epoch-millisecond value from a Date, a number, or an ISO string.
const epochMs = now => +new Date(now);

// True when a key is inside one of the private retention-scoped prefixes. This is
// the load-bearing guard against touching public production objects.
export function isRetentionScopeKey(key) {
  return typeof key === 'string' && RETAIN_SCOPE_PREFIXES.some(prefix => key.startsWith(prefix));
}

// Pure: decide which raw captures are expired given UTC age, the replay cursor
// and the retention window. Each object carries at least `completedAt` (an ISO
// timestamp used for age) and `sequence`; an optional `key` is checked against
// the retention scope so a public object is never deleted.
//
// Returns:
//   - `delete`: expired objects (oldest-agnostic; the caller preserves order).
//   - `keep`: objects still within retention, plus any out-of-scope object.
//   - `lostRange`: `{ from, to }` (inclusive sequence bounds) of expired objects
//     the cursor still needed, or `null` when nothing was lost. A non-null
//     `lostRange` is the signal that an explicit recovery reset is required.
export function planCleanup({ objects, now, cursor = -1, retentionMs = RAW_RETENTION_MS }) {
  const nowMs = epochMs(now);
  let lostFrom = null;
  let lostTo = null;
  const deleteList = [];
  const keepList = [];
  for (const object of objects) {
    const ageMs = nowMs - Date.parse(object.completedAt);
    const expired = ageMs >= retentionMs;
    const unconsumed = object.sequence > cursor;
    const outOfScope = object.key !== undefined && !isRetentionScopeKey(object.key);
    if (expired && !outOfScope) {
      deleteList.push(object);
      if (unconsumed) {
        if (lostFrom === null) {
          lostFrom = object.sequence;
          lostTo = object.sequence;
        } else {
          lostFrom = Math.min(lostFrom, object.sequence);
          lostTo = Math.max(lostTo, object.sequence);
        }
      }
    } else {
      keepList.push(object);
    }
  }
  return {
    delete: deleteList,
    keep: keepList,
    lostRange: lostFrom === null ? null : { from: lostFrom, to: lostTo }
  };
}

// Pure: decide which failure/diagnostic bundles expire or are evicted, oldest
// first. Each object carries `recordedAt` (an ISO timestamp used for age) and
// `bytes` (stored size). Age-expired bundles are always deleted; if the retained
// set still exceeds `maxBytes`, the oldest remaining bundles are evicted until it
// is within the cap. Returns `{ delete, keep }` with `delete` oldest-first.
export function planDiagnosticRetention({ objects, now, retentionMs = DIAGNOSTIC_RETENTION_MS, maxBytes = MAX_DIAGNOSTIC_BYTES }) {
  const nowMs = epochMs(now);
  const byAge = [...objects].sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
  const expired = byAge.filter(object => nowMs - Date.parse(object.recordedAt) >= retentionMs);
  const current = byAge.filter(object => nowMs - Date.parse(object.recordedAt) < retentionMs);
  const evicted = [];
  let total = current.reduce((sum, object) => sum + object.bytes, 0);
  for (const object of current) {
    if (total <= maxBytes) break;
    evicted.push(object);
    total -= object.bytes;
  }
  return { delete: [...expired, ...evicted], keep: current.filter(object => !evicted.includes(object)) };
}

// Pure: the age in milliseconds of the oldest retained object, or `null` when
// there are none. This is the lifecycle safety-net monitor: it reports when the
// oldest object is drifting past the retention window (because cleanup or the
// one-day R2 lifecycle rule has not kept up). Accepts raw captures (`completedAt`)
// or diagnostic bundles (`recordedAt`).
export function oldestObjectAge({ objects, now }) {
  if (objects.length === 0) return null;
  const nowMs = epochMs(now);
  const timestamps = objects.map(object => Date.parse(object.completedAt ?? object.recordedAt));
  return nowMs - Math.min(...timestamps);
}

// Orchestrate one hourly cleanup pass over the raw capture store. Lists committed
// captures and any still-pending local spool entries, plans expiry against the
// replay cursor, deletes expired objects (R2 `.json`/`.pb` plus the local spool
// entry) via `store.remove`, and reports the outcome. A non-null `lostRange`
// means a stuck consumer was pinned and an explicit recovery reset is required.
export async function runCleanup({ store, spool, now, cursor = -1, log = () => { }, feedId = 'ttc-vehicles' }) {
  if (!store || typeof store.list !== 'function' || typeof store.remove !== 'function') {
    throw new Error('Cleanup requires a capture store with list and remove');
  }
  const committed = await store.list({ afterSequence: -1 });
  const pending = await spool.list(feedId);

  // Union committed and pending by sequence so a half-flushed capture is planned
  // and deleted exactly once.
  const bySequence = new Map();
  for (const capture of committed) bySequence.set(capture.sequence, capture);
  for (const { capture } of pending) if (!bySequence.has(capture.sequence)) bySequence.set(capture.sequence, capture);

  const objects = [...bySequence.values()].map(capture => ({
    key: captureKey(feedId, capture.sequence),
    completedAt: capture.completedAt,
    sequence: capture.sequence
  }));

  const plan = planCleanup({ objects, now, cursor });
  for (const object of plan.delete) {
    await store.remove(object.sequence);
  }
  log({ source: 'ttc-retention', status: 'cleanup', deleted: plan.delete.length, retained: plan.keep.length, lostRange: plan.lostRange });
  return { deleted: plan.delete.length, retained: plan.keep.length, lostRange: plan.lostRange };
}
