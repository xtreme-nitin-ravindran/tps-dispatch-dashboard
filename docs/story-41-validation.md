# Story 41 — Stack Police Divisions / Road Closures Controls

## Scope

Make the two map layer controls render as a clean vertical stack instead of a
compressed two-column row, and rename the boundary control's visible label.

- The **Road closures** control now sits directly below the **Police Divisions**
  control.
- The boundary control's visible label was renamed from **Police division
  boundaries** to **Police Divisions**. The full official wording
  (`Police division boundaries — Toronto Police Service`) stays in the map
  attribution.
- Both controls render at identical widths at every supported viewport.
- 44 px touch targets, safe-area insets, and existing behavior are preserved.
- No overlap, clipping, horizontal scrolling, or interference with map gestures
  or the zoom control.

This is a narrowly scoped layout follow-up to Story 40 (Mobile Full-Screen Map
Mode). It does not change map data, filtering, or interaction semantics.

## Changes

### `app.js`

- Renamed the Leaflet layer name from `"Police division boundaries"` to
  `"Police Divisions"` and the concise mobile label from `Police divisions` to
  `Police Divisions`.
- Extended `syncMobileLayerRowOffset()` to measure the Police Divisions
  control's real rendered bottom edge (relative to `.map-wrap`) and expose it as
  the `--police-control-bottom` CSS variable on the document root. The
  measurement runs inside the existing coalesced `scheduleMapMaintenance` frame,
  so no new listeners, refetch, or layer recreation are introduced.

### `styles.css`

- Desktop: `.map-wrap` defines `--map-layer-control-width: 200px`. The Road
  closures control is `right: 10px; left: auto; width: 200px` and anchors at
  `top: var(--police-control-bottom, 47px)`. The Police Divisions Leaflet
  control shares the same `200px` width.
- Mobile (`max-width: 680px`): both controls are full-width with matching
  `8px` left/right insets. The Road closures control anchors at
  `top: var(--police-control-bottom, 56px)`.
- Focus mode: the Road closures control and the Police Divisions corner both
  respect left/right safe-area insets.
- Focus-mode floating chrome (`max-height` on `.mobile-focus-filter-summary` and
  `.map-info`) is bounded to the space above the bottom sheet and attribution so
  the taller stacked row cannot push chrome over the required map credit.

### Cache / versioning

Because `styles.css` and `app.js` changed and the service worker matches shell
assets with `ignoreSearch: true`, the query-string cache-busters alone cannot
invalidate cached assets. The app/stylesheet cache-busters advanced to
`story-41-1` and `CACHE_VERSION` advanced to `sirento-shell-v50`. The four
affected version-string assertions were updated across
`cluster-asset-versioning`, `pwa-metadata`, and `mobile-compositing` coverage.

## Verification

- Full Docker suite: **753/753** pass.
- UTC suite: **473/473** pass.
- America/Los_Angeles suite: **473/473** pass.
- Python: **7/7** pass.
- Live integrations: **8/8** pass.
- Coverage gate: **100.00% lines / 100.00% branches / 100.00% functions**.
- JavaScript syntax (`node --check`), ESLint, and `git diff --check` pass.
- Rendered-browser regressions pass: `npm run test:story-40e:browser` (**3/3**)
  and `npm run test:story-39a:browser` (**5/5**).

One Story 39A browser run failed while loading its fixture with a
`TimeoutError` at line 48, before any connector assertion ran. This was the
pre-existing load-timing flake rather than a layout failure; the suite passed
**5/5** on re-run.

## Final diff and publication

The application/test diff is small and scoped: **10 files, +79/-37**, plus this
new validation document. It contains no unrelated churn and no
`data/current.json` changes.

No commit or push was made. Publication still requires explicit authorization.

## Outstanding acceptance

Physical iPhone Safari/Brave validation remains outstanding. The story is
**IMPLEMENTED / AWAITING VALIDATION** until that device check is complete.
