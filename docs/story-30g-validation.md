# Story 30G — TTC completion and release validation

## Recovery audit — 2026-09-29

Recovered the existing dirty `dev` tree without resetting, reverting, or replacing
the Story 30A–30G implementation. No staged changes were present. After inspection,
`git pull --ff-only origin dev` reported already up to date. Reviewed the tracked
diff, untracked TTC implementation/tests and pipeline files, both validation
reports, saved coverage, and the later `browser-release` results and screenshots.
The original coverage work was already complete; there are no current uncovered
lines, branches, or functions in the project's measured suite.

Fresh Docker validation of the recovered code:

| Check | Recovery result |
| --- | --- |
| Combined coverage, UTC and America/Los_Angeles | 691/691 each; 100% lines, branches, functions |
| Unmodified coverage badge gate | Passes both fresh reports |
| Unit suites, UTC and America/Los_Angeles | 421/421 each |
| Live-source integration | 8/8 |
| Story 38G regression | 96/96 |
| Python | 7/7 |
| JavaScript/Python lint and browser/module syntax | Pass |
| Local Concourse pipeline validation | Pass |
| Responsive Chromium rerun | Pass; six widths, both themes, five alternate fixtures |
| Working-tree and staged whitespace checks | Pass; generated snapshot unchanged |

Fresh logs and badges are in `.cache/story30g/recovery/`. Corrected the README's
outdated Node 20 testing instructions to match the existing Node 22 Docker image
and package engine requirement. No application changes were needed for coverage.
The fresh browser run exited successfully and saved screenshots/results under
`.cache/story30g/recovery/browser/`. All six widths reported zero page errors,
12 stress cycles each, and zero remaining layers after alert expiry. Interaction
long-task maxima were 97, 97, 130, 101, 96 and 139 ms at 320, 375, 390, 430, 768
and 1440 px respectively. The selected-summary minute-refresh assertion passed.
Reviewed the recovered mobile dark and desktop light screenshots and the fresh
390 px dark screenshot. Browser emulation does not satisfy physical iPhone gates.

The earlier narrative below predates the saved `browser-release` run. That run
also exercises the selected TTC summary across the real minute refresh and captures
long tasks from an initialization script. Its recorded interaction maximum is
123 ms; all initial maxima are zero, which must not be interpreted as proof that
initial rendering has no cost. It contains six widths with no page errors and the
five alternate fixture modes. Physical-browser acceptance remains separate.

On recovery, the user requested continued physical checks via iPhone Mirroring.
The app currently requires the user's Touch ID or Mac login before it can be used.
No new physical acceptance pass is claimed while that unlock is pending. Remaining
checks are Safari's fixed-build Map/Calls transition, Brave dark mode, repeated
selection/sheet transitions and dynamic browser-toolbar behavior in both browsers.
Production-path verification still requires separately authorized promotion and
pipeline installation; this recovery does not publish, commit, push, or deploy.

Work remains on `dev`, fast-forwarded from `origin/dev` before changes. Existing
uncommitted Story 30A–30F work was preserved. No commit, push, branch-protection
bypass, or deployment was performed. `data/current.json` is unchanged.

## Coverage gate

Baseline: **99.85% lines / 98.06% branches / 99.44% functions**.
Final Docker Node 22 report in **both UTC and America/Los_Angeles**:
**100.00% lines / 100.00% branches / 100.00% functions**.
Both reports pass the unmodified `scripts/coverage-badges.py` publication gate.
No thresholds, exclusions, or coverage measurement rules changed. As documented
in the README, this gate measures loaded Node modules and tests; it does not
include browser-only UI interactions or Python. Those are validated separately.

Exact baseline modules below 100%, with the behavior tests added:

| Module | Baseline line / branch / function % | Added validation |
| --- | --- | --- |
| `scripts/publish-ttc-geometry.js` | 77.78 / 66.67 / 100 | Real CLI output, default expiry, candidate exclusion, replacement by unavailable/empty output, public allow-list |
| `scripts/ttc-vehicles.js` | 81.32 / 62.86 / 37.50 | Real fixture and infer-only CLI, optional static files, filesystem errors, normal polling, missing/corrupt/oversized restart files, fresh reset, invalid limits, offline static failure |
| `src/disruptions/ui.js` | 100 / 100 / 98.11 | Active backend TTC alert suppresses its duplicate in the legacy nearby list |
| `src/ttc/correlation.js` | 97.40 / 88.64 / 96.74 | Explicit ordered stops, future service date, trip-only and mismatched-direction catalog, absent selectors, degenerate projection, invalid metadata/catalog/reference/segment schemas |
| `src/ttc/diversion-geometry.js` | 100 / 98.18 / 91.67 | Closed-path simplification and intermediate scheduled vertices |
| `src/ttc/diversion-inference.js` | 100 / 95.14 / 99.09 | Cold inference with confirmed history, stale/ambiguous/missing departure, discontinuous restored history, unsupported/ambiguous alerts, construction cause, route cluster cap, merging prior identities, legacy TTL, unanchored single-vehicle episodes, output/state corruption |
| `src/ttc/lifecycle.js` | 100 / 95.65 / 100 | Invalid clock, future bounded and invalid windows, legacy first-seen/update fallback |
| `src/ttc/map-layer.js` | 100 / 97.06 / 100 | Destroy with live layers/listeners, reuse existing pane, unknown selection does not frame arbitrary geometry |
| `src/ttc/presentation.js` | 94.59 / 91.89 / 95.24 | Missing stop name, route/items/period metadata, absent observed list, unprojected segment, outside-radius label, snapshot merge preserving other sources |
| `src/ttc/static-gtfs.js` | 100 / 84.35 / 100 | Invalid CSV/identity/numbers/calendar, missing names/shapes, empty network, ZIP headers/members/comment/missing tables, deflated ZIP equivalence |
| `src/ttc/static-source.js` | 100 / 89.29 / 100 | HTTP/size failure retains known-good cache; unreadable cache is reported |
| `src/ttc/vehicle-detector.js` | 100 / 92.65 / 100 | Degenerate shape, missing trip pattern, conflicting trip, probable route-only context, unavailable initial state, trip-scoped directional alerts, corrupt restart/evidence |
| `src/ttc/vehicle-feed.js` | 85.71 / 88.89 / 100 | Chunked response, stream size/transport failure, deleted/nonvehicle records, invalid feed/observation timestamps |
| `src/ttc/vehicle-geometry.js` | 100 / 90.48 / 100 | Missing/short/degenerate geometry never produces a projection |
| `test/ttc-diversions.test.js` | 100 / 99 / 97.67 | Unequal journey lengths; bounded long episode is asserted nonempty; infer-only uses `assert.fail` as its forbidden transport |

35 meaningful tests added, taking the combined suite from 656 to 691. Detailed
baseline V8 ranges and intermediate investigation reports are local ignored
artifacts under `.cache/story30g/`; final coverage reports are
`coverage-utc.txt` and `coverage-la.txt` there.

Simplifications: the detector's newest sample always belongs to its evidence run,
so impossible empty-run fallbacks were removed. Inference's validated retirement
TTL no longer has an impossible missing-value fallback. The impossible inferred
geometry overflow branch was removed: at most 120 accepted samples plus two
boundaries can enter a 122-point output, and simplification never adds points.
CLI path defaults now reside in `runVehiclePolling` rather than being duplicated.
The snapshot composition helper is used by `app.js` and was retained and tested.
Normal polling accepts an injected alert updater for deterministic transport tests.

## Final user experience

- Route identity uses names such as **504 King**; multiple routes remain separate
  labels, and missing metadata falls back to source route IDs.
- The existing OFFICIAL TTC DISRUPTION hierarchy plus structured detour/construction
  copy supplies status without another badge competing with NEW/UPDATED.
- Dashed amber means the affected part of the normal scheduled route. It never
  claims the route is closed. Solid teal means an observed diversion; both styles
  have theme-aware equivalents and selected line weights.
- Observed detail heading now explicitly says **Observed diversion · Observed by
  SirenTO**, followed by “Based on repeated TTC vehicle movements. This is not an
  official TTC-published route.”
- The contextual checkbox is now simply **TTC disruptions**. The existing legend
  retains conditional affected-route and observed-diversion swatches.
- Affected stops remain in the existing collapsed `<details>` list, with no stop
  marker cloud. Valid active-period timestamps use Toronto-local formatting;
  empty or invalid periods no longer produce a stray time label or throw.
- Successful empty data leaves no TTC panel, dead checkbox, or legend entry.
  Unavailable/stale official data uses existing source-status copy. Observed data
  must be fresh, confirmed, related, valid, and unexpired independently of alerts.
- Geometry expiration removes the observed line pair while preserving the official
  alert/selection. Alert expiration removes all TTC layers and clears selection.
  The browser suite explicitly asserts both transitions and control cleanup.
- The `multiple` fixture now pairs an observed **504 King** diversion with a
  scheduled-only **501 Queen** alert (three parts/six Leaflet layers). Existing
  tests retain same-route distinct-direction identity and malformed-geometry checks.

## Production artifact contract and wiring

| Stage | Produced/retained data | Publication |
| --- | --- | --- |
| Incident ETL | 30A alerts → 30B lifecycle → 30C correlation in `current.json.ttcAlerts` | `data/current.json` on `data` branch |
| Concourse vehicle task | Static cache, 30D vehicle state, 30E inference state in task cache; deviations/diversions in task output | Internal state is not staged for the data branch |
| Public projector | `publicTtcGeometry()` validates full inference output and selects confirmed public fields | `data/ttc-diversions.json` on `data` branch |
| GitHub fallback | Fresh detector/inference state per four-poll burst; cached static ZIP only | Same public projection; candidate/likely paths never published |
| Browser | Fetches both raw data-branch URLs with cache-busting and `cache: no-store` | Displays only valid active alerts/geometry |

The Concourse job orders observe → read latest snapshots → project/commit → put.
Its independent job cannot block incident publication. The copied data repository
preserves unrelated files; only compact TTC geometry is staged. Concurrent writes
fail normal fast-forward pushes safely and retry on a later cycle. The projector
replaces an old file with an empty list for successful-zero or unavailable output.
If the task crashes before publication, browser freshness and expiry still suppress
old observed geometry; it is not retained indefinitely.

The GitHub fallback publishes alert/static correlation through the existing stale
snapshot updater, and geometry through its separate vehicle workflow. Four cold
polls do not assume sufficient completed multi-vehicle evidence. Diagnostic
artifacts have one-day Actions retention; raw histories and cluster state are not
published to the browser's data branch. Developer fixtures remain loopback-gated. GitHub Pages `_config.yml` now excludes
`test`, `scripts`, `concourse`, `docs`, package/tool files and local caches from the
deployed site. The YAML exclusion list was parsed and checked locally; its live
build must still be verified after promotion. This uses the documented Jekyll
[source-relative exclude configuration](https://jekyllrb.com/docs/configuration/options/).
`.gitignore` explicitly excludes all local `.cache/` evidence and previews.
The isolated phone preview is an ignored copy with its own LAN-only fixture gates,
not a production-code bypass.

Local `fly validate-pipeline -c concourse/pipeline.yml`: **passes**. Real projector
CLI tests verify redaction, confirmed-only output and empty replacement. End-to-end
fixtures exercise the protobuf → lifecycle → static → detector → inference → public
artifact → frontend contract, including retained state and cold fallback behavior.

Live verification found the published page still loading `story-38g-4`, and the
public data-branch `ttc-diversions.json` URL returned **HTTP 404**. This confirms the
new feature is not deployed. After renewing Concourse authentication, `fly jobs` showed only `update-sirento`;
recent builds 3564–3567 succeeded, and build 3568 was running. The TTC job is not
installed. Production confirmation requires normal protected promotion and a
Concourse pipeline update; no live update was made.

## Cache and service worker

App-shell cache advanced to `sirento-shell-v39`; HTML asset URLs use `story-30g-1`.
The worker precaches frontend modules but does not intercept live TTC geometry,
including a same-origin artifact URL. Dedicated assertions cover both same-origin
and raw data-branch geometry URLs. Existing app-shell/offline/source-state tests pass.
An offline tab retains source freshness semantics and the independent 30-second
expiry check; it cannot keep observed geometry indefinitely.

## Automated validation

| Check | Result |
| --- | --- |
| Docker unit tests, UTC | 421/421 |
| Docker unit tests, America/Los_Angeles | 421/421 |
| Combined coverage suite, UTC | 691/691; 100/100/100 |
| Combined coverage suite, America/Los_Angeles | 691/691; 100/100/100 |
| Coverage badge gate | Passes both reports |
| Story 38G regression | 96/96 |
| Live source integration | 8/8 |
| Python | 7/7 |
| JavaScript and Python lint | Pass |
| App, service-worker, src and scripts syntax | Pass |
| Concourse pipeline configuration | Pass |
| `git diff --check` | Pass |

These suites overlap; their totals must not be added as unique tests.
Chromium responsive tests pass at 320, 375, 390, 430, 768 and 1440 px in both themes,
with alert-only, confirmed, multiple, expired, unavailable and empty fixtures.
There are 12 stress cycles per width (72 total) and 20 real renderer refreshes per
width (120 total). Selected incident/TTC synchronization, expiry, retained path DOM
identity and bounded layer counts pass with no page errors or document overflow.
Final browser artifacts: `.cache/story30g/browser-accepted/`. This run also repeatedly toggles police boundaries. An earlier attempt completed all six responsive widths, then timed out loading the expired fixture; the complete rerun passed (exit 0).

Long-task maxima by width: **103, 102, 102, 99, 144, 97 ms** respectively.
Maximum **144 ms**, compared with 117 ms in 30F. An earlier concurrent run measured
194 ms. These are local desktop measurements, not physical-device CPU timings;
no claim of identical performance is made. Existing first-render observation limits
remain: the observer starts after initial fixture load. Layer diagnostics report
four layers for confirmed, six for multiple, two after observed expiry, and zero
after alert expiry. No production-visible debug UI was added.

## Physical iPhone and release status

Physical testing uses iPhone Mirroring, connected after the user unlocked it, and
an isolated LAN preview of the working tree. Production remains on the older build.
Safari checks observed so far: light-mode TTC card/detail, named route, collapsed
stops, provenance, map selection, distinct dashed/solid paths, road closures and
police boundaries together, boundary toggle, zoom, and half/collapsed sheet. Dark
Calls and emergency incident selection were also inspected. The Map-to-Calls
footer jump was subsequently reproduced in Brave and fixed as described below.
The complete dynamic-toolbar and repeated-transition matrix is not yet signed off.

Brave successfully loaded the same LAN preview. Checked light-mode detail text,
route identity, collapsed stops, observed provenance, map selection, road overlays,
police boundaries off/on, collapsed/half/expanded sheet states, pan and zoom. The
observed and scheduled paths stayed distinct, with no visible radiating or duplicate
lines; attribution remained visible in these checks.

Physical testing exposed a reproducible Map → Calls jump to the footer in both
browsers. The click handler now brings the selected view control into view after
layout, preventing the long list's reparenting from leaving the user at the footer.
A browser regression assertion checks that the Calls control remains in the
viewport after each switch. After explicitly versioning the preview's app URL to
avoid cached code, Brave showed the Calls controls and list at the expected
position; switching back to Map also worked. Safari has not yet rerun this fix.

The user switched the phone to another app during further testing. The remaining
Brave dark-mode, repeated selection/transition sequences and dynamic-toolbar
matrix, plus Safari's final fixed-build acceptance, remain pending. The user
reported having run physical tests, but has not supplied pass/fail or tested-build
details. Neither browser is recorded as a complete acceptance pass.

**Story 30 is not yet production-ready.** Remaining mandatory gates are complete
physical Safari/Brave acceptance, Safari verification of the
scroll fix, and deployed production-path verification after normal
protected promotion and pipeline installation. Local coverage and automated
validation gates pass. No optional new TTC feature is needed for this release.
