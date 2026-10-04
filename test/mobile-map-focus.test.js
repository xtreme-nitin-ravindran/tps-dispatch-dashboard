import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, css, app] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../app.js', import.meta.url), 'utf8')
]);

const mobileQuery = '@media (max-width: 680px), (max-width: 950px) and (max-height: 500px) and (pointer: coarse)';
const desktopRules = css.slice(0, css.indexOf(mobileQuery));
const mobileRules = css.slice(css.indexOf(mobileQuery));
const focusStart = app.indexOf('function setMobileFocusMode(');
const focusHandler = app.slice(focusStart, app.indexOf('\nsetMobileView(mobileView', focusStart));

test('the focus control is a real button with an accessible name and 44px target', () => {
  assert.match(html, /id="mobileMapFocusToggle"[^>]*type="button"[^>]*aria-pressed="false"[^>]*aria-controls="mapView"[^>]*aria-label="Full screen map"/);
  assert.match(html, /class="mobile-map-focus-icon"[^>]*aria-hidden="true"/);
  assert.match(mobileRules, /\.mobile-map-focus-toggle \{[^}]*width: 48px;[^}]*height: 48px;/);
});

test('desktop layout is unchanged by the focus control', () => {
  assert.match(desktopRules, /\.mobile-map-focus-toggle \{\s*display: none;\s*\}/);
  assert.doesNotMatch(desktopRules, /data-mobile-focus/);
});

test('entering focus mode hides the pre-map stack and expands the map', () => {
  assert.match(mobileRules, /html\[data-mobile-focus="on"\] \.topbar,/);
  assert.match(mobileRules, /html\[data-mobile-focus="on"\] \.controls-card,/);
  assert.match(mobileRules, /html\[data-mobile-focus="on"\]\[data-mobile-view="map"\] #dispatchMap \{\s*height: 100vh;\s*height: 100dvh;\s*\}/);
  assert.match(mobileRules, /html\[data-mobile-focus="on"\]\[data-mobile-view="map"\] \.map-wrap \{\s*min-height: 100vh;\s*min-height: 100dvh;\s*\}/);
});

test('focus mode is mobile-only and toggles the × / fullscreen icon', () => {
  assert.match(focusHandler, /const next = Boolean\(on\) && isMobileViewLayout\(\);/);
  assert.match(focusHandler, /document\.documentElement\.dataset\.mobileFocus = next \? "on" : "off";/);
  assert.match(focusHandler, /icon\.textContent = next \? "×" : "⛶";/);
  assert.match(focusHandler, /aria-label", next \? "Exit full screen map" : "Full screen map"/);
});

test('entering focus mode preserves scroll and restores it on exit', () => {
  assert.match(focusHandler, /mobileFocusScrollY = window\.scrollY \|\| window\.pageYOffset \|\| 0;/);
  assert.match(focusHandler, /window\.scrollTo\(\{ top: mobileFocusScrollY, behavior: "instant" \}\)/);
});

test('focus mode updates the sheet-overlap variable synchronously', () => {
    // Story 40F: the Leaflet bottom-corner controls (attribution, zoom) must move
    // with the focused layout in the same frame, otherwise the attribution briefly
    // overlaps the bottom sheet until the deferred maintenance frame runs.
    assert.match(focusHandler, /syncMapSheetOverlap\(\);\s*if \(next\) \{/);
  });
test('focus mode reuses the existing map and view state without duplicate DOM', () => {
  assert.match(focusHandler, /if \(mobileView !== "map"\) setMobileView\("map", \{ persist: false \}\);/);
  assert.match(focusHandler, /scheduleMapMaintenance\(\{ invalidateSize: true \}\)/);
  assert.doesNotMatch(focusHandler, /cloneNode|innerHTML|insertAdjacentHTML|createElement|L\.map\(/);
  assert.equal(html.match(/id="dispatchMap"/g)?.length, 1);
  assert.equal(html.match(/id="mobileMapFocusToggle"/g)?.length, 1);
});

test('the focus control is inert on desktop and exits when leaving mobile layout', () => {
  assert.match(app, /mobileMapFocusToggle\?\.addEventListener\("click", auditInteraction\('mobile:map-focus', \(\) => \{\s*if \(!isMobileViewLayout\(\)\) return;/);
  assert.match(app, /if \(!isMobileViewLayout\(\) && mobileFocusMode\) setMobileFocusMode\(false\);/);
});

test('the focus control sits beside the stacked layer controls without compressing them', () => {
  // Story 41: the focus control is left-aligned and vertically centered against
  // the right-aligned Police Divisions / Road closures stack.
  assert.match(mobileRules, /\.mobile-map-focus-toggle \{[^}]*top: calc\(var\(--mobile-layer-stack-center, 56px\) - 24px\);[^}]*left: 8px;/);
  assert.match(mobileRules, /\.map-layer-toggle \{[^}]*top: var\(--police-control-bottom, 56px\);[^}]*right: 8px;[^}]*left: auto;/);
});

test('the focus control anchors to the layer row\'s measured bottom edge, not a fixed offset', () => {
  // The offset is measured from the real rendered row so a taller (wrapped) row
  // on iOS Safari cannot place the control underneath Road closures.
  assert.match(app, /function syncMobileLayerRowOffset\(\) \{/);
  assert.match(app, /const layerRow = wrap\?\.querySelector\?\.\("\.map-layer-toggle"\);/);
  assert.match(app, /const rowBottom = layerRow\.getBoundingClientRect\(\)\.bottom - wrapTop;/);
  assert.match(app, /document\.documentElement\.style\.setProperty\("--mobile-layer-row-bottom", `\$\{Math\.round\(rowBottom\)\}px`\);/);
  // It runs inside the existing coalesced maintenance frame and observes the row.
  assert.match(app, /syncMapSheetOverlap\(\);\s*syncMobileLayerRowOffset\(\);/);
  assert.match(app, /mapSheetObserver\.observe\(layerRow\);/);
  // The focus control and the focus-mode chrome all derive from the same variable.
  assert.match(mobileRules, /html\[data-mobile-focus="on"\]\[data-mobile-view="map"\] \.mobile-map-focus-toggle \{ top: calc\(var\(--mobile-layer-stack-center, 56px\) - 24px\);/);
  assert.doesNotMatch(mobileRules, /top: 64px;/);
});

// --- Story 40B: focus-mode map geometry & bottom-sheet integration ---

test('focused map uses dynamic viewport units with a static fallback', () => {
  assert.match(mobileRules, /html\[data-mobile-focus="on"\]\[data-mobile-view="map"\] #dispatchMap \{\s*height: 100vh;\s*height: 100dvh;\s*\}/);
  assert.match(mobileRules, /html\[data-mobile-focus="on"\]\[data-mobile-view="map"\] \.map-wrap \{\s*min-height: 100vh;\s*min-height: 100dvh;\s*\}/);
  assert.match(mobileRules, /html\[data-mobile-focus="on"\]\[data-mobile-view="map"\] \{\s*\/\*[\s\S]*?\*\/\s*--mobile-map-height: 100vh;\s*--mobile-map-height: 100dvh;/);
});

test('focused map derives sheet heights from the focused viewport, not the static 460px map', () => {
  // The base mobile block still defines the static fallback for the normal layout.
  assert.match(mobileRules, /--mobile-map-height: 460px/);
  // Focus mode overrides it so half/expanded sheet heights track the real viewport.
  assert.match(mobileRules, /html\[data-mobile-focus="on"\]\[data-mobile-view="map"\] \{\s*\/\*[\s\S]*?\*\/\s*--mobile-map-height: 100vh;\s*--mobile-map-height: 100dvh;/);
  assert.match(mobileRules, /data-mobile-sheet-state="half"[\s\S]*?min\(30dvh, calc\(var\(--mobile-map-height\) - 220px\)\)/);
  assert.match(mobileRules, /data-mobile-sheet-state="expanded"[\s\S]*?min\(50dvh, calc\(var\(--mobile-map-height\) - 160px\)\)/);
});

test('focused map respects safe-area insets on every edge and avoids horizontal overflow', () => {
  assert.match(mobileRules, /html\[data-mobile-focus="on"\]\[data-mobile-view="map"\] \.map-panel \.leaflet-top \{ top: calc\(8px \+ env\(safe-area-inset-top, 0px\)\); \}/);
  assert.match(mobileRules, /html\[data-mobile-focus="on"\]\[data-mobile-view="map"\] \.map-layer-toggle \{ top: var\(--police-control-bottom, 56px\); right: calc\(8px \+ env\(safe-area-inset-right, 0px\)\); left: auto; \}/);
  assert.match(mobileRules, /html\[data-mobile-focus="on"\]\[data-mobile-view="map"\] \.map-panel \.leaflet-top\.leaflet-right \{ top: calc\(8px \+ env\(safe-area-inset-top, 0px\)\); right: calc\(8px \+ env\(safe-area-inset-right, 0px\)\); left: auto; \}/);
  assert.match(mobileRules, /html\[data-mobile-focus="on"\]\[data-mobile-view="map"\] \.map-stage \{[\s\S]*?max-width: 100vw;[\s\S]*?overflow: hidden;/);
  assert.match(mobileRules, /html\[data-mobile-focus="on"\]\[data-mobile-view="map"\] \{\s*\/\*[\s\S]*?\*\/\s*--mobile-map-height: 100vh;\s*--mobile-map-height: 100dvh;\s*overflow-x: hidden;/);
});

test('focused map keeps the existing bottom sheet and its overlap path', () => {
  // The sheet is not hidden or duplicated in focus mode.
  assert.doesNotMatch(mobileRules, /data-mobile-focus="on"[\s\S]{0,200}\.mobile-bottom-sheet \{ display: none; \}/);
  assert.equal(html.match(/id="mobileBottomSheet"/g)?.length, 1);
  assert.equal(html.match(/id="mobileSheetCallList"/g)?.length, 1);
  // Map controls still clear the sheet through the existing overlap variable.
  assert.match(mobileRules, /\.map-panel \.leaflet-bottom\.leaflet-right \{ bottom: var\(--mobile-map-sheet-overlap, 0px\)/);
  assert.match(app, /els\.dispatchMap\.style\.setProperty\("--mobile-map-sheet-overlap", `\$\{overlap\}px`\)/);
});

test('focus entry and exit invalidate Leaflet through the existing coalesced scheduler', () => {
  const body = app.slice(focusStart, app.indexOf('\nmobileMapFocusToggle?.addEventListener', focusStart));
  assert.match(body, /scheduleMapMaintenance\(\{ invalidateSize: true \}\)/);
  assert.doesNotMatch(body, /dispatchMap\?\.invalidateSize|dispatchMap\.invalidateSize/);
  assert.doesNotMatch(body, /addEventListener/);
});

test('orientation changes invalidate only the visible map through the shared scheduler', () => {
  assert.match(app, /window\.addEventListener\("orientationchange", \(\) => \{\s*if \(isMobileViewLayout\(\) && mobileView !== "map"\) return;\s*scheduleMapMaintenance\(\{ invalidateSize: true \}\);\s*\}\)/);
  // No parallel resize system: the orientation handler reuses scheduleMapMaintenance.
  assert.doesNotMatch(app, /orientationchange[\s\S]{0,200}invalidateSize\(\{ pan: false \}\)/);
});

test('focus mode does not refetch data or recreate map layers', () => {
  assert.doesNotMatch(focusHandler, /fetch|loadData|fetchSnapshot|applyFilters|renderCalls|renderDisruptions|createPoliceBoundaryLayer|L\.map\(|clearLayers|removeLayer/);
  assert.doesNotMatch(focusHandler, /initMap/);
});

test('focus mode preserves filters, radius, selection, overlays, and sheet state', () => {
  assert.doesNotMatch(focusHandler, /state\.(radiusKm|serviceFilter|eventFilter|historyWindow)\s*=/);
  assert.doesNotMatch(focusHandler, /focusedCallId\s*=/);
  assert.doesNotMatch(focusHandler, /boundaryVisible\s*=/);
  assert.doesNotMatch(focusHandler, /mobileSheetState\s*=/);
  assert.doesNotMatch(focusHandler, /roadOverlay/);
});

test('normal mobile layout and desktop are unchanged by focus-mode geometry', () => {
  // The static map height and sheet heights remain the default outside focus mode.
  assert.match(desktopRules, /#dispatchMap \{\s*height: 620px;/);
  assert.match(mobileRules, /--mobile-map-height: 460px/);
  assert.doesNotMatch(desktopRules, /data-mobile-focus/);
  assert.doesNotMatch(desktopRules, /--mobile-map-height: 100dvh/);
});

// --- Story 40C: persistent Map / Calls / Disruptions navigation in focus mode ---

const viewToggleHandler = app.slice(
  app.indexOf('mobileViewToggles.forEach(toggle => toggle.addEventListener("click"'),
  app.indexOf('mobileDisruptionsControl?.addEventListener')
);
const disruptionsHandler = app.slice(
  app.indexOf("mobileDisruptionsControl?.addEventListener('click'"),
  app.indexOf('\nfunction setMobileFocusMode(', app.indexOf("mobileDisruptionsControl?.addEventListener('click'"))
);

test('focus mode keeps the existing Map / Calls / Disruptions navigation reachable', () => {
  // The single existing navigation group is reused; no second focus-mode navigation is added.
  assert.equal(html.match(/class="mobile-view-toggle"/g)?.length, 1);
  assert.equal(html.match(/id="mobileDisruptionsControl"/g)?.length, 1);
  // The navigation stays visible in focus mode while the radius controls are hidden.
  assert.match(mobileRules, /html\[data-mobile-focus="on"\] \.radius-controls \{[\s\S]*?position: fixed;/);
  assert.match(mobileRules, /html\[data-mobile-focus="on"\] \.radius-controls > \.section-kicker,\s*html\[data-mobile-focus="on"\] \.radius-controls \.radius-toggle-group \{ display: none; \}/);
  assert.match(mobileRules, /html\[data-mobile-focus="on"\] \.mobile-view-toggle \{ width: 100%; max-width: 100%; \}/);
  // Each navigation control keeps its existing 44px touch target.
  assert.match(mobileRules, /\.mobile-view-toggle button \{ min-height: 44px;/);
});

test('focus mode hides the pre-map chrome in both Map and Calls views', () => {
  // The chrome-hiding rules are no longer scoped to the map view only.
  assert.match(mobileRules, /html\[data-mobile-focus="on"\] \.topbar,/);
  assert.match(mobileRules, /html\[data-mobile-focus="on"\] \.nearby-summary,/);
  assert.match(mobileRules, /html\[data-mobile-focus="on"\] footer \{ display: none; \}/);
  // The map info & legend stays reachable in focus mode (floated above the map),
  // so it must not be part of the hide list.
  assert.doesNotMatch(mobileRules, /html\[data-mobile-focus="on"\] \.map-info,/);
  // The calls surface and disruptions panel are owned by the existing view rules, not hidden here.
  assert.doesNotMatch(mobileRules, /html\[data-mobile-focus="on"\] \.content-grid,/);
  assert.doesNotMatch(mobileRules, /html\[data-mobile-focus="on"\] \.disruptions-panel,/);
});

test('the focus session is not cleared when mobileView changes away from map', () => {
  // setMobileView never touches focus state, so Map -> Calls -> Map keeps the session.
  const setterStart = app.indexOf('function setMobileView(');
  const setter = app.slice(setterStart, app.indexOf('\nmobileViewToggles.forEach', setterStart));
  assert.doesNotMatch(setter, /setMobileFocusMode|mobileFocusMode\s*=/);
  // Focus mode is only exited by the × control or by leaving the mobile breakpoint.
  const focusCalls = [...app.matchAll(/setMobileFocusMode\(/g)].length;
  assert.equal(focusCalls, 3); // definition + toggle click + breakpoint cleanup
  assert.match(app, /if \(!isMobileViewLayout\(\) && mobileFocusMode\) setMobileFocusMode\(false\);/);
});

test('returning to Map during focus mode restores the full-screen focused layout', () => {
  // The focused map layout is keyed on the existing data-mobile-view="map" state.
  assert.match(mobileRules, /html\[data-mobile-focus="on"\]\[data-mobile-view="map"\] \.map-stage \{[\s\S]*?position: fixed;[\s\S]*?inset: 0;/);
  assert.match(mobileRules, /html\[data-mobile-focus="on"\]\[data-mobile-view="map"\] #dispatchMap \{\s*height: 100vh;\s*height: 100dvh;\s*\}/);
  // The existing view toggle handler drives the transition without a parallel path.
  assert.match(viewToggleHandler, /setMobileView\(toggle\.dataset\.mobileView,/);
  assert.doesNotMatch(viewToggleHandler, /setMobileFocusMode|mobileFocusMode\s*=/);
});

test('focused Calls keeps the existing calls surface and clears the floating navigation', () => {
  // Story 40F: the navigation band moves to the top safe-area position and the
  // calls surface clears only that band (44px control + 8px gap), not the
  // map-only chrome that is hidden in the Calls/Disruptions view.
  assert.match(mobileRules, /html\[data-mobile-focus="on"\]\[data-mobile-view="calls"\] \.radius-controls \{\s*top: calc\(8px \+ env\(safe-area-inset-top, 0px\)\);\s*\}/);
  assert.match(mobileRules, /html\[data-mobile-focus="on"\]\[data-mobile-view="calls"\] main \{ padding-top: calc\(8px \+ 44px \+ 8px \+ env\(safe-area-inset-top, 0px\)\); \}/);
  // The old map-only offset must not remain for the focused Calls view.
  assert.doesNotMatch(mobileRules, /data-mobile-view="calls"\] main \{ padding-top: calc\(var\(--mobile-layer-row-bottom/);
  // The calls surface is the existing content-grid; no duplicate container is introduced.
  assert.equal(html.match(/id="callsView"/g)?.length, 1);
  assert.equal(html.match(/id="callList"/g)?.length, 1);
  assert.doesNotMatch(mobileRules, /data-mobile-focus="on"\]\[data-mobile-view="calls"\] \.content-grid \{ display: none/);
});

test('focused Disruptions reuses the existing Calls-owned disruptions path', () => {
  // The existing control switches to Calls and focuses the single disruptions panel.
  assert.match(disruptionsHandler, /if \(mobileView === 'map'\)[\s\S]*?setMobileView\('calls'\)/);
  assert.match(disruptionsHandler, /document\.querySelector\('#disruptions'\)/);
  assert.match(disruptionsHandler, /disruptions\?\.focus\(\{ preventScroll: true \}\)/);
  assert.doesNotMatch(disruptionsHandler, /setMobileFocusMode|mobileFocusMode\s*=/);
  assert.doesNotMatch(disruptionsHandler, /setMobileView\('disruptions'\)/);
  assert.equal(html.match(/id="disruptions"/g)?.length, 1);
});

test('focus-mode view transitions stay presentation-only and reuse the map-maintenance path', () => {
  // No refetch, layer recreation, or duplicate listeners in the navigation handlers.
  for (const handler of [viewToggleHandler, disruptionsHandler]) {
    assert.doesNotMatch(handler, /fetch|loadData|fetchSnapshot|applyFilters|renderCalls|renderDisruptions|createPoliceBoundaryLayer|L\.map\(|clearLayers|removeLayer|initMap/);
    // Only the single registration listener; no duplicate listeners are attached inside the handler.
    assert.equal([...handler.matchAll(/addEventListener/g)].length, 1);
  }
  // Returning to Map invalidates Leaflet through the existing coalesced scheduler.
  assert.match(app, /mapSizeInvalidationPending \|\|= mobile && view === "map";/);
  assert.match(app, /if \(mobile && view === "map" && mapSizeInvalidationPending\)[\s\S]*?dispatchMap\?\.invalidateSize\(\{ pan: false \}\)/);
});

test('normal non-focused mobile navigation and desktop are unchanged by 40C', () => {
  // Outside focus mode the radius controls keep their normal static layout.
  assert.match(mobileRules, /\.radius-controls \{\n {4}position: static;/);
  // The focus-mode navigation overrides are scoped to data-mobile-focus only.
  assert.doesNotMatch(desktopRules, /data-mobile-focus/);
  assert.doesNotMatch(desktopRules, /mobile-view-toggle \{[^}]*position: fixed/);
});

// --- Story 40D: floating filter summary & map chrome ---

const focusSummaryStart = app.indexOf('function focusFilterSummaryText(');
const focusSummaryFn = app.slice(focusSummaryStart, app.indexOf('\nfunction setMobileFiltersOpen(', focusSummaryStart));

test('the floating filter summary is a read-only, accessible status element', () => {
  assert.match(html, /<p id="mobileFocusFilterSummary" class="mobile-focus-filter-summary" role="status" aria-live="polite"\s*\n?\s*aria-label="Applied filters" hidden><\/p>/);
  assert.equal(html.match(/id="mobileFocusFilterSummary"/g)?.length, 1);
  // It is a paragraph, not an interactive control.
  assert.doesNotMatch(html, /<button[^>]*id="mobileFocusFilterSummary"/);
});

test('the floating filter summary is hidden outside focus mode and shown inside it', () => {
  assert.match(focusSummaryFn, /const visible = mobileFocusMode && isMobileViewLayout\(\);/);
  assert.match(focusSummaryFn, /mobileFocusFilterSummary\.hidden = !visible;/);
  assert.match(focusSummaryFn, /if \(visible\) mobileFocusFilterSummary\.textContent = focusFilterSummaryText\(\);/);
  // The element starts hidden in the markup and is only revealed by focus mode.
  assert.match(html, /id="mobileFocusFilterSummary"[\s\S]*?hidden><\/p>/);
});

test('the floating filter summary reflects the existing applied filter state', () => {
  assert.match(focusSummaryFn, /state\.radiusKm === null/);
  assert.match(focusSummaryFn, /state\.nearby/);
  assert.match(focusSummaryFn, /state\.hours/);
  assert.match(focusSummaryFn, /state\.serviceFilter/);
  assert.match(focusSummaryFn, /state\.eventFilter/);
  assert.match(focusSummaryFn, /state\.division/);
  assert.match(focusSummaryFn, /state\.search/);
  // It is derived from state only; it never mutates filters.
  assert.doesNotMatch(focusSummaryFn, /state\.\w+\s*=[^=]/);
});

test('the floating filter summary updates when filters change and on focus entry/exit', () => {
  assert.match(app, /document\.querySelector\("#filterSummary"\)\.textContent = filterSummary\(state\);\s*syncMobileFilterIndicator\(\);\s*syncFocusFilterSummary\(\);/);
  assert.match(app, /function setMobileFocusMode\(on\)[\s\S]*?syncFocusFilterSummary\(\);/);
});

test('the floating filter summary is positioned as floating map chrome with safe-area insets', () => {
  assert.match(mobileRules, /\.mobile-focus-filter-summary \{[\s\S]*?position: absolute;[\s\S]*?top: calc\(var\(--mobile-layer-row-bottom, 64px\) \+ 108px \+ env\(safe-area-inset-top, 0px\)\);[\s\S]*?left: calc\(8px \+ env\(safe-area-inset-left, 0px\)\);[\s\S]*?right: calc\(8px \+ env\(safe-area-inset-right, 0px\)\);/);
  assert.match(mobileRules, /\.mobile-focus-filter-summary\[hidden\] \{ display: none; \}/);
  // It is not rendered on desktop.
  assert.doesNotMatch(desktopRules, /\.mobile-focus-filter-summary \{/);
});

test('the boundary control shows a concise mobile label while keeping the full wording', () => {
  // Story 41: the visible control label is the concise "Police Divisions"; the
  // full official wording stays in the map attribution.
  assert.match(app, /"Police Divisions": divisionLayer/);
  assert.match(html, /Police division boundaries — Toronto Police Service/);
  // A concise mobile label is attached to the rendered control.
  assert.match(app, /boundaryControlLabel\?\.setAttribute\('data-mobile-label', 'Police Divisions'\)/);
  assert.match(mobileRules, /\.map-panel \.leaflet-control-layers-overlays label\[data-mobile-label\]::after \{\s*content: attr\(data-mobile-label\);/);
  // The full text is visually hidden but preserved for assistive tech.
  assert.match(mobileRules, /\.map-panel \.leaflet-control-layers-overlays label\[data-mobile-label\] > span \{[\s\S]*?clip-path: inset\(50%\);/);
});

test('the concise boundary label is mobile-only and leaves desktop unchanged', () => {
  assert.doesNotMatch(desktopRules, /data-mobile-label/);
  assert.doesNotMatch(desktopRules, /Police divisions/);
});

test('the floating summary and concise label do not introduce duplicate DOM or state', () => {
  assert.equal(html.match(/id="mobileFocusFilterSummary"/g)?.length, 1);
  assert.equal(html.match(/id="dispatchMap"/g)?.length, 1);
  assert.equal(html.match(/id="mobileMapFocusToggle"/g)?.length, 1);
  // No new map, sheet, or navigation surface is created for the summary.
  assert.doesNotMatch(focusSummaryFn, /createElement|innerHTML|insertAdjacentHTML|cloneNode|L\.map\(/);
});

// --- Story 40D follow-up: focus-mode map-info reachability, chrome overlap, location context ---

test('focus mode keeps the map info & legend reachable instead of hiding it', () => {
  // The map-info panel is no longer part of the focus-mode hide list.
  const hideBlock = mobileRules.slice(
    mobileRules.indexOf('html[data-mobile-focus="on"] .topbar,'),
    mobileRules.indexOf('footer { display: none; }', mobileRules.indexOf('html[data-mobile-focus="on"] .topbar,'))
  );
  assert.doesNotMatch(hideBlock, /\.map-info/);
  // It is floated above the fixed map stage so the legend and source times stay usable.
  assert.match(mobileRules, /html\[data-mobile-focus="on"\]\[data-mobile-view="map"\] \.map-info \{[\s\S]*?position: fixed;[\s\S]*?z-index: 750;/);
  assert.equal(html.match(/id="mapInfo"/g)?.length, 1);
});

test('the floating filter summary clears the floating navigation band', () => {
  // The navigation band clears the focus button (whose top tracks the layer row's real bottom edge).
  assert.match(mobileRules, /html\[data-mobile-focus="on"\] \.radius-controls \{[\s\S]*?top: calc\(var\(--mobile-layer-row-bottom, 64px\) \+ 56px \+ env\(safe-area-inset-top, 0px\)\);/);
  assert.match(mobileRules, /\.mobile-focus-filter-summary \{[\s\S]*?top: calc\(var\(--mobile-layer-row-bottom, 64px\) \+ 108px \+ env\(safe-area-inset-top, 0px\)\);/);
  // The map-info floats below the summary so the three chrome bands do not collide.
  assert.match(mobileRules, /html\[data-mobile-focus="on"\]\[data-mobile-view="map"\] \.map-info \{[\s\S]*?top: calc\(var\(--mobile-layer-row-bottom, 64px\) \+ 152px \+ env\(safe-area-inset-top, 0px\)\);/);
});

test('the floating filter summary names the location context it is scoped to', () => {
  assert.match(focusSummaryFn, /const originLabel = nearbyOriginKind === 'map'/);
  assert.match(focusSummaryFn, /nearbyOriginKind === 'saved'/);
  assert.match(focusSummaryFn, /savedLocationForContext\(state\)\?\.label/);
  assert.match(focusSummaryFn, /Within \$\{state\.radiusKm\} km of \$\{originLabel\}/);
  // It still never mutates filter or location state.
  assert.doesNotMatch(focusSummaryFn, /state\.\w+\s*=[^=]/);
  assert.doesNotMatch(focusSummaryFn, /nearbyOriginKind\s*=[^=]/);
});
