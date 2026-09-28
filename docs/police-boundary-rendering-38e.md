# Story 38E — police-boundary rendering hardening

## Result

Police division boundaries now use a dedicated Leaflet Canvas renderer in the
production path. The boundary control owns an empty placeholder layer; the real
24,459-coordinate geometry is attached only after the control state has had a paint
opportunity. This avoids both the iOS/WebKit SVG path lifecycle implicated by the
radiating-line reports and synchronous geometry attachment inside Leaflet's native
layer-control click handler.

The source geometry remains unchanged: 16 features, 18 polygons, 19 rings, 24,459
coordinates, zero invalid rings/coordinates, no segment over 25 km, maximum segment
1.628 km, checksum `f543bca4` before and after Leaflet construction.

The exact corrupt iPhone frame has not been reproduced outside physical iOS Brave,
so the WebKit failure mechanism is not proved down to a specific Leaflet internal.
The highest-confidence failure path was the large reusable SVG renderer being
projected/redrawn across hidden (`display:none`) map, resize/invalidation, and WebKit
transform/compositing states. Canvas removes the 16 police-boundary SVG paths entirely.

## Lifecycle

- Boundaries off: create only the layer-control placeholder. Do not fetch the GeoJSON
  or construct Leaflet polygons.
- First on: update the native checkbox immediately, wait two animation frames, fetch
  and validate the production GeoJSON, then construct and attach the Canvas layer.
- Off: cancel scheduled work and detach the reusable geometry layer.
- Repeated on: paint the checkbox, then reattach and redraw the same geometry and
  dedicated renderer after two frames. Do not reconstruct or refetch.
- Calls mode: mark boundaries dirty but perform no boundary construction, style update,
  or explicit redraw.
- Calls to Map: reveal Map, let layout settle, run the one coalesced `invalidateSize`,
  then schedule the dirty boundary redraw.
- Theme changes while hidden mark the overlay dirty; the new style/redraw is applied
  only when the map can render safely.

Road closures do not share the police Canvas renderer.

## Chromium measurements

Local in-app Chromium, 390 × 844, deterministic 1,212-call fixture, roads enabled:

| Measurement | Result |
| --- | ---: |
| Boundary-off startup construction | 0 ms / no Canvas / no boundary SVG paths |
| First ON visual handler | 0.1 ms |
| First Canvas construction and render | 49.5 ms (65.7 ms on a separate cold-on run) |
| OFF visual handler | 0.3 ms |
| Repeated ON visual handler | 0.1 ms |
| Reused Canvas reattach/redraw | 4.3 ms |
| Calls to Map boundary redraw | 2.2 ms, after 3.7 ms `invalidateSize` |

Story 38A's prior SVG baseline was a 50–55 ms main-thread construction task during
startup. Canvas and SVG construction were similar in the controlled Chromium sample
(49.5 ms Canvas versus 47.4 ms SVG), so renderer choice is based on lifecycle safety
and DOM elimination rather than a claimed construction-speed win. Canvas produced one
canvas and zero boundary SVG paths; the SVG comparison produced 16 boundary paths.
The material performance changes are zero startup boundary work when disabled,
post-paint first activation, and 4.3 ms reused activation.

## Deterministic fixture URLs

Replace `44004` with any loopback static-server port other than 8080.

- Canvas, boundaries on, roads on, heavy incidents, half sheet:
  `http://127.0.0.1:44004/?mobileAuditFixture=many&mobileAuditView=map&mobileAuditLocation=current&mobileAuditRadius=toronto&mobileAuditSheet=half&mobileAuditRoads=on&mobileAuditBoundaries=on&incident=mobile-audit-selected&uxAudit=1&policeBoundaryDebug=1`
- Lazy/off startup:
  `http://127.0.0.1:44004/?mobileAuditFixture=many&mobileAuditView=map&mobileAuditRoads=on&mobileAuditBoundaries=off&uxAudit=1&policeBoundaryDebug=1`
- Calls-owned startup (no boundary construction until Map is revealed):
  `http://127.0.0.1:44004/?mobileAuditFixture=many&mobileAuditView=calls&mobileAuditRoads=on&mobileAuditBoundaries=on&uxAudit=1&policeBoundaryDebug=1`
- SVG comparison only:
  `http://127.0.0.1:44004/?mobileAuditFixture=many&mobileAuditView=map&mobileAuditRoads=on&mobileAuditBoundaries=off&mobileAuditBoundaryRenderer=svg&uxAudit=1&policeBoundaryDebug=1`

The SVG override and projected-geometry debugger are loopback-only. Both are disabled
by default and ignored on non-loopback hosts.

## Debug capture

With `policeBoundaryDebug=1`, run this in Web Inspector after a corrupt frame or after
the lifecycle action under investigation:

```js
copy(JSON.stringify(window.__sirentoPoliceBoundaryDebug.capture(), null, 2))
```

`latest()` returns the most recent automatic post-paint capture. Captures contain only
render state: lifecycle event, Leaflet IDs, feature/ring identity, SVG `d` attributes
when the SVG comparison is active, map size/zoom/pixel origin, pane and renderer
transforms/bounds, projected part counts, and impossible-segment findings. They do not
include user/device location or incident data. Non-finite points, segments longer than
85% of the larger viewport dimension, and projected parts exceeding source rings are
reported but never used to alter production geometry.

## Physical iPhone Brave acceptance

1. Clear site data.
2. Open SirenTO in Brave.
3. Enable Police division boundaries.
4. Pan and zoom.
5. Switch Map to Calls to Map five times.
6. Toggle boundaries off/on five times.
7. Enable road closures too.
8. Rotate the device if available.
9. Capture a screenshot immediately if radiating lines appear.
10. On a loopback/debug build, copy the diagnostic capture above immediately after the
    corrupt frame.

Also verify that the boundary button does not freeze, no corrupt lines or blank map
appear, and the map remains responsive. Physical iPhone Brave remains the required
final acceptance environment.
