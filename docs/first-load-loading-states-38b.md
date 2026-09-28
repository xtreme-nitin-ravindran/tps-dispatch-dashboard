# Story 38B — First-load loading states

Story 38B adds explicit, low-cost feedback without changing list size, Map/Calls ownership, map overlays, or product layout.

## States

- App shell: ready as soon as the module binds the existing controls.
- Incidents: `loading`, `ready`, `unavailable`, or `error`. A successful empty snapshot becomes the existing zero-results presentation only after readiness.
- Map: `loading`, `ready` after the first Leaflet tile is usable, or `error` when Leaflet/tiles are unavailable.
- Secondary sources: `loading`, `ready`, or `error`; their existing local stale/unavailable messages remain authoritative.
- Stale incident data remains visible with the existing source warning and is never presented as loading or zero.

The initial incident list contains one status rather than card-shaped placeholders. On the first successful snapshot only, the app crosses two animation frames before building and atomically committing the populated fragment. This gives the browser a paint opportunity without an arbitrary timer. Later refreshes retain usable content.

The collapsed bottom-sheet header says “Loading nearby calls…” until incident readiness. Quick Look keeps both actions enabled and uses a separate incident status so location permission or manual-area messages are not overwritten.

## Deterministic fixture URLs

Serve the repository on loopback. These switches do not activate on production hosts.

- Slow incidents: `/?mobileAuditFixture=many&mobileAuditUx=reliability&mobileAuditDelay=incident&uxAudit=1`
- Slow map: `/?mobileAuditFixture=many&mobileAuditUx=reliability&mobileAuditDelay=map&uxAudit=1`
- Slow secondary sources: `/?mobileAuditFixture=many&mobileAuditUx=reliability&mobileAuditDelay=secondary&uxAudit=1`
- Combined slow load: `/?mobileAuditFixture=many&mobileAuditUx=reliability&mobileAuditDelay=incident,secondary,map&uxAudit=1`
- Successful zero: `/?mobileAuditFixture=zero&mobileAuditUx=reliability&mobileAuditDelay=incident,map&uxAudit=1`
- Incident sources unavailable: `/?mobileAuditFixture=unavailable&mobileAuditUx=reliability&mobileAuditDelay=incident,map&uxAudit=1`
- Stale/cached incidents: `/?mobileAuditFixture=stale&mobileAuditUx=reliability&mobileAuditDelay=incident,map&uxAudit=1`
- Normal fast fixture: `/?mobileAuditFixture=many&mobileAuditUx=reliability&uxAudit=1`

Append `&mobileAuditView=calls` to inspect the Calls surface. Use `&mobileAuditSheet=half` or `&mobileAuditSheet=expanded` to inspect the sheet body.

## Physical iPhone Brave validation

Do not treat desktop emulation as device acceptance.

1. Clear Brave site data, start a screen recording, and open SirenTO.
2. Confirm the map and calls surfaces explain their loading state before any blank region appears.
3. Confirm Quick Look and Map/Calls controls accept input while data loads.
4. Expand and collapse the sheet; its header must retain a useful loading/status summary.
5. Confirm populated cards arrive with meaningful content rather than blank shells.
6. Reload while service-worker controlled and confirm there is no persistent loader or aggressive flicker.
7. Repeat at 320, 375, 390, and 430 CSS-pixel widths when available.

Physical Brave success remains unclaimed until this checklist is run on an iPhone.
