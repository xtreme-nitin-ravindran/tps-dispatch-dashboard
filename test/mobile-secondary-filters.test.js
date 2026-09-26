import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { activeSecondaryFilterCount, filterDefaults } from '../src/view-controls.js';

const [html, css, app] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../app.js', import.meta.url), 'utf8')
]);

test('search remains visible while one mobile affordance owns secondary controls', () => {
  const controls = html.slice(html.indexOf('<section class="controls-card">'), html.indexOf('<p id="sharedIncidentStatus"'));
  assert.match(controls, /class="search-wrap"[\s\S]*?id="mobileFiltersToggle"/);
  assert.doesNotMatch(controls.slice(0, controls.indexOf('id="mobileFiltersToggle"')), /secondary-filter-control/);
  assert.equal([...html.matchAll(/id="mobileFiltersToggle"/g)].length, 1);
  for (const id of ['divisionSelect','historyHours','serviceFilter','eventFilterGroup','clearFilters','shareView']) {
    assert.equal([...html.matchAll(new RegExp(`id="${id}"`,'g'))].length, 1);
  }
});

test('meaningful secondary filters drive the count while search and radius do not', () => {
  assert.equal(activeSecondaryFilterCount(filterDefaults),0);
  assert.equal(activeSecondaryFilterCount({...filterDefaults,serviceFilter:'TFS'}),1);
  assert.equal(activeSecondaryFilterCount({...filterDefaults,serviceFilter:'TPS',eventFilter:'other',division:'Division 14',hours:12}),4);
  assert.equal(activeSecondaryFilterCount({...filterDefaults,search:'long query',radiusKm:2}),0);
});

test('mobile disclosure stays in document flow and desktop layouts remain visible', () => {
  assert.match(css, /\.mobile-filters-toggle \{ display: none; \}/);
  assert.match(css, /@media \(max-width: 680px\)[\s\S]*?\.mobile-filters-toggle \{[\s\S]*?display: flex;[\s\S]*?min-height: 44px;/);
  assert.match(css, /\.secondary-filter-control \{ display: none; \}[\s\S]*?\.mobile-filters-open \.secondary-filter-control \{ display: grid; \}/);
  assert.doesNotMatch(css, /\.mobile-filters-toggle\s*\{[^}]*position:\s*(?:fixed|sticky)/);
  assert.match(app, /setMobileFiltersOpen\(els\.mobileFiltersToggle\.getAttribute\('aria-expanded'\) !== 'true'\)/);
  assert.match(app, /function syncMobileFilterIndicator\(\)[\s\S]*?activeSecondaryFilterCount\(state\)/);
});

test('clear filters reuses existing semantics and refreshes the count', () => {
  const clearHandler = app.slice(app.indexOf("document.querySelector('#clearFilters').addEventListener"), app.indexOf("document.querySelector('#shareView').addEventListener"));
  assert.match(clearHandler, /Object\.assign\(state, filterDefaults\)/);
  assert.match(clearHandler, /syncFilterControls\(\)/);
  assert.match(app, /function syncFilterControls\(\)[\s\S]*?syncMobileFilterIndicator\(\)/);
});
