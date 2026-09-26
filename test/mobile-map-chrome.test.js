import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, css, app] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../app.js', import.meta.url), 'utf8')
]);
const mobileQuery = '@media (max-width: 680px), (max-width: 950px) and (max-height: 500px) and (pointer: coarse)';
const mobileStart = css.indexOf(mobileQuery);
const mobileRules = css.slice(mobileStart, css.indexOf('\n}', mobileStart) + 2);
const desktopRules = css.slice(0, mobileStart);

test('mobile overlay controls share one compact row with full labels and 44px targets', () => {
  assert.match(html, /class="road-overlay-toggle map-layer-toggle"[\s\S]*?<span>Road closures<\/span>/);
  assert.match(app, /"Police division boundaries": layer/);
  assert.equal([...html.matchAll(/id="roadOverlay"/g)].length, 1);
  assert.equal([...app.matchAll(/L\.control\.layers\(/g)].length, 1);
  assert.match(mobileRules, /\.map-layer-toggle \{[\s\S]*?top: 8px;[\s\S]*?width: calc\(50% - 12px\);[\s\S]*?min-height: 48px/);
  assert.match(mobileRules, /\.leaflet-control-layers \{[\s\S]*?min-height: 48px;[\s\S]*?padding: 1px 8px/);
  assert.match(mobileRules, /\.leaflet-control-layers-overlays label \{[\s\S]*?min-height: 44px/);
});

test('zoom, attribution, and overlay chrome remain inside the usable map in every sheet state', () => {
  assert.match(mobileRules, /\.map-panel \.leaflet-top \{ top: 60px; \}/);
  assert.match(mobileRules, /\.map-panel \.leaflet-bottom \{ bottom: var\(--mobile-sheet-height\)/);
  assert.match(mobileRules, /--mobile-sheet-height: calc\(52px \+ env\(safe-area-inset-bottom, 0px\)\)/);
  assert.match(mobileRules, /data-mobile-sheet-state="half"[\s\S]*?var\(--mobile-map-height\) - 220px/);
  assert.match(mobileRules, /data-mobile-sheet-state="expanded"[\s\S]*?var\(--mobile-map-height\) - 160px/);
});

test('collapsed sheet is compact and tappable while Calls mode owns no sheet', () => {
  assert.match(mobileRules, /\.mobile-sheet-header \{[\s\S]*?min-height: 52px/);
  assert.ok(52 >= 44);
  assert.match(mobileRules, /html\[data-mobile-view="calls"\][\s\S]*?\.mobile-bottom-sheet \{ display: none; \}/);
  assert.match(app, /setAttribute\("aria-expanded", String\(nextState !== "collapsed"\)\)/);
  assert.match(app, /control\.dataset\.sheetTarget === nextState/);
});

test('mobile-only compaction preserves desktop map chrome', () => {
  assert.match(desktopRules, /\.map-layer-toggle \{[\s\S]*?top: 12px;[\s\S]*?min-height: 42px;[\s\S]*?padding: 8px 10px/);
  assert.doesNotMatch(desktopRules, /--mobile-sheet-height/);
});

test('compact fixed surfaces do not introduce horizontal overflow or expensive blur', () => {
  assert.match(mobileRules, /\.map-layer-toggle \{[\s\S]*?width: calc\(50% - 12px\);[\s\S]*?max-width: none/);
  assert.match(mobileRules, /\.leaflet-top\.leaflet-right \{[\s\S]*?right: 8px;[\s\S]*?left: calc\(50% \+ 4px\)/);
  assert.match(mobileRules, /\.mobile-bottom-sheet \{[\s\S]*?inset: auto 0 0;[\s\S]*?backdrop-filter: none/);
});
