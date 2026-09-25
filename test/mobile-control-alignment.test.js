import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, css] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../styles.css', import.meta.url), 'utf8')
]);

const portraitStart = css.indexOf('@media (max-width: 680px) {\n  .app-shell');
const sharedMobileStart = css.indexOf('@media (max-width: 680px), (max-width: 950px) and (max-height: 500px) and (pointer: coarse)');
const portraitRules = css.slice(portraitStart, sharedMobileStart);
const sharedMobileRules = css.slice(sharedMobileStart);
const finalMobileRules = css.slice(css.lastIndexOf('@media (max-width: 680px) {'));

test('mobile filters and actions use aligned grids with usable touch targets', () => {
  assert.match(portraitRules, /\.event-toggle-group\s*{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[\s\S]*?gap: 8px;/);
  assert.match(portraitRules, /\.event-toggle:first-child\s*{[\s\S]*?grid-column: 1 \/ -1;/);
  assert.match(portraitRules, /\.event-toggle\s*{[\s\S]*?min-height: 44px;/);
  assert.match(finalMobileRules, /\.view-actions\s*{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[\s\S]*?gap: 8px;/);
  assert.match(finalMobileRules, /\.view-actions button\s*{ width: 100%; min-height: 44px; \}/);
});

test('radius choices form deliberate three-and-two rows above Map and Calls', () => {
  assert.match(sharedMobileRules, /\.radius-toggle-group\s*{[\s\S]*?grid-template-columns: repeat\(6, minmax\(0, 1fr\)\);[\s\S]*?gap: 4px;/);
  assert.match(sharedMobileRules, /\.radius-toggle-group button\s*{ grid-column: span 2; \}/);
  assert.match(sharedMobileRules, /button:nth-child\(n \+ 4\)\s*{ grid-column: span 3; \}/);
  assert.match(sharedMobileRules, /\.mobile-view-toggle\s*{ display: grid; grid-template-columns: 1fr 1fr; gap: 4px; width: 100%; \}/);
  assert.match(sharedMobileRules, /\.radius-toggle-group button\s*{[\s\S]*?min-height: 44px;/);
  assert.match(sharedMobileRules, /\.mobile-view-toggle button\s*{ min-height: 44px;/);
});

test('road and police boundary controls share aligned mobile map columns', () => {
  assert.match(html, /class="road-overlay-toggle map-layer-toggle"[\s\S]*?Road closures/);
  assert.match(sharedMobileRules, /\.map-layer-toggle\s*{[\s\S]*?left: 8px;[\s\S]*?width: calc\(50% - 12px\);[\s\S]*?min-height: 64px;/);
  assert.match(sharedMobileRules, /\.map-panel \.leaflet-top\.leaflet-right\s*{[\s\S]*?right: 8px;[\s\S]*?left: calc\(50% \+ 4px\);/);
  assert.match(sharedMobileRules, /\.leaflet-control-layers\s*{[\s\S]*?width: 100%;[\s\S]*?min-height: 64px;/);
  assert.match(sharedMobileRules, /\.leaflet-control-layers-overlays label\s*{[\s\S]*?min-height: 44px;/);
});

test('desktop control layouts remain outside the mobile overrides', () => {
  const desktopRules = css.slice(0, portraitStart);
  assert.match(desktopRules, /\.event-toggle-group\s*{[\s\S]*?display: flex;[\s\S]*?flex-wrap: wrap;/);
  assert.match(css, /\.view-actions \{ display: flex; flex-wrap: wrap;/);
  assert.match(css, /\.radius-controls \{ display: flex; align-items: center;/);
  assert.match(css, /\.mobile-view-toggle \{ display: none; \}/);
});

test('mobile sticky and bottom-sheet safe-area behavior is preserved', () => {
  assert.match(sharedMobileRules, /position: sticky;[\s\S]*?env\(safe-area-inset-top, 0px\)/);
  assert.match(sharedMobileRules, /\.mobile-bottom-sheet\s*{[\s\S]*?position: fixed;[\s\S]*?height: var\(--mobile-sheet-height\);/);
  assert.match(sharedMobileRules, /padding-bottom: env\(safe-area-inset-bottom, 0px\)/);
  assert.match(sharedMobileRules, /scroll-margin-top: calc\(152px \+ env\(safe-area-inset-top, 0px\)\)/);
});
