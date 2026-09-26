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

test('mobile radius selector is a single scrollable row with touch-sized buttons', () => {
  const mobileQuery = '@media (max-width: 680px), (max-width: 950px) and (max-height: 500px) and (pointer: coarse)';
  const mobileRules = css.slice(css.indexOf(`${mobileQuery} {\n  .radius-controls`));
  assert.notEqual(css.indexOf(mobileQuery), -1, 'portrait and coarse-pointer landscape mobile layouts share the control rules');
  assert.match(mobileRules, /position: static/);
  assert.doesNotMatch(mobileRules, /position: sticky/);
  assert.match(mobileRules, /flex-wrap: nowrap/);
  assert.match(mobileRules, /overflow-x: auto/);
  assert.match(mobileRules, /max-width: 100%/);
  assert.match(mobileRules, /min-height: 44px/);
  assert.match(mobileRules, /\.map-panel \.leaflet-top \{ top: 60px; \}/);
  assert.match(mobileRules, /scroll-margin-top: 12px/);
});

test('desktop radius layout remains non-sticky and unchanged outside the mobile query', () => {
  const mobileStart = css.indexOf('@media (max-width: 680px), (max-width: 950px) and (max-height: 500px) and (pointer: coarse) {\n  .radius-controls');
  const desktopRules = css.slice(css.indexOf('.radius-controls {'), mobileStart);
  assert.match(desktopRules, /\.radius-controls \{ display: flex; align-items: center;/);
  assert.match(desktopRules, /\.radius-toggle-group \{ display: flex; flex-wrap: wrap;/);
  assert.doesNotMatch(desktopRules, /position: sticky/);
});

test('selected radius is derived from the existing state for the single shared control', () => {
  assert.equal([...html.matchAll(/data-radius-km=/g)].length, 5);
  assert.equal([...app.matchAll(/const radiusToggles = document\.querySelectorAll\('\[data-radius-km\]'\);/g)].length, 1);
  assert.equal([...app.matchAll(/radiusToggles\.forEach\(toggle => toggle\.addEventListener\('click'/g)].length, 1);
  assert.match(app, /function syncRadiusControls\(\) \{[\s\S]*?const active = value === state\.radiusKm;[\s\S]*?classList\.toggle\('active', active\);[\s\S]*?setAttribute\('aria-pressed', String\(active\)\);/);
  assert.match(app, /activeToggle\.scrollIntoView\(\{ block: 'nearest', inline: 'nearest' \}\)/);
});

test('deterministic fixture can select every radius without duplicating controls', () => {
  assert.match(app, /mobileAuditFixture\.radius === 'toronto' \? null : Number\(mobileAuditFixture\.radius\)/);
  assert.equal([...html.matchAll(/data-radius-km=/g)].length, 5);
});

test('radius changes reuse the complete filtering and rendering pipeline', () => {
  assert.match(app, /function updateNearbyView\(\) {[\s\S]*?applyFilters\(\);[\s\S]*?syncRadiusControls\(\);/);
  assert.match(app, /function render\(map = true\) {[\s\S]*?renderNearbySummary\(\);[\s\S]*?renderCalls\(\);[\s\S]*?renderMap\(\);[\s\S]*?renderDisruptions/);
  assert.match(app, /function selectNearbyRadius\(value\) {[\s\S]*?value === null[\s\S]*?state\.radiusKm = null;[\s\S]*?updateNearbyView\(\);/);
  assert.match(app, /radiusToggles\.forEach[\s\S]*?selectNearbyRadius\(toggle\.dataset\.radiusKm === 'toronto' \? null : Number\(toggle\.dataset\.radiusKm\)\)/);
});

test('map and card selection share one zoom-preserving selected incident', () => {
  assert.match(app, /focusedCallId = reconcileIncidentSelection\(focusedCallId, state\.filtered\);/);
  assert.match(app, /\.on\("click", event => \{[\s\S]*?setMobileSheetState\([\s\S]*?selectCall\(call\.id, \{ pan: false, revealRow: true \}\)/);
  assert.match(app, /const zoom = dispatchMap\.getZoom\(\);[\s\S]*?dispatchMap\.panTo\(coordinates/);
  assert.doesNotMatch(app, /setView\(coordinatesForCall\(call\),\s*18/);
  assert.match(app, /incident-card:not\(\.incident-card--popup\)[\s\S]*?aria-pressed/);
});

test('show-on-map is a working in-page link that selects the incident and reveals the map', () => {
  assert.match(html, /<a class="show-map-hint" href="#dispatchMap" hidden>Show on map/);
  assert.match(app, /event\.target\.closest\("\.show-map-hint"\)[\s\S]*?event\.preventDefault\(\);[\s\S]*?els\.dispatchMap\.scrollIntoView/);
  assert.match(app, /event\.target\.closest\("\.show-map-hint, \.glossary-trigger, \.glossary-popover, \.share-incident"\)\) return;[\s\S]*?event\.key !== "Enter"/);
});
