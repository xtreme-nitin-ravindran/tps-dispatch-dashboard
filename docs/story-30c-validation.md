# Story 30C implementation and validation report

Date: 2026-09-28. Branch: `dev`, fast-forward synchronized before work.
Changes remain local; no commit, push, or deployment was performed. Existing
uncommitted Story 30A/30B work was preserved and extended.

## 1. Files changed by Story 30C

New backend modules:

- `src/ttc/static-gtfs.js`: ZIP/CSV ingestion, source validation, static indexes,
  normalized patterns, and service-calendar lookup.
- `src/ttc/static-source.js`: bounded download, daily validated cache, retention.
- `src/ttc/correlation.js`: route/stop/trip joins, candidates, segments, validation.
- `src/ttc/backend.js`: shared lifecycle-then-correlation orchestration.
- `scripts/ttc-static.js`: opt-in live static/identifier diagnostic.
- `test/ttc-static.test.js` and seven `test/fixtures/ttc-static/*.txt` fixtures.
- This report.

Extended existing files (some were already uncommitted 30A/30B work):

- `src/ttc/alerts.js`, `src/ttc/lifecycle.js`: additive validation; exclude derived
  correlation from the source-content hash.
- `scripts/ttc-alerts.js`, `scripts/tfs-etl.js`, `scripts/tfs-fallback.js`: shared
  production backend integration.
- `concourse/tfs-etl.yml`, `.github/workflows/update-tfs.yml`: backend ZIP caches.
- `package.json`: diagnostic and deterministic suite commands.
- `eslint.config.js`: Node globals for backend-only TTC modules.
- `.gitignore`, `.dockerignore`: exclude downloaded cache.
- `README.md`: source, architecture, contract, algorithms, operations, commands.

Pre-existing changes to `Dockerfile.test`, `package-lock.json`,
`concourse/pipeline.yml`, `test/tfs-etl.test.js`, and
`test/ttc-gtfs-alerts.test.js` were not authored by Story 30C.

## 2–3. Source and reuse

Official source: [Surface Routes and Schedules for BusTime](https://open.toronto.ca/dataset/surface-routes-and-schedules-for-bustime/),
City resource `28514055-d011-4ed7-8bb0-97961dfe2b66`, `surfacegtfs.zip`.
The official package metadata explicitly requires this dataset for enhanced
NVAS/BusTime GTFS-RT. Read routes, stops, trips, stop_times, shapes, calendar,
and calendar_dates. The first four are required; the remainder are optional.

Story 30A/30B ingestion, lifecycle, publication, failure state, and commands are
reused. Story 32 has a bundled stop-only lookup from the older static source,
without trips, geometry, calendars, or a refresh pipeline. It cannot safely serve
as the BusTime pattern source; it remains unchanged. No second static dataset is
shipped to the browser. The new archive is a backend-only ignored cache.

## 4–6. Identifier joins and observed mismatches

Route, stop, and trip IDs use exact string equality. Leading zeroes are preserved;
short route names and stop codes are not aliases. Metadata is separate from original
alert IDs. Unknown IDs are retained and explicitly marked unmatched, and aggregate
unmatched-ID lists are logged. Duplicate references are deterministic and deduplicated.

The live diagnostic returned **zero qualifying construction/detour alerts**.
Consequently there were no live route, stop, or trip IDs to join: compatibility is
verified by deterministic fixtures and the official paired-source declaration,
but not empirically established against current alert IDs. No observed mismatch
is not evidence that future IDs will all match. The diagnostic must be rerun when
qualifying alerts are present.

## 7–8. Patterns, branches, directions

A SHA-256 of route ID, direction ID, shape ID, and ordered stop IDs identifies each
normalized pattern. Equivalent trips share one pattern; numeric stop-sequence
spacing and timetable differences do not split it. Source trip IDs remain in the
backend index for explicit trip selectors. Directions 0, 1, missing directions,
branches, replacement patterns, and short turns remain distinct.

Per-route selectors prevent unrelated route stops from leaking into candidates.
Consistent direction/trip evidence narrows candidates. Best stop coverage wins;
calendar exceptions and Toronto service dates prefer credible active service.
Previous-day service remains eligible because overnight times are not retained.
Missing calendar evidence does not eliminate patterns.

## 9–11. Segments, projection, ambiguity

Segments include all scheduled stops from the first through last matched affected
stop. They require at least two distinct affected stops; repeated occurrences are
not arbitrarily selected. GTFS-RT informed entities are unordered, so normalized
lexical stop-ID order is never treated as traversal evidence. An explicit
`affectedStopOrder` supplied by a caller with sequence evidence is checked; a
conflict prevents an exact claim and suppresses that segment.

Shapes follow numeric source sequence. Stops project to their nearest polyline
position using a local equirectangular approximation, within 100 m. Competing
positions on separated shape edges within 5 m of the best distance are ambiguous.
All intermediate-stop projections must be monotonic; endpoints must differ.
Otherwise the source shape reference survives without fabricated geometry.
Coordinates in clipped geometry are `[longitude, latitude]`.

Exact, partial, ambiguous, and unmatched statuses are separate. Multiple equally
credible complete patterns remain ambiguous; partial coverage is retained.
Exact describes the static pattern/stop join, not certainty about projected
geometry or actual service. Each candidate has its own segment and geometry status.

**This geometry is the affected scheduled TTC route, not the temporary detour path.**

## 12–13. Schema, artifact size, performance

Additive item `correlation` and top-level `ttcAlerts.staticCorrelation` retain
`ttcAlerts.schemaVersion:1`. The static metadata has schemaVersion 1, source hash,
availability, diagnostics, and a shared catalog of referenced patterns. Candidates
reference that catalog; complete shapes and scheduled trip lists remain backend-only.
Static refreshes do not change alert content hashes or lifecycle update timestamps.
Validation rejects bad geometry/coordinates, invalid or duplicate sequences, missing
pattern references, and unsupported exact claims without mutating input.

Live archive: **83,084,610 bytes** compressed. Its stop_times member is
370,392,647 bytes; shapes is 43,015,549 bytes. Static counts:

| Entity | Count |
|---|---:|
| Routes | 230 |
| Stops | 9,128 |
| Trips | 129,271 |
| Patterns | 1,391 |
| Shapes | 1,406 |
| Trips without stop times | 4 |

Measured cached-ZIP index construction: **13,775 ms**, process RSS after indexing
**989,519,872 bytes (~944 MiB)**. An earlier run was 15,847 ms and similar RSS.
Bounded CSV decoding avoids a complete additional text copy, but substantial
inflated ZIP/index allocations remain. This is a material new backend memory cost;
workers should allow headroom above 1 GiB. It is not browser memory usage.

The zero-alert diagnostic payload was **541 bytes** (compact JSON including static
metadata). This does not measure a populated live snapshot. Fixtures verify shared
pattern references and clipped segments; production logs report actual artifact
bytes and correlation milliseconds on every backend run. Only one static index
build is used for all alerts; no per-alert full-trip scans or full-shape copies.

## 14–16. Production paths and commands

Concourse adds only a task cache path plus `TTC_STATIC_CACHE`. GitHub fallback adds
an Actions cache for `.cache/ttc`. Both use the same backend through existing ETL;
RT normalization/lifecycle precede static correlation and publication validation.
No new package dependency or separate workflow parser was added.

ZIP refresh is daily, with two 60-second attempts and bounded download size.
Known-good bytes are replaced atomically only after validation. Refresh failure
uses stale valid bytes. If none are usable, RT updates still proceed and only
unchanged alerts may retain previous correlation, marked static-unavailable.
The cache is neither committed nor published to the data branch.

Local commands:

- `npm run update:ttc`: standalone full TTC backend pipeline.
- `npm run update:tfs`: production snapshot pipeline.
- `npm run test:ttc`: deterministic TTC tests.
- `npm run update:ttc:static`: static/live-ID diagnostic; no snapshot write.

README provides the Docker equivalents and a persistent local cache mount.

## 17–19. Tests and live validation

18 new deterministic tests cover route/stop/trip IDs, duplicates, equivalent trips,
directions, branches, partial matches, explicit order conflicts, no-stop alerts,
multiple routes, shapes, projection tolerance, loops/reversed geometry, missing
shapes, calendars, cache retention, malformed schema, missing stop times, CSV
chunk/Unicode boundaries, row-order determinism, and changed-alert failure handling.
The end-to-end test encodes real protobuf, invokes 30A normalization, 30B lifecycle,
30C correlation, and production ETL, then reads and validates the generated snapshot.

Final regression results:

- Docker unit suite in UTC: **321 passed**.
- Docker unit suite in America/Los_Angeles: **321 passed**.
- Live-source integration suite: **8 passed**.
- Python tests: **7 passed**.
- ESLint and Ruff: passed.
- Browser entry points and all `src`/`scripts` JavaScript syntax: passed.
- `git diff --check` and staged whitespace check: passed.
- Generated `data/current.json`: unchanged.

Live GTFS validation succeeded with the counts above and zero qualifying RT alerts.
Static corruption/replacement tests do not use live data. Publication wiring was
validated locally; hosted jobs were not deployed or triggered.

## 20–21. Story 30D findings and UI constraint

Story 30D must preserve source-version identity and the distinction between
scheduled geometry, projected geometry, and any later observed temporary path.
Do not reuse the older Story 32 stop-ID namespace without a validated join.
Account for unordered selectors, empty live alert periods, missing trip stop times,
calendar overlap/overnight service, branch ambiguity, and shape loops. Future
schedule data may be published before its service start; calendar eligibility is
only a preference, not evidence of vehicle operation.

No user-facing UI, styling, layout, controls, map behavior, frontend schema consumer,
or bundled Story 32 stop dataset changed. `app.js`, `index.html`, `styles.css`, and
`src/disruptions` are unchanged. No temporary detour geometry was inferred.
