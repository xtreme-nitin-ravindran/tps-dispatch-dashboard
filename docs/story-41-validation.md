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
- Extended the same measurement to expose two more root variables:
  `--mobile-layer-stack-center` (the vertical center of the stacked Police
  Divisions / Road closures controls) and `--mobile-layer-control-width` (the
  wider of the two controls' rendered widths). Both are measured from the same
  frame with no additional listeners.

### `styles.css`

- Desktop: `.map-wrap` defines `--map-layer-control-width: 200px`. The Road
  closures control is `right: 10px; left: auto; width: 200px` and anchors at
  `top: var(--police-control-bottom, 47px)`. The Police Divisions Leaflet
  control shares the same `200px` width.
- Mobile (`max-width: 680px`): both controls **shrink-wrap to their content**
  (`width: max-content`) and are **right-aligned** (`right: 8px; left: auto`).
  They share a measured `min-width: var(--mobile-layer-control-width, 0)` so
  their rendered widths match even though their labels differ. The Road closures
  control anchors at `top: var(--police-control-bottom, 56px)`. The Police
  Divisions label weight is set to `700` to match the Road closures label so the
  two stacked controls read as one group.
- The fullscreen/× focus control is **left-aligned** (`left: 8px`) and
  **vertically centered** against the stack via
  `top: calc(var(--mobile-layer-stack-center, 56px) - 24px)`.
- Focus mode: the Road closures control and the Police Divisions corner both
  respect right safe-area insets and keep `left: auto`; the focus control keeps
  its left safe-area inset and stack-center anchoring.
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

### Layout follow-up verification (shrink-wrapped stack + centered focus control)

Measured rendered geometry via Playwright Chromium against the deterministic
loopback fixture on port `8765`:

- At 390×844 (non-focus): Police Divisions `x=203, w=167, right=370`; Road
  closures `x=203, w=167, right=370`; focus control `x=20, w=48`, vertical
  center `576` = stack center `576`; zoom control `x=334, y=703` (no collision).
- At 320, 375, 390, 430, and 844×390 landscape: widths match, right edges match,
  the focus control is vertically centered and left of the stack, label text is
  `start`-aligned, and there is no horizontal overflow.
- In focus mode (390×844): Police Divisions `x=215, right=382`; Road closures
  `x=215, right=382`; focus control `x=8, y=32` (center `56` = stack center
  `56`); navigation band `y=160`; summary `y=212`; map info `y=256`; no
  overlaps.

## Final diff and publication

The application/test diff is small and scoped: **6 files, +56/-32**, plus this
validation document. It contains no unrelated churn and no
`data/current.json` changes.

No commit or push was made. Publication still requires explicit authorization.

## Outstanding acceptance

Physical iPhone Safari/Brave validation remains outstanding. The story is
**IMPLEMENTED / AWAITING VALIDATION** until that device check is complete.
