import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyTheme } from '../src/theme.js';
import { clusterPoints } from '../src/map-clusters.js';

const [css, app, disruptions] = await Promise.all([
  readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../app.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/disruptions/ui.js', import.meta.url), 'utf8')
]);

const darkTheme = css.slice(css.indexOf(':root {'), css.indexOf(':root[data-theme="light"]'));
const lightTheme = css.slice(css.indexOf(':root[data-theme="light"]'), css.indexOf('* { box-sizing'));

test('incident pins have a defined theme-aware edge and restrained halo', () => {
  assert.match(css, /\.dispatch-marker\s*{[\s\S]*?border: 2px solid var\(--marker-border\)[\s\S]*?box-shadow: 0 0 0 2px var\(--marker-ring\), 0 3px 8px var\(--marker-shadow\)/);
  assert.match(darkTheme, /--marker-border: #fff/);
  assert.match(darkTheme, /--marker-ring: rgba\(8, 17, 27, \.58\)/);
  assert.match(lightTheme, /--marker-border: #173d35/);
  assert.match(lightTheme, /--marker-ring: rgba\(255, 255, 255, \.9\)/);
  assert.match(css, /\.dispatch-marker\.category-fire \{ background: var\(--marker-fire\); \}/);
  assert.match(css, /\.dispatch-marker\.category-medical \{ background: var\(--marker-medical\); \}/);
  assert.match(css, /\.dispatch-marker\.category-other \{ background: var\(--marker-other\); \}/);
});

test('live explicit and system theme changes retarget marker variables', () => {
  const root = { dataset: {} };
  const meta = { content: '' };
  applyTheme(root, meta, 'system', true);
  assert.equal(root.dataset.theme, 'dark');
  applyTheme(root, meta, 'system', false);
  assert.equal(root.dataset.theme, 'light');
  applyTheme(root, meta, 'dark', false);
  assert.equal(root.dataset.theme, 'dark');
  assert.match(app, /systemTheme\.addEventListener\('change', syncTheme\)/);
});

test('selection remains distinct while aging retains relative de-emphasis', () => {
  assert.match(css, /\.dispatch-marker\.selected\s*{[\s\S]*?transform: scale\(1\.45\)[\s\S]*?var\(--marker-selected-inner\)[\s\S]*?var\(--marker-selected-ring\)/);
  assert.match(css, /\.dispatch-marker\.age-aging \{ opacity: \.72; \}/);
  assert.match(css, /\.dispatch-marker\.age-old \{ opacity: \.52; \}/);
  assert.match(css, /\.dispatch-marker\.selected,\s*\.dispatch-marker\.siren-match\s*{\s*opacity: 1/);
});

test('clusters keep readable counts and unchanged grouping behavior', () => {
  assert.match(css, /\.call-cluster\s*{[\s\S]*?border: 2px solid var\(--cluster-border\)[\s\S]*?color: var\(--cluster-text\)[\s\S]*?text-shadow:[\s\S]*?box-shadow:/);
  assert.match(darkTheme, /--cluster-border: #fff/);
  assert.match(lightTheme, /--cluster-border: #10242a/);
  const calls = [{ id: 'a' }, { id: 'b' }];
  assert.equal(clusterPoints(calls, () => ({ x: 1, y: 1 })).length, 1);
  assert.match(app, /className:`call-cluster age-\$\{clusterTier\}/);
  assert.match(app, /html:String\(group\.length\)/);
});

test('contrast styles are scoped away from location and road-closure objects', () => {
  assert.match(app, /L\.circleMarker\(state\.nearby/);
  assert.match(disruptions, /className:`road-closure-symbol/);
  assert.doesNotMatch(css, /\.nearby-origin[^}]*var\(--marker-(?:border|ring|shadow)\)/);
  assert.doesNotMatch(css, /\.road-closure-(?:line|symbol)[^}]*var\(--marker-(?:border|ring|shadow)\)/);
});

test('incident marker click still uses the existing selection path', () => {
  assert.match(app, /\.on\("click", event => \{[\s\S]*?selectCall\(call\.id, \{ pan: false, revealRow: true \}\)/);
});
