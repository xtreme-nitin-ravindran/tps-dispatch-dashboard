import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, css] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../styles.css', import.meta.url), 'utf8')
]);

const portraitStart = css.indexOf('@media (max-width: 680px) {\n  .app-shell');
const desktopRules = css.slice(0, portraitStart);
const portraitRules = css.slice(portraitStart);

test('mobile header keeps branding and theme access in one compact row', () => {
  assert.match(html, /class="brand"[\s\S]*?<h1>SirenTO<\/h1>/);
  assert.match(html, /id="themePreference" aria-label="Theme preference"/);
  assert.match(portraitRules, /\.topbar \{[\s\S]*?min-height: 60px;/);
  assert.match(portraitRules, /\.topbar \{[\s\S]*?flex-wrap: nowrap;[\s\S]*?padding: 8px 0;/);
  assert.match(portraitRules, /\.topbar-photo,[\s\S]*?\.topbar-tools > \.refresh-info \{ display: none; \}/);
  assert.match(portraitRules, /\.theme-control select \{ min-height: 44px; \}/);
});

test('Search and collapsed Filters share one mobile row without hiding either control', () => {
  const controls = html.match(/<section class="controls-card">[\s\S]*?<\/section>/)[0];
  assert.ok(controls.indexOf('id="searchInput"') < controls.indexOf('id="mobileFiltersToggle"'));
  assert.match(portraitRules, /\.controls-card \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto;[\s\S]*?gap: 6px;[\s\S]*?padding: 8px;/);
  assert.match(portraitRules, /\.mobile-filters-toggle \{[\s\S]*?min-width: 82px;[\s\S]*?min-height: 44px;/);
  assert.match(portraitRules, /\.secondary-filter-control \{ display: none; \}/);
});

test('Quick Look keeps its action, status, fallback and disclosure while avoiding a wrapped fallback row', () => {
  const quickLook = html.match(/<section class="nearby-feature"[\s\S]*?<\/section>/)[0];
  for (const id of ['nearMe', 'nearStatus', 'chooseArea']) assert.match(quickLook, new RegExp(`id="${id}"`));
  assert.match(quickLook, /<summary>Location &amp; more options<\/summary>/);
  assert.match(quickLook, /class="mobile-location-action">Choose area<\/span>/);
  assert.match(portraitRules, /#nearControls:not\(\[hidden\]\) \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); gap: 6px;/);
  assert.match(portraitRules, /#nearControls button \{ min-width: 0; min-height: 44px;/);
  assert.match(portraitRules, /\.desktop-location-action \{ display: none; \}[\s\S]*?\.mobile-location-action \{ display: inline; \}/);
});

test('mobile compaction stays in normal flow and desktop layout remains unchanged', () => {
  assert.doesNotMatch(portraitRules, /\.(?:topbar|nearby-feature|controls-card|radius-controls)\s*\{[^}]*position:\s*(?:fixed|sticky)/);
  assert.match(desktopRules, /\.topbar \{[\s\S]*?min-height: 86px;/);
  const desktopControls = desktopRules.match(/\.controls-card \{[\s\S]*?\}/)[0];
  assert.match(desktopControls, /grid-template-columns: 1fr auto auto;/);
  assert.match(desktopControls, /padding: 14px;/);
  assert.match(css, /\.nearby-feature \{ margin: 20px 0; padding: 24px;/);
});

test('mobile widths are constrained and hidden controls cannot reserve space', () => {
  assert.match(portraitRules, /\.app-shell \{[\s\S]*?width: min\(100% - 22px, 1480px\);/);
  assert.match(portraitRules, /\.search-wrap \{[\s\S]*?min-width: 0;/);
  assert.match(portraitRules, /\.topbar-photo,[\s\S]*?display: none;/);
  assert.match(portraitRules, /\.secondary-filter-control \{ display: none; \}/);
});
