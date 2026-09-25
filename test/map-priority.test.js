import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, css, app] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../app.js', import.meta.url), 'utf8')
]);

const mapStart = html.indexOf('<section class="map-stage" id="mapView">');
const resultsStart = html.indexOf('<section class="content-grid" id="callsView">');
const infoStart = html.indexOf('<details class="panel map-info" id="mapInfo">');
const disruptionsStart = html.indexOf('<section class="panel disruptions-panel"');
const mapMarkup = html.slice(mapStart, resultsStart);
const mapInfoMarkup = html.slice(infoStart, disruptionsStart);
const mobileQuery = '@media (max-width: 680px), (max-width: 950px) and (max-height: 500px) and (pointer: coarse)';
const mobileRules = css.slice(css.indexOf(mobileQuery));

test('map immediately follows the filter summary controls without permanent metadata above it', () => {
  assert.ok(html.indexOf('class="radius-controls"') < mapStart);
  assert.ok(html.indexOf('class="nearby-summary"') < mapStart);
  assert.doesNotMatch(mapMarkup, /Toronto call map|Source updates|map-legend|id="mapStatus"/);
  assert.match(mapMarkup, /class="map-wrap"/);
  assert.match(css, /\.map-stage\s*{\s*margin: 12px 0 18px;/);
});

test('results follow the map before map metadata and travel disruptions on desktop', () => {
  assert.ok(mapStart < resultsStart);
  assert.ok(resultsStart < infoStart);
  assert.ok(infoStart < disruptionsStart);
  assert.doesNotMatch(css.slice(0, css.indexOf('@media (max-width: 1050px)')), /\.map-stage\s*{[^}]*display:\s*none/);
  assert.doesNotMatch(css.slice(0, css.indexOf('@media (max-width: 1050px)')), /\.content-grid\s*{[^}]*display:\s*none/);
});

test('legend, located count, map heading, and source freshness remain accessible in collapsed map info', () => {
  assert.match(mapInfoMarkup, /<summary>[\s\S]*Map info &amp; legend[\s\S]*id="mapStatus"/);
  assert.doesNotMatch(html.slice(infoStart, html.indexOf('>', infoStart) + 1), /\sopen(?:\s|>)/);
  for (const text of [
    'Toronto call map', 'Source updates', 'What do these times mean?', 'Fire', 'Medical', 'Other',
    'Resolved intersection / street segment', 'Approximate location', 'TFS circle', 'TPS square',
    '0–10 min · strongest', '10–30 min · normal', '30–60 min', '60+ min'
  ]) assert.match(mapInfoMarkup, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(app, /els\.sourceUpdated\.replaceChildren/);
  assert.match(app, /els\.mapStatus\.textContent/);
});

test('mobile map/results switching and bottom sheet behavior remain intact', () => {
  assert.match(mobileRules, /html\[data-mobile-view="calls"\] \.map-stage,/);
  assert.match(mobileRules, /html\[data-mobile-view="map"\] \.content-grid,/);
  assert.match(mobileRules, /\.mobile-bottom-sheet \{[\s\S]*?position: fixed;[\s\S]*?display: grid;/);
  assert.match(app, /mobileSheetToggle\?\.addEventListener\("click"/);
});

test('filters remain earlier in normal document flow and map info uses theme tokens', () => {
  for (const id of ['searchInput', 'divisionSelect', 'historyHours', 'serviceFilter']) {
    assert.ok(html.indexOf(`id="${id}"`) < mapStart, `${id} should remain before the map`);
  }
  assert.ok(html.indexOf('data-event-filter="all"') < mapStart);
  assert.ok(html.indexOf('data-radius-km="0.5"') < mapStart);
  const infoRules = css.slice(css.indexOf('.map-info {'), css.indexOf('.map-status {'));
  assert.match(infoRules, /border-top: 1px solid var\(--line\)/);
  assert.match(infoRules, /outline: 3px solid var\(--focus-ring\)/);
});
