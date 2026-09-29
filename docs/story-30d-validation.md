# Story 30D implementation and validation report

Completed locally on `dev`, September 28, 2026. `origin/dev` was fast-forward
synchronized before editing. Existing uncommitted Story 30A–30C work was preserved.
No commit, push, pipeline deployment, or GitHub workflow run was performed.

## 1. Files changed

New Story 30D files:

- `src/ttc/realtime.js`: shared protobuf decode/timestamp helpers extracted from alerts.
- `src/ttc/vehicle-feed.js`: bounded fetch, normalization, duplicate/conflict handling.
- `src/ttc/vehicle-geometry.js`: compiled shape segments and nearest projection.
- `src/ttc/vehicle-detector.js`: correlation, temporal state, validation, compact export.
- `scripts/ttc-vehicles.js`: shared bounded polling, atomic backend files, diagnostics.
- `test/fixtures/ttc-vehicles/builders.js`: deterministic static/protobuf sequence builders.
- `test/ttc-vehicles.test.js`: 28 deterministic tests.
- `concourse/ttc-vehicles.yml`: independent vehicle observation task.
- `.github/workflows/ttc-vehicles.yml`: independent four-poll fallback.
- This report.

Extended `src/ttc/alerts.js` to use the shared helpers, `package.json` for commands
and tests, `concourse/pipeline.yml` for the separate job, and `README.md` for the
backend contract and operations. Other files already dirty at task start were not
changed by Story 30D. No new dependency or lockfile change was needed for this story.

## 2–3. Endpoint, fields and identity

Endpoint: `https://bustime.ttc.ca/gtfsrt/vehicles`, using existing
`gtfs-realtime-bindings` 2.2.0. The shared decoder preserves absent optional fields.
Read vehicle ID; trip ID, route ID, direction ID, start date/time and schedule
relationship; latitude, longitude, bearing and speed; stop ID, current stop
sequence/status; vehicle and feed timestamps. Normalized coordinates must be finite
numbers within geographic bounds. IDs remain exact strings. Missing vehicle identity
is counted and dropped; entity IDs and coordinates never become persistent identity.

## 4–6. Matching results, ID conflicts and pattern selection

The final four-poll run decoded 1,799–1,804 vehicles per poll. Of the fresh processed
observations, 1,586–1,587 had route and trip IDs. There were **zero exact matches**,
267–272 probable matches, 843–852 ambiguous observations and 669–675 unmatched
observations per poll. No ambiguous/unmatched position generated evidence.

A separate diagnostic found **444 recognized trip IDs, 443 route conflicts, zero
direction conflicts, and 438 stop conflicts**. Example: realtime trip `49772020`
reported route `122`, while the static trip with the same ID belonged to route `13`.
Another, `125653020`, reported route `11` but joined static route `45`.
These are observed ID collisions/context conflicts, not proof of the underlying
schedule-version cause. The final burst similarly logged 432–436 context conflicts
per poll. Shared string IDs alone are therefore unsafe.

Exact matching validates supplied route, direction and stop context. Known-trip
conflicts are rejected. Unrecognized trips may fall back to route/direction/stop
membership in the Story 30C indexes. Exactly one surface-mode pattern with usable
shape must remain. Multiple branches, directions, or variants remain ambiguous;
position does not select a convenient nearest branch. No aliases or invented IDs.
Non-scheduled trip relationships are excluded. Start date/time are assignment
boundaries, not assumed service-calendar proof. Stop sequence is preserved but is
not interpreted as an array index because equivalent static trips can have different
numeric sequence spacing. Missing geometry or degenerate geometry cannot classify.

## 7. Distance and projection

Local equirectangular distance in metres, with longitude scaled by cosine of shape
latitude, matches the practical geographic approach in Story 30C. Its stop projection
has a 100 m rejection threshold and cannot serve an unbounded vehicle-distance query;
a separate compiled segment query supports the new semantics without changing 30C.
Trip/route indexes limit matching; segment bounding boxes prune shape scans. Shapes
are compiled lazily and cached once per burst. Distance is to the polyline, not stops.
Store nearest point, segment index/fraction, progress and distance. Distinct near-tied
positions within 5 m and more than 50 m apart along the line flag ambiguous progress.
That flag matters for later path inference even when minimum route distance is valid.

## 8–10. Threshold, confirmation and recovery

Entry is **over 100 m**; exit is **under 50 m**. Three consecutive off-route
observations must span **60 seconds** and displace **100 m** from the first point.
This excludes one-point errors, duplicated polls and stationary jitter. A confirmed
vehicle enters rejoining on close-to-shape evidence and returns on-route after
**three consecutive on-route observations over 60 seconds**. Neutral-band points
break consecutive evidence but retain confirmed/rejoining state. New episodes exclude
samples from a recovered episode. States are unknown/on-route/possible/confirmed/rejoining.

The conservative threshold accommodates street widths, shape approximation and GPS
uncertainty; it is not a claimed measurement of TTC GPS precision. A 150 m endpoint
buffer makes off-route terminus/layover observations neutral, while close-to-shape
points can still recover. No Toronto-specific exception list was added. Loops,
parallel segments and crossings are exercised geometrically. Calibration results
below do not justify reducing the threshold or asserting reliable fleet-wide recall.

## 11–14. GPS, bounded history, expiry and reassignment

Reject implied jumps exceeding **100 m + 40 m/s × elapsed time**, before changing
assignment. Rejected points never enter history. Identical or out-of-order times
cannot add confirmation; conflicting same-time feed records are discarded together.

Explicit bounds: **20 samples / 10 minutes**, whichever is smaller; **3,000 tracks**;
**32 MiB restart artifact**; **8 MiB feed response**; 1–20 polls per invocation.
Feed/observation age must be at most **120 seconds**, with at most **30 seconds** of
future skew. Missing/old/future feed timestamps are unavailable, not successful-empty.
Inactivity expires a vehicle after **180 seconds**. A gap over **90 seconds** resets
confirmation. Static version, route, trip, direction, start date/time, or pattern
changes reset history. Disappearance and reappearance cannot resurrect stale evidence.

## 15. Active-alert context

Use current, successfully fetched active Story 30B alerts with explicit unambiguous
single-route selectors or exact Story 30C pattern correlation and compatible scoped
selectors. Unscoped stop selectors cannot masquerade as route-wide evidence. Ambiguous,
scheduled, expired or unavailable alert support is excluded. No alerts are required,
and the output has no inferred cause. Both live runs had zero qualifying alerts;
relationship behavior is verified through the real protobuf/lifecycle/static fixture flow.

## 16. Backend output and schema

Ignored `.cache/ttc/vehicle-state.json` holds bounded restart state.
Ignored `.cache/ttc/deviations.json` holds versioned compact episode evidence, static
version/pattern/shape references, timestamps, projected observations and related alert
IDs. No full shapes or full fleet are exported. Separate state and export validators
check ranges, timestamps, bounds, states, identity uniqueness and index consistency.
Malformed cache is logged and discarded; per-file writes are atomic.

On feed failure, export is immediately unavailable with **zero deviations**; restart
state ages normally. Fetch/decode/stale-header reasons remain distinct. Static failure
clears evidence. Empty successful feeds are `ok`; unmatched records have independent
metrics. Downstream consumers must check observation and artifact freshness against
their own reference clock—old files cannot expire themselves after scheduler failure.

## 17–19. Cadence, Concourse and GitHub fallback

Independent Concourse serial job `detect-ttc-vehicle-deviations` uses the existing
one-minute trigger and new task file. Each task loads static GTFS once, then polls
**four times 30 seconds apart** (90 seconds plus setup/network time). The existing
incident ETL/publication is not repeated per poll and cannot be blocked by TTC failure.
A bounded task cache may continue evidence between builds; cold starts are safe.
Actual cadence includes scheduler/serial-job delays and is not an always-on service.

`ttc-vehicle-evidence/deviations.json` is a Concourse task output consumable by future
backend tasks in that build. It is not stored in the web data branch. Job logs retain
20 builds. The existing `concourse/tfs-etl.yml` requires no vehicle-specific edits.

The independent GitHub fallback runs every five minutes when scheduling permits,
uses the same four-poll code, caches only the static ZIP, and starts vehicle history
fresh each run. Its compact artifact has one-day retention. It cannot claim
cross-run continuity, and no confirmation is manufactured on cache loss or delay.
Both workflow definitions are implemented locally, not deployed or triggered.

## 20–21. Commands and deterministic tests

- `npm run update:ttc:vehicles`: one live refresh, bounded local history.
- `npm run test:ttc:vehicles:live`: four live diagnostic polls.
- `npm run update:ttc:vehicles -- --polls 10 --interval-ms 30000`: bounded longer burst.
- `npm run update:ttc:vehicles -- --fixture /path/sequence.json --static-fixture test/fixtures/ttc-static`: offline fixture input.
- `npm run test:ttc`: deterministic alert/static/vehicle suites.

Fixture input records contain `now`, `protobufBase64`, and optional alert state.
Builders and polling tests demonstrate the format. No UI startup is needed.

The 28 new tests cover parsing and optional fields; bad coordinates/times/identity;
source failure categories and empty success; exact/fallback/ambiguous/unmatched
joins; normal, single-point, sustained and stationary evidence; jumps; duplicates and
out-of-order records; rejoin/hysteresis; termini; all reassignment boundaries;
expiry/reappearance; count/time/fleet bounds; corrupt state/output; straight/vertex/
curved/duplicate/degenerate/crossing/parallel geometry; alert scoping; episode reset;
and a real protobuf → static index → lifecycle alert → projection → compact-output
end-to-end flow. Polling orchestration and static failure are tested using files and
injected clocks without the live endpoint.

## 22–23. Live calibration and performance

Static source hash:
`e67c06dad8633cda674bdd12dc68cfe0e8e215842e37371f4bd686d7c79c93ec`.
Final burst ended at **2026-09-28T22:06:17.591Z**.

| Metric | Final four-poll burst |
|---|---:|
| Decoded vehicles / poll | 1,799–1,804 |
| Stale records / poll | 9–14 |
| Invalid coordinates / missing identity | 0 / 0 |
| Exact / probable matches | 0 / 267–272 |
| Ambiguous / unmatched | 843–852 / 669–675 |
| Median matched distance | 0.138–0.161 m |
| p95 matched distance | 0.561–0.823 m |
| Maximum matched distance | 44.24–111.15 m |
| Final possible / confirmed / rejoining | 1 / 0 / 0 |
| Matching time | 3.68–5.44 ms |
| Geometry time | 15.80–34.93 ms |
| Detection processing time | 31.38–48.00 ms |
| Static load/index time | 13,283 ms |
| Static index RSS | 975,503,360 bytes |
| Post-processing RSS | 830,902,272–1,036,554,240 bytes |
| Compact artifact, excluding trailing newline | 216–1,023 bytes |
| Final bounded restart file | 517,740 bytes / 268 tracks |

The initial exploratory burst decoded 1,805–1,808 vehicles, matched 252–260 probable
patterns, had p95 distances 0.43–1.80 m and maxima 413–423 m, and accumulated **two
confirmed deviations**. These are not field-verified detours. The final independent
burst had none, a valid outcome. An obsolete pre-episode-schema development cache
was correctly rejected at final-burst startup rather than carried forward.

Very small typical distances may indicate upstream position snapping; these samples
cannot establish raw GPS accuracy. Unmatched vehicles are not in these percentiles.
The heavy cost remains Story 30C's ~1 GiB static index, not per-poll detection. Allow
worker headroom. No heavy dependency or fleet × network geometry scan was introduced.

## 24. Full validation

- Docker unit suite, UTC: **349 passed**.
- Docker unit suite, America/Los_Angeles: **349 passed**.
- Live-source integration suite: **8 passed**.
- Python suite: **7 passed**.
- ESLint and Ruff: passed.
- `app.js`, `service-worker.js`, all `src`/`scripts` JavaScript syntax: passed.
- `fly validate-pipeline -c concourse/pipeline.yml`: passed.
- `git diff --check`: passed.
- No generated snapshot or frontend changes.

Full-suite logs are available locally under `/tmp/story30d-*.log`. Hosted execution
has not been validated by deployment; the repository configuration and shared code
were exercised locally.

## 25–26. Story 30E findings and UI confirmation

First investigate realtime/static trip-ID collisions and schedule compatibility;
do not build paths on raw trip-ID equality. Preserve matching quality, static-version
identity, ambiguous progress, terminal suppression and evidence freshness. Fallback
coverage is intentionally limited; absence of evidence is not absence of a deviation.
Burst polling leaves gaps. A future continuous-path story may need different cadence
and artifact transport, but must not invent continuity from caches or GitHub runs.

Story 30D detects **deviation from scheduled TTC route geometry**. It does not
determine the actual diversion route or the cause of the deviation.

**No user-facing UI, styling, layout, controls, vehicle markers, route overlays or map
behavior changed. No frontend files were touched. `data/current.json` is unchanged.**
