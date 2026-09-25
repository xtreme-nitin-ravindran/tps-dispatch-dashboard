import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [css, html, serviceWorker] = await Promise.all([
  readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../service-worker.js', import.meta.url), 'utf8')
]);
const mobileQuery = '@media (max-width: 680px), (max-width: 950px) and (max-height: 500px) and (pointer: coarse)';
const mobileStart = css.indexOf(mobileQuery);
const mobileRules = css.slice(mobileStart, css.indexOf('\n}', mobileStart) + 2);
const desktopRules = css.slice(0, mobileStart);
const portraitStart = css.indexOf('@media (max-width: 680px) {\n  .app-shell');
const portraitRules = css.slice(portraitStart, mobileStart);

function declaration(selector, rules = mobileRules) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return rules.match(new RegExp(`(?:^|\\n)\\s*${escapedSelector}\\s*\\{([^}]*)\\}`))[1];
}

test('mobile fixed and sticky surfaces use opaque theme backgrounds without backdrop blur', () => {
  for (const selector of ['.radius-controls', '.mobile-bottom-sheet']) {
    const rules = declaration(selector);
    assert.match(rules, /background: var\(--panel\)/);
    assert.match(rules, /box-shadow: 0 (?:2px 8px|-4px 12px) rgb\(0 0 0 \/ 18%\)/);
    assert.match(rules, /backdrop-filter: none/);
    assert.doesNotMatch(rules, /blur\(/);
  }
});

test('mobile map overlay containers avoid backdrop blur without changing alignment', () => {
  for (const selector of ['.map-layer-toggle', '.map-panel .leaflet-top.leaflet-right .leaflet-control-layers']) {
    const rules = declaration(selector);
    assert.match(rules, /background: var\(--panel\)/);
    assert.match(rules, /backdrop-filter: none/);
    assert.doesNotMatch(rules, /blur\(/);
  }
  assert.match(declaration('.map-layer-toggle'), /width: calc\(50% - 12px\)/);
  assert.match(mobileRules, /\.map-panel \.leaflet-top\.leaflet-right\s*\{[\s\S]*?left: calc\(50% \+ 4px\);/);
});

test('mobile search controls avoid blur while desktop glass styling remains available', () => {
  assert.match(declaration('.controls-card', portraitRules), /background: var\(--panel\)/);
  assert.match(declaration('.controls-card', portraitRules), /backdrop-filter: none/);
  assert.match(declaration('.controls-card', desktopRules), /backdrop-filter: blur\(18px\)/);
  assert.match(declaration('.map-layer-toggle', desktopRules), /backdrop-filter: blur\(12px\)/);
});

test('opaque mobile surfaces resolve to readable light and dark theme pairs', () => {
  assert.match(css, /:root\s*\{[\s\S]*?--panel: #0f1926;[\s\S]*?--text: #f4f7fb;/);
  assert.match(css, /:root\[data-theme="light"\]\s*\{[\s\S]*?--panel: #ffffff;[\s\S]*?--text: #10242a;/);
});

test('the revised mobile stylesheet replaces the cached app-shell asset', () => {
  assert.match(html, /styles\.css\?v=map-priority-1/);
  assert.match(serviceWorker, /CACHE_VERSION = "sirento-shell-v4"/);
});
