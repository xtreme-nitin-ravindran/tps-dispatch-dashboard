import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, css, app, boundaryOverlay] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../assets/css/styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/police-boundary-overlay.js', import.meta.url), 'utf8')
]);
const mobileQuery = '@media (max-width: 680px), (max-width: 950px) and (max-height: 500px) and (pointer: coarse)';
const mobileRules = css.slice(css.indexOf(mobileQuery));
const desktopRules = css.slice(0, css.indexOf(mobileQuery));

test('Leaflet prefix is removed with its supported attribution API', () => {
  assert.match(app, /attributionControl\.setPrefix\(false\)/);
  assert.doesNotMatch(css, /leaflet-control-attribution[^{]*\{[^}]*display:\s*none/s);
});

test('only compact linked OpenStreetMap credit remains in the map attribution control', () => {
  const attributionStart = mobileRules.indexOf('.map-panel .leaflet-control-attribution {');
  const attributionRule = mobileRules.slice(attributionStart, mobileRules.indexOf('}', attributionStart) + 1);
  assert.match(app, /attribution: '&copy; <a href="https:\/\/www\.openstreetmap\.org\/copyright">OpenStreetMap<\/a>'/);
  assert.doesNotMatch(boundaryOverlay, /attribution\s*:/);
  assert.doesNotMatch(boundaryOverlay, /Division boundaries © Toronto Police Service/);
  assert.match(attributionRule, /width: max-content;/);
  assert.match(attributionRule, /max-width: calc\(100vw - 20px\);/);
  assert.match(attributionRule, /white-space: nowrap/);
  assert.doesNotMatch(attributionRule, /width:\s*(?:100%|100vw)/);
});

test('TPS division provenance appears in normal flow inside existing Map info', () => {
  const infoMatch = html.match(/<details class="panel map-info"[\s\S]*?<\/details>/);
  assert.ok(infoMatch, 'expected the Map info details element');
  const [info] = infoMatch;
  assert.match(info, /<p class="map-source-credit">Police division boundaries — Toronto Police Service<\/p>/);
  assert.match(desktopRules, /\.map-source-credit \{[\s\S]*?color: var\(--muted\);[\s\S]*?font-size: 12px/);
});

test('mobile attribution sits in the lower-right chrome, clear of the focus control', () => {
  // Story 40F: the attribution must not occupy the fullscreen/× control area.
  // It is placed in the bottom-right corner on every layout, where it stacks
  // below the zoom control and above the bottom-sheet overlap.
  assert.match(app, /control\.setPosition\("bottomright"\)/);
  assert.doesNotMatch(app, /setPosition\(isMobileViewLayout\(\) \? "topleft"/);
  // Leaflet inserts bottom-corner controls at the front, so repositioning on
  // every maintenance frame would lift the attribution above the zoom control.
  // The guard only repositions when the corner actually differs.
  assert.match(app, /if \(control\.getPosition\?\.\(\) !== "bottomright"\) control\.setPosition\("bottomright"\)/);
  assert.match(mobileRules, /\.map-panel \.leaflet-bottom\.leaflet-right \{ bottom: var\(--mobile-map-sheet-overlap, 0px\); \}/);
  assert.doesNotMatch(mobileRules, /\.map-panel \.leaflet-bottom \{ bottom: var\(--mobile-map-sheet-overlap/);
});

test('Calls mode removes the map and attribution while desktop keeps valid placement', () => {
  assert.match(mobileRules, /html\[data-mobile-view="calls"\] \.map-stage,[\s\S]*?\.map-info,[\s\S]*?\.mobile-bottom-sheet \{ display: none; \}/);
  assert.match(app, /control\.setPosition\("bottomright"\)/);
  assert.match(desktopRules, /\.leaflet-control-attribution \{[\s\S]*?background: var\(--map-attribution-background\)/);
});
