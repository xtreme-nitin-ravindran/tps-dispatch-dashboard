# Story 64 — Continuous TTC Capture with Durable R2 Replay — Implementation Plan

Status: APPROVED PLAN (October 13, 2026). Design only; no application code written.
This document is the shared plan for every Story 64 implementation session. Read it
together with the Story 64 section of `.continue/rules/SirenTO-Development-Roadmap.md`.

## 0. Purpose of this document

Story 64 is too large for a single chat session. This file is the durable handoff so
each session reads the same plan instead of reconstructing it from chat history. It
records the dependency order, per-piece interfaces and TDD cycles, the invariants that
need dedicated regression tests, the approved policy decisions, and the session split.

## 1. Scope summary

Story 64 wraps the existing Story 57 failure-only diagnostic artifact in durable
private R2 transport and retention, and adds two long-running Node services (collector
and processor) around the existing parser, detector, inference, advisory normalization
and publication code. It supports Story 57 without closing it.

Reuse (do not reimplement): `src/ttc/vehicle-feed.js`, `vehicle-detector.js`,
`diversion-inference.js`, `static-source.js`, `official-advisories.js`,
`scripts/ttc-vehicles.js`, and the existing R2 publication sink
(`scripts/lib/publication-sink.js`). Reuse the Story 57 diagnostic helpers
(`diversionValidationDiagnostic`, `writeDiversionDiagnostic`, `error.rejectedState`).

## 2. Approved policy decisions

- **Fixed three-minute evaluation windows** for the existing two-fresh/eight-healthy-
  absence counters. Independent of poll count, restarts and publication frequency.
  Unavailable or incomplete windows must not increment healthy absences. This is a
  nominal policy choice, not a claim to preserve the old variable 3m35s runtime.
- **Six-hour raw retention** with hourly cleanup (normal seven-hour physical-age bound).
- **Failure bundles capped at 24 hours and 256 MB total**, oldest first.
- **Mac VM for development**; an always-available VM is required for production
  acceptance. Development, deterministic replay, cleanup and functional map validation
  can proceed before the production VM exists.
- **Alert-correlated acceptance only where sufficient independent vehicle evidence
  exists.** Alerts alone never confirm a path.

## 3. Dependency order

```
1. Capture contract + durable capture store
   ├──> 2. Collector service
   └──> 3. Processor service
          ├──> 4. Failure-path R2 archival (Story 57 bundle)
          └──> 5. Retention / cleanup + lifecycle safety net
                 └──> 6. Ownership interlock + health + Compose
```

Rationale:

- **1 before 2 and 3.** The capture record shape is the shared contract; both the
  collector (writer) and processor (reader) depend on it.
- **2 before 3.** The collector is the simpler producer and gives the processor real
  captures to consume. Piece 3 depends on piece 1's ordering/discovery guarantee.
- **4 depends on 3.** The failure path lives inside the processor's inference call and
  must be persisted before teardown.
- **5 depends on 1 and 3.** Retention must respect the replay cursor and checkpoint/
  static dependencies.
- **6 is last.** The interlock guards concurrent publishers, which only exist once 2
  and 3 run.

Cross-cutting: the fixed three-minute evaluation window is a policy change **inside
piece 3** (it changes when `completeDiversionCapture` is called), not a separate piece.

## 4. Per-piece interfaces and TDD cycles

### Piece 1 — Capture contract + durable capture store

Interface (proposed):

```js
// src/ttc/capture-store.js
export const CAPTURE_SCHEMA_VERSION = 1;

// Pure: build an immutable capture record from a fetch outcome.
export function buildCapture({ feedId, sequence, requestedAt, completedAt,
  sourceUpdatedAt, bytes, contentHash, outcome, schemaVersion }) -> Capture

// Pure: validate a capture record (rejects malformed/oversized).
export function validateCapture(capture) -> void   // throws

// Durable write: local spool first, then R2 PUT. Returns durability state.
export async function commitCapture(capture, { spool, sink }) -> { durable: boolean, key }

// Ordered discovery that cannot silently skip a late upload.
export async function listCommitted({ sink, afterSequence, limit }) -> Capture[]
```

Contract points:

- `outcome` ∈ `{ok, empty, unavailable, error}`. Identical-feed attempts are health
  metadata, not new vehicle evidence.
- `contentHash` is over the raw protobuf bytes.
- `durable:false` means "pending local spool entry, not yet R2-durable".
- Discovery is sequence-ordered with a bounded lookback so a late upload is found.

**Identical-feed rule (explicit).** New vehicle evidence requires a different
`contentHash`. `sourceUpdatedAt` alone never establishes new evidence. Identical hash
with a different timestamp is an identical-feed attempt (health metadata). Different
hash with identical positions is still new evidence (the bytes changed). The golden
fixture must encode all cases:

| Case | contentHash | sourceUpdatedAt | Classification |
|---|---|---|---|
| A | identical | identical | Duplicate — health metadata only |
| B | identical | different | Identical feed, new timestamp — health metadata only |
| C | different | identical | New evidence — content changed despite same source timestamp |
| D | different | different | New evidence — normal advance |
| E | identical | different, positions identical | Identical feed — same as B; hash is the discriminator, not positions |

TDD cycles:

1. `buildCapture` golden fixture covering cases A–E.
2. `validateCapture` rejects malformed/oversized/non-monotonic.
3. `commitCapture` spool-first; R2 failure → `durable:false`, spool intact.
4. `commitCapture` success → `durable:true`, spool cleared.
5. `listCommitted` sequence-ordered, finds late lower-sequence upload.
6. `listCommitted` no double-return across calls with same cursor.

### Piece 2 — Collector service

Interface (proposed):

```js
// src/ttc/collector.js
export async function runCollector({
  intervalMs = 30000,          // monotonic schedule, not setInterval drift
  fetchFeed = fetchTtcVehicles,
  store,                       // piece 1
  clock = () => new Date(),
  wait = sleep,
  log = () => {},
  signal,                      // graceful shutdown
  maxIterations = Infinity     // test seam
}) -> { polls, gaps, spoolDepth }
```

Contract points:

- Monotonic schedule: next poll target = `start + n*intervalMs`, not `now + intervalMs`.
- Bounded requests: one in-flight fetch; no overlap.
- Alert/static refresh and public uploads must not block collection.
- Spool saturation is bounded and alerted, not silently dropped.
- Unavoidable observation gaps are reported, never treated as zero results.

TDD cycles:

1. Fake clock, N iterations fire at exactly `start + n*30000`.
2. Slow fetch does not overlap; next poll on schedule.
3. Fetch failure → `outcome:error`, collector continues, gap recorded.
4. Identical feed twice → health metadata, not new evidence.
5. Spool saturation → bounded, alert, oldest pending reported.
6. Graceful shutdown flushes spool.
7. **Drift measurement over a long run.** Record actual start times for a long
   simulated run; assert ≥99% of polls start within 10s of target; emit structured gap
   records (start, target, delta, cause) for every poll outside tolerance and for every
   unexplained gap >60s. The telemetry is the deliverable, not just the assertion.

### Piece 3 — Processor service

Interface (proposed):

```js
// src/ttc/processor.js
export async function runProcessor({
  store,                       // piece 1
  loadStatic = loadStaticGtfs,
  infer = inferDiversions,
  complete = completeDiversionCapture,
  publish,                     // existing R2 sink
  checkpointPath,
  clock = () => new Date(),
  log = () => {},
  signal
}) -> { processed, rejected, cursor }

// Checkpoint = state + consumed cursor, written atomically together.
export async function writeCheckpoint(path, { state, cursor, staticVersion })
export async function readCheckpoint(path) -> { state, cursor, staticVersion } | undefined
```

Contract points:

- Checkpoint and cursor are persisted together as one atomic unit, with the previous
  compatible checkpoint retained for recovery.
- Reprocessing after a crash is idempotent, including public output and Story 57
  counters.
- Preserve original capture/source times during replay, then apply wall-clock expiry
  before publication. Never advertise replayed old samples as new.
- Capture static version + timestamped advisory/GTFS-RT context for deterministic
  replay; reference unchanged versions rather than duplicating ZIPs.
- If history/context is gone or incompatible → explicit reset + warm-up, never bridge
  unsupported gaps or wait indefinitely.
- Fixed three-minute evaluation window (approved policy). Unavailable/incomplete
  windows must not increment healthy absences.

TDD cycles:

1. Single capture → inference, checkpoint written, cursor advanced.
2. Crash after inference, before checkpoint → replay identical output + counters.
3. Duplicate capture → processed once semantically.
4. Out-of-order upload → ordered, not skipped.
5. Static version mismatch → explicit reset + warm-up.
6. Three-minute window: 6 polls = one window.
7. Unavailable/incomplete window → healthy absences unchanged.
8. Replayed old sample → expiry before publication.
9. **Checkpoint atomicity.** Kill the process during `writeCheckpoint` (mid-write,
   after temp write, before rename). On restart the checkpoint is either the previous
   complete checkpoint or the new complete checkpoint, never partial. Assert the
   state+cursor pair is always mutually consistent (no state from one write with cursor
   from another). Test both the temp-file and rename boundaries.

### Piece 4 — Failure-path R2 archival (Story 57 diagnostic bundle)

Interface (proposed):

```js
// src/ttc/diagnostic-archive.js
export async function archiveDiagnostic(bundle, { sink, spool, now }) -> { durable, key }

// Enriches the existing writeDiversionDiagnostic payload with replay inputs.
export function buildDiagnosticBundle({ error, index, capture, checkpoint,
  buildVersion, staticVersion, logicalClock, advisoryRefs }) -> Bundle
```

Contract points:

- Reuses `diversionValidationDiagnostic`, `writeDiversionDiagnostic`,
  `error.rejectedState`; no duplicate capture logic.
- Bundle includes build/image version, static version, logical clock, pre-transition
  checkpoint/cursor, triggering capture identity, advisory/alert-context references.
- Oversize → `state:null, truncated:true`, bundle labelled incomplete, never claims
  exact replay.
- Preserves the original processing failure; archival failure must not mask it.
- Failure-only; inert on the happy path.
- Never turns malformed geometry into accepted geometry.

TDD cycles:

1. Validation failure → bundle archived to R2, original error still thrown.
2. R2 failure during archival → retry via spool, original error preserved.
3. Oversize state → `truncated:true`, `state:null`, bundle marked incomplete.
4. Happy path → archival never invoked (inert).
5. Bundle contains all replay inputs.
6. Complete bundle + pre-transition state reproduces the known validator error in
   canonical Docker (the narrow regression).

### Piece 5 — Retention / cleanup + lifecycle safety net

Interface (proposed):

```js
// src/ttc/retention.js
export async function runCleanup({ store, spool, now, cursor, log }) -> { deleted, retained, lostRange }

// Pure: decide what is expired given UTC age + cursor + dependencies.
export function planCleanup({ objects, now, cursor, retentionMs = 6*3600*1000 }) -> { delete: [], keep: [] }
```

Contract points:

- Six-hour rolling retention, hourly cleanup → normal max physical age seven hours.
- Cleanup respects the replay cursor within retention, but a stuck consumer cannot
  retain raw data indefinitely. At six hours → expire, record the lost replay range,
  require explicit recovery reset.
- Never deletes public production objects, unrelated data, another project's bucket, or
  currently required configuration.
- Checkpoint/static dependencies kept under separately scoped prefixes.
- Failure bundles capped at 24h / 256 MB, oldest first.
- UTC age arithmetic verified; Toronto midnight/DST cases.
- Prefix-scoped one-day R2 lifecycle is a safety net only (asynchronous, not a strict
  six-hour guarantee). Monitor oldest-object age.

TDD cycles:

1. `planCleanup` at 6h boundary → deletes expired, keeps current.
2. At 7h → all raw expired, lost range recorded.
3. Cursor inside retention → cleanup does not delete objects the cursor still needs.
4. Stuck cursor past 6h → expire + lost range + recovery reset required.
5. DST/midnight: 23:59 yesterday still current at 00:01.
6. Cleanup never touches public production prefix.
7. Failure bundle > 256 MB → oldest-first eviction.
8. Lifecycle safety net: oldest-object age monitored.

### Piece 6 — Ownership interlock + health endpoints + Compose deployment

Interface (proposed):

```js
// src/ttc/ownership.js
export async function acquireOwnership({ sink, ownerId, ttlMs }) -> { acquired, holder }
export async function renewOwnership({ sink, ownerId, ttlMs }) -> boolean
export async function releaseOwnership({ sink, ownerId }) -> void

// src/ttc/health.js
export function healthSnapshot({ collector, processor, spool, r2 }) -> Health
```

Contract points:

- One active collector, one authoritative processor. Enforced ownership prevents
  accidental concurrent production publishers.
- Health endpoints are private and report capture/processing/publication health
  separately.
- Graceful shutdown and automatic process restart.
- Development uses isolated R2 state/output and must never compete with the production
  writer.
- Rollback to previous image + compatible checkpoint with exactly one writer.

TDD cycles:

1. Second processor cannot acquire ownership while first holds it.
2. Ownership TTL expiry → stale holder can be taken over.
3. Health snapshot reports capture/processing/publication independently.
4. Dev config points at isolated prefix; cannot acquire production ownership.
5. Graceful shutdown releases ownership.
6. Rollback: previous checkpoint + previous image → single writer, correct state.

## 5. Invariants needing dedicated regression tests

**Idempotency**

- Replay after crash produces byte-identical public output and identical Story 57
  counters.
- Duplicate capture (same content hash) is processed once semantically; no duplicated
  support or persistence counters.
- Repeated source samples do not earn persistence.
- `completeDiversionCapture` is called once per evaluation window, not once per poll.
- Diagnostic archival is idempotent; re-archiving the same failure does not create
  duplicate bundles or mask the original error.

**Ownership**

- Exactly one authoritative publisher at any time.
- Development never competes with the production writer.
- Stale ownership (TTL expiry) is recoverable without two concurrent writers.
- Rollback preserves the single-writer guarantee.
- Cleanup never deletes another project's bucket or public production objects.

**Retention**

- Six-hour boundary deletes expired, keeps current; seven-hour boundary records lost
  range.
- Cleanup respects the replay cursor within retention.
- Stuck consumer past six hours → expire + lost range + explicit recovery reset.
- UTC age arithmetic correct across Toronto midnight/DST.
- Failure bundles capped at 24h / 256 MB, oldest first.
- Yesterday's stale history never reappears as current output.
- Public geometry expiry (≤30 min) remains authoritative even if the object still
  exists; cleanup and inference/public/browser expiry are independent.
- Source unavailable ≠ zero diversions, preserved through cleanup and replay.

**Atomicity**

- Checkpoint is always previous-or-new, never partial.
- State+cursor pair is mutually consistent across a mid-write kill.

**Telemetry**

- ≥99% of polls start within 10s of target over a long run.
- Structured gap records emitted for out-of-tolerance polls and unexplained gaps >60s.

**Cross-cutting**

- Preserve original capture/source times during replay, then apply wall-clock expiry
  before publication.
- Never advertise replayed old samples as new.
- Malformed geometry is never turned into accepted geometry by loosening validation.
- Alerts alone never confirm a path; observed paths without an official alert remain
  SirenTO-observed.

## 6. Session split

| Session | Scope | Ends when |
|---|---|---|
| S1 | Piece 1 (capture contract + store) + Piece 2 (collector) | Both merged to `dev`, `npm run verify` green, roadmap updated |
| S2 | Piece 3 (processor + checkpoint atomicity + 3-min window) | Merged, verify green |
| S3 | Piece 4 (failure-path R2 archival) + Piece 5 (retention/cleanup) | Merged, verify green |
| S4 | Piece 6 (ownership + health + Compose) — code only, dev VM | Merged, verify green; deployment IMPLEMENTED / AWAITING VALIDATION |
| S5+ | Production acceptance: VM, 24h trial, live TTC cases, validator regression | Story 64 → DONE |

Rationale:

- S1 pairs 1+2 because the collector is the first real consumer of the capture
  contract; building them together proves the contract against a real writer.
- S3 pairs 4+5 because retention must respect the replay cursor and the failure bundle
  is one of the things retention manages.
- S4 is separate because it is the only piece that touches deployment; it lands as
  "code done, deployment pending" so it does not block the pure-code sessions.

## 7. Context transfer between sessions

1. The roadmap is the handoff. Each session ends by updating the Story 64 section of
   `.continue/rules/SirenTO-Development-Roadmap.md` with a completion handoff: what
   changed, what is verified, what is outstanding, and a **Known local facts** block.
2. This plan is the shared plan. Every session reads it instead of reconstructing the
   plan from chat history.
3. Each session's opening prompt points at this plan + the roadmap Story 64 section,
   plus a short Known local facts block carried forward.
4. Do not carry transient observations forward; only stable facts (contract shapes,
   fixture IDs, exact commands).

## 8. Open items / gates

- The narrow validator regression (reproduce the known `Invalid TTC diversion output`
  failure) is a prerequisite to production cutover, not to starting S1. It is piece 4,
  cycle 6.
- Piece 6 deployment is gated on the always-available VM for production acceptance;
  the interlock/health code can be built and tested on the Mac dev VM.
- Production VM capacity/operating budget and source limits/cadence must be validated
  before production deployment.
