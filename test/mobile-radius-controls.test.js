import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, css, app] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../app.js', import.meta.url), 'utf8')
]);

test('mobile radius selector exposes every supported search area in one shared control', () => {
  const [controls] = html.match(/<nav class="radius-controls"[\s\S]*?<\/nav>/);
  assert.match(controls, /aria-label="Incident search area"/);
  assert.deepEqual(
    [...controls.matchAll(/data-radius-km="([^"]+)"/g)].map(match => match[1]),
    ['0.5', '1', '2', '5', 'toronto']
  );
  assert.equal([...html.matchAll(/class="radius-controls"/g)].length, 1);
  for (const label of ['500 m', '1 km', '2 km', '5 km', 'Toronto-wide']) assert.match(controls, new RegExp(`>${label}<`));
});

test('mobile radius selector stays at the viewport edge with touch-sized buttons', () => {
  const mobileRules = css.slice(css.indexOf('@media (max-width: 680px) {\n  .radius-controls'));
  assert.match(mobileRules, /position: sticky/);
  assert.match(mobileRules, /top: max\(6px, env\(safe-area-inset-top\)\)/);
  assert.match(mobileRules, /grid-template-columns: \.95fr \.78fr \.78fr \.78fr 1\.45fr/);
  assert.match(mobileRules, /min-height: 44px/);
});

test('radius changes reuse the complete filtering and rendering pipeline', () => {
  assert.match(app, /function updateNearbyView\(\) {[\s\S]*?applyFilters\(\);[\s\S]*?syncRadiusControls\(\);/);
  assert.match(app, /function render\(map = true\) {[\s\S]*?renderNearbySummary\(\);[\s\S]*?renderCalls\(\);[\s\S]*?renderMap\(\);[\s\S]*?renderDisruptions/);
  assert.match(app, /toggle\.dataset\.radiusKm === 'toronto'[\s\S]*?state\.radiusKm = null;[\s\S]*?updateNearbyView\(\);/);
});

test('map and card selection share one zoom-preserving selected incident', () => {
  assert.match(app, /focusedCallId = reconcileIncidentSelection\(focusedCallId, state\.filtered\);/);
  assert.match(app, /\.on\("click", event => \{[\s\S]*?selectCall\(call\.id, \{ pan: false, revealRow: true \}\)/);
  assert.match(app, /const zoom = dispatchMap\.getZoom\(\);[\s\S]*?dispatchMap\.panTo\(coordinates/);
  assert.doesNotMatch(app, /setView\(coordinatesForCall\(call\),\s*18/);
  assert.match(app, /incident-card:not\(\.incident-card--popup\)[\s\S]*?aria-pressed/);
});

test('show-on-map is a working in-page link that selects the incident and reveals the map', () => {
  assert.match(html, /<a class="show-map-hint" href="#dispatchMap" hidden>Show on map/);
  assert.match(app, /event\.target\.closest\("\.show-map-hint"\)[\s\S]*?event\.preventDefault\(\);[\s\S]*?els\.dispatchMap\.scrollIntoView/);
  assert.match(app, /event\.target\.closest\("\.show-map-hint, \.glossary-trigger, \.glossary-popover"\)\) return;[\s\S]*?event\.key !== "Enter"/);
});
