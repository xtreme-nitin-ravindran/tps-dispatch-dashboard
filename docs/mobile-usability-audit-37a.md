# Story 37A — Mobile usability audit

Audit date: 2026-09-26. No layout rules were changed. Measurements below use the
production DOM/rendering path in the in-app Chromium browser and the loopback audit
fixture added by this story. Safari/Brave findings marked “inference” follow directly
from the CSS viewport/safe-area rules and should be confirmed on physical iOS devices
in the implementation story.

## Executive finding

The main problem is not one isolated overlap. Mobile currently renders the full
desktop control stack before the map, then adds a 156 px sticky control and a fixed
72/42dvh/68dvh results sheet. At 390×844 the map starts 1,545 px down the document.
When the sheet is expanded, only about 108 px remains between the sticky control and
the sheet. Leaflet bottom controls are offset by the sheet height even when that
height exceeds the map: zoom reaches y = −13 px and attribution reaches y = 61 px,
outside the map and underneath the sticky control. TTC disruption content is hidden
in both mobile views.

## Mobile DOM and flow hierarchy

Top to bottom in document flow at `max-width: 680px`:

1. `.topbar`: brand, refresh/freshness, theme, second brand image.
2. `.offline-status` when applicable.
3. `.nearby-feature`: Quick Look copy, primary location CTA, Hear sirens, status,
   saved-location controls, manual/clear controls when active, Watch This Area.
4. dialogs (`.watch-dialog`, `.saved-locations-dialog`), out of flow until opened.
5. `.siren-results` when Hear sirens mode is active.
6. `.controls-card`: search, police division, history.
7. `.event-filters`: service plus five event-type buttons.
8. `.view-actions`: filter summary, Clear filters, Share view/status.
9. `.shared-incident-status` when applicable.
10. `.radius-controls`: five radii plus Map/Calls; sticky only at the mobile query.
11. `.nearby-summary`: summary, sort, optional radius expansion.
12. `.mobile-bottom-sheet`: fixed, therefore removed from flow; header, three state
    buttons, optional road detail/feed status, duplicated incident list.
13. `.map-stage`: map, road control, Leaflet police-boundary/zoom/attribution
    controls, empty message, approximation note.
14. `.content-grid`: desktop incident list plus notice/source panels. Hidden in Map
    view; visible in Calls view.
15. `.map-info`: collapsed map info/legend.
16. `.disruptions-panel`: road and TTC details. Hidden in both mobile view states.
17. footer.

The mobile sheet and desktop call list are both populated by `renderList`, so a live
snapshot of 1,048 calls produced two complete card trees even while one was hidden.
This is a memory/DOM-volume concern in addition to layout crowding.

## Persistent UI and information hierarchy

Approximate heights are the measured 390 px portrait values before optional states.

| Element | Purpose | Visibility/position | Height | Competition | Class |
| --- | --- | --- | ---: | --- | --- |
| `.topbar` | Identity, feed status, theme | Always, flow | 121 px | Delays core task | C |
| `.nearby-feature` | Location/siren entry, saved places, Watch | Always, flow | 461 px | Largest pre-map block | A for primary CTA; B/C for rest |
| `.controls-card` | Search, division, history | Always, flow | 192 px | Duplicates later filtering intent | B |
| `.event-filters` | Service/type filtering | Always, flow | 276 px | Five 44 px buttons consume three rows | B |
| `.view-actions` | Filter summary, clear/share | Always, flow | 81 px | Sits before navigation | C |
| `.radius-controls` | Radius and Map/Calls | Always; sticky at 6 px | 156 px | Covers summary/map while scrolling | A |
| `.nearby-summary` | Result summary and sort | After load, flow | 131 px | Covered by sticky control | A/B |
| `.mobile-bottom-sheet` | Map-mode results | Always in Map view; fixed bottom | 72 px / 42dvh / 68dvh | Competes with map and Leaflet controls | A |
| `.map-layer-toggle` | Road overlay | Always over map | 64 px | Half of map top | B |
| `.leaflet-control-layers` | Police boundaries | Always over map | 64 px | Other half of map top | B |
| `.leaflet-control-zoom` | Map zoom | Always over map | 64 px | Shifted by sheet; can leave map | B |
| `.leaflet-control-attribution` | Required credits | Always over map | 34 px at 390 px | Wraps full-width; shifted by sheet | E but legally required |
| `.map-note` | Approximate-location caveat | Always over map | 26 px | Not shifted with the sheet | B |
| `.map-info` | Legend/source details | Collapsed, flow | 50 px | Minor | C |
| `.content-grid` | Calls plus notices/sources | Calls view only | data-dependent | Very large; duplicates sheet cards | A calls; D/E notices/sources |
| `.disruptions-panel` | Road/TTC detail | Hidden in both mobile states | 0 visible | Unreachable | B |
| `.watch-dialog` | Watch setup | Modal on request | up to content/viewport | Can be tall but not persistent | C |

Classification key: A must be immediately available; B useful but collapsible;
C secondary/settings; D rarely needed; E should not occupy prime space.

## Vertical-space measurements

Initial document positions (pixels from document top, live production rendering):

| Viewport | Topbar | Quick Look | Controls + filters + actions | Sticky radius/view | Summary | Map begins |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 320×568 | 145 | 531 | 569 | 156 | 131 | 1,637 |
| 375×667 | 121 | 461 | 587 | 156 | 131 | 1,544 |
| 390×844 | 121 | 461 | 587 | 156 | 131 | 1,544 |
| 430×932 | 121 | 461 | 587 | 156 | 131 | 1,544 |
| 768×1024 | 124 | 351 | 345 | 68 | 125 | 1,139 |
| 1024×768 | 86 | 304 | 345 | 68 | 140 | 1,069 |

The first sheet result is technically available in a fixed 72 px header immediately,
but no incident content is visible until the user opens it. In Calls view, the first
desktop-list incident begins after the same roughly 1.4–1.5k px control stack.

Top five causes of wasted vertical space:

1. `.nearby-feature` combines one primary task with saved locations, explanatory
   copy, Hear sirens, Watch, and conditional area controls (461–531 px).
2. `.event-filters` uses a full-width service select plus a 3-row event grid (276 px).
3. `.controls-card` keeps three full controls visible (192 px).
4. `.radius-controls` uses three radius rows plus Map/Calls and stays sticky (156 px).
5. `.nearby-summary` repeats information already in the sheet header (131 px).

## Positioning and layering audit

| Selector | Breakpoint | Position / offset | z-index | Finding |
| --- | --- | --- | ---: | --- |
| `.controls-card` | default | sticky; top 10 px | 5 | At 681 px and above it remains sticky; mobile overrides it to static only at 680 px. |
| `.radius-controls` | mobile compound query | sticky; top `6px + safe-area-top` | 900 | 156 px tall and above the sheet; covers following flow while stuck. |
| `.mobile-bottom-sheet` | mobile compound query | fixed; bottom 0 | 850 | Covers document/map; safe-area included in its height/padding. |
| `.map-layer-toggle` | all; mobile override | absolute; top/left 8 px | 500 | Occupies left half of top 64 px. |
| Leaflet controls | plugin | absolute corners | Leaflet 800 | Boundary control occupies right half; bottom controls are shifted by sheet height. |
| `.map-note` | all | absolute; left/bottom 12 px | 500 | Unlike Leaflet bottom controls, does not follow sheet height and is obscured. |
| `.map-empty` | all | absolute centred | 500 | Can sit behind expanded sheet. |
| `.glossary-popover` | all | absolute under trigger | 1000 | Can render above sticky/sheet but can extend outside narrow cards. |
| search icon/clear | all | absolute in input | auto | No observed collision. |

Viewport sizing and safe areas:

- `body` uses `min-height: 100vh`; standalone mode changes to `100dvh` and applies
  horizontal safe areas.
- Standalone `.app-shell` adds top and bottom safe-area padding.
- The collapsed sheet is `72px + safe-area-bottom`; half is `42dvh`; expanded is
  `min(68dvh, 100dvh - 176px - safe-area-top)`.
- Expanded height reserves 176 px for the sticky area, but the actual sticky control
  is 156 px plus its 6 px top. Only about 108 px is left between it and the sheet on
  a 390×844 viewport once browser viewport geometry is applied.
- iOS Safari/Brave inference: `dvh` should track changing browser chrome better than
  `vh`, but the sticky top and fixed bottom react independently to safe areas and
  dynamic toolbar changes. The layout has no single shared “usable map viewport”
  calculation, so transient chrome changes can intensify the collision. Standalone
  mode also applies bottom safe area to both the app shell and sheet contexts.

## Breakpoints and contradictory rules

- `min-width: 1051px`: desktop call panel sizing/contained scrolling.
- `max-width: 1050px`: two-column controls, single-column content, two-column side
  stack.
- `max-width: 680px`: portrait-mobile layout, static controls card, single-column
  controls, event grid, 460 px map, topbar wrapping.
- second `max-width: 680px`: topbar overrides.
- inline `max-width: 680px`: Quick Look stack and siren result changes.
- `max-width: 480px`: saved-locations dialog/list.
- compound mobile query: `max-width: 680px`, or `max-width: 950px` plus
  `max-height: 500px` plus coarse pointer. It owns sticky radius, view switching,
  sheet and map-control offsets.

Important transitions:

- At 681 px portrait the complete mobile view switch and sheet disappear abruptly;
  `.controls-card` becomes sticky again and both map and calls render in document flow.
- A 768 px tablet portrait is therefore neither compact mobile nor wide desktop: the
  map begins at 1,139 px and the calls panel follows it.
- Landscape mobile behavior requires a coarse pointer. Browser/device emulation that
  changes only dimensions will not exercise it, and a tablet landscape taller than
  500 px gets the non-mobile layout.
- Base mobile map height is hardcoded to 460 px; non-mobile map height is 620 px.
- `.map-panel .leaflet-top { top: 146px + safe-area }` is broad, then the specific
  top-right layer container overrides back to 8 px. The broad rule is fragile for any
  future top-left Leaflet control.
- View rules hide `.disruptions-panel` for both `data-mobile-view="map"` and `"calls"`.

## Collision audit

| Pair | Width/state | Cause | Scope |
| --- | --- | --- | --- |
| Sticky radius vs summary | 320–680, after scroll | 156 px sticky element overlays following `.nearby-summary`; measured summary y 65–196 while sticky is y 6–162. | General; browser chrome may worsen on iOS. |
| Sticky radius vs map | 320–680, map scrolled up | No reserved sticky clearance beyond scroll margin; map can sit beneath z 900 control. | General. |
| Expanded sheet vs map | 320–680 | Fixed 68dvh sheet plus 156 px sticky leaves too little map. | General P0. |
| Expanded sheet vs layer controls | 390×844 expanded | Sheet begins y 270; both top layer controls end y 281. | General P0. |
| Sheet vs Leaflet bottom controls | half/expanded | `bottom: var(--mobile-sheet-height)` is relative to 460 px map; expanded offset exceeds map height. Zoom y −13 and attribution y 61–95. | General P0. |
| Sheet vs `.map-note` | half/expanded | Map note remains `bottom: 12px` and sheet z 850 covers it. | General. |
| Attribution vs map content | narrow widths | Attribution becomes 366 px wide and wraps to two lines, covering full map width. | General; font/layout variation can add a line on iOS. |
| Road vs police controls | 320 px | Two fixed half columns, long boundary text and status; content wraps within 64 px and can crowd. | General. |
| Map/Calls vs radius choices | all mobile | Seven primary-looking buttons in one 156 px sticky card; hierarchy is unclear. | General. |
| Watch controls vs primary nearby CTA | narrow mobile | All actions live in `.nearby-feature`; wrapping raises it from 461 px to 531 px at 320. | General. |
| Glossary popover vs sheet/card edge | narrow cards | Absolute width uses viewport rather than sheet/card available width. | Potential, general. |

## Map and bottom-sheet usability

- Map CSS height is 460 px on mobile. At initial load none is visible: it begins
  about 1.54k px down at 375–430 px widths.
- In a good collapsed-sheet scroll position, the map is usable, but 128 px of its
  vertical area is committed to top layer controls plus bottom attribution/note.
- The expanded sheet makes the map effectively unusable and displaces Leaflet controls
  outside their container. Marker/cluster interaction is limited to the roughly 108 px
  gap and can be intercepted by either fixed surface.
- Attribution wraps to 34 px/full map width at 390 px. It is required, but its current
  presentation blocks map interaction.
- Sheet states: collapsed 72 px plus bottom safe area; half 42dvh; expanded 68dvh
  capped by `100dvh - 176px - safe-area-top`.
- Header is always visible. Body scrolls independently with overscroll containment;
  the page underneath remains separately scrollable outside the sheet.
- Drag is implemented only from the header with pointer capture and a 36 px threshold.
  Three explicit state buttons provide a non-drag alternative.
- The fixed sheet creates no document-flow blank space. Instead it obscures content;
  only Leaflet’s `.leaflet-bottom` is compensated.
- Changing sheet state calls `invalidateSize` but the map element itself never changes
  size, so it does not solve the reduced visible map viewport.

## State persistence

| State | Survives reload? | Evidence/result |
| --- | --- | --- |
| Saved selected location | Yes | Separate saved-location storage persists context and coordinates. |
| Current device/manual location | No | Device position is session-only; manual map choice is not stored. |
| Radius | Yes | Stored in `sirento.preferences.v1`; restoration may request location. |
| Service/event/division/history | Yes | Stored preferences. |
| Text search | No | `preferenceRecord` omits `search`; share URLs can preserve it. |
| Selected incident | Only via deep link | `incident` URL restores it; ordinary selection is in memory. |
| Nearby sort | No | `nearbySort` is in-memory only. |
| Map centre/zoom | No | Initial load refits; no centre/zoom storage. |
| Mobile Map/Calls view | Yes | Stored preference. |
| Bottom-sheet state | No | In-memory dataset only; defaults collapsed unless a deep-link arrival opens it. |
| Road/police layer visibility | Yes | Stored preferences. |

## Prioritized cleanup plan

### P0 — broken usability

1. `.map-panel .leaflet-bottom` and `.mobile-bottom-sheet`: clamp/control offsets to
   the map’s own visible bounds instead of applying sheet height directly. Smallest
   fix: stop translating Leaflet controls beyond the map and establish one shared map
   viewport inset variable. Separate Story 37B.
2. `.mobile-bottom-sheet[data-sheet-state]` plus `.radius-controls`: prevent half and
   expanded states from leaving less than a minimum usable map height. Smallest fix:
   derive sheet maxima from the actual sticky/control stack or collapse the sticky
   stack while the sheet is open. Separate Story 37C.
3. `html[data-mobile-view] .disruptions-panel`: make road/TTC information reachable
   in at least one mobile view. Smallest fix: remove the contradictory double hide and
   place a collapsed Travel entry in Calls. Separate Story 37D.

### P1 — major vertical-space waste

4. `.nearby-feature`: keep the primary siren/location action visible and collapse
   saved places, Watch, manual area and explanatory text. Separate Story 37E.
5. `.event-filters` and `.controls-card`: collapse secondary filters behind one
   filter summary/action; retain search immediately available. Separate Story 37F.
6. `.radius-controls`: reduce the 156 px sticky block. Smallest fix: one compact
   radius control row/menu plus Map/Calls, with a measured sticky height variable.
   Separate Story 37G.
7. `.nearby-summary` and `.mobile-sheet-summary`: remove duplicate summary space in
   Map view. Smallest fix: use the sheet header as the Map summary and keep sort in
   Calls/sheet body. Can join Story 37G if tightly scoped.

### P2 — hierarchy and performance

8. `renderList(els.callList)` and `renderList(mobileSheetCallList)`: avoid rendering
   every incident twice. Smallest fix: one mobile list surface or bounded/windowed
   rendering. Separate Story 37H because it changes rendering behavior.
9. `.map-layer-toggle` and Leaflet layer control: combine into one compact layer
   affordance; road/boundary settings are secondary. Separate Story 37I.
10. Persistence: decide explicitly whether search, sort, selected incident, map view
    position and sheet state should persist. Do not bundle with collision work.
    Separate Story 37J.

### P3 — polish

11. Leaflet attribution: keep required credits accessible but constrain wrapping and
    reserve a non-interactive strip. Include with Story 37I.
12. Normalize 320 px wrapping/touch spacing in topbar, Watch dialog, long labels and
    layer statuses after structural work. Separate Story 37K.
13. Validate safe-area/dynamic-toolbar behavior on iOS Safari and Brave, portrait and
    landscape, installed and browser modes. Acceptance task for 37B/37C, not a redesign.

## Deterministic verification fixture

The loopback-only `mobileAuditFixture` supports `many`, `zero`, and `stale`, plus
`mobileAuditView=map|calls` and `mobileAuditSheet=collapsed|half|expanded`. The many
state uses production normalizers/renderers and includes 12 mixed calls, a selectable
incident (`mobile-audit-selected`), long text, a road closure, a TTC disruption,
enabled road/police layers, and compatibility with `watchFixture=current`. It makes no
live snapshot or push request and is inert on non-loopback hosts. URLs are documented
in the README.

## Follow-up test matrix

For each implementation story, verify 320×568, 375×667, 390×844, 430×932, 768×1024,
and the 950×500/951×500/950×501 transition on a coarse-pointer emulator. Test map and
calls views, all three sheet states, selected incident, zero/many calls, road and police
layers, long labels, stale/unavailable sources, Watch dialog and TTC content. Add
physical iOS Safari and Brave runs for dynamic browser chrome and standalone safe-area
behavior. Continue to run all repository checks in Docker.
