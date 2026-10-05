# Mobile Focus-Mode Chrome Contract

Authoritative reference for the mobile full-screen map ("focus mode") chrome
layout. It describes the behavior that the current production code, the
rendered-browser regressions, and completed Stories 39A, 40E, 42, 43, 44, and 49
already implement. It is descriptive, not aspirational: if the code or tests
contradict this document, the code and tests win and the discrepancy should be
reported rather than silently reconciled.

All selectors, CSS custom properties, and script names below were verified
against the current repository.

## 1. Purpose and boundaries

Focus mode is an **in-page** map-first workspace for phones. It is not the
browser Fullscreen API and it does not change browser history.

- Entry/exit is a single mobile-only `<button id="mobileMapFocusToggle">`
  (`aria-controls="mapView"`, `aria-pressed`, `aria-label` toggling between
  `Full screen map` and `Exit full screen map`). The icon glyph toggles between
  `⛶` and `×`.
- State lives on `document.documentElement.dataset.mobileFocus` (`"on"`/`"off"`).
- Focus mode is only meaningful on the mobile layout
  (`isMobileViewLayout()` → `mobileLayoutMedia.matches`). `setMobileFocusMode`
  coerces to `false` off the mobile layout, and a layout change that leaves the
  mobile breakpoint exits focus mode.
- Focus mode reuses the existing map, bottom sheet, Map/Calls/Disruptions
  navigation, and disruptions panel. It must not create a second map, call list,
  disruption panel, bottom sheet, or state path.
- The Map / Calls / Disruptions session persists across focus mode. Switching to
  Calls or Disruptions keeps the session; returning to Map restores the
  full-screen focused layout. `setMobileView` never mutates focus state.

## 2. Participating chrome elements

| Element | Selector | Role in the layout |
|---|---|---|
| Map stage | `.map-stage` / `#mapView` | Owns the map. In focus mode it becomes `position: fixed; inset: 0` at `z-index: 700`. |
| Map panel / wrap | `.map-panel`, `.map-wrap` | Leaflet host. `.map-wrap` is the positioning context for the layer controls and the focus control. |
| Map canvas | `#dispatchMap` | Leaflet container; carries `--mobile-map-sheet-overlap`. |
| Focus control | `#mobileMapFocusToggle` (`.mobile-map-focus-toggle`) | Enters/exits focus mode. Left-aligned, vertically centered against the layer-control stack. |
| Layer controls | `.map-layer-toggle` (Road closures) and `.map-panel .leaflet-top.leaflet-right .leaflet-control-layers` (Police Divisions) | Right-aligned, stacked, shrink-wrapped to content. |
| Zoom control | `.leaflet-control-zoom` | Leaflet bottom-right control. |
| Attribution | `.leaflet-control-attribution` | OpenStreetMap credit; kept in the lower-right chrome. |
| Navigation band | `.mobile-view-toggle` inside `.radius-controls` | Map / Calls / Disruptions. Floated in focus mode. |
| Applied-filter summary | `#mobileFocusFilterSummary` (`.mobile-focus-filter-summary`) | Read-only `role="status"` summary of applied filters; hidden outside focus mode. |
| Map-info disclosure | `#mapInfo` (`.map-info`) | `<details>` legend/source panel; floated in focus mode. |
| Bottom sheet | `#mobileBottomSheet` (`.mobile-bottom-sheet`) | Existing nearby-calls sheet; `z-index: 850`. |

## 3. Measured CSS custom properties

The geometry synchronization path is `scheduleMapMaintenance()` →
`syncMapSheetOverlap()` + `syncMobileLayerRowOffset()` →
`syncMobileFocusChromeMetrics()`. It runs inside the existing coalesced
`requestAnimationFrame` maintenance frame with no new listeners, refetch, or
layer recreation. `setRootMetric()` writes a root variable only when its rounded
value changes, so the pass cannot thrash layout or re-trigger the
`ResizeObserver`.

| Variable | Written by | Measured from | Meaning |
|---|---|---|---|
| `--mobile-map-sheet-overlap` | `syncMapSheetOverlap()` | map rect vs sheet rect | Overlap of the map bottom under the sheet; set on `#dispatchMap`. |
| `--mobile-sheet-height-actual` | `syncMapSheetOverlap()` | `#mobileBottomSheet` height | Real rendered sheet height (collapsed sheet grows to fit a wrapped summary). |
| `--police-control-bottom` | `syncMobileLayerRowOffset()` | Police Divisions control bottom − `.map-wrap` top | Top anchor for the Road closures control. |
| `--mobile-layer-row-bottom` | `syncMobileLayerRowOffset()` | `.map-layer-toggle` bottom − `.map-wrap` top | Bottom of the layer-control stack; anchors the focus control and floating chrome. |
| `--mobile-layer-stack-center` | `syncMobileLayerRowOffset()` | midpoint of Police Divisions top → Road closures bottom | Vertical center the focus control is centered against. |
| `--mobile-layer-control-width` | `syncMobileLayerRowOffset()` | wider of the two layer controls | Shared `min-width` so both controls render at equal width. |
| `--mobile-focus-height` | `syncMobileFocusChromeMetrics()` | `#mobileMapFocusToggle` height | Focus-button height; offsets the navigation band below it. |
| `--mobile-nav-bottom` | `syncMobileFocusChromeMetrics()` | `.radius-controls` bottom | Navigation band bottom; anchors the filter summary. |
| `--mobile-summary-bottom` | `syncMobileFocusChromeMetrics()` | `#mobileFocusFilterSummary` bottom | Filter-summary bottom; bounds the map-info max-height. |
| `--mobile-zoom-clearance` | `syncMobileFocusChromeMetrics()` | `window.innerWidth − zoom.left` | Horizontal clearance the map info must leave for the zoom column. |
| `--mobile-attribution-clearance` | `syncMobileFocusChromeMetrics()` | `window.innerHeight − attribution.top` | Vertical clearance the map info must leave above the attribution. |

`syncMobileFocusChromeMetrics()` returns early unless focus mode is active on the
mobile layout, because the fixed chrome's viewport-relative rectangles are only
meaningful then.

### Measured boundaries vs. static fallbacks

Every measured variable is consumed with a static fallback so the layout is
correct before the first measurement frame:

| Variable | Static fallback |
|---|---|
| `--police-control-bottom` | `47px` (desktop) / `56px` (mobile) |
| `--mobile-layer-row-bottom` | `64px` |
| `--mobile-layer-stack-center` | `56px` |
| `--mobile-layer-control-width` | `0` (mobile) / `200px` via `--map-layer-control-width` (desktop) |
| `--mobile-focus-height` | `48px` |
| `--mobile-nav-bottom` | `calc(var(--mobile-layer-row-bottom, 64px) + 108px)` |
| `--mobile-summary-bottom` | `calc(var(--mobile-layer-row-bottom, 64px) + 152px)` |
| `--mobile-zoom-clearance` | `calc(8px + 34px + 8px)` |
| `--mobile-attribution-clearance` | `calc(var(--mobile-sheet-height-actual, var(--mobile-sheet-height, 52px)) + 28px)` |
| `--mobile-sheet-height-actual` | `var(--mobile-sheet-height, 52px)` |

Static (non-measured) layout variables:

- `--map-layer-control-width: 200px` on `.map-wrap` (desktop layer-control width).
- `--mobile-map-height: 460px` (normal mobile map height); overridden to
  `100vh`/`100dvh` in focus mode.
- `--mobile-sheet-height: calc(52px + env(safe-area-inset-bottom, 0px))`
  (collapsed sheet), with `half`/`expanded` derived from `--mobile-map-height`.

## 4. Safe-area insets

Safe-area insets are applied on every relevant edge:

- Page shell: `padding-right/left: env(safe-area-inset-right/left, 0px)` and
  `padding-top/bottom: env(safe-area-inset-top/bottom, 0px)`.
- Focus control: `left: calc(8px + env(safe-area-inset-left, 0px))`.
- Layer controls: `right: calc(8px + env(safe-area-inset-right, 0px))`.
- Leaflet top corners: `top: calc(8px + env(safe-area-inset-top, 0px))`.
- Navigation band: `top` includes `env(safe-area-inset-top, 0px)`; focused Calls
  uses `calc(8px + env(safe-area-inset-top, 0px))`.
- Filter summary: `left`/`right` include the left/right insets; `top`/`max-height`
  include the top/bottom insets.
- Map info: `left` includes the left inset, `right` includes the right inset,
  `bottom` includes the bottom inset, `max-height` includes both vertical insets.
- Bottom sheet: `padding-bottom: env(safe-area-inset-bottom, 0px)`; in standalone
  display mode it also insets `right`/`left`.

## 5. Stacking (z-index)

| Layer | z-index |
|---|---|
| Map stage (normal mobile) | `0` (with `isolation: isolate`) |
| Map stage (focus mode) | `700` |
| Map load status overlay | `450` |
| Layer controls (`.map-layer-toggle`, Leaflet layers control) | `500` |
| Map note | `500` |
| Focus control | `600` |
| Filter summary | `600` |
| Map info (focus mode) | `750` |
| Navigation band (focus mode) | `800` |
| Bottom sheet | `850` |
| Glossary popover | `1000` |
| Police-boundary debug panel | `10000` |

The map info (`750`) floats above the map stage (`700`) and the focus
control/summary (`600`), and below the navigation band (`800`) and bottom sheet
(`850`). Leaflet's own `.leaflet-top` corner stacks at `z-index: 1000`; this is
why the attribution is kept in the lower-right corner rather than the top-left
(see Story 40F).

## 6. Minimum interactive target

Interactive controls must be at least **44 × 44 px**:

- Focus control: `48 × 48 px`.
- Layer controls: `min-height: 48px`; their inner labels `min-height: 44px`.
- Navigation buttons: `min-height: 44px`.
- Sheet state controls: `min-height: 44px`.
- Map-info summary: `min-height: 44px` on mobile.

The rendered-browser regressions assert `>= 44` (with a `0.5px` sub-pixel
tolerance) for the focus control, the navigation band, and the layer controls.

## 7. Story 39A cluster-connector bounds

Cluster expansion is bounded in `src/map-clusters.js`:

- `MAX_EXPANDED_CLUSTER_SIZE = 12` — at most 12 incidents expand from one cluster.
- `MAX_FAN_OUT_RADIUS_PX = 96` — fan-out radius never exceeds 96 px.

`app.js` enforces the same bounds at render time: it throws if more than
`MAX_EXPANDED_CLUSTER_SIZE` `.cluster-connector` paths are rendered, and a large
cluster surfaces only the selected incident marker instead of fanning out every
incident. Connectors must remain within their owning cluster control: each
connector is a `L.polyline([center, endpoint])` whose endpoint is produced by
`spreadPoint`, so it is always within 96 px of its cluster center and is removed
when the cluster collapses, the selection changes, or the view/filter/radius
changes. Stale or duplicate connector paths must never accumulate.

## 8. Map info must clear the zoom-control column

In focus mode the map info is bottom-anchored and stops short of the zoom
control horizontally:

```
right: calc(var(--mobile-zoom-clearance, calc(8px + 34px + 8px)) + 8px + env(safe-area-inset-right, 0px));
```

`--mobile-zoom-clearance` is the zoom control's real measured distance from the
viewport right edge, so the panel leaves an accurate 8 px gap to the zoom column
instead of a hardcoded width. The rendered-browser regression asserts the map
info does not overlap `.leaflet-control-zoom`.

## 9. Vertical-clearance relationships

From the top of the focused viewport downward:

1. **Focus control** is vertically centered against the layer-control stack
   (`top: calc(var(--mobile-layer-stack-center, 56px) - 24px)`).
2. **Navigation band** sits below the focus button:
   `top: calc(var(--mobile-layer-row-bottom, 64px) + var(--mobile-focus-height, 48px) + 8px + env(safe-area-inset-top, 0px))`.
3. **Filter summary** anchors below the navigation band's real bottom edge
   (`--mobile-nav-bottom` + 8 px), clamped so a taller layer row cannot push it
   into the bottom chrome on short landscape viewports.
4. **Map info** is bottom-anchored above the attribution's real clearance
   (`--mobile-attribution-clearance` + 13 px) and bounded above by
   `--mobile-summary-bottom`.
5. **Attribution** sits in the lower-right chrome, below the zoom control and
   clear of the sheet.
6. **Bottom sheet** is fixed to the bottom (`z-index: 850`); the map's
   bottom-corner controls are lifted by `--mobile-map-sheet-overlap`.

In focused Calls/Disruptions the map-only controls are hidden, so the navigation
band moves to `calc(8px + env(safe-area-inset-top, 0px))` and the calls content
starts just below it (`main { padding-top: calc(8px + 44px + 8px + env(safe-area-inset-top, 0px)); }`).

### 9.1 Landscape focus-mode chrome (Story 50)

The relationships above are the **portrait** layout. In landscape the viewport is
only ~390 px tall, so chaining the navigation band below the layer-control stack
and the focus button pushed the band and the filter summary into the middle of
the screen while the bottom-anchored map info rose to meet them, leaving a
measured **7 px** visible map band at 844×390 (the map was effectively covered).

A landscape media query
(`@media (max-width: 950px) and (max-height: 500px) and (pointer: coarse)`, the
same condition the mobile layout uses) overrides the focus-mode chrome:

- **Navigation and close** align at the top safe-area edge. Navigation reserves
  the close button on its left and the measured layer-control width on its right.
- **Filter summary** sits below navigation/close and stops short of the layer
  controls. Long summaries scroll within a 40 px cap.
- **Map info** keeps a complete 44 px disclosure target; its expanded height
  clears both the summary and layer stack and its content scrolls internally.
- **Calls sheet** is capped using the available viewport height minus the
  measured top controls and room for Map info, zoom and attribution. In landscape
  focus mode its state buttons share the heading row, leaving the body for calls.

The regression covers 844×390 and the browser-chrome-reduced 932×342 viewport,
all sheet states, Map info taps/scrolling, long summaries, and rotation back from
portrait. The user confirmed the local fix on physical iPhone Brave on October
5, 2026. Publication and production validation remain pending. Portrait geometry
is unchanged.

## 10. Collapsed and expanded map info

- The map info is a `<details>` element. Collapsed, it is a compact header
  (bounded to `<= 80px` by the regression); expanded, it sizes to its content.
- In focus mode it is `position: fixed` with `top: auto`, `height: auto`, and a
  bounded `max-height: min(60dvh, …)` so it grows upward to its content and
  scrolls internally instead of stretching to fill the gap between two insets
  (the Story 43 defect).
- A usable portion of the map must remain visible: the regression requires the
  map-info top to be at least 20% of the viewport height, and the expanded panel
  to be at most 75% of the viewport height.
- On exit, the map info returns to normal document flow (`position: static`,
  `max-height: none`).

## 11. Required behavior across lifecycle events

| Event | Required behavior |
|---|---|
| Entry | `dataset.mobileFocus = "on"`; label → `Exit full screen map`; `aria-pressed="true"`; icon → `×`; scroll position saved; if not on Map, switch to Map; sheet overlap synced synchronously; maintenance scheduled with `invalidateSize`. |
| Exit | `dataset.mobileFocus = "off"`; label → `Full screen map`; `aria-pressed="false"`; icon → `⛶`; previous scroll position restored on the next frame; map info returns to static flow. |
| Re-entry | The compact collapsed map-info state returns; the filter summary reappears. |
| Viewport resize | `resize` and `visualViewport` resize/scroll schedule maintenance; only the visible map is invalidated. |
| Orientation change | `orientationchange` schedules maintenance with `invalidateSize`; skipped when the mobile layout is not on Map. |
| Asynchronous loading | The fixture readiness contract (`document.documentElement.dataset.incidentLoadState === "ready"`) gates measurement; user-selected state is preserved across async work. |
| User interaction | Unforced pointer and keyboard activation both toggle focus mode; stale deferred map work is superseded by newer interaction. |

## 12. Rendered-browser invariants

The rendered-browser suites enforce:

- **No overlap** between declared element pairs (focus control vs. layer
  controls/navigation/summary/attribution; attribution vs. layer controls/zoom/
  navigation/summary/sheet; map info vs. navigation/summary/sheet/focus/layer
  controls/zoom/attribution; sheet summary vs. handle/state controls).
- **Viewport containment** — every measured chrome rectangle stays inside the
  viewport (0.5 px tolerance).
- **Visible map band** — with the map info collapsed, the vertical gap between
  the lowest top chrome (navigation band, filter summary, layer controls, focus
  control) and the highest bottom chrome (map info, sheet, attribution, zoom
  control) is at least 25% of the viewport height (Story 50). This catches the
  landscape defect where the map info's own top edge was still below 20% of the
  viewport but the band and summary had consumed the map.
- **Target size** — focus control, navigation band, and layer controls are
  `>= 44 px`.
- **Hit-testing** — `document.elementFromPoint` at the focus control's center
  resolves to the focus control; at the attribution's center resolves to the
  attribution link; at the navigation's center resolves to the navigation.
- **Horizontal overflow** — `documentElement.scrollWidth <= clientWidth + 1`.

## 13. Automated vs. physical-device validation

- Automated Chromium regressions run headless via Playwright and cover the
  geometry, hit-testing, and interaction invariants above.
- Automated Chromium success does **not** replace physical-device validation when
  a defect is specific to iPhone Safari, Brave, WebKit, or another
  browser/device environment. The taller wrapped layer row and wrapped
  attribution scenarios in `scripts/mobile-focus-browser.js` simulate the iOS
  Safari failure modes, but physical acceptance remains an outstanding item for
  the relevant stories until confirmed on-device.

## 14. Browser-test ownership map

| Contract area | Script | npm command |
|---|---|---|
| Cluster-connector bounds and lifecycle cleanup (Story 39A) | `scripts/cluster-connectors-browser.js` | `npm run test:story-39a:browser` |
| Focus-control geometry, hit-testing, entry/exit, focused Calls/Disruptions navigation (Stories 40E/40F) | `scripts/mobile-focus-browser.js` | `npm run test:story-40e:browser` |
| Clipped road-closure count (Story 41A) | `scripts/road-closure-count-browser.js` | `npm run test:road-closure-count:browser` |
| Bottom-sheet header: no state label, wrapping summary (Story 42) | `scripts/mobile-sheet-header-browser.js` | `npm run test:story-42:browser` |
| Map-info collapsed/expanded sizing and chrome clearance (Story 43) | `scripts/mobile-map-info-browser.js` | `npm run test:story-43:browser` |
| TTC disruption rendering/state transitions | `scripts/ttc-ui-browser.js` | `npm run test:ttc-ui:browser` |

## 15. Shared test infrastructure

- `scripts/lib/mobile-chrome-assert.js` (Story 49) provides the shared geometry
  math and assertion plumbing: `normalizeRect`, `intersects` (touching edges are
  non-overlapping unless a clearance tolerance is supplied), `readChromeRects`
  (the browser-side reader), `measureChrome(page, selectors)` (one
  `page.evaluate`; a selector may be a string or `{ selector, optional: true }`),
  `assertNoOverlap(state, pairs, label, tolerance)`, `assertInViewport`, and
  `assertNoHorizontalOverflow`. Each feature script keeps its own selectors,
  scenarios, thresholds, and feature-specific assertions, and explicitly declares
  which element pairs must not overlap.
- `scripts/lib/browser-fixture.js` provides the shared fixture-readiness wait:
  `awaitFixtureReady(page, options?)` waits for
  `document.documentElement.dataset.incidentLoadState === "ready"` (default
  timeout `60000ms`), with `isFixtureReady`, `readIncidentLoadState`, and
  `describeFixtureState` exported for direct testing. It is test-only and has no
  production effect.

## 16. Running the browser suites

Targeted suite (during implementation):

```bash
npm run test:story-43:browser
```

Complete aggregate run (before completing a browser-relevant story):

```bash
npm run test:browser
```

`npm run test:browser` (`scripts/run-browser-suites.js`) discovers every
`test:*:browser` package script except itself, sorts them deterministically,
starts and readiness-checks its own loopback server on `127.0.0.1:8765`, runs the
suites sequentially, and tears down the server and child processes on success,
failure, or interruption. Port `8080` must not be used. The browser suites are
outside Docker, CI, `npm run verify`, and `npm run verify:fast`.
