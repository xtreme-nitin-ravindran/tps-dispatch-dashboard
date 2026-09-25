import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, css] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../styles.css', import.meta.url), 'utf8')
]);

const mobileQuery = '@media (max-width: 680px), (max-width: 950px) and (max-height: 500px) and (pointer: coarse)';

test('installed mode is detected with standard display-mode and the iOS standalone fallback', () => {
  assert.match(html, /matchMedia\("\(display-mode: standalone\)"\)/);
  assert.match(html, /standaloneQuery\.matches \|\| navigator\.standalone === true/);
  assert.match(html, /dataset\.displayMode = standalone \? "standalone" : "browser"/);
  assert.match(html, /standaloneQuery\.addEventListener\?\.\("change", syncDisplayMode\)/);
});

test('standalone layout opts into the full viewport and protects every device edge', () => {
  assert.match(html, /const browserViewport = "width=device-width,initial-scale=1"/);
  assert.match(html, /viewport\.content = standalone \? `\$\{browserViewport\},viewport-fit=cover` : browserViewport/);
  assert.match(css, /html\[data-display-mode="standalone"\] body \{[\s\S]*?min-height: 100dvh;[\s\S]*?safe-area-inset-right[\s\S]*?safe-area-inset-left/);
  assert.match(css, /html\[data-display-mode="standalone"\] \.app-shell \{[\s\S]*?safe-area-inset-top[\s\S]*?safe-area-inset-bottom/);
});

test('normal browser mode retains the base shell sizing without standalone padding', () => {
  assert.match(html, /<meta name="viewport" content="width=device-width,initial-scale=1" \/>/);
  const baseShell = css.slice(css.indexOf('.app-shell {'), css.indexOf('html[data-display-mode="standalone"] .app-shell'));
  assert.match(baseShell, /width: min\(1480px, calc\(100% - 36px\)\)/);
  assert.match(baseShell, /margin: 0 auto/);
  assert.doesNotMatch(baseShell, /safe-area-inset/);
  assert.doesNotMatch(css, /data-display-mode="browser"[^{]*{/);
});

test('standalone mobile controls and sheet remain visible, touch-sized, and safe-area aware', () => {
  const mobileRules = css.slice(css.indexOf(mobileQuery));
  assert.match(mobileRules, /\.radius-controls \{[\s\S]*?position: sticky;[\s\S]*?safe-area-inset-top/);
  assert.match(mobileRules, /\.mobile-view-toggle \{ display: grid;[\s\S]*?\.mobile-view-toggle button \{ min-height: 44px/);
  assert.match(mobileRules, /\.mobile-bottom-sheet \{[\s\S]*?position: fixed;[\s\S]*?display: grid;[\s\S]*?safe-area-inset-bottom/);
  assert.match(mobileRules, /data-display-mode="standalone"\] \.mobile-bottom-sheet \{[\s\S]*?safe-area-inset-right[\s\S]*?safe-area-inset-left/);
  assert.match(mobileRules, /\.mobile-sheet-state-controls button \{ min-height: 44px/);
});
