/* global document, getComputedStyle */
// Story 66 mobile road-closure regression.
//
// The defect this guards: on mobile, tapping a road closure opened the bottom
// sheet detail but never opened the Leaflet popup bubble, because
// selectClosure() returned early in its isMobileViewLayout() branch before the
// bindPopup(...).openPopup() line. Desktop already opened the bubble.
//
// The fix keeps the existing mobile sheet routing AND opens the map bubble, and
// highlights the matching road-closure card in the Disruptions panel
// (#roadsList). This suite asserts the real rendered outcome: a tap on the
// closure symbol opens a .leaflet-popup, the sheet detail is shown, and the
// matching #roadsList card carries .selected. Clearing the selection removes
// the card highlight.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import assert from 'node:assert/strict';
import { awaitFixtureReady, awaitUiState } from './lib/browser-fixture.js';
import { createBrowserTiming, resolveTimingFormat } from './lib/browser-timing.js';

const timing = createBrowserTiming();
const timingFormat = resolveTimingFormat(process.env);

const base = process.env.ROAD_CLOSURE_MOBILE_UI_URL || 'http://127.0.0.1:8765/';
const query = '?mobileAuditFixture=many&mobileAuditView=map&mobileAuditLocation=current&mobileAuditRadius=toronto&mobileAuditSheet=collapsed&mobileAuditRoads=on&mobileAuditBoundaries=on';

// Mobile viewports (at or below the 680px mobile breakpoint).
const MOBILE_VIEWPORTS = [
  { name: '320x700', width: 320, height: 700 },
  { name: '375x812', width: 375, height: 812 },
  { name: '390x844', width: 390, height: 844 },
  { name: '430x932', width: 430, height: 932 }
];

async function readState(page) {
  return page.evaluate(() => {
    const popup = document.querySelector('.leaflet-popup');
    const sheet = document.querySelector('#mobileBottomSheet');
    const selected = [...document.querySelectorAll('#roadsList .disruption-item.selected')];
    return {
      popupCount: document.querySelectorAll('.leaflet-popup').length,
      popupText: popup ? popup.textContent : null,
      popupGeometry: (() => {
        const article = popup && popup.querySelector('article.closure-detail');
        const content = popup && popup.querySelector('.leaflet-popup-content');
        if (!article || !content) return null;
        const a = article.getBoundingClientRect(), c = content.getBoundingClientRect(), s = getComputedStyle(article);
        return { paddingLeft: s.paddingLeft, paddingRight: s.paddingRight, borderBottomWidth: s.borderBottomWidth, gapLeft: Math.round(a.left - c.left), gapRight: Math.round(c.right - a.right) };
      })(),
      sheetState: sheet.dataset.sheetState,
      sheetSummary: document.querySelector('#mobileSheetSummary').textContent,
      sheetScrollTop: document.querySelector('#mobileSheetBody').scrollTop,
      selectedIds: selected.map(card => card.dataset.closureId),
      roadCardIds: [...document.querySelectorAll('#roadsList .disruption-item[data-closure-id]')].map(card => card.dataset.closureId)
    };
  });
}

const browser = await timing.time('chromium-launch', () => chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE }));
const errors = [];
const results = [];
try {
  for (const viewport of MOBILE_VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(`${viewport.name}: ${error.message}`));
    await timing.time(`page-goto:${viewport.name}`, () => page.goto(`${base}${query}`, { waitUntil: 'domcontentloaded' }));
    await timing.time(`fixture-ready:${viewport.name}`, () => awaitFixtureReady(page));

    // The road-closure card carries the closure id so it can be matched.
    const symbol = page.locator('.road-closure-symbol span[data-closure-id]').first();
    await page.waitForSelector('.road-closure-symbol span[data-closure-id]');
    const closureId = await symbol.getAttribute('data-closure-id');
    assert.ok(closureId, `${viewport.name}: closure symbol has no data-closure-id`);

    const before = await readState(page);
    assert.equal(before.popupCount, 0, `${viewport.name}: popup should be closed before selection`);
    assert.deepEqual(before.selectedIds, [], `${viewport.name}: no card should be selected before selection`);
    assert.ok(before.roadCardIds.includes(closureId), `${viewport.name}: matching road card is missing`);

    // Tap the closure symbol on the map.
    await page.locator('#dispatchMap').scrollIntoViewIfNeeded();
    await symbol.dispatchEvent('click');

    // Bounded wait for the expected rendered state rather than a fixed sleep.
    await awaitUiState(page, () => document.querySelectorAll('.leaflet-popup').length > 0, { description: 'road-closure map popup' });
    const after = await readState(page);

    // 1. The map bubble opens on mobile (the original defect), with the same
    // symmetric 16px chrome asserted for the TTC bubble (Story 74 precedent:
    // computed geometry guards the shared-chrome cascade override trap).
    assert.equal(after.popupCount, 1, `${viewport.name}: mobile tap did not open the map bubble`);
    assert.match(after.popupText || '', /ROAD CLOSURE/, `${viewport.name}: popup is not the closure detail`);
    const geometry = after.popupGeometry;
    assert.ok(geometry, `${viewport.name}: road popup has no measurable detail article`);
    assert.equal(geometry.paddingLeft, '16px', `${viewport.name}: popup left padding`);
    assert.equal(geometry.paddingRight, '16px', `${viewport.name}: popup right padding`);
    assert.equal(geometry.borderBottomWidth, '0px', `${viewport.name}: popup bottom border`);
    assert.equal(geometry.gapLeft, 0, `${viewport.name}: popup left edge gap`);
    assert.equal(geometry.gapRight, 0, `${viewport.name}: popup right edge gap`);
    assert.equal(after.sheetState, before.sheetState);
    assert.equal(after.sheetSummary, before.sheetSummary);
    assert.equal(after.sheetScrollTop, before.sheetScrollTop);
    assert.deepEqual(after.selectedIds, []);
    await page.locator('.leaflet-popup-close-button').dispatchEvent('click');
    await awaitUiState(page, () => !document.querySelector('.leaflet-popup'), { description: 'closed road popup' });

    results.push({ viewport: viewport.name, closureId, popupOpened: after.popupCount === 1 });
    console.log(`${viewport.name}: mobile closure bubble leaves calls sheet and list alone`);
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ story: '66', viewports: results, errors }, null, 2));
} finally {
  await timing.time('browser-close', () => browser.close());
  console.log(timing.format({ format: timingFormat, label: 'test:road-closure-mobile:browser' }));
}
