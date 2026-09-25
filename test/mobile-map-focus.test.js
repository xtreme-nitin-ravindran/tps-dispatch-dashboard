import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, css, app] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../app.js', import.meta.url), 'utf8')
]);
const mobile = css.slice(css.indexOf('@media (max-width: 680px), (max-width: 950px)'));

test('Map Focus enters and exits without changing application state', () => {
  assert.match(html, /id="mapFocusToggle"[\s\S]*?aria-pressed="false"[\s\S]*?>Expand map</);
  const setter = app.slice(app.indexOf('function setMapFocus('), app.indexOf('\nmapFocusToggle?.addEventListener', app.indexOf('function setMapFocus(')));
  assert.match(setter, /dataset\.mapFocus = String\(mapFocused\)/);
  assert.match(setter, /Close map[\s\S]*?Expand map/);
  assert.match(setter, /dispatchMap\?\.invalidateSize\(\{ pan: false \}\)/);
  assert.doesNotMatch(setter, /applyFilters|renderCalls|renderMap|fetch|focusedCallId\s*=/);
});

test('focused map keeps compact radius, Map Calls, Layers, and close controls', () => {
  assert.match(html, /class="focused-radius"[\s\S]*?id="focusedRadius"/);
  assert.match(html, /data-focused-view="map"[\s\S]*?data-focused-view="calls"/);
  assert.match(html, /<details class="mobile-layers"[\s\S]*?<summary>Layers<\/summary>/);
  assert.match(mobile, /data-map-focus="true"[\s\S]*?\.focused-radius \{ display: flex/);
  assert.match(mobile, /data-map-focus="true"[\s\S]*?#dispatchMap \{ height: 100dvh/);
});

test('Layers exposes persistent road and police boundary state without large mobile controls', () => {
  assert.match(html, /id="mobileRoadOverlay"[\s\S]*?Road closures/);
  assert.match(html, /id="mobilePoliceBoundaries"[\s\S]*?Police division boundaries/);
  assert.match(app, /mobileRoadOverlay\.checked = checked/);
  assert.match(app, /mobilePoliceBoundaries\.checked = boundaryVisible/);
  assert.match(mobile, /\.map-layer-toggle,[\s\S]*?leaflet-top\.leaflet-right \{ display: none; \}/);
});

test('bottom sheet and selected incident model remain active in focused mode', () => {
  assert.match(mobile, /data-map-focus="true"[\s\S]*?leaflet-bottom \{ bottom: var\(--mobile-sheet-height\)/);
  assert.match(app, /data-focused-view[\s\S]*?setMobileSheetState/);
  assert.match(app, /nextState === "collapsed" \? "map" : "calls"/);
  assert.match(app, /let focusedCallId = null/);
  assert.doesNotMatch(app, /mapFocused[\s\S]{0,120}focusedCallId\s*=/);
});

test('focus rules are mobile-only and prevent horizontal viewport overflow', () => {
  assert.doesNotMatch(css.slice(0, css.indexOf('@media (max-width: 680px), (max-width: 950px)')), /data-map-focus/);
  assert.match(mobile, /data-map-focus="true"[\s\S]*?position: fixed;[\s\S]*?inset: 0/);
  assert.match(mobile, /mobile-layers-menu[\s\S]*?width: min\(270px, calc\(100vw - 32px\)\)/);
});
