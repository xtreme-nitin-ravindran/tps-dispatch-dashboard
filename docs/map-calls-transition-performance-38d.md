# Story 38D — Map / Calls transition performance

Measured locally on the deterministic 1,212-call fixture in the in-app Chromium
browser at 390 × 844. These numbers are diagnostic desktop emulation, not a claim
about physical iPhone Brave.

Fixture URL:

`http://127.0.0.1:43999/?mobileAuditFixture=many&mobileAuditView=map&mobileAuditLocation=current&mobileAuditRadius=toronto&mobileAuditSheet=half&mobileAuditRoads=on&mobileAuditBoundaries=on&incident=mobile-audit-selected&uxAudit=1`

The port is replaceable with any local static-server port. The important fixture
parameters are the 1,212-call `many` state, Toronto-wide radius, Map initial mode,
half sheet, both overlays enabled, selected incident, and opt-in audit.

## Sequence before Story 38D

1. The click audit and first-interaction fixture work ran.
2. `mobileView` changed.
3. The bounded incident-list subtree moved to its new owner.
4. The root view mode, active button, ARIA visibility, and bottom-sheet visibility changed.
5. Leaflet attribution was synchronized immediately.
6. Map overlap measurement and `invalidateSize` were queued for the next animation frame.
7. Preferences were written synchronously.
8. Selected-incident reconciliation was queued two frames later for Map.

The one-frame map job could run before the switched state painted. The path did not
refilter incidents, render calls, rebuild markers, rebuild road closures, reconstruct
police boundaries, refetch sources, or recreate Leaflet.

## Sequence after Story 38D

1. The click handler changes `mobileView`.
2. It updates the active button, root view mode, Map/Calls ARIA visibility, and bottom-sheet visibility.
3. It moves the already-rendered bounded list (40 cards) to the visible owner without regenerating it.
4. A cancelable two-frame scheduler gives the switched DOM a paint opportunity.
5. Only the latest transition performs attribution/overlap maintenance.
6. A Map reveal performs at most one coalesced `invalidateSize`, then reconciles the selected incident if needed.
7. Preference persistence runs in the same deferred maintenance job.

A new user view choice made while incident data is loading is authoritative: late
fixture/preference/deep-link startup restoration no longer overwrites it. Rendering
triggered by other startup controls also leaves the Story 38B loading message intact
instead of temporarily presenting an unavailable result.

## Timing

| Measurement | First | Repeated |
| --- | ---: | ---: |
| Map → Calls handler | 3.7 ms | 3.0 ms |
| Map → Calls visual response | 15.8 ms | 21.4 ms |
| Calls deferred maintenance | 0.5 ms | 0.3 ms |
| Calls → Map handler | 2.8 ms | 2.9 ms |
| Calls → Map visual response | 47.3 ms | 45.1 ms |
| Map deferred maintenance | 6.9 ms | 6.6 ms |
| Map-reveal `invalidateSize` | 3.3 ms | 3.6 ms |

The initial 1,212-incident marker construction (83.9 ms) and police-boundary layer
initialization (231.7 ms) happened during startup, not during a view toggle. Toggle
measure intervals contained no incident refilter/resort, marker/cluster rebuild, road
overlay rebuild, police-boundary reconstruction, source fetch, or list regeneration.

## Browser verification

- 320, 375, 390, and 430 px: correct exclusive Map/Calls visibility, no horizontal overflow, no blank primary surface.
- Calls always retained one `#callList` with 40 cards; Map restored the same list to the half sheet.
- The selected incident and half-sheet state survived repeated toggles.
- Each Map reveal produced one effective resize invalidation; Calls produced none.
- Scheduler unit tests cover same-frame rapid toggles, cancellation after the first frame, and final-generation-only maintenance.
- A 1.5-second delayed incident fixture stayed in Calls with `Loading calls…`, then completed with 40 cards and the selected incident without restarting the fetch.

## Physical iPhone Brave checklist

Use a cold load and, preferably, screen-record it:

1. Enable both overlays, select an incident, and leave the sheet at half height.
2. Test the first Map → Calls and first Calls → Map.
3. Repeat the pair five times, including several quick taps.
4. Confirm the mode changes immediately, taps and scrolling remain responsive, the map/list never goes blank, controls do not go stale, and the previous sheet state returns.

Physical iPhone Brave remains the authoritative acceptance environment and has not
been run here.

## Story 38E recommendation

If physical Brave still freezes after this transition split, capture a screen recording
and Web Inspector main-thread trace using the opt-in audit. Story 38E should then target
the independently measured police-boundary/large Leaflet SVG startup cost, without
reopening Map/Calls ownership or bounded incident rendering.
