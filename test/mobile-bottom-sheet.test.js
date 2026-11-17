import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mobileMapSheetOverlap, mobileSheetActionLabel, nextMobileSheetState } from '../src/mobile-bottom-sheet.js';

const [html, css, app] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../assets/css/styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/app.js', import.meta.url), 'utf8')
]);
const mobileQuery = '@media (max-width: 680px), (max-width: 950px) and (max-height: 500px) and (pointer: coarse)';

test('[MUST-10][STORY-17] bottom sheet shell renders only at the mobile breakpoint and preserves desktop layout', () => {
  assert.match(html, /<aside class="mobile-bottom-sheet"[\s\S]*?data-sheet-state="collapsed"/);
  assert.match(css.slice(0, css.indexOf(mobileQuery)), /\.mobile-bottom-sheet \{ display: none; \}/);
  assert.match(css.slice(css.indexOf(mobileQuery)), /\.mobile-bottom-sheet \{[\s\S]*?position: fixed;[\s\S]*?inset: auto 0 0;[\s\S]*?display: grid;/);
  assert.doesNotMatch(css.slice(0, css.indexOf(mobileQuery)), /position: fixed;[\s\S]*?mobile-bottom-sheet/);
});

test('[MUST-10][STORY-17] collapsed and open states have bounded safe-area-aware heights', () => {
  const mobileRules = css.slice(css.indexOf(mobileQuery));
  assert.match(mobileRules, /--mobile-sheet-height: calc\(52px \+ env\(safe-area-inset-bottom, 0px\)\)/);
  assert.match(mobileRules, /--mobile-map-height: 460px/);
  assert.match(mobileRules, /data-mobile-sheet-state="open"[\s\S]*?min\(40dvh, calc\(var\(--mobile-map-height\) - 160px\)\)/);
  assert.match(mobileRules, /padding-bottom: env\(safe-area-inset-bottom, 0px\)/);
  assert.match(mobileRules, /\.map-panel \.leaflet-bottom\.leaflet-right \{ bottom: var\(--mobile-map-sheet-overlap, 0px\)/);
});

test('[MUST-10][STORY-17] the summary toggles the independent sheet', () => {
  assert.equal(nextMobileSheetState('collapsed'), 'open');
  assert.equal(nextMobileSheetState('open'), 'collapsed');
  assert.match(app, /mobileSheetToggle\?\.addEventListener\("click"[\s\S]*?setMobileSheetState\(nextMobileSheetState/);
});

test('[MUST-10][STORY-17] sheet remains operable without drag gestures', () => {
  assert.match(html, /id="mobileSheetToggle"[\s\S]*?aria-controls="mobileSheetBody"[\s\S]*?aria-expanded="false"/);
  assert.doesNotMatch(html, /data-sheet-target/);
  assert.equal(mobileSheetActionLabel('collapsed'), 'Open nearby calls sheet');
  assert.equal(mobileSheetActionLabel('open'), 'Close nearby calls sheet');
  assert.match(app, /setAttribute\("aria-expanded", String\(nextState !== "collapsed"\)\)/);
});

test('[MUST-10][STORY-17] sheet reuses nearby summary, incident cards, and existing controls', () => {
  assert.match(app, /const summaryText = empty\?\.message[\s\S]*?nearbySummary\(state\.filtered, state\.radiusKm,[^;]+\);[\s\S]*?const mobileSummaryText = mobileNearbySummary\([\s\S]*?mobileSheetSummary\.textContent = mobileSummaryText/);
  assert.match(html, /id="mobileSheetCallList"/);
  assert.match(app, /const host = mobile && mobileView === "map" \? mobileSheetCallList : callsListHome/);
  assert.match(app, /host\.append\(els\.callList\)/);
  assert.equal([...app.matchAll(/function createIncidentCard\(/g)].length, 1);
  assert.match(app, /const card = createIncidentCard\(call, \{ distance \}\);[\s\S]*?fragment\.appendChild\(card\)/);
  assert.equal([...html.matchAll(/data-radius-km=/g)].length, 5);
  assert.equal([...html.matchAll(/data-mobile-view=/g)].length, 3);
  assert.match(app, /radiusToggles\.forEach\(toggle => toggle\.addEventListener\('click'/);
  assert.match(app, /mobileViewToggles\.forEach\(toggle => toggle\.addEventListener\("click"/);
});

test('[MUST-10][STORY-17] Calls mode removes the fixed sheet from layout while retaining its prior state', () => {
  const mobileRules = css.slice(css.indexOf(mobileQuery));
  assert.match(mobileRules, /html:is\(\[data-mobile-view="calls"\], \[data-mobile-view="disruptions"\]\) :is\(\.map-stage, \.map-info, \.mobile-bottom-sheet\) \{ display: none; \}/);
  const setterStart = app.indexOf('function setMobileView(');
  const setter = app.slice(setterStart, app.indexOf('\nmobileViewToggles.forEach', setterStart));
  assert.doesNotMatch(setter, /mobileSheetState\s*=/);
});

test('[MUST-10][STORY-17] map controls stay inside the usable map above every sheet state', () => {
  const mobileRules = css.slice(css.indexOf(mobileQuery));
  assert.match(mobileRules, /\.map-panel \.leaflet-top \{ top: 60px; \}/);
  assert.match(mobileRules, /\.map-panel \.leaflet-bottom\.leaflet-right \{ bottom: var\(--mobile-map-sheet-overlap, 0px\)/);
  assert.equal(460 - 300, 160, 'expanded sheet leaves room for map controls');
});

test('[MUST-10][STORY-17] map control offset tracks actual fixed-sheet overlap instead of sheet height', () => {
  const map = { top: 400, bottom: 860, height: 460 };
  assert.equal(mobileMapSheetOverlap(map, { top: 808 }, true), 52, 'collapsed');
  assert.equal(mobileMapSheetOverlap(map, { top: 544 }, true), 316, 'expanded');
  assert.equal(mobileMapSheetOverlap({ top: 0, bottom: 460, height: 460 }, { top: 544 }, true), 0, 'non-overlapping scrolled map');
  assert.equal(mobileMapSheetOverlap(map, { top: 544 }, false), 0, 'desktop or Calls mode');
  assert.equal(mobileMapSheetOverlap(null, { top: 544 }), 0, 'missing map bounds');
  assert.equal(mobileMapSheetOverlap(map, null), 0, 'missing sheet bounds');
  assert.equal(mobileMapSheetOverlap({ bottom: 100 }, { top: 50 }), 0, 'missing map height');
  assert.equal(mobileMapSheetOverlap({ bottom: 'unknown', height: 460 }, { top: 50 }), 0, 'invalid bounds');
  assert.match(app, /visualViewport\?\.addEventListener\("resize", scheduleMapMaintenance\)/);
  assert.match(app, /document\.addEventListener\("scroll", scheduleMapMaintenance, \{ passive: true, capture: true \}\)/);
  assert.match(app, /document\.addEventListener\("touchmove", scheduleMapMaintenance/);
  assert.match(app, /ResizeObserver\(scheduleMapMaintenance\)/);
});

test('[MUST-10][STORY-17] sheet header stays visible while incident content scrolls independently', () => {
  const mobileRules = css.slice(css.indexOf(mobileQuery));
  assert.match(mobileRules, /\.mobile-bottom-sheet \{[\s\S]*?grid-template-rows: auto minmax\(0, 1fr\);[\s\S]*?overflow: hidden/);
  assert.match(mobileRules, /\.mobile-sheet-body \{[\s\S]*?overflow-y: auto;[\s\S]*?overscroll-behavior: contain;[\s\S]*?touch-action: pan-y/);
  assert.match(mobileRules, /\.mobile-sheet-header \{[^}]*cursor: pointer/);
  assert.match(mobileRules, /\.mobile-sheet-header \{[\s\S]*?min-height: 52px/);
  assert.match(mobileRules, /\.mobile-sheet-handle \{[\s\S]*?position: absolute;[\s\S]*?top: 4px/);
  assert.doesNotMatch(app, /mobileSheetBody\?\.addEventListener\("pointer(?:down|move|up)"/);
});

test('[MUST-10][STORY-17][STORY-42] the sheet header shows no internal state label and the summary wraps', () => {
  // The visible COLLAPSED / HALF / expanded state label is removed from the header.
  assert.doesNotMatch(html, /id="mobileSheetState"/);
  assert.doesNotMatch(html, /class="mobile-sheet-state"/);
  assert.doesNotMatch(app, /mobileSheetStateLabel/);
  assert.doesNotMatch(app, /#mobileSheetState/);
  // The state machine still drives the data attributes and accessible controls.
  assert.match(app, /document\.documentElement\.dataset\.mobileSheetState = nextState/);
  assert.match(app, /setAttribute\("aria-expanded", String\(nextState !== "collapsed"\)\)/);
  // The summary is allowed to wrap instead of truncating with an ellipsis.
  const mobileRules = css.slice(css.indexOf(mobileQuery));
  const summary = mobileRules.match(/\.mobile-sheet-summary \{([^}]*)\}/)[1];
  assert.doesNotMatch(summary, /text-overflow: ellipsis/);
  assert.doesNotMatch(summary, /white-space: nowrap/);
  assert.doesNotMatch(summary, /overflow: hidden/);
  assert.match(summary, /overflow-wrap: anywhere/);
  // The header is a single column so wrapped text cannot collide with a label.
  const header = mobileRules.match(/\.mobile-sheet-header \{([^}]*)\}/)[1];
  assert.match(header, /grid-template-columns: minmax\(0, 1fr\);/);
  assert.doesNotMatch(header, /grid-template-columns: minmax\(0, 1fr\) auto/);
});

test('[MUST-10][STORY-17] opening and closing the sheet is presentation-only and never refetches data', () => {
  const setterStart = app.indexOf('function setMobileSheetState(');
  const setter = app.slice(setterStart, app.indexOf('\nmobileSheetToggle?.addEventListener', setterStart));
  assert.match(setter, /dataset\.sheetState = nextState/);
  assert.doesNotMatch(setter, /fetch|fetchSnapshot|loadData|applyFilters|renderCalls/);
});
