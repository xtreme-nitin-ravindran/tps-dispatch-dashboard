import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyTheme } from '../src/theme.js';

const [css, app, disruptions] = await Promise.all([
  readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../app.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/disruptions/ui.js', import.meta.url), 'utf8')
]);

const darkTheme = css.slice(css.indexOf(':root {'), css.indexOf(':root[data-theme="light"]'));
const lightTheme = css.slice(css.indexOf(':root[data-theme="light"]'), css.indexOf('* { box-sizing'));
const tilePaneRule = css.match(/\.leaflet-tile-pane\s*{([^}]*)}/)[1];

test('dark map dims the existing tiles without a full-pane filter or overlay', () => {
  assert.match(darkTheme, /--map-background: #101d2b/);
  assert.match(darkTheme, /--map-tile-opacity: \.46/);
  assert.match(tilePaneRule, /opacity: var\(--map-tile-opacity\)/);
  assert.doesNotMatch(tilePaneRule, /(?:filter|backdrop-filter|blur)\s*:/);
  assert.doesNotMatch(css, /--map-tile-filter/);
});

test('light map retains fully opaque standard OpenStreetMap tiles', () => {
  assert.match(lightTheme, /--map-background: #e2eaec/);
  assert.match(lightTheme, /--map-tile-opacity: 1/);
  assert.match(app, /L\.tileLayer\("https:\/\/\{s\}\.tile\.openstreetmap\.org\/\{z\}\/\{x\}\/\{y\}\.png"/);
});

test('explicit and system theme changes retarget map CSS without a reload', () => {
  const root = { dataset: {} };
  const meta = { content: '' };
  const syncTheme = app.match(/function syncTheme\(\)\s*{([^}]*)}/)[1];
  assert.equal(applyTheme(root, meta, 'light', true), 'light');
  assert.equal(applyTheme(root, meta, 'dark', false), 'dark');
  assert.equal(applyTheme(root, meta, 'system', true), 'dark');
  assert.equal(applyTheme(root, meta, 'system', false), 'light');
  assert.match(app, /systemTheme\.addEventListener\('change', syncTheme\)/);
  assert.doesNotMatch(syncTheme, /(?:location\.reload|tileLayer)/);
});

test('theme switching keeps one tile layer and existing map interactions', () => {
  assert.equal(app.match(/L\.tileLayer\(/g).length, 1);
  assert.match(app, /dispatchMap\.on\("zoomend", \(\) => \{[\s\S]*?expandedCluster\.clear\(\);[\s\S]*?scheduleMapMarkerRender\(\);[\s\S]*?\}\)/);
  assert.match(app, /dispatchMap\.on\("click", event =>/);
  assert.match(app, /dispatchMap\.on\('roadclosureselect', event => selectClosure/);
});

test('markers and vector overlays remain above and readable on the dimmed tiles', () => {
  assert.match(css, /\.dispatch-marker\s*{[^}]*border: 2px solid var\(--marker-border\)[^}]*box-shadow:/s);
  assert.match(css, /\.call-cluster\s*{[^}]*border: 2px solid var\(--cluster-border\)[^}]*color: var\(--cluster-text\)[^}]*text-shadow:/s);
  assert.match(css, /\.road-closure-line\s*{[^}]*stroke: var\(--road-marker\) !important/s);
  assert.match(css, /\.road-closure-symbol span\s*{[^}]*filter: drop-shadow/s);
  assert.match(css, /\.police-boundary\s*{[^}]*stroke: var\(--boundary-marker\) !important/s);
  assert.match(css, /\.nearby-origin\s*{[^}]*stroke: var\(--marker-selected-border\) !important;[^}]*fill: var\(--accent\) !important/s);
  assert.match(disruptions, /className:`road-closure-symbol/);
});
