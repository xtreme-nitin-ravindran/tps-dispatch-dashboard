# Story 38G — police-boundary Canvas lifecycle containment

## Finding and containment

The exact visual failure was reproduced in local Chromium with the deterministic fixture.
It remained visible after police boundaries were switched OFF. DOM inspection identified
106 SVG paths with class `cluster-connector`; the police pane contained a separate Canvas.
The lines were incident-cluster connectors, not projected police geometry.

Selecting an incident automatically expanded its entire screen-space cluster. At the fixture's
wide zoom the selected group contained 106 calls, and `spreadPoint()` used an unbounded
`count × 7` pixel radius. The result was a persistent, city-spanning connector fan whose light
stroke matched the reported “radiating white lines.” Sheet and boundary transitions exposed the
already-retained expanded cluster but did not create corrupt police coordinates.

Cluster fan-out is now limited to 12 incidents and its radius is capped at 96 pixels. A selected
incident inside a larger cluster is rendered as its own selected marker alongside the cluster,
without expanding the group or creating connectors. This preserves selection while making a
city-spanning fan structurally impossible.

The lifecycle audit identified a concrete unsafe ordering in the production path: a sheet
height transition lasts 180 ms, while map invalidation and police redraw could occur after
only one to three animation frames. The dedicated police Canvas and its cached projected
parts were then reused through later size/transform changes. Roads do not share the police
renderer: road lines use the `roadClosurePane`, while police boundaries now use the isolated
`policeBoundaryPane`.

The police lifecycle remains conservative:

1. A sheet state change immediately updates the visible controls and cancels pending police
   redraw work.
2. Police drawing remains suppressed until the CSS transition window and two paints finish.
3. The final map layout is captured and `invalidateSize({pan:false})` runs once.
4. The existing police layer is redrawn once after invalidation.
5. Roads keep their existing renderer and resize lifecycle.

Map reveal and other explicit size invalidations use the same stale-safe redraw path.
Generation checks prevent stale rapid-toggle work from running. Renderer reuse remains because
the reproduction proved the police Canvas was not causal; repeated rebuilding would add risk
without addressing the incident-cluster connector defect.

## Deterministic exact-sequence fixture

Start a loopback static server on a port other than 8080, for example 4173, and open:

`http://127.0.0.1:4173/?mobileAuditFixture=many&mobileAuditView=map&mobileAuditRoads=on&mobileAuditBoundaries=off&mobileAuditSheet=collapsed&view=1&incident=mobile-audit-selected&uxAudit=1&policeBoundaryDebug=1`

This uses 1,212 deterministic incidents, the selected-incident production path, the real
road-closure path, the real map/sheet lifecycle, and bundled production police geometry.
The fixture and its data switches are ignored off loopback.

Run this order first:

1. Confirm Map mode, Road closures ON, Police boundaries OFF, and the selected incident.
2. Enable Police division boundaries.
3. Set the sheet to Half.
4. Set the sheet to Collapsed.
5. Pan and zoom once.

Then compare `mobileAuditRoads=off`/`on` and `mobileAuditBoundaries=off`/`on` independently.

## Physical diagnostic export

Add `policeBoundaryDebug=1` to any build-under-test URL. An explicit diagnostics panel appears
with **Copy JSON** and **Download JSON**. Immediately after a corrupt frame, use either action
before reloading. The export retains the latest 80 lifecycle captures and includes:

- lifecycle time/reason, sheet state, mobile view, zoom, rounded map center, size, pixel origin,
  pane transform, and redraw scheduling/generation state;
- police/road layer and renderer IDs, pane/renderer sharing checks, Canvas CSS and backing-store
  dimensions, device pixel ratio, and renderer bounds;
- per-feature projected-part counts, bounds, endpoint samples and checksums, layer bounds, non-finite points,
  viewport-spanning jumps, out-of-renderer points, and source-ring mismatches.

The export does not read precise user location, saved locations, Watch This Area subscriptions,
tokens, storage, or private content. Map center is rounded to three decimal places.

## Browser stress procedure

At 320, 375, 390, and 430 CSS px, run at least 20 cycles with roads ON and an incident selected:

1. Police boundaries ON/OFF/ON.
2. Half then Collapsed.
3. Map → Calls → Map.

After each width, verify one visible police Canvas, no orphan Canvas growth, one police layer,
roads still present, no blank map, and no projected or dimension issues in the JSON export.

## Required physical iPhone Brave retest

On the production/build-under-test URL, repeat ten times: Road closures ON → Police boundaries
OFF → select incident → boundaries ON → Half → Collapsed → inspect. Then pan/zoom, Map → Calls
→ Map, toggle boundaries five times, and rotate if available. Acceptance requires zero radiating
lines, no persistent corruption, no multi-second freeze, and immediate control response. A
Chromium pass is supporting evidence only and cannot close Story 38G.
