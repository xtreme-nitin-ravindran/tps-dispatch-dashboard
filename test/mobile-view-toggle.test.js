import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, css, app] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../app.js', import.meta.url), 'utf8')
]);

const mobileQuery = '@media (max-width: 680px), (max-width: 950px) and (max-height: 500px) and (pointer: coarse)';

test('accessible Map and Calls toggle is available only at the mobile breakpoint', () => {
  const [toggle] = html.match(/<div class="mobile-view-toggle"[\s\S]*?<\/div>/);
  assert.match(toggle, /role="group" aria-label="Choose mobile dashboard view"/);
  assert.match(toggle, /data-mobile-view="map"[\s\S]*?aria-pressed="true"[\s\S]*?aria-controls="mapView"/);
  assert.match(toggle, /data-mobile-view="calls"[\s\S]*?aria-pressed="false"[\s\S]*?aria-controls="callsView"/);
  assert.match(css.slice(0, css.indexOf(mobileQuery)), /\.mobile-view-toggle \{ display: none; \}/);
  assert.match(css.slice(css.indexOf(mobileQuery)), /\.mobile-view-toggle \{ display: grid;/);
});

test('mobile view rules show one existing primary view without changing desktop layout', () => {
  assert.match(html, /<section class="map-stage" id="mapView">/);
  assert.match(html, /<section class="content-grid" id="callsView">/);
  const mobileRules = css.slice(css.indexOf(mobileQuery));
  assert.match(mobileRules, /html\[data-mobile-view="calls"\] \.map-stage,[\s\S]*?\.map-info,[\s\S]*?\.mobile-bottom-sheet \{ display: none; \}/);
  assert.match(mobileRules, /html\[data-mobile-view="map"\] \.content-grid,[\s\S]*?\.disruptions-panel \{ display: none; \}/);
  assert.doesNotMatch(mobileRules, /html\[data-mobile-view="calls"\][^{]*\.disruptions-panel\s*\{\s*display:\s*none/);
  assert.doesNotMatch(css.slice(0, css.indexOf(mobileQuery)), /data-mobile-view=/);
});

test('view switching only updates presentation and preserves filters, radius, data, and selection', () => {
  const setterStart = app.indexOf('function setMobileView(');
  const setter = app.slice(setterStart, app.indexOf('\nmobileViewToggles.forEach', setterStart));
  assert.match(setter, /document\.documentElement\.dataset\.mobileView = view/);
  assert.match(setter, /setAttribute\("aria-pressed", String\(active\)\)/);
  assert.match(setter, /scheduleViewMaintenance\(\{ view, mobile, focusSelection, persist \}\)/);
  assert.doesNotMatch(setter, /state\.|applyFilters|loadData|fetch|focusedCallId\s*=/);
  assert.match(setter, /mobile && view === 'calls' && expandedCluster\.size[\s\S]*?expandedCluster\.clear\(\);[\s\S]*?if \(dispatchMap\) renderMapMarkers\(\)/);
  assert.match(setter, /mobileBottomSheet\?\.setAttribute\("aria-hidden", String\(view !== "map"\)\)/);
  assert.match(setter, /syncIncidentListSurface\(mobile\)/);
  assert.doesNotMatch(setter, /renderCalls\(\)/);
  assert.match(app, /focusSelection && mobile && view === "map" && focusedCallId[\s\S]*?selectCall\(focusedCallId, \{ panIfNeeded: true \}\)/);
  assert.match(app, /mobileViewToggles\.forEach\(toggle => toggle\.addEventListener\("click", auditInteraction\(`view:\$\{toggle\.dataset\.mobileView\}`, \(\) => \{[\s\S]*?setMobileView\(toggle\.dataset\.mobileView,/);
});

test('breakpoint changes rebuild only the active incident surface without stale ownership', () => {
  assert.match(app, /mobileLayoutMedia\.addEventListener\?\.\("change", \(\) => \{[\s\S]*?setMobileView\(mobileView, \{ persist: false \}\);[\s\S]*?\}\)/);
  const setterStart = app.indexOf('function setMobileView(');
  const setter = app.slice(setterStart, app.indexOf('\nmobileViewToggles.forEach', setterStart));
  assert.match(setter, /removeAttribute\("aria-hidden"\)/);
});

test('each mobile mode owns one incident surface and switching moves it without rebuilding cards', () => {
  assert.match(app, /const callsListHome = els\.callList\.parentElement/);
  const surfaceStart = app.indexOf('function syncIncidentListSurface(');
  const surface = app.slice(surfaceStart, app.indexOf('\nfunction setMobileView(', surfaceStart));
  assert.match(surface, /mobile && mobileView === "map" \? mobileSheetCallList : callsListHome/);
  assert.match(surface, /host\.append\(els\.callList\)/);
  const rendererStart = app.indexOf('function renderCalls()');
  const renderer = app.slice(rendererStart, app.indexOf('\nnearbySort.addEventListener', rendererStart));
  assert.match(renderer, /renderList\(els\.callList\)/);
  assert.doesNotMatch(renderer, /mobileSheetCallList|inactiveList/);
});

test('map maintenance coalesces resize work and view changes do not rebuild layers', () => {
  assert.match(app, /if \(mapMaintenanceFrame !== null\) return;[\s\S]*?requestAnimationFrame/);
  assert.match(app, /mapSizeInvalidationPending \|\|= invalidateSize/);
  assert.match(app, /dispatchMap\?\.invalidateSize\(\{ pan: false \}\)/);
  assert.match(app, /viewTransitionScheduler\.schedule/);
  assert.match(app, /if \(viewTransitionScheduler\.pending\(\)\) return/);
  const setterStart = app.indexOf('function setMobileView(');
  const setter = app.slice(setterStart, app.indexOf('\nmobileViewToggles.forEach', setterStart));
  assert.doesNotMatch(setter, /initMap|renderDisruptions|createPoliceBoundaryLayer|loadDivisionOverlay/);
  assert.match(setter, /if \(dispatchMap\) renderMapMarkers\(\)/);
});

test('visible state is committed before bounded list ownership and deferred maintenance', () => {
  const setterStart = app.indexOf('function setMobileView(');
  const setter = app.slice(setterStart, app.indexOf('\nmobileViewToggles.forEach', setterStart));
  const presentation = setter.indexOf("uxAudit.mark('view-toggle:visual-state-committed'");
  const ownership = setter.indexOf('syncIncidentListSurface(mobile)');
  const maintenance = setter.indexOf('scheduleViewMaintenance({ view, mobile, focusSelection, persist })');
  assert.ok(presentation >= 0 && presentation < ownership);
  assert.ok(ownership < maintenance);
  assert.doesNotMatch(setter, /invalidateSize/);
});

test('deferred transition work is stale-safe and invalidates only a visible map', () => {
  const start = app.indexOf('function scheduleViewMaintenance(');
  const scheduler = app.slice(start, app.indexOf('\nfunction syncIncidentListSurface', start));
  assert.match(scheduler, /if \(view !== mobileView \|\| mobile !== isMobileViewLayout\(\)\) return/);
  assert.match(scheduler, /mobile && view === "map" && mapSizeInvalidationPending/);
  assert.match(scheduler, /mapSizeInvalidationPending = false;[\s\S]*?dispatchMap\?\.invalidateSize/);
  assert.doesNotMatch(scheduler, /renderMapMarkers|renderDisruptions|loadDivisionOverlay|renderCalls|applyFilters/);
});

test('show-on-map keeps the selected incident and activates the map view', () => {
  const setterStart = app.indexOf('function setMobileView(');
  const setter = app.slice(setterStart, app.indexOf('\nmobileViewToggles.forEach', setterStart));
  assert.match(app, /const showOnMap = event\.target\.closest\("\.show-map-hint"\);[\s\S]*?selectCall\(row\.dataset\.callId,[\s\S]*?if \(showOnMap\)[\s\S]*?setMobileView\("map", \{ focusSelection: true \}\)/);
  assert.match(app, /let focusedCallId = null/);
  assert.doesNotMatch(setter, /focusedCallId\s*=/);
});

test('a view selected during loading is not overwritten by late startup restoration', () => {
  assert.match(app, /let mobileViewInteracted = false/);
  assert.match(app, /view:\$\{toggle\.dataset\.mobileView\}`,[\s\S]*?mobileViewInteracted = true;[\s\S]*?setMobileView/);
  assert.match(app, /if \(arrival\.mobileView && !mobileViewInteracted\) setMobileView/);
  assert.match(app, /if \(!mobileViewInteracted\) setMobileView\(saved\.mobileView/);
  assert.match(app, /if \(!mobileViewInteracted\) setMobileView\(mobileAuditFixture\.view/);
});
