import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, css, app, boundaryOverlay] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../app.js', import.meta.url), 'utf8'),
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

test('mobile attribution uses a fixed top corner instead of sheet-height tracking', () => {
  assert.match(app, /attributionControl\?\.setPosition\(isMobileViewLayout\(\) \? "topleft" : "bottomright"\)/);
  assert.match(mobileRules, /\.map-panel \.leaflet-top \{ top: 60px; \}/);
  assert.match(mobileRules, /\.map-panel \.leaflet-bottom\.leaflet-right \{ bottom: var\(--mobile-map-sheet-overlap, 0px\); \}/);
  assert.doesNotMatch(mobileRules, /\.map-panel \.leaflet-bottom \{ bottom: var\(--mobile-map-sheet-overlap/);
});

test('Calls mode removes the map and attribution while desktop keeps valid placement', () => {
  assert.match(mobileRules, /html\[data-mobile-view="calls"\] \.map-stage,[\s\S]*?\.map-info,[\s\S]*?\.mobile-bottom-sheet \{ display: none; \}/);
  assert.match(app, /isMobileViewLayout\(\) \? "topleft" : "bottomright"/);
  assert.match(desktopRules, /\.leaflet-control-attribution \{[\s\S]*?background: var\(--map-attribution-background\)/);
});
