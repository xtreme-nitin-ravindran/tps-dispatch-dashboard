// Story 64 — private health reporting (Piece 6).
//
// The collector/processor services each expose a private health snapshot. A
// single `healthSnapshot` reducer aggregates the four components — the collector
// (capture), the processor (processing), the capture spool, and the R2 sink
// (publication) — into a Health object that reports the three concerns
// independently:
//
//   - `capture`: is the collector polling and committing captures?
//   - `processing`: is the processor consuming captures and advancing the cursor?
//   - `publication`: is the R2 publication sink reachable?
//
// The three sub-reports are deliberately independent: a source that is
// temporarily unavailable (capture degraded) must never be conflated with the
// processor being healthy, a failed publication, or zero results. Health is a
// private operational signal, not a public data surface, so a snapshot never
// exposes vehicle positions, geometry, or other evidence.
//
// Each component is described by a plain snapshot object with a `status` in the
// three-value vocabulary below plus whatever detail fields the caller wants
// surfaced. `healthSnapshot` normalizes the status and assembles the three
// independent reports without making the caller do the aggregation.

// The three-value status vocabulary. Anything outside it is coerced to
// `unavailable`, so an unexpected/garbage status degrades loudly rather than
// being reported as healthy.
export const HEALTH_STATUSES = Object.freeze(['ok', 'degraded', 'unavailable']);

// Coerce a component status into the vocabulary. `ok` and `degraded` pass
// through; anything else (including missing, null, or an unknown string) becomes
// `unavailable`.
export function coerceStatus(status) {
  if (status === 'ok' || status === 'degraded') return status;
  return 'unavailable';
}

// A component snapshot is `{ status, ...detail }`. `coerceStatus` normalizes the
// status; the caller's detail fields are surfaced unchanged so the snapshot
// remains a faithful report of the underlying component.
const report = (component) => {
  const { status, ...detail } = (component && typeof component === 'object') ? component : {};
  return { status: coerceStatus(status), ...detail };
};

// Aggregate the four component snapshots into a Health object with the three
// concerns reported independently. `spool` folds into `capture` (spool depth is
// part of capture health, not publication), and `r2` maps to `publication`.
export function healthSnapshot({ collector, processor, spool, r2 } = {}) {
  const capture = report(collector);
  // Spool depth contributes to capture health as an additive signal, without
  // overwriting the collector's own status: a saturated spool can only degrade
  // an otherwise-ok capture report.
  if (spool && typeof spool === 'object' && typeof spool.depth === 'number' && spool.depth > 0 && capture.status === 'ok') {
    capture.status = 'degraded';
  }
  if (spool && typeof spool === 'object') capture.spoolDepth = spool.depth;
  const processing = report(processor);
  const publication = report(r2);
  return { capture, processing, publication };
}
