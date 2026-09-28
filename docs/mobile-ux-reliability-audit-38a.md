# Story 38A — Mobile UX reliability audit and instrumentation

Audit date: 2026-09-28. This story adds opt-in measurements, loopback-only delay
fixtures, geometry diagnostics, and tests. It does not redesign loading UI, change
Map/Calls ownership, virtualize the list, or repair geometry.

## Executive summary

The strongest measured bottleneck is the 1,212-card DOM, not a lazy import. On a
390×844 in-app Chromium run, creating the complete list took 63.3 ms and contributed
to a 177 ms initial main-thread task. Moving that already-rendered list between its
Calls and Map-sheet parents costs 32–34 ms synchronously; the complete handler takes
36–38 ms and the next painted state arrives in 80–93 ms. Each toggle generated a
60–65 ms long task. A Toronto-wide radius click that does not change the radius still
rerenders all cards and took 92.4 ms.

The code creates each card off-DOM, fills all meaningful text in the same function,
and appends one completed fragment. The first card took 0.3 ms from clone to meaningful
content and was not connected while empty. There is no asynchronous card hydration.
Reported blank card shells are therefore most consistent with the browser failing to
paint during the large atomic list commit/style/layout task, possibly amplified by
iOS font/compositing work, rather than empty card nodes being intentionally inserted.

The map has no explicit loading status. The local run creates Leaflet at 197 ms and
receives its first tile-ready event at 357 ms; the slow-map fixture exposes the same
surface as unexplained empty map space for about 2.6 seconds. Service-worker setup
begins only at `load`, after the first UI and initial render. A controlled warm reload
improved first usable UI by only 28.5 ms and full readiness by 13.1 ms. It does not
cache the live incident snapshot, Google fonts, Leaflet CDN files, or map tiles.

The bundled police geometry is structurally sound: 16 features, 18 polygons, 19
rings, 24,459 coordinates, zero invalid rings, zero invalid coordinates, zero
segments over 25 km, maximum segment 1.628 km, and checksum `f543bca4` before and
after Leaflet layer construction. The renderer does not mutate it and view changes do
not recreate the layer. Current evidence therefore weighs against corrupt source data
or cross-ring conversion in this checkout and toward an intermittent Leaflet SVG
renderer/clipping/lifecycle defect on iOS. A physical-device capture is still needed
at the moment the defect occurs.

## Method and limitations

Measurements use the production initialization and rendering functions with the
deterministic 1,212-incident fixture at 390×844. Times are `performance.now()` values
from navigation start. Long tasks come from `PerformanceObserver` where supported.
The cold run used a new loopback origin with no controlling worker; the warm run was a
reload controlled by the newly installed worker. The test machine is not an iPhone
and the in-app browser is Chromium, so these numbers are a reproducible baseline, not
a substitute for the Brave physical-device pass below. The reported 3–4 second iOS
stall was not reproduced in desktop-class Chromium; the measured work identifies the
path most likely to scale badly on that device.

Enable measurements on any deployment with `?uxAudit=1`. No console logging is
emitted. In DevTools, use `window.__sirentoUxAudit.snapshot()`. The same JSON is
mirrored, only while enabled, in `#sirentoUxAuditReport`.

## Definition of first usable UI

First usable means that the page structure and an understandable loading state are
visible; Search, Filters, radius, and Map/Calls controls accept input; and no primary
surface presents a large unexplained empty region. It does not require map tiles,
markers, road closures, TTC data, or police boundaries to be complete.

The instrumented code currently marks control readiness, not full satisfaction of
that UX definition, because the map and collapsed sheet do not yet identify
themselves as loading. What blocks the true definition is missing visual state, not
control event hookup: controls were wired at 121.9 ms while the map remained
unexplained until Leaflet/tile paint.

## Measured first-load timeline

Cold 390×844 loopback run, 1,212 incidents, boundaries and roads enabled:

| Milestone | Navigation time | Incremental work |
| --- | ---: | ---: |
| HTML parsed | 82.8 ms | — |
| App bootstrap begins | 120.6 ms | 37.8 ms after parse |
| Incident fixture fetch begins | 121.5 ms | — |
| Controls wired / instrumented first usable | 121.9 ms | 1.3 ms after bootstrap |
| Fixture fetch ends | 122.8 ms | 1.3 ms |
| Incident normalization ends | 128.0 ms | 5.2 ms |
| Filter/sort ends | 132.7 ms | 1.4 ms |
| First incident render begins | 133.2 ms | — |
| First meaningful card complete, off-DOM | 134.2 ms | 0.3 ms |
| First incident render ends | 196.5 ms | 63.3 ms, 1,212 cards |
| First map creation ends | 207.8 ms | 10.9 ms |
| Initial marker/cluster creation ends | 211.5 ms | 3.5 ms, 15 representations |
| Road/TTC preparation ends | 213.4 ms | under timer resolution |
| First Leaflet tile-ready | 357.0 ms | — |
| Boundary preparation ends | 444.2 ms | 236.7 ms wall time, including fetch/render |
| First fully rendered UI | 444.2 ms | — |
| Worker registration begins | 358.4 ms | after page `load` |
| Worker registration ends | 449.3 ms | — |
| Cached shell assets ready | 449.6 ms | — |

The initial main-thread long task ran from 119.8–296.8 ms (177 ms). Boundary work
produced a second 55 ms task from 390.1–445.1 ms.

## Cold, warm, and worker-controlled comparison

| Milestone | Cold, uncontrolled | Warm, worker-controlled | Difference |
| --- | ---: | ---: | ---: |
| HTML parsed | 82.8 ms | 62.6 ms | −20.2 ms |
| Bootstrap | 120.6 ms | 92.6 ms | −28.0 ms |
| Controls wired | 121.9 ms | 93.4 ms | −28.5 ms |
| 1,212-card render complete | 196.5 ms | 170.1 ms | −26.4 ms |
| First tile ready | 357.0 ms | 354.1 ms | −2.9 ms |
| Fully rendered | 444.2 ms | 431.1 ms | −13.1 ms |
| Shell cache ready | 449.6 ms | 379.3 ms | −70.3 ms |

The worker is network-first for navigation and cache-first only for its same-origin
shell allowlist. It deliberately excludes live incident data. Leaflet JS/CSS, Google
fonts, and OSM tiles are cross-origin and outside that allowlist. The worker therefore
helps repeat shell asset retrieval but cannot explain or cure the dominant card DOM,
boundary SVG, or tile work. On true first visit, registration/cache population happens
too late to help the first render. A stale worker can serve an old allowlisted asset
because query strings are ignored; cache-version changes are therefore required for
instrumentation releases, as done here with `sirento-shell-v27`.

## Blank-region inventory and loading recommendation

Classification: A skeleton, B spinner/progress, C text status, D immediately
interactive shell with background loading, E no loading UI.

| Surface | Current pre-load behavior | Why it looks blank | Desired behavior | Class |
| --- | --- | --- | --- | --- |
| Quick Look | Heading, copy, location actions, and status render in HTML | Not blank; data-derived summary is elsewhere | Keep actions live and say incidents are loading when relevant | D/C |
| Search / Filters | Complete controls render immediately | Not blank; options are incomplete until incidents populate divisions | Keep interactive; label division population only if delayed materially | D |
| Radius / Map–Calls | Complete controls render immediately | Not blank | Keep interactive; visual pressed/view state must precede heavy work | D |
| Map container | Fixed-height empty `#dispatchMap`; road status says “Not available yet” | No central map/loading state before Leaflet and tiles | Map-specific progress/status, then distinguish tile failure from no incidents | B/C |
| Incident results | Static loader exists inside `#callList`; the list is moved into the active mobile owner | In Map mode the collapsed sheet hides the loader body; atomic replacement can delay paint | Deterministic list skeleton or concise status; zero state remains distinct | A/C |
| Bottom sheet | Header says “Recent calls nearby”; body contains the moved loader when opened | Header does not say that data is loading; collapsed body conceals feedback | Loading count/status in header; body skeleton only when open | C/A |
| TTC | Travel section has static explanatory shell; feed content arrives with snapshot rendering | Mobile visibility and secondary delay can make it absent/unreachable | Text status because it is secondary; never block first usable | C |
| Map info | Collapsed summary and static legend/source copy | No primary blank region | No loading UI; update located count when ready | E |

Hidden mobile views use `display:none` and do not reserve layout space. The fixed
bottom sheet is out of flow. The material unexplained allocation is the fixed-height
map before Leaflet paint; the perceived card shell is a paint/blocking issue, not an
empty hydrated node found in source.

## Incident-card timeline and cause

- Container clone to meaningful title: 0.3 ms for the first card.
- `connected` at that point: `false`.
- Initial render passes: one.
- Cards committed in that pass: 1,212.
- Full list construction/commit: 63.3 ms cold, 66.0 ms warm, 77.9 ms in the
  intentionally delayed run.
- No dynamic import, font-gated visibility, opacity gate, or follow-up hydration was
  found. Card fields are populated synchronously in `createIncidentCard`.
- Google fonts are external and may change later glyph metrics, but fallback text is
  not intentionally hidden.

Conclusion: blank-looking cards are most likely missed/intermediate paints while the
large fragment is built, inserted, styled, and composited on iOS. A physical recording
with the audit report is needed to distinguish main-thread blocking from a WebKit paint
artifact, but an empty-card data-binding bug is not supported by current evidence.

## First-interaction timings

Deterministic loaded state, 1,212 incidents:

| Interaction | First handler | Subsequent | Finding |
| --- | ---: | ---: | --- |
| Calls | 36.3 ms | 36.9 ms | No meaningful first-use penalty; list move dominates |
| Map | 38.1 ms | 36.0 ms | `invalidateSize` is scheduled; selected sync adds 4.1–4.4 ms later |
| Visual Calls response | 83.5 ms | 80.4 ms | Misses a 50 ms task budget |
| Visual Map response | 92.8 ms | 91.1 ms | Misses a 50 ms task budget |
| Toronto-wide radius, already selected | 92.4 ms | Not repeated in this run | Refilters and rebuilds all cards unnecessarily |
| Filters disclosure | 0.1 ms | — | Cheap |
| Incident selection in Calls | 2.1 ms | — | Cheap without map pan/cluster expansion |
| Bottom-sheet expansion | 0.1 ms | — | `invalidateSize` is deferred |
| Road overlay off/on | 0.2 / 0.4 ms | — | Cheap in fixture |
| Boundary overlay off/on | <0.1 / 0.1 ms | — | Existing layer is reused |

No production dynamic imports exist and map, markers, controls, listeners, and the
boundary fetch are initialized during first render. A localhost-only 180 ms synthetic
lazy-work switch proved the instrumentation: first Calls measured 211.3 ms, then Map
30.6 ms and Calls 34.5 ms. The same signature is absent without that switch. Current
evidence does not support lazy module/listener initialization as the production cause.

## Map / Calls timing breakdown

Measured with many incidents, Toronto-wide scope, boundaries and roads on, a selected
incident, and a half sheet:

| Component | Calls | Map |
| --- | ---: | ---: |
| State update | <0.1 ms | <0.1 ms |
| Move existing 1,212-card list to new owner | 32.6–33.5 ms | 32.1–34.1 ms |
| Presentation attributes/classes | 3.1–3.4 ms | 3.3–3.5 ms |
| Schedule map maintenance / `invalidateSize` | 0.1–0.2 ms | 0.2 ms |
| Preference persistence | 0–0.1 ms | 0–0.1 ms |
| Selected-incident synchronization | n/a | 4.1–4.4 ms, deferred two frames |
| Total handler | 36.3–36.9 ms | 36.0–38.1 ms |
| Next painted state | 80.4–83.5 ms | 91.1–92.8 ms |
| Browser long task | 60–62 ms | 63–65 ms |

The toggle does not repopulate/clear the list, refilter, rebuild markers, recreate
overlays, or reinitialize Leaflet. Its expensive operation is reparenting a large DOM
subtree, followed by style/layout/paint. This is the best-supported explanation for a
3–4 second iOS stall: the same work is modest on the audit machine but is synchronous
and scales with DOM/card complexity. Heavy work currently happens before the visible
transition can paint.

## Long-task findings

| Phase | Duration | Responsible path | Interpretation |
| --- | ---: | --- | --- |
| Initial load | 177–220 ms | bootstrap + normalize/filter + 1,212-card commit + map/markers | Primary first-load blocker |
| Boundary completion | 50–55 ms | GeoJSON diagnostic/Leaflet SVG construction | Secondary; should not block usable UI |
| Calls toggles | 60–62 ms | list ownership + presentation + paint | DOM reparent/layout |
| Map toggles | 63–65 ms | list ownership + presentation + map scheduling + paint | DOM reparent/layout; selection follows |
| Synthetic first click | 235 ms | explicit localhost-only 180 ms work plus toggle | Fixture correctly isolates first-use work |

Long Tasks attribution is often only `self` in Chromium and may be unsupported in
iOS Brave. The audit associates task intervals with overlapping named measures and
retains raw start/duration data; iPhone recordings should pair those entries with the
Web Inspector main-thread trace when available.

## Police-boundary geometry findings

The validator accepts only Polygon/MultiPolygon GeoJSON, Toronto-range `[longitude,
latitude]` positions, closed rings with at least four positions, and correct nesting.
Diagnostics report feature/polygon/ring counts, invalid coordinates/rings, segment
thresholds, maximum segment, and a deterministic source checksum.

Bundled result: 16 features; 18 polygons; 19 rings; 24,459 positions; zero invalid
rings/coordinates; zero >25 km or >100 km segments; 1.628 km maximum; checksum
`f543bca4` before and after `L.geoJSON`; mutation `false`. Each polygon/ring is passed
as GeoJSON directly to Leaflet—there is no custom flattening, clipping, simplification,
or cross-ring joining. One boundary layer is created and reused; Map/Calls toggles do
not touch it. The source is therefore exonerated for the audited revision. The next
failure capture must record this diagnostic plus rendered SVG path `d` values; an
unchanged checksum with radiating SVG lines would prove a Leaflet/WebKit render or
clipping lifecycle defect.

## Root-cause hypotheses ranked by evidence

1. **Large synchronous incident DOM/style/layout work — high confidence.** Directly
   measured in first render, radius rerender, list reparent, visual response, and long
   tasks. It explains first-load and toggle scaling on slower iOS hardware.
2. **Missing loading semantics creates perceived blankness — high confidence.** The
   map has fixed height but no central status; the collapsed sheet conceals its body’s
   loader. This explains why waits feel like failure even before optimization.
3. **Boundary SVG renderer/clipping lifecycle on iOS — medium confidence.** Source,
   nesting, segments, checksum, and mutation are clean. The defect is intermittent and
   still needs a corrupt-frame device capture.
4. **Cross-origin critical dependencies on cold load — medium confidence.** Leaflet is
   parser-critical ahead of the module; fonts/Leaflet/tiles are outside the worker.
   Network conditions can delay bootstrap/map paint, though the local cold/warm gap
   was small.
5. **Lazy initialization on first click — low confidence.** No dynamic import or first
   listener setup was found, and first/subsequent toggle handlers were nearly equal.

## Practical Story 38 acceptance targets

Targets apply to the primary supported physical iPhone Brave run under a reasonable
network, with separate reporting for cold and warm loads:

- visible app shell: ≤1.0 s cold, ≤0.5 s warm;
- usable controls: ≤1.5 s cold, ≤0.75 s warm;
- incident/map loading state visible: within 100 ms of shell paint;
- button pressed/selected/view ownership feedback: within 100 ms;
- Map/Calls visible response: ≤100 ms, even with 1,200 incidents;
- deferred view maintenance complete: ≤500 ms in the many-incident fixture;
- ordinary interaction main-thread task: ≤50 ms; exceptional initial chunks should be
  split so no single task exceeds 100 ms.

Visual response and completion are deliberately separate. Tiles, clustering,
boundaries, road closures, and TTC may finish later without holding the selected view
or loading explanation hostage.

## Deterministic fixture URLs

Serve on a loopback port other than 8080. These switches are ignored off loopback.

- Baseline many incidents:
  `/?mobileAuditFixture=many&mobileAuditUx=reliability&uxAudit=1`
- Slow first incident load (1,500 ms):
  `/?mobileAuditFixture=many&mobileAuditUx=reliability&mobileAuditDelay=incident&uxAudit=1`
- Slow secondary feed (1,200 ms):
  `/?mobileAuditFixture=many&mobileAuditUx=reliability&mobileAuditDelay=secondary&uxAudit=1`
- Slow map-ready path (1,000 ms):
  `/?mobileAuditFixture=many&mobileAuditUx=reliability&mobileAuditDelay=map&uxAudit=1`
- First-click lazy work (180 ms, exactly once):
  `/?mobileAuditFixture=many&mobileAuditUx=reliability&mobileAuditDelay=lazy&uxAudit=1`
- Combined stress:
  `/?mobileAuditFixture=many&mobileAuditUx=reliability&mobileAuditDelay=incident,secondary,map,lazy&uxAudit=1`
- Toronto-wide, overlays, selected incident, half sheet:
  `/?mobileAuditFixture=many&mobileAuditUx=reliability&mobileAuditRadius=toronto&mobileAuditRoads=on&mobileAuditBoundaries=on&mobileAuditSheet=half&view=1&incident=mobile-audit-selected&uxAudit=1`
- Calls view:
  `/?mobileAuditFixture=many&mobileAuditUx=reliability&mobileAuditView=calls&uxAudit=1`

The existing `mobileAuditLocation`, `mobileAuditFilters`, `mobileAuditRadius`,
`mobileAuditSheet`, `mobileAuditView`, `mobileAuditRoads`, and
`mobileAuditBoundaries` switches remain composable. Delays resume the real production
render/state path after waiting.

## Usability regression-test strategy

Unit/structural tests should avoid exact time assertions:

- first load retains meaningful loader/status content until atomic replacement;
- loading, zero, unavailable, and populated states are structurally distinct;
- cards are completed before connection and have one initial population pass;
- inactive views are not separately populated and listeners do not accumulate;
- a view’s selected/pressed state changes before deferred map/list work;
- repeated toggles preserve one list owner and one boundary layer;
- geometry rejects wrong nesting, reversed coordinates, open rings, invalid positions,
  suspicious segments, and source mutation;
- fixture delays are accepted only with explicit reliability mode on loopback.

Browser tests should use coarse budgets around named marks, not brittle millisecond
equality. Test cold, warm, and worker-controlled loads; slow incident/secondary/map
states; 1,212 incidents; Toronto-wide; overlays; selection; and every sheet state.
Assert that the relevant loading explanation is visible before releasing each delay,
then that real data replaces it. Assert a visual-response mark before completion work
and no growing render/listener counts across repeated toggles.

## Physical-device acceptance checklist

Primary: current iPhone Brave. Repeat a practical subset in iPhone Safari.

1. Record device/iOS/browser versions, network type, orientation, theme, and whether
   Low Power Mode is active.
2. Clear site data, start a screen recording, open the instrumented production URL,
   and record shell, loading-state, first usable, first data, tile, and full-ready
   moments plus the exported audit JSON.
3. Reload once warm and once confirmed worker-controlled. Note blank regions and
   compare the same marks.
4. From the fully loaded many-incident state, tap each control once, then repeat it:
   Map, Calls, radius, Filters, boundaries, roads, incident card, and each sheet state.
5. Run Map → Calls → Map with Toronto-wide data, overlays independently off/on, a
   selected incident, and collapsed/half/expanded sheet.
6. Repeat light/dark and portrait/landscape where practical.
7. If geometry corrupts, do not reload immediately. Capture screen/video, audit JSON,
   source checksum, overlay state, zoom/centre, and (with Web Inspector) rendered SVG
   path data and a performance trace.
8. For every run record approximate visible delay, whether taps animate/press before
   waiting, unexplained blank surfaces, frozen scrolling, longest obvious jank, and
   whether corruption survives pan/zoom/toggle.

## Recommended follow-on scopes

- **38B — first-load feedback:** add explicit map, sheet-header, Quick Look/data, and
  list loading/zero/error states; keep controls interactive; remove critical Leaflet
  CDN dependence or provide a clearly recoverable failure state.
- **38C — card/list cost:** bound or virtualize initial list rendering, skip no-op
  filter/radius rerenders, preserve completed cards, and test that no blank shells are
  connected. This is the highest-leverage performance story.
- **38D — interaction and Map/Calls response:** change visible ownership/pressed state
  before reparent/layout work, defer map invalidation and selected synchronization,
  and avoid moving a 1,200-card subtree during the input task while preserving the
  established single-owner model until a separately approved design changes it.
- **38E — boundary root cause:** capture the iOS corrupt frame, compare source checksum
  with SVG output, isolate Leaflet clipping/renderer reuse, then reject or sanitize
  invalid geometry at the boundary and add renderer-level regression coverage. Do not
  add another cosmetic line-hiding patch.
