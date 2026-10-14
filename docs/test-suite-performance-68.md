# Test-suite performance baseline (Story 68A)

**Status:** 68A baseline captured (documentation only). 68B results appended below
(see "68B — Node offline-suite concurrency tuning").

**Purpose.** Record a reproducible wall-clock and per-stage baseline for the
SirenTO test suites so that later test growth and any Story 68 optimization
(68B-68D) can be measured against a fixed reference. This document makes **no
speedup claim**; it only records what is slow *now*.

## Environment

| Item | Value |
| --- | --- |
| Host | macOS arm64, 14 CPU, 36 GB RAM |
| Host Node | v26.10.0 |
| Container CPU (`nproc`) | 4 |
| Container RAM | ~15.6 GB |
| Container Node | v24.21.0 |
| Docker test image | `toronto-dispatch-tests` |
| Image fingerprint | `0defafb35844e6736f575e0ea547429d650dd3f8e0be34774ad18297f5938bea` (current) |
| Playwright (host only) | 1.63.0 (not in the Docker image) |
| Browser server | `npm run test:browser` owns loopback `127.0.0.1:8765` |

## Method

- All Docker-backed commands run through the canonical wrapper
  `scripts/docker-test.sh` (never a bare `docker run`), so the current working
  tree is mounted read-only over the image's `/workspace`.
- **Image state: WARM.** The image already existed and its fingerprint was
  current, so no rebuild occurred. Cold-build time is the `--ensure-image` build
  path and is not re-measured here (it is a one-time cost, not part of steady
  state).
- `scripts/verify.sh` does **not** print per-stage durations (its parallel
  scheduler logs only `started`/`passed`). Per-stage times below were therefore
  derived by running `VERIFY_JOBS=1` (sequential) and timestamping the
  scheduler's own `started`/`passed` markers. No timing tooling was added.
- Browser per-suite times reuse the existing timing spans
  (`scripts/lib/browser-timing.js`) via `BROWSER_TIMING=json npm run test:browser`.
- Repetitions: `verify:fast` x2, `verify` (parallel) x3, `verify` (sequential)
  x1, `npm test` x1, `test:coverage` x1, `test:browser` x2.

## Test inventory

| Category | Count |
| --- | --- |
| `test/*.test.js` (all) | 114 |
| `test/*.integration.test.js` (live source) | 8 |
| Offline canonical suite (`test/*.test.js` minus integration) | 106 |
| `test:*:browser` package scripts | 8 |
| Tests reported by the runner (offline suite) | **1275** |

> Correction to the prior handoff: the offline suite is **106 files / 1275
> tests**; `114` is the *total* `test/*.test.js` count (106 offline + 8
> integration).

## Stage timings

### `npm run verify:fast` (warm, sequential)

| Run | Wall-clock | Runner `duration_ms` |
| --- | --- | --- |
| 1 | 27 s | 23 903 |
| 2 | 26 s | 22 660 |

### `npm run verify` - parallel (default `VERIFY_JOBS=4`)

| Run | Wall-clock | Coverage job |
| --- | --- | --- |
| 1 | 46 s | **FAILED** (99.98 %) |
| 2 | 45 s | **FAILED** (99.98 %) |
| 3 | 43 s | passed |

### `npm run verify` - sequential (`VERIFY_JOBS=1`), per-stage

| Stage | Duration |
| --- | --- |
| lint | ~1 s |
| requirement-coverage | ~1 s |
| javascript-syntax | <1 s |
| unit-los-angeles | ~26 s |
| python | ~2 s |
| integration | ~3 s |
| coverage (UTC + 100 % gate) | ~40 s |
| **Total wall-clock** | **74 s** |

### `npm test` and `npm run test:coverage` (isolated, warm)

| Command | Wall-clock | Runner `duration_ms` | Tests |
| --- | --- | --- | --- |
| `npm test` (TZ=America/Los_Angeles) | 23 s | 22 861 | 1275 |
| `npm run test:coverage` (TZ=UTC, 100 % gate) | 38 s | 37 526 | 1275 |

### `npm run test:browser` (warm)

| Run | Wall-clock | Result |
| --- | --- | --- |
| 1 | 146 s | all 8 suites passed |
| 2 | 17 s | `test:story-39a:browser` failed (cold-start `waitForFunction` 5 s timeout) |

Per-suite spans (run 1, from `BROWSER_TIMING=json`):

| Suite | Duration |
| --- | --- |
| `test:ttc-ui:browser` | 97 879 ms |
| `test:story-43:browser` | 13 816 ms |
| `test:story-40e:browser` | 10 740 ms |
| `test:story-42:browser` | 9 694 ms |
| `test:call-refresh:browser` | 5 687 ms |
| `test:road-closure-mobile:browser` | 3 023 ms |
| `test:story-39a:browser` | 2 568 ms |
| `test:road-closure-count:browser` | 2 010 ms |
| `server-ready` | 106 ms |
| **Total (spans)** | **145 523 ms** |

## Critical path and top stages

- **Full `npm run verify` critical path:** the `coverage` job (~40 s) is the
  longest single stage; with `VERIFY_JOBS=4` the wall-clock is bounded by the
  longest job plus image-ensure overhead (~43-46 s). Sequential total is ~74 s.
- **Top time-consuming stages overall:**
  1. `test:ttc-ui:browser` - ~98 s (dominated by the deliberate ~61 s fixed wait
     in `scripts/ttc-ui-browser.js`; subject of increment 68C).
  2. `coverage` (UTC + 100 % gate) - ~40 s.
  3. `unit-los-angeles` - ~26 s.
  4. `npm test` (LA) - ~23 s.
- The offline suite runs **twice** in full `verify` (LA + UTC coverage), so the
  ~23-40 s unit cost is paid twice.

## Variability and observations

- `verify:fast` is stable (26-27 s).
- Parallel `verify` wall-clock is stable (43-46 s) but the **coverage gate is
  intermittent** (see below).
- Browser total is dominated by the TTC suite; the other seven suites together
  are ~46 s.

## Pre-existing issues observed (NOT caused by 68A)

1. **Intermittent coverage gate on clean `dev`.** Of three parallel `verify`
   runs on an unmodified tree, the `coverage` job failed twice at
   **99.98 % line / 99.98 % branch** and passed once; the sequential run passed.
   The uncovered location is consistent: `scripts/ttc-vehicles.js` lines
   **143-145** (the `--infer-only` catch block that writes a diversion
   diagnostic). This matches the documented spawned-CLI subprocess-coverage
   flake class in `AGENTS.md`. It means `npm run verify` is **not reliably green
   on clean `dev`** and should be tracked as a separate follow-up (out of scope
   for 68A).
2. **Browser cold-start flake.** `test:story-39a:browser` failed once with a
   `page.waitForFunction: Timeout 5000ms exceeded` in
   `scripts/cluster-connectors-browser.js:42`; it passed on the other run. This
   is the cold-start class the `awaitFixtureReady` retry (Story 52E) targets.

## Reproduce

```sh
# Fast inner-loop (warm image)
npm run verify:fast

# Full verification, parallel (default) and sequential
npm run verify
VERIFY_JOBS=1 npm run verify

# Offline suite and coverage gate
scripts/docker-test.sh env TZ=America/Los_Angeles npm test
scripts/docker-test.sh env TZ=UTC NODE_V8_COVERAGE=/tmp/coverage npm run test:coverage

# Browser suites with per-suite timing spans
BROWSER_TIMING=json npm run test:browser
```

---

## 68B — Node offline-suite concurrency tuning

**Status:** IMPLEMENTED / AWAITING VALIDATION (October 13, 2026). Two changes,
both measured on the warm 4-CPU image.

### Finding 1 — the suite was never CPU-bound

The offline suite's ~22 s wall-clock was almost entirely **one** test:
`test/data-publication.test.js` → `[STORY-54][STORY-55E] the incident CLI fails
loudly without R2 credentials` took **21.3 s** in isolation. It writes a *stale*
snapshot, so `publishIncidents` runs the **real ETL** (`runTfsEtl` → live
TFS/TPS/roads/TTC fetches, each with a 30 s `AbortSignal.timeout`) before it
reaches `createSinkFromEnv()` and throws on the missing R2 credentials. That is
an offline canonical-suite test performing live integration, which violates the
canonical-suite / live-integration separation.

Per-file durations (isolated, `TZ=UTC`):

| File | Duration |
| --- | --- |
| `test/data-publication.test.js` | **21 653 ms** |
| `test/browser-suite-runner.test.js` | 2 800 ms |
| `test/eslint-tmp-ignore.test.js` | 1 521 ms |
| `test/ttc-diversions.test.js` | 1 472 ms |
| `test/tfs-etl.test.js` | 1 232 ms |
| every other offline file | < 600 ms |

### Fix 1 — stub the ETL in that test

Added the existing deterministic `fetchPreload` (already used by the other CLI
tests) via `--import preload`, so the ETL runs against in-memory stubs and the
test still asserts the same `/R2 publication requires/` failure.

| Scope | Before | After |
| --- | --- | --- |
| The no-creds test | 21 325 ms | **119 ms** |
| The whole `data-publication.test.js` file | 21 838 ms | **505 ms** |

This is a correctness fix (an offline test no longer touches the live network)
and the single largest suite speedup.

### Finding 2 — `--test-concurrency`

With the network-bound test removed, the suite became CPU/I/O-bound and
concurrency matters. Measured on the 4-CPU image (isolated suite, `TZ=UTC`):

| `--test-concurrency` | Isolated suite | Coverage run |
| --- | --- | --- |
| 1 | ~13 s | ~52 s |
| 2 | ~7 s | ~41 s |
| 3 (Node default = `availableParallelism()-1`) | 5.3-6.2 s | 8.0-9.4 s |
| **4 (chosen)** | **4.8-5.2 s** | **6.3-8.2 s** |
| 5 | 4.3-5.0 s | 5.8-7.4 s |
| 6 | ~6.9 s | — |
| 8 | ~6.6 s | — |
| 12 | ~25.8 s (pre-fix) | — |

Concurrency 4 (the CPU count) is repeatably at or near the best for both the
plain suite and the coverage run, and keeps the process count bounded when
`VERIFY_JOBS=4` runs several jobs at once. Values above the CPU count (5-8) are
within noise of 4 and never better.

### Fix 2 — pin `--test-concurrency=4`

`scripts/run-unit-tests.sh` now sets a single documented constant
(`TEST_CONCURRENCY=4`) passed to both the plain and coverage `node` invocations,
placed **before** `--test` so the existing `unit-suite-selection.test.js`
argument parser is unaffected. No sharding, no change to file selection, both
timezone checks, the live-integration separation, and the exact 100/100/100 gate
are preserved.

### Before / after (warm image, same host/container as 68A)

| Command | 68A baseline | 68B |
| --- | --- | --- |
| `npm test` (TZ=UTC) | 23.5 s | **5.4 s** |
| `npm run test:coverage` (TZ=UTC, 100 % gate) | 38 s | **6.8-7.9 s** |
| `npm run verify` parallel (`VERIFY_JOBS=4`) | 43-45 s | **11.6-15.0 s** |
| `VERIFY_JOBS=1 npm run verify` | 74 s | **20.7-23.5 s** |
| `npm run verify:fast` | 26-27 s | **7.7-8.0 s** |
| `npm test` (TZ=America/Los_Angeles) | 23 s | **8.2 s** |

Coverage gate stability: 5/5 consecutive `test:coverage` runs at 100/100/100.
The pre-existing `scripts/ttc-vehicles.js:143-145` flake did not reproduce in
these runs; it remains a separate follow-up. `npx eslint .` clean;
`git diff --check` clean.

### Files changed and rollback

- `scripts/run-unit-tests.sh` — pin `--test-concurrency=4`.
- `test/data-publication.test.js` — stub the ETL in the no-creds CLI test.

Rollback: revert the single `TEST_CONCURRENCY` constant to restore Node's
default; revert the test's `--import preload` to restore the live-ETL path.

---

## 68C — Replace the TTC 61-second fixed wait with deterministic clock emulation

**Status:** IMPLEMENTED / AWAITING VALIDATION (October 13, 2026).

### Finding — the TTC suite was dominated by one wall-clock wait

`scripts/ttc-ui-browser.js` ran `await page.waitForTimeout(61000)` at the
`width===390` case to exercise the app's real `setInterval(..., 60000)`
minute-tick (`src/app/app.js:3145`) and assert the periodic
`renderNearbySummary()` refresh does not clobber a focused TTC detail's summary
(`#mobileSheetSummary` stays `'504 King'`). That single wait made the suite
~98 s and the whole aggregate browser run ~146 s.

### Fix — Playwright `page.clock` emulation in an isolated page

The 61 s wait is removed from the six-width loop. A dedicated scenario installs
Playwright's fake clock **before** navigation (`page.clock.install({ time })`),
loads the deterministic fixture, selects the TTC diversion card (so
`focusedClosureId` is set and `#mobileSheetSummary` becomes `'504 King'`), then
advances the emulated clock exactly one minute with `page.clock.runFor(60000)`.
That fires the app's real `setInterval(..., 60000)` deterministically, and the
assertion is unchanged: the focused summary stays `'504 King'`.

The clock is installed only for this isolated page, so the six-width loop keeps
real time and Leaflet / fixture readiness are unaffected. The scenario uses
`mobileAuditView=calls` so the diversion card is visible (the diversion list is
shown in Calls view; the bottom-sheet summary is asserted by `textContent`, not
visibility).

### Before / after (warm image, same host/container as 68A/68B)

| Scope | 68A baseline | 68C |
| --- | --- | --- |
| `test:ttc-ui:browser` (isolated) | ~98 s | **~6.0-6.2 s** |
| `npm run test:browser` (aggregate) | ~146 s | **~90 s** |

The TTC suite span in the aggregate run is now ~42 s under load (the other seven
suites run first); in isolation it is ~6 s. The 61 s fixed wait is gone.

### Supporting changes

- `scripts/run-browser-suites.js` — removed the now-obsolete `LONG_SUITE_HINT`
  constant and its "deliberate ~61s wait" progress note (the suite is no longer
  long).
- `test/browser-suite-runner.test.js` — rewrote the `[STORY-47A]` test that
  asserted the 61 s hint was surfaced; it now asserts the TTC suite runs to
  completion (status 0) and that the obsolete hint is **not** emitted.
- `docs/browser-tests.md` — replaced the "deliberate 61-second wait" note with
  the clock-emulation description.

### Files changed and rollback

- `scripts/ttc-ui-browser.js` — remove the 61 s wait; add the clock-emulated
  scenario.
- `scripts/run-browser-suites.js` — remove `LONG_SUITE_HINT` and its note.
- `test/browser-suite-runner.test.js` — update the `[STORY-47A]` runner test.
- `docs/browser-tests.md` — update the TTC-suite note.

Rollback: restore the `await page.waitForTimeout(61000)` block in the loop,
restore `LONG_SUITE_HINT` and its note, and revert the runner test and doc note.

### Verification

- `npm run verify` (Docker, parallel) — all required checks passed, exact
  100/100/100 coverage.
- `scripts/docker-test.sh env TZ=UTC npm test` — 1275 tests pass.
- `scripts/docker-test.sh npx eslint .` — clean.
- `npm run test:browser` — all 8 suites passed.
- `test:ttc-ui:browser` — 3 consecutive isolated runs at ~6.0 s, exit 0.

---

## 68D — Browser-suite concurrency assessment, documentation, and close-out

**Status:** ASSESSED — concurrency **REJECTED** (October 13, 2026). No code
change. This section records the measurement, the decision, and the correction
to the 68C figure.

### Question

Is running the rendered-browser suites concurrently (instead of the current
sequential aggregate) a real, safe win on this machine? The 68D plan asked for
"one Chromium/server first; verify resource safety on a 4-CPU container".

### Where the browser suites actually run

The rendered-browser suites run on the **host**, not in the Docker test image
(the image intentionally has no Playwright/Chromium). The relevant resource
envelope is therefore the host, not the 4-CPU container:

| Item | Value |
| --- | --- |
| Host | macOS arm64, 14 CPU, 36 GB RAM |
| Playwright | 1.63.0 (host only) |
| Browser | `chrome-headless-shell` (one Chromium per suite) |
| Shared server | one loopback `127.0.0.1:8765` static server, owned by the runner |
| Background load during measurement | a VM (`Virtualization.framework`, 90-146 % CPU), Rancher Desktop / lima, NordVPN, VS Code, WindowServer |

Each suite launches its **own** Chromium and connects to the shared read-only
static server. The suites share no browser state, so concurrency is *correct* in
principle; the question is whether it is *faster*.

### Sequential aggregate baseline (current behavior)

`BROWSER_TIMING=json npm run test:browser`, three runs on the warm tree:

| Run | Wall-clock | Span total | Result |
| --- | --- | --- | --- |
| 1 | 92 s | 91 401 ms | all 8 suites passed |
| 2 | 99 s | 97 302 ms | all 8 suites passed |
| 3 | 88 s | 87 527 ms | all 8 suites passed |

Per-suite spans (run 3):

| Suite | Span |
| --- | --- |
| `test:ttc-ui:browser` | 39 529 ms |
| `test:story-43:browser` | 14 589 ms |
| `test:story-40e:browser` | 10 727 ms |
| `test:story-42:browser` | 9 849 ms |
| `test:call-refresh:browser` | 5 754 ms |
| `test:story-39a:browser` | 2 502 ms |
| `test:road-closure-mobile:browser` | 2 475 ms |
| `test:road-closure-count:browser` | 1 998 ms |
| `server-ready` | 104 ms |

The TTC suite is the dominant cost (~39-44 s under load). The other seven
suites together are ~48 s.

### Concurrency experiments (all worse)

Every concurrency variant was measured against the same warm tree and the same
shared server. "Sequential" is the sum of the same suites run one after another.

| Experiment | Sequential | Concurrent | Outcome |
| --- | --- | --- | --- |
| TTC + `story-43` | 53.6 s | **102.5 s**, **99.4 s**, **>120 s (timeout)** | ~2x slower, high variance |
| TTC + `story-40e` | 52.4 s | 39.4 s | within noise of TTC alone (41.7 s) — not a repeatable win |
| 7 small suites (all at once) | 46.9 s | **>120 s (timeout), 5/7 suites FAILED** | unusable |
| 3 small suites (`call-refresh`, `road-closure-count`, `story-39a`) | 11.0 s | **62.6 s** | ~5.7x slower |

The 7-suite concurrent run failed 5 of 7 suites; the failures are the cold-start
`fixture-ready` timeout class (the same class the Story 52E `awaitFixtureReady`
retry targets), triggered by CPU contention between Chromium instances.

### Root cause

The TTC suite is **CPU-bound**: it renders Leaflet across six viewport widths
(320/375/390/430/768/1440) with `waitUntil: 'networkidle'` and heavy map work.
Instrumenting the suite shows the six-width bodies alone are ~27 s
(320→5.4 s, 375→5.0 s, 390→5.5 s, 430→5.3 s, 768→2.7 s, 1440→3.2 s) and the
extra scenario pages add ~8 s. Adding a second Chromium instance on a host that
already runs a VM, Rancher/lima, NordVPN, VS Code, and WindowServer starves the
CPU, so both suites slow down and the readiness bounds start to trip.

### Decision

**Reject browser-suite concurrency.** It is not a real, safe win on this
machine: it is slower in every measured configuration, it is highly variable,
and it converts a stable green run into cold-start failures. The sequential
aggregate runner is retained unchanged. No code change is made in 68D.

### Correction to the 68C figure

The 68C handoff reported `test:ttc-ui:browser` at "~6.0-6.2 s". That number is
the **span total** emitted by `BROWSER_TIMING=json`, which only wraps
`chromium-launch`, `page-goto:<width>`, `fixture-ready:<width>`, and
`browser-close`. It does **not** include the per-width assertion bodies (the
12-cycle theme/overlay loop, the sheet/view toggles, the `waitForFunction`
calls, the screenshots) or the extra scenario pages, which are the bulk of the
suite.

Measured directly, the TTC suite wall-clock is:

| Scope | 68A baseline | 68C (actual) |
| --- | --- | --- |
| `test:ttc-ui:browser` (isolated wall-clock) | ~98 s | **~39-42 s** |
| `npm run test:browser` (aggregate wall-clock) | ~146 s | **88-99 s** |

The 61 s fixed wait removal is still a real win (~98 s → ~39 s isolated, ~146 s
→ ~88-99 s aggregate), but the magnitude was overstated by quoting the span
total as the suite time. The aggregate figure (~90 s) was correct because the
runner's `suite:<name>` span wraps the whole `npm run <suite>` process.

### Reproduce

```sh
# Sequential aggregate baseline (current behavior)
BROWSER_TIMING=json npm run test:browser

# Concurrency experiment (do NOT adopt; shown for evidence)
python3 -m http.server 8765 --bind 127.0.0.1 &
( npm run test:ttc-ui:browser & npm run test:story-43:browser & wait )
```

### Files changed and rollback

None. 68D is an assessment; the sequential runner is unchanged. Rollback is not
applicable.

---

## Story 70 — Browser cold-start `fixture-ready` flake hardening

**Status:** IMPLEMENTED / AWAITING VALIDATION (October 13, 2026). Out-of-band
chore identified by the Story 68D retrospective.

### Reproduction (required before any change)

Two distinct cold-start failure classes were reproduced:

**Class A — shared `awaitFixtureReady` 60 s exhaustion.** Reproduced only under
the 7-suite concurrent condition (the configuration Story 68D already measured
and **rejected**). Running all seven small suites at once failed **5/7** suites,
consistently across two runs. The failure is
`awaitFixtureReady: fixture did not become ready within 60000ms ... incident-load
state is missing (document.documentElement.dataset.incidentLoadState is
undefined)` — the page's JS never started, i.e. pure CPU starvation from seven
Chromium instances on a host already running a VM, Rancher/lima, NordVPN, VS
Code, and WindowServer. A single page reaches `ready` in ~388 ms even under
contention, so the 60 s budget is not the weakness. This is the environment-only
artifact the Story 70 note anticipates; **no code change** addresses it, and the
concurrency configuration that triggers it is already rejected.

**Class B — the 5 s selected-card predicate at
`scripts/cluster-connectors-browser.js:42`.** Reproduced **1/15-1/25 in the
sequential (supported) path** with no artificial concurrency, always at the
`assertBounded` selected-card `page.waitForFunction` (`Timeout 5000ms exceeded`).
This is the exact Story 68A failure and the genuine, in-scope flake: a hardcoded
5 s bound with no bounded-retry handshake, inconsistent with the Story 52E
pattern and `AGENTS.md`.

### Fix — shared bounded-retry helper for post-readiness UI predicates

Added `awaitUiState(page, predicate, options?)` to
`scripts/lib/browser-fixture.js`, mirroring `awaitFixtureReady`'s proven
handshake: a 5-second per-attempt budget with one bounded retry by default
(`DEFAULT_UI_STATE_RETRIES = 1`). It never weakens the predicate — the expected
state must still be reached before assertions run — and it fails fast on a
genuinely broken predicate. Applied to the three suites' 5 s predicates:

- `scripts/cluster-connectors-browser.js` — selected/deselected incident card.
- `scripts/road-closure-mobile-browser.js` — map popup and cleared detail.
- `scripts/mobile-map-info-browser.js` — summary bottom offset and rotated panel.

### Verification

| Check | Result |
| --- | --- |
| `test:story-39a:browser` sequential, 30 runs | **0/30 failures** (was ~1/15-1/25) |
| `test:road-closure-mobile:browser` sequential, 5 runs | 0/5 failures |
| `test:story-43:browser` sequential, 5 runs | 0/5 failures |
| `npm run test:browser` | all 8 suites passed (~89 s aggregate) |
| `npm run verify` | all required checks passed, exact 100/100/100 |
| `npx eslint .` | clean |
| `git diff --check` | clean |

### Files changed and rollback

- `scripts/lib/browser-fixture.js` — add `awaitUiState` + `DEFAULT_UI_STATE_RETRIES`.
- `scripts/cluster-connectors-browser.js`, `scripts/road-closure-mobile-browser.js`,
  `scripts/mobile-map-info-browser.js` — use `awaitUiState` for the 5 s predicates.
- `test/browser-fixture.test.js` — 10 deterministic `[STORY-70]` unit tests.
- `test/requirements.map.json` — declare `STORY-70` and map it to the helper test.
- `docs/browser-tests.md` — document the helper.

Rollback: revert the three suites to their bare 5 s `page.waitForFunction` calls
and remove `awaitUiState`; the suites return to their intermittent cold-start
behavior.

---

## Story 68 revisited — October 14, 2026

Follow-up pass over Story 68 after Stories 69-72 landed (Node 26 image, 1519
offline tests). Measured first; the adopted changes are diagnostics only — no
test removed, no acceptance weakened, no production behavior changed.

### Current baselines (warm image / host, October 14, 2026)

| Command | Duration | Notes |
| --- | --- | --- |
| `npm run verify:fast` | ~10 s | unit suite `duration_ms` 6 869 |
| `npm run verify` (default jobs) | 12-13 s | all checks + exact 100/100/100 |
| `VERIFY_JOBS=1 npm run verify` | ~24 s | lint 2 s, LA suite 6 s, python 3 s, integration 5 s, coverage 7 s |
| `npm run test:browser` | ~82 s | all 8 suites pass; TTC suite ~30-34 s under host load |

### Adopted changes (diagnostics; no behavior change)

1. **`scripts/verify.sh` per-job elapsed reporting** (the recorded 68B
   candidate). Both schedulers now report each job's duration
   (`==> [lint] passed (2s)`) and both mode summaries print the overall
   elapsed (`==> All required checks passed in 12s`). Per-stage timing no
   longer requires external timestamping or `VERIFY_JOBS=1`. Covered by two
   `[INFRA-VERIFY]` structural tests in `test/verify-script.test.js`.
2. **Per-width `assertions:<width>` spans in `scripts/ttc-ui-browser.js`.**
   The six-width assertion bodies were previously invisible to
   `BROWSER_TIMING=json` (the 68D correction had to be re-measured by hand).
   The suite now emits them permanently.
3. **`--test-concurrency=4` re-validated on Node 26** (image upgraded by
   Story 71; suite grown to 1519 tests): 2 ~= 9.6 s, 3 ~= 5.4 s, 4 ~= 5.3 s,
   5 ~= 6.6 s, 6 ~= 6.7 s. The pin is unchanged; the `scripts/run-unit-tests.sh`
   header now records the re-validation.
4. **Six-width identity-cycle split** (approved October 14, 2026). The TTC
   suite's 12-cycle theme/overlay/zoom identity exercise now runs in full only
   at the canonical widths (390 px mobile, 1440 px desktop); the other four
   widths (320/375/430/768) run a reduced 3-cycle pass so the identity
   property is still exercised at every width. Every per-width layout,
   visibility, geometry, and long-task assertion is unchanged. Measured
   isolated: assertion bodies 25.7 s -> 18.4 s; span total 33.0 s -> 24.7 s;
   the aggregate `npm run test:browser` fell 103.2 s -> 81.8 s (all suites
   green). The deep 100-cycle identity property remains covered in-process by
   `test/ttc-ui.test.js` (`[STORY-30F]`).

### Measured TTC breakdown (isolated run with the new spans)

| Width | page-goto | assertions (before) | assertions (after) |
| --- | --- | --- | --- |
| 320 | 1.2 s | 4.7 s | 3.2 s |
| 375 | 1.1 s | 4.2 s | 2.8 s |
| 390 | 1.1 s | 5.9 s | 6.0 s (full 12 cycles) |
| 430 | 1.0 s | 4.4 s | 2.8 s |
| 768 | 1.1 s | 3.2 s | 1.4 s |
| 1440 | 1.5 s | 3.2 s | 2.2 s (full 12 cycles) |

The six page loads total ~7 s and the assertion batteries ~18 s after the
split; the extra scenario pages add ~5 s. The remaining TTC cost is the
per-width battery that stays at every width (layout/visibility/geometry/
long-task assertions plus the reduced identity pass) and the two full
12-cycle passes at the canonical widths.

### Considered and not adopted (would weaken or risk acceptance)

- Splitting the six-width battery further (dropping the identity loop
  entirely at some widths, or reducing below 3 cycles) — the adopted 12/3
  split already captures the measured win; deeper cuts would reduce per-width
  regression coverage and need a fresh acceptance decision.
- `waitUntil: 'networkidle'` → `'domcontentloaded'` for the TTC pages —
  maybe ~0.5 s per page, but changes what the long-task observer captures and
  the timing of assertions relative to tile loads; not adopted without
  evidence of a stable win.
