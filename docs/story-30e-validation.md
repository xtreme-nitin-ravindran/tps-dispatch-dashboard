# Story 30E — observed diversion inference and validation

Implemented locally on `dev`, September 28, 2026. `git pull --ff-only origin dev`
reported up to date. Pre-existing uncommitted Stories 30A–30D work was preserved.
No commit, push, workflow dispatch, pipeline deployment or production publication.

**Story 30E geometry is inferred by SirenTO from observed TTC vehicle movement and
is not TTC-published route geometry.**

## 1. Files changed by this story

New files:

- `src/ttc/diversion-geometry.js`: metric, ordered corridor comparison, conservative
  simplification and separate scheduled-segment clipping.
- `src/ttc/diversion-inference.js`: bounded episode capture, clustering, confidence,
  identity, expiry, validation, compact output and GeoJSON export.
- `test/ttc-diversions.test.js`: 26 deterministic tests.
- `test/fixtures/ttc-diversions/run.js`: offline protobuf/static/alert fixture export.
- `docs/story-30e-validation.md`: this report.

Extended files (some already uncommitted at task start): `scripts/ttc-vehicles.js`,
`concourse/ttc-vehicles.yml`, `.github/workflows/ttc-vehicles.yml`, `package.json`,
`README.md`. No new dependency or lockfile edit by this story. Story 30D detector,
vehicle-feed parser, static index and alert lifecycle implementations are unchanged.

## 2. Deviation episode representation

A retained episode carries an ID hashed from static version, vehicle ID, assignment,
pattern and the detector's original `deviationStartedAt`. It contains route,
direction, pattern/shape, trip ID if supplied, bounded accepted observations,
first/latest observation and latest off-route time, raw/projected boundary evidence,
related alert IDs, and explicit confirmed/completed/closed/truncated flags.

The assignment includes route, trip, direction, service start date/time as in 30D.
Trip ID alone is never an independence key. Possible episodes are retained early
so the last credible scheduled sample is not lost as 30D's 20-sample window rolls.
Only episodes confirmed by 30D may contribute to clusters. This is downstream
retention of accepted detector evidence, not another fleet tracking/classification
system. Duplicate/out-of-order samples cannot append. Route/pattern reassignment,
missing tracks and gaps over 90 seconds close incomplete episodes. A recovered
vehicle's later off-route start gets a distinct episode. Lost histories cannot be
reconstructed from the compact 30D deviations export.

## 3. Departure and rejoin

Departure projects the last credible on-route point before the episode's first
accepted off-route point. Both samples and the shape segment/fraction/progress are
retained. This is a projection-based boundary estimate, not a claim about the exact
crossing instant. Uncertainty is at least 50 m and at least the gap between those
samples. Without a credible on-route sample, the first off-route projection is
explicitly marked `off-route-projection`, with at least 150 m uncertainty; it cannot
satisfy the anchored-completion confirmation rule. Ambiguous boundary progress does
not produce an inferred boundary.

Rejoin requires the 30D recovery transition and three consecutive on-route samples
over 60 seconds. Project the first sample in that confirmed recovery run, preserve
it with the last preceding off/neutral sample, and trim the trajectory there rather
than adding the scheduled travel during recovery confirmation. Rejoin must advance
along the directional scheduled shape. A missing or ambiguous rejoin remains absent.

## 4–5. Similarity and grouping

Partition by exact route/direction/pattern/shape and departure bin (150 m, with
adjacent bins searched). Endpoint progress must differ by no more than 150 m at each
known boundary. Densify along observed segments at up to 40 m spacing, retaining
observed vertices; dwell movements below 1 m are removed. Compare ordered polylines
with discrete Fréchet distance. The 100 m maximum tolerates sampling and lane noise
while preserving travel order. This is a distance in metres, not an opaque score.

Incomplete trajectories can match an observed prefix. Completed episodes seed
clusters first. Every new member must match every existing member: no chaining of
many small differences into a large route change. An incomplete prefix compatible
with two completed corridors is withheld, not counted twice or arbitrarily assigned.
Cluster order and medoid ties are deterministic. Comparisons are restricted to
plausible bins, 24 members and 256 densified vertices; paths exceeding that geometry
budget are rejected, not coarsened into shortcuts.

## 6–7. Independent evidence and confidence

- Candidate: at least one usable confirmed 30D episode.
- Likely: two distinct vehicles or three distinct completed episodes, but insufficient
  completed, departure-anchored evidence for confirmation.
- Confirmed: completed anchored episodes from two distinct vehicles, or three separate
  completed anchored episodes. Three completed episodes from one vehicle are allowed.

The last rule counts genuine separate departures and confirmed recoveries, not
multiple polls or trip-ID matches. Restart validation rejects overlapping completed
episodes from one vehicle and cross-checks record counts against retained members.
No confident rejoin is invented for incomplete evidence. An active qualifying alert
adds the explicit explainable `alertSupported` confidence dimension; it never lets a
single vehicle/episode bypass the independent-evidence rule.

## 8–9. Representative path and simplification

Select the observed medoid (minimum summed corridor distance), preferring completed,
anchored trajectories. This keeps observed corner order and avoids averaging parallel
lanes into a shortcut. Geometry consists of projected departure, representative
ordered observations and the confirmed projected rejoin if present. It is not a
concatenation of fleet samples. Apply Ramer–Douglas–Peucker at 8 m, preserving endpoints.
The pure API accepts a configured tolerance from 0 to 20 m. Never increase tolerance
to satisfy a count limit. Tests preserve right-angle turns and both endpoints.

No existing local road/track topology provides trustworthy map matching. Therefore
there is no routing dependency or road snapping. Streetcars and buses use observed
movement, with the existing safe static-pattern selection. Observed positions cannot
prove a passenger stop, so no temporary stops or dwell-as-stop claims are generated.
Sampling gaps still imply straight interpolation between observations; these are not
surveyed road/track paths and should not be rendered as such in Story 30F.

## 10–11. Identity, refinement and material change

A new cluster ID is a hash of the static version and deterministic seed episode ID.
The seed includes the original episode start, not the current polling timestamp.
On later polls, compatible route/pattern/boundary/corridor records retain their ID,
first observed time and identity anchor, independently of member counts or GPS noise.
Incomplete anchors can grow until a completed path is available; completed anchors
then remain fixed. This prevents repeated small updates from drifting the identity
into an unrelated route. Geometry/confidence/evidence/alert fields can update.

A path over 100 m corridor distance or 150 m boundary progress difference is materially
incompatible and gets a separate cluster/ID, not a silent warp. Opposite directions
and branches are always separate. A split can retain an old ID for one compatible
continuation, while the other receives a new ID. Records are not a permanent version
archive; expired records are removed. Identity continuity requires persisted bounded
state; a cold start cannot reconstruct expired or lost IDs.

## 12. Expiry

Support expires 30 minutes after the most recent off-route observation, not after the
latest poll or recovery sample. Episodes age out too. Three distinct vehicles with
at least three consecutive, unambiguous scheduled observations over 60 seconds,
progressing through the affected region after last support, shorten the idle lifetime
to five minutes. A formerly supporting alert that no longer qualifies in a successful
alert refresh shortens it to ten minutes. Alert/feed failure is not evidence of an
alert ending. One recovery never immediately removes a supported diversion.

Shortened expiry is remembered across polls while the same observation ages. Fresh
support can renew the lifetime. Retirement removes contributing episodes so a later
poll cannot resurrect the old cluster from the same evidence. Static-version changes
clear incompatible state. A source outage suppresses compact output immediately while
retained evidence continues to age. Consumers must also enforce their own freshness
clock if scheduling stops.

## 13–14. Alerts and contradictory evidence

Reuse 30D's safe route/trip/direction selector relationships, then require a currently
active DETOUR or CONSTRUCTION alert with exact 30C correlation and a projected affected
scheduled segment overlapping the observed departure/rejoin region. Unknown or
ambiguous segment correlation, unscoped selectors, expired alerts and unavailable
sources cannot strengthen confidence. Route-only alerts lacking affected geometry
are deliberately insufficient for the stronger 30E flag. No alert is required for
inference and no cause is invented.

Multiple compatible-context but spatially incompatible clusters coexist. No
route-wide forced consensus. Shared incomplete prefixes cannot break a tie. Capacity
exclusions and oversized geometry are counted in diagnostics. Evidence counts describe
retained bounded members, not all vehicles that ever used the corridor.

## 15–16. Backend schema, artifacts and bounds

`diversion-state.json` contains private episodes and records with identity anchors and
member IDs. `diversions.json` strips full trajectories, assignment/vehicle identities,
member IDs and identity anchors, preserving compact geometry, provenance, structured
confidence, evidence counts, boundary raw evidence/uncertainty and related alerts.
Both use `schemaVersion: 1`, `staticVersion`, source `status` and `checkedAt`.
Every path uses `geometrySource: sirento-observed`.

`scheduledAffectedSegment` is separate from inferred `geometry`: shape reference,
start/end progress and the clipped scheduled shape when within the geometry budget.
An unknown rejoin or over-budget scheduled polyline leaves its geometry null, retaining
references rather than inventing or overwriting scheduled geometry. The implementation
reuses 30C shape coordinates and 30D compiled metric/projection primitives.

Bounds: 500 episodes; 120 points/30 minutes per episode; 30-minute evidence age;
24 member episodes per cluster; 12 clusters per route; 200 clusters globally;
122 output/anchor vertices; 256 comparison vertices; 16 MiB restart artifact, with
an 8 MiB episode byte budget. Stable deterministic newest-first retention protects
memory. Truncated/discontinuous episodes cannot vote. Validators reject impossible
coordinates, ordering, timestamps, confidence/count inconsistencies, bad route/pattern/
shape references, projected boundaries inconsistent with the shape, invalid provenance,
oversized arrays and backward rejoins. They never fill missing data.

## 17–18. Concourse and GitHub fallback

The existing independent vehicle-processing task invokes the same inference after
each detector refresh. `TTC_DIVERSION_STATE` points into `ttc-vehicle-cache`; compact
`TTC_DIVERSION_OUTPUT` is `ttc-vehicle-evidence/diversions.json`. Restart and output files
are each atomic JSON writes. They are not a multi-file transaction; missing evidence
on cold starts remains conservative. The existing incident ETL and TPS/TFS/closure
sources do not depend on inference. No additional pipeline/job/poller was created.

The fallback uploads both compact artifacts and caches only static GTFS. Four actual
polls can support incomplete candidates/likely clusters, but commonly cannot observe
both departure and the full recovery window. It cannot manufacture completed episodes
or cross-run continuity. One-day artifact retention is unchanged. Configurations were
validated locally; neither Concourse nor GitHub was deployed or triggered.

## 19–20. Local commands and diagnostic geometry

```sh
npm run update:ttc:vehicles
npm run test:ttc:diversions:live
npm run update:ttc:vehicles -- --infer-only --geojson .cache/ttc/diversions.geojson
npm run update:ttc:vehicles -- --fixture /path/sequence.json --static-fixture /path/gtfs
npm run fixture:ttc:diversions
npm run test:ttc
```

The existing static cache or fixture builds the index. `--infer-only` consumes the
existing detector restart state without vehicle/alert fetches; old detector state is
unavailable and cannot refresh support. The fixture uses two vehicles plus real alert
protobuf normalization/reconciliation and static correlation, and writes isolated
`.cache/ttc/diversion-fixture/{vehicle-state,deviations,diversion-state,diversions}.json`
and `diversions.geojson`. Developer GeoJSON contains scheduled route, scheduled affected
segment, member trajectories, inferred path, departure and rejoin. There is no map/UI
integration. Both live and fixture commands run with the documented Docker cache mount.

Structured logs include episode counts, completed/incomplete evidence, cluster
creation/merging/splitting/expiry, confidence counts, geometry updates, independent
vehicle counts, route IDs, average/maximum corridor distance, alert support, processing
time and RSS. Raw fleet positions are not logged. Empty live output is valid.

## 21–22. Deterministic and end-to-end tests

26 tests cover one vehicle; duplicate polling; two matching vehicles; three separate
completed runs from one vehicle; opposite direction/branch context; noise/dwell/different
sampling; different corridors/departures/rejoins/order; absent rejoin; cold departure;
GPS outlier exclusion; turn-preserving simplification; stable identity/refinement;
material changes and simultaneous clusters; independent alert support/no alert;
expiry/source/static failure; restart persistence; bounds and oversized comparisons;
ended-alert and scheduled-return expiry without resurrection; shared-prefix ambiguity;
forged counts/overlapping episodes and schema corruption.

The real protobuf → lifecycle alert → static correlation → 30D detector → 30E inference
fixture asserts unchanged static geometry, plausible projected boundaries, two-vehicle
support, off-route representative geometry, `sirento-observed` provenance, preserved
alert relationship, compact output and all diagnostic GeoJSON feature types. File-based
polling tests exercise restart between invocations and static-failure clearing. No UI
module is imported or needed.

## 23–24. Live diagnostics and performance

Four polls ended **2026-09-28T22:33:04.357Z** with static version
`e67c06dad8633cda674bdd12dc68cfe0e8e215842e37371f4bd686d7c79c93ec`.

| Observation | Result |
|---|---:|
| Decoded vehicles per poll | 1,814–1,816 |
| Probable pattern matches | 269–271 |
| Ambiguous / unmatched observations | 848–852 / 687–690 |
| Realtime/static trip context conflicts rejected | 382–383 |
| Confirmed deviation episodes / completed trajectories | 0 / 0 |
| Confirmed incomplete episodes | 0 |
| Candidate / likely / confirmed diversion clusters | 0 / 0 / 0 |
| Clusters with one / multiple vehicles | 0 / 0 |
| Routes affected / expired clusters | 0 / 0 |
| Average / maximum cluster distance | 0 / 0 (no clusters) |
| Inference processing per poll | 1.61–4.23 ms |
| Whole-process RSS after inference | 831–1,038 MB |
| Static load/index | 13,260 ms; 975 MB RSS |
| Compact inference artifact | 172 bytes including newline |
| Restart inference artifact | 2,066 bytes; one unconfirmed possible episode |

The retained possible episode did not become a confirmed 30D trajectory and therefore
created no 30E candidate. Zero inferred diversions is a valid diagnostic outcome, not
evidence that no TTC diversion existed. Static matching remains coverage-limited and
all trip-collision rejection was retained. No real diversion geometry could be field-
validated in this burst. Noise/corridor thresholds are conservative starting policies,
not live-calibrated accuracy claims.

The deterministic 500-episode capacity test took roughly 0.33 seconds in an isolated
Docker run (including setup/validation). The dominant live memory cost remains 30C's
static index. No new dependency or fleet-wide all-to-all comparison was introduced.
Logs reside locally at `/tmp/story30e-*.log`; generated outputs are ignored by Git.

## 25. Full validation

- Docker unit suite in UTC: **375 passed**, including 26 new inference tests.
- Docker unit suite in America/Los_Angeles: **375 passed**.
- Live-source integration suite: **8 passed**.
- Python suite: **7 passed**.
- ESLint and Ruff: passed.
- `app.js`, `service-worker.js`, all `src`/`scripts` JavaScript syntax: passed.
- `fly validate-pipeline -c concourse/pipeline.yml`: passed.
- `git diff --check`: passed.
- Offline fixture: one confirmed, alert-supported diversion from two completed
  independent vehicle episodes; diagnostic GeoJSON exported successfully.
- Live four-poll diagnostic: succeeded; zero inferred diversions (details above).
- No generated production snapshot or frontend changes.

The offline fixture's compact artifact was 2,106 bytes including newline, with about
80 MB total process RSS and 1.4 ms final inference time on the tiny fixture index.
Its GeoJSON provides a reproducible observed-path example despite empty live output.

## 26–27. Story 30F implications and UI constraint

Story 30F should distinguish candidate/likely/confirmed, preserve boundary uncertainty,
handle null rejoin/affected-segment geometry, check source and observation freshness,
and label provenance explicitly. Counts are bounded evidence, not fleet totals. Identity
survives retained-state refinement, not cache loss. Multiple corridors per route are
normal. Do not use inferred geometry as 30D's expected route, for navigation, or to
invent streetcar track/temporary stops. Longer continuous observation and trustworthy
static/realtime matching coverage would improve completed-path recall; four-poll cold
fallbacks cannot provide that continuity. Live data did not establish path accuracy.

**No user-facing UI, map rendering, controls, styling, route highlights, browser polling,
frontend schema/types or frontend behavior changed. `data/current.json` is unchanged.**
