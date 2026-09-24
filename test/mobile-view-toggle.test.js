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
  assert.match(mobileRules, /html\[data-mobile-view="calls"\] \.map-stage,[\s\S]*?\.disruptions-panel \{ display: none; \}/);
  assert.match(mobileRules, /html\[data-mobile-view="map"\] \.content-grid,[\s\S]*?\.disruptions-panel \{ display: none; \}/);
  assert.doesNotMatch(css.slice(0, css.indexOf(mobileQuery)), /data-mobile-view=/);
});

test('view switching only updates presentation and preserves filters, radius, data, and selection', () => {
  const setterStart = app.indexOf('function setMobileView(');
  const setter = app.slice(setterStart, app.indexOf('\nmobileViewToggles.forEach', setterStart));
  assert.match(setter, /document\.documentElement\.dataset\.mobileView = view/);
  assert.match(setter, /setAttribute\("aria-pressed", String\(active\)\)/);
  assert.match(setter, /dispatchMap\?\.invalidateSize/);
  assert.doesNotMatch(setter, /state\.|applyFilters|renderCalls|renderMap|loadData|fetch|focusedCallId\s*=/);
  assert.match(setter, /selectCall\(focusedCallId, \{ panIfNeeded: true \}\)/);
  assert.match(app, /mobileViewToggles\.forEach\(toggle => toggle\.addEventListener\("click", \(\) => \{[\s\S]*?setMobileView\(toggle\.dataset\.mobileView,/);
});

test('show-on-map keeps the selected incident and activates the map view', () => {
  const setterStart = app.indexOf('function setMobileView(');
  const setter = app.slice(setterStart, app.indexOf('\nmobileViewToggles.forEach', setterStart));
  assert.match(app, /const showOnMap = event\.target\.closest\("\.show-map-hint"\);[\s\S]*?selectCall\(row\.dataset\.callId,[\s\S]*?if \(showOnMap\)[\s\S]*?setMobileView\("map", \{ focusSelection: true \}\)/);
  assert.match(app, /let focusedCallId = null/);
  assert.doesNotMatch(setter, /focusedCallId\s*=/);
});
