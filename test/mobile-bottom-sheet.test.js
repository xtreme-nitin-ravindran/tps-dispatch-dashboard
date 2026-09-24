import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mobileSheetActionLabel, mobileSheetStateAfterDrag, nextMobileSheetState } from '../src/mobile-bottom-sheet.js';

const [html, css, app] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../app.js', import.meta.url), 'utf8')
]);
const mobileQuery = '@media (max-width: 680px), (max-width: 950px) and (max-height: 500px) and (pointer: coarse)';

test('bottom sheet shell renders only at the mobile breakpoint and preserves desktop layout', () => {
  assert.match(html, /<aside class="mobile-bottom-sheet"[\s\S]*?data-sheet-state="collapsed"/);
  assert.match(css.slice(0, css.indexOf(mobileQuery)), /\.mobile-bottom-sheet \{ display: none; \}/);
  assert.match(css.slice(css.indexOf(mobileQuery)), /\.mobile-bottom-sheet \{[\s\S]*?position: fixed;[\s\S]*?inset: auto 0 0;[\s\S]*?display: grid;/);
  assert.doesNotMatch(css.slice(0, css.indexOf(mobileQuery)), /position: fixed;[\s\S]*?mobile-bottom-sheet/);
});

test('collapsed, half, and expanded states have bounded safe-area-aware heights', () => {
  const mobileRules = css.slice(css.indexOf(mobileQuery));
  assert.match(mobileRules, /--mobile-sheet-height: calc\(72px \+ env\(safe-area-inset-bottom, 0px\)\)/);
  assert.match(mobileRules, /data-mobile-sheet-state="half"[\s\S]*?42dvh/);
  assert.match(mobileRules, /data-mobile-sheet-state="expanded"[\s\S]*?68dvh/);
  assert.match(mobileRules, /padding-bottom: env\(safe-area-inset-bottom, 0px\)/);
  assert.match(mobileRules, /\.map-panel \.leaflet-bottom \{ bottom: var\(--mobile-sheet-height\)/);
});

test('tap and drag interactions move through the three sheet states', () => {
  assert.equal(nextMobileSheetState('collapsed'), 'half');
  assert.equal(nextMobileSheetState('half'), 'expanded');
  assert.equal(nextMobileSheetState('expanded', -2), 'collapsed');
  assert.equal(nextMobileSheetState('unknown'), 'half');
  assert.equal(mobileSheetStateAfterDrag('collapsed', -50), 'half');
  assert.equal(mobileSheetStateAfterDrag('half', -50), 'expanded');
  assert.equal(mobileSheetStateAfterDrag('expanded', 50), 'half');
  assert.equal(mobileSheetStateAfterDrag('half', 10), 'half');
  assert.match(app, /mobileSheetToggle\?\.addEventListener\("click"[\s\S]*?setMobileSheetState\(nextMobileSheetState/);
  assert.match(app, /mobileSheetToggle\?\.addEventListener\("pointerdown"[\s\S]*?mobileSheetToggle\?\.addEventListener\("pointerup"/);
});

test('sheet remains operable without drag gestures', () => {
  assert.match(html, /id="mobileSheetToggle"[\s\S]*?aria-controls="mobileSheetBody"[\s\S]*?aria-expanded="false"/);
  for (const state of ['collapsed', 'half', 'expanded']) assert.match(html, new RegExp(`data-sheet-target="${state}"`));
  assert.equal(mobileSheetActionLabel('collapsed'), 'Expand nearby calls sheet to half height');
  assert.equal(mobileSheetActionLabel('half'), 'Expand nearby calls sheet to full height');
  assert.equal(mobileSheetActionLabel('expanded'), 'Collapse nearby calls sheet');
  assert.match(app, /setAttribute\("aria-expanded", String\(nextState !== "collapsed"\)\)/);
  assert.match(app, /setAttribute\("aria-pressed", String\(control\.dataset\.sheetTarget === nextState\)\)/);
});

test('sheet reuses nearby summary, incident cards, and existing controls', () => {
  assert.match(app, /const summaryText = nearbySummary\(state\.filtered, state\.radiusKm\)[\s\S]*?mobileSheetSummary\.textContent = summaryText/);
  assert.match(html, /id="mobileSheetCallList"/);
  assert.match(app, /renderList\(els\.callList\);\s*renderList\(mobileSheetCallList\)/);
  assert.equal([...app.matchAll(/function createIncidentCard\(/g)].length, 1);
  assert.match(app, /fragment\.appendChild\(createIncidentCard\(call, \{ distance \}\)\)/);
  assert.equal([...html.matchAll(/data-radius-km=/g)].length, 5);
  assert.equal([...html.matchAll(/data-mobile-view=/g)].length, 2);
  assert.match(app, /radiusToggles\.forEach\(toggle => toggle\.addEventListener\('click'/);
  assert.match(app, /mobileViewToggles\.forEach\(toggle => toggle\.addEventListener\("click"/);
});

test('sheet header stays visible while incident content scrolls independently', () => {
  const mobileRules = css.slice(css.indexOf(mobileQuery));
  assert.match(mobileRules, /\.mobile-bottom-sheet \{[\s\S]*?grid-template-rows: auto minmax\(0, 1fr\);[\s\S]*?overflow: hidden/);
  assert.match(mobileRules, /\.mobile-sheet-body \{[\s\S]*?overflow-y: auto;[\s\S]*?overscroll-behavior: contain;[\s\S]*?touch-action: pan-y/);
  assert.match(mobileRules, /\.mobile-sheet-header \{[\s\S]*?touch-action: none/);
  assert.doesNotMatch(app, /mobileSheetBody\?\.addEventListener\("pointer(?:down|move|up)"/);
});

test('opening and closing the sheet is presentation-only and never refetches data', () => {
  const setterStart = app.indexOf('function setMobileSheetState(');
  const setter = app.slice(setterStart, app.indexOf('\nmobileSheetToggle?.addEventListener', setterStart));
  assert.match(setter, /dataset\.sheetState = nextState/);
  assert.doesNotMatch(setter, /fetch|fetchSnapshot|loadData|applyFilters|renderCalls/);
});
