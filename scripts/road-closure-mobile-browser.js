/* global document */
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
    const detail = document.querySelector('#mobileClosureDetail');
    const selected = [...document.querySelectorAll('#roadsList .disruption-item.selected')];
    return {
      popupCount: document.querySelectorAll('.leaflet-popup').length,
      popupText: popup ? popup.textContent : null,
      sheetDetailHidden: detail ? detail.hidden : null,
      sheetDetailText: detail ? detail.textContent : null,
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

    // 1. The map bubble opens on mobile (the original defect).
    assert.equal(after.popupCount, 1, `${viewport.name}: mobile tap did not open the map bubble`);
    assert.match(after.popupText || '', /ROAD CLOSURE/, `${viewport.name}: popup is not the closure detail`);
    // 2. The existing sheet routing is preserved.
    assert.equal(after.sheetDetailHidden, false, `${viewport.name}: sheet detail is not shown`);
    assert.match(after.sheetDetailText || '', /Back to incident list/, `${viewport.name}: sheet detail is not the closure detail`);
    // 3. The matching Disruptions-panel card is highlighted.
    assert.deepEqual(after.selectedIds, [closureId], `${viewport.name}: matching road card is not highlighted`);

    // Clearing the selection removes the card highlight.
    await page.locator('.closure-detail-back').click();
    await awaitUiState(page, () => document.querySelector('#mobileClosureDetail')?.hidden === true, { description: 'cleared closure detail' });
    const cleared = await readState(page);
    assert.deepEqual(cleared.selectedIds, [], `${viewport.name}: card highlight was not cleared`);
    assert.equal(cleared.sheetDetailHidden, true, `${viewport.name}: sheet detail was not hidden after clearing`);

    results.push({ viewport: viewport.name, closureId, popupOpened: after.popupCount === 1 });
    console.log(`${viewport.name}: mobile closure bubble, sheet detail, and card highlight passed`);
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ story: '66', viewports: results, errors }, null, 2));
} finally {
  await timing.time('browser-close', () => browser.close());
  console.log(timing.format({ format: timingFormat, label: 'test:road-closure-mobile:browser' }));
}
