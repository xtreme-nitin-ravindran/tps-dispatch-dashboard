# Story 38 — final mobile reliability acceptance

Acceptance date: 2026-09-28. This record combines the 38F automated/browser preflight,
the completed 38G physical iPhone Brave acceptance, and the final 38V automated pass.
No unperformed Safari, rotation, or installed-PWA result is inferred from Brave,
Chromium, or desktop instrumentation.

## Status

| Area | Status | Evidence |
| --- | --- | --- |
| Physical iPhone Brave | **Pass** | Exact historical 38G failure sequence ×10, Map/Calls ×10, sheet stress ×5, boundary OFF/ON ×5, pan/zoom, roads, first interactions, and attribution passed with no radiating lines or multi-second freeze. |
| Physical iPhone Safari | **Unavailable** | Optional sanity pass was not available. |
| PWA / Home Screen on iPhone | **Unavailable** | Hardware-only gap. |
| Local responsive browser | Pass | Chromium production paths at 320, 375, 390, and 430 px. |
| Story 38 automated suites | **Final pass** | Final totals and coverage are recorded below. |

The final 38V pass found no product regression. It did find stale and incomplete test
coverage around the final 38G diagnostic and redraw paths; those tests were corrected
and strengthened before the complete suite was rerun.

## Physical iPhone Brave acceptance record

| Check | Result |
| --- | --- |
| Exact historical failure sequence ×10 | Pass |
| Large 172-call cluster | Remained clustered; selected incident stayed separately visible |
| Connector fan-out / accumulation | Pass; no radiating lines, giant fan, or stale accumulation |
| Map ↔ Calls ×10 | Pass |
| Sheet-state stress ×5 | Pass |
| Pan / zoom | Pass |
| Police boundaries OFF → ON ×5 | Pass |
| Road closures | Pass |
| First interactions | Pass |
| Attribution | Pass |
| Multi-second freezes | None observed |
| Rotation | Not performed |
| Safari | Not performed |
| Installed PWA / standalone | Not performed |

If a boundary defect reappears, capture the corrupted frame before reload, enable
`policeBoundaryDebug=1`, save `window.__sirentoPoliceBoundaryDebug.snapshot()`, and
return to root-cause work. Do not mark this checklist complete after a corrupt run.

## Local responsive-browser preflight

This is supporting evidence only, not physical Brave acceptance. A loopback Chromium
run used the real rendering and interaction paths at 390×844 with deterministic data.

- Search, compact Filters, the radius row, Map/Calls, map controls, bottom sheet, Map
  info, TTC content, and attribution remained reachable.
- At 320, 375, 390, and 430 px, `documentElement.scrollWidth` equalled the viewport
  width; no horizontal overflow was observed in Map or Calls mode.
- The only visible map attribution was `© OpenStreetMap`; it stayed compact rather
  than spanning the map.
- The high-risk run completed 12 Calls interactions and 12 Map interactions, retained
  the selected `mobile-audit-selected` incident, and retained the half-sheet state.
- Roads and police boundaries were enabled together. Five boundary OFF/ON cycles
  reused one Canvas; the map contained zero `.police-boundary` SVG paths.
- A dark-theme change while Calls hid the map was deferred, then rendered after Map
  returned. The final state had one boundary Canvas, zero boundary SVG paths, and no
  recorded Chromium long task.
- This browser pass does not establish iOS/WebKit paint correctness, touch latency,
  rotation behavior, safe-area behavior on hardware, or physical cold/warm timings.

## Story 38 fixture matrix

Start a static server from the repository root on a loopback port other than 8080;
for example `python3 -m http.server 4173`. Every URL below is exact and uses the
production render path. Data and delay switches are explicit, disabled by default,
and ignored off loopback. `uxAudit=1` only enables measurement output.

### Load

| State | Exact URL |
| --- | --- |
| Normal | `http://127.0.0.1:4173/?mobileAuditFixture=many&mobileAuditUx=reliability&uxAudit=1` |
| Slow incidents | `http://127.0.0.1:4173/?mobileAuditFixture=many&mobileAuditUx=reliability&mobileAuditDelay=incident&uxAudit=1` |
| Slow map | `http://127.0.0.1:4173/?mobileAuditFixture=many&mobileAuditUx=reliability&mobileAuditDelay=map&uxAudit=1` |
| Slow secondary | `http://127.0.0.1:4173/?mobileAuditFixture=many&mobileAuditUx=reliability&mobileAuditDelay=secondary&uxAudit=1` |
| Combined slow | `http://127.0.0.1:4173/?mobileAuditFixture=many&mobileAuditUx=reliability&mobileAuditDelay=incident,secondary,map&uxAudit=1` |

### Data

| State | Exact URL |
| --- | --- |
| Many (1,212) | `http://127.0.0.1:4173/?mobileAuditFixture=many&mobileAuditRadius=toronto&mobileAuditView=calls&uxAudit=1` |
| Zero | `http://127.0.0.1:4173/?mobileAuditFixture=zero&mobileAuditView=calls&uxAudit=1` |
| Stale | `http://127.0.0.1:4173/?mobileAuditFixture=stale&mobileAuditView=calls&uxAudit=1` |
| Unavailable | `http://127.0.0.1:4173/?mobileAuditFixture=unavailable&mobileAuditView=calls&uxAudit=1` |

### Location

| State | Exact URL |
| --- | --- |
| Current | `http://127.0.0.1:4173/?mobileAuditFixture=many&mobileAuditLocation=current&uxAudit=1` |
| None | `http://127.0.0.1:4173/?mobileAuditFixture=many&mobileAuditLocation=none&uxAudit=1` |
| Denied | `http://127.0.0.1:4173/?mobileAuditFixture=many&mobileAuditLocation=denied&uxAudit=1` |
| Saved | `http://127.0.0.1:4173/?mobileAuditFixture=many&mobileAuditLocation=saved&uxAudit=1` |
| Manual | `http://127.0.0.1:4173/?mobileAuditFixture=many&mobileAuditLocation=manual&uxAudit=1` |

### Filters

| State | Exact URL |
| --- | --- |
| None | `http://127.0.0.1:4173/?mobileAuditFixture=many&mobileAuditFilters=none&mobileAuditView=calls&uxAudit=1` |
| Multiple | `http://127.0.0.1:4173/?mobileAuditFixture=many&mobileAuditFilters=multiple&mobileAuditView=calls&uxAudit=1` |
| Search | `http://127.0.0.1:4173/?mobileAuditFixture=many&mobileAuditFilters=search&mobileAuditView=calls&uxAudit=1` |
| Zero result | `http://127.0.0.1:4173/?mobileAuditFixture=many&mobileAuditFilters=zero&mobileAuditView=calls&uxAudit=1` |

### Map overlays and selection

| State | Exact URL |
| --- | --- |
| Both off | `http://127.0.0.1:4173/?mobileAuditFixture=many&mobileAuditView=map&mobileAuditRoads=off&mobileAuditBoundaries=off&uxAudit=1` |
| Boundaries only | `http://127.0.0.1:4173/?mobileAuditFixture=many&mobileAuditView=map&mobileAuditRoads=off&mobileAuditBoundaries=on&uxAudit=1&policeBoundaryDebug=1` |
| Roads only | `http://127.0.0.1:4173/?mobileAuditFixture=many&mobileAuditView=map&mobileAuditRoads=on&mobileAuditBoundaries=off&uxAudit=1` |
| Both on | `http://127.0.0.1:4173/?mobileAuditFixture=many&mobileAuditView=map&mobileAuditRoads=on&mobileAuditBoundaries=on&uxAudit=1&policeBoundaryDebug=1` |
| Selected incident | `http://127.0.0.1:4173/?mobileAuditFixture=many&mobileAuditRadius=toronto&mobileAuditView=map&mobileAuditRoads=on&mobileAuditBoundaries=on&view=1&incident=mobile-audit-selected&uxAudit=1` |

### View and sheet

| State | Exact URL |
| --- | --- |
| Map | `http://127.0.0.1:4173/?mobileAuditFixture=many&mobileAuditView=map&uxAudit=1` |
| Calls | `http://127.0.0.1:4173/?mobileAuditFixture=many&mobileAuditView=calls&uxAudit=1` |
| Collapsed | `http://127.0.0.1:4173/?mobileAuditFixture=many&mobileAuditView=map&mobileAuditSheet=collapsed&uxAudit=1` |
| Half | `http://127.0.0.1:4173/?mobileAuditFixture=many&mobileAuditView=map&mobileAuditSheet=half&uxAudit=1` |
| Expanded | `http://127.0.0.1:4173/?mobileAuditFixture=many&mobileAuditView=map&mobileAuditSheet=expanded&uxAudit=1` |

### Combined high-risk scenario

`http://127.0.0.1:4173/?mobileAuditFixture=many&mobileAuditUx=reliability&mobileAuditDelay=incident,secondary,map&mobileAuditLocation=current&mobileAuditFilters=multiple&mobileAuditRadius=toronto&mobileAuditRoads=on&mobileAuditBoundaries=on&mobileAuditView=map&mobileAuditSheet=half&view=1&incident=mobile-audit-selected&uxAudit=1&policeBoundaryDebug=1`

## Final automated verification (38V)

The final pass used the pinned Docker image and did not check for host Node.

| Check | Result |
| --- | --- |
| UTC deterministic suite | 286 passed |
| America/Los_Angeles deterministic suite | 286 passed |
| Full JavaScript / browser-layout / service-worker / live-source suite | 556 passed |
| Focused Story 38G regression suite | 96 passed |
| Python | 7 passed |
| Live integration | 8 passed against the current upstream sources |
| Service worker isolated suite | 11 passed |
| ESLint / Ruff | Passed |
| Browser JavaScript syntax | Passed for `app.js`, `src/`, and `scripts/` |
| Coverage publication validation | Passed; temporary badges generated successfully |
| Coverage | 100.00% lines / 100.00% branches / 100.00% functions |
| `git diff --check` | Passed |
| `data/current.json` | Unchanged |

The first 38V combined coverage attempt exposed reachable gaps in the new boundary and
road diagnostic tests. The full discovery run also found three stale assertions: one
still expected the pre-38G cluster redraw condition, and two assumed a selection event
preceded the new road-redraw diagnostic event. The final tests assert the 38G
large-cluster selection path, stale animation-frame cancellation, renderer/layer
diagnostics, malformed projected geometry, and named road-selection events. No
production behavior was changed during 38V.

## Files changed during final verification (38V)

- `docs/mobile-ux-reliability-acceptance-38f.md`
- `test/incident-layer-performance.test.js`
- `test/police-boundary-lifecycle.test.js`
- `test/police-boundary-overlay.test.js`
- `test/road-overlay.test.js`

## Completion decision

Story 38 is **complete** for its required Brave acceptance and automated verification.
The current `dev` tree is ready to commit and push after the final clean rerun. Rotation,
Safari, and installed-PWA checks remain explicitly unperformed physical-device gaps;
they are not claimed as passes.
