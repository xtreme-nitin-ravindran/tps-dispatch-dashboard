import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyTheme, normalizeThemePreference, resolveTheme, themePreferences } from '../src/theme.js';

const [css, app] = await Promise.all([
  readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../app.js', import.meta.url), 'utf8')
]);

test('theme preferences validate and resolve explicit and system choices', () => {
  assert.deepEqual(themePreferences, ['system', 'light', 'dark']);
  assert.equal(normalizeThemePreference('light'), 'light');
  assert.equal(normalizeThemePreference('dark'), 'dark');
  assert.equal(normalizeThemePreference('unknown'), 'system');
  assert.equal(resolveTheme('system', true), 'dark');
  assert.equal(resolveTheme('system', false), 'light');
  assert.equal(resolveTheme('dark', false), 'dark');
});

test('applying a theme updates reusable document and browser chrome hooks', () => {
  const root = {dataset:{}};
  const meta = {content:''};
  assert.equal(applyTheme(root, meta, 'system', false), 'light');
  assert.equal(root.dataset.theme, 'light');
  assert.equal(meta.content, '#f4f7f8');
  assert.equal(applyTheme(root, meta, 'dark', false), 'dark');
  assert.equal(root.dataset.theme, 'dark');
  assert.equal(meta.content, '#0c1320');
});

test('map appearance follows live document theme without changing map layers', () => {
  const darkTheme = css.slice(css.indexOf(':root {'), css.indexOf(':root[data-theme="light"]'));
  const lightTheme = css.slice(css.indexOf(':root[data-theme="light"]'), css.indexOf('* { box-sizing'));
  assert.match(darkTheme, /--map-tile-filter: invert\(\.88\) hue-rotate\(180deg\) brightness\(\.72\) contrast\(1\.08\) saturate\(\.72\)/);
  assert.match(lightTheme, /--map-tile-filter: none/);
  assert.match(css, /\.leaflet-tile-pane\s*{\s*filter: var\(--map-tile-filter\)/);
  assert.match(css, /#dispatchMap[\s\S]*?background: var\(--map-background\)/);
  assert.match(css, /\.leaflet-control-attribution[\s\S]*?background: var\(--map-attribution-background\)/);
});

test('incident pins and road restrictions remain distinct and prominent in both themes', () => {
  const darkTheme = css.slice(css.indexOf(':root {'), css.indexOf(':root[data-theme="light"]'));
  const lightTheme = css.slice(css.indexOf(':root[data-theme="light"]'), css.indexOf('* { box-sizing'));
  assert.match(darkTheme, /--marker-other: #cbd5e1/);
  assert.match(darkTheme, /--road-marker: #f43f5e/);
  assert.match(darkTheme, /--marker-border: #fff/);
  assert.match(darkTheme, /--marker-shadow: rgba\(0, 0, 0, \.7\)/);
  assert.match(lightTheme, /--marker-other: #64748b/);
  assert.match(lightTheme, /--road-marker: #be123c/);
  assert.match(css, /\.road-restriction\s*{[^}]*stroke: var\(--road-marker\) !important;[^}]*fill: var\(--road-marker\) !important;/);
  assert.match(css, /\.map-legend \.other-key\s*{\s*background: var\(--marker-other\)/);
  assert.match(css, /\.road-key\s*{[^}]*border-top: 4px dashed var\(--road-marker\)/);
});

test('audited UI states use shared theme tokens', () => {
  assert.match(css, /\.dispatch-marker\s*{[\s\S]*?border: 2px solid var\(--marker-border\)[\s\S]*?background: var\(--marker-default\)/);
  assert.match(css, /\.dispatch-marker\.selected\s*{[\s\S]*?var\(--marker-selected-ring\)/);
  assert.match(css, /\.incident-change-badge\s*{[\s\S]*?var\(--warning-line\)[\s\S]*?var\(--warning-soft\)/);
  assert.match(css, /\.call-row\.selected\s*{[\s\S]*?var\(--accent-soft\)[\s\S]*?var\(--accent-line\)/);
  assert.match(css, /\.leaflet-tooltip\s*{[\s\S]*?background: var\(--panel\)/);
  assert.match(css, /\.leaflet-popup-content-wrapper,[\s\S]*?background: var\(--panel-2\)/);
  assert.match(css, /\.map-empty\s*{[\s\S]*?background: var\(--map-empty-background\)/);
  assert.match(css, /\.error-state strong\s*{\s*color: var\(--danger\)/);
  assert.match(css, /\.feed-status\s*{[\s\S]*?background: var\(--warning-soft\)[\s\S]*?color: var\(--status-warning\)/);
  assert.match(css, /\.event-filters select\s*{[\s\S]*?color: var\(--text\)[\s\S]*?background: var\(--control-bg\)/);
});

test('explicit and system theme changes update the document theme live', () => {
  assert.match(app, /const systemTheme = window\.matchMedia\("\(prefers-color-scheme: dark\)"\)/);
  assert.match(app, /function syncTheme\(\) {\s*applyTheme\(document\.documentElement, themeColorMeta, themePreference, systemTheme\.matches\);\s*}/);
  assert.match(app, /systemTheme\.addEventListener\('change', syncTheme\)/);
  assert.match(app, /#themePreference'\)\.addEventListener\('change',[\s\S]*?syncTheme\(\)/);
});
