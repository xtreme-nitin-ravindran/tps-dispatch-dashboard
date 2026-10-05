/* global document, window, getComputedStyle */
// Story 43: rendered-browser regression for the fullscreen Map info panel.
//
// The defect this guards: in fullscreen (focus) mode the Map info disclosure was
// `position: fixed` with both `top` and `bottom` insets and no height, so it
// stretched to fill the entire gap between them. The collapsed disclosure
// rendered as a ~485px blank panel covering nearly the whole map, and the
// expanded panel kept the same oversized container. The floating filter summary
// had the same stretch defect.
//
// Regex-only CSS assertions cannot prove the rendered geometry, so this script
// measures real bounding rectangles in both the collapsed and expanded states,
// asserts the map stays substantially visible, and drives closing, reopening,
// exiting, and re-entering fullscreen.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import assert from 'node:assert/strict';
import {
  measureChrome,
  assertNoOverlap,
  assertInViewport,
  assertNoHorizontalOverflow
} from './lib/mobile-chrome-assert.js';
import { awaitFixtureReady } from './lib/browser-fixture.js';

const base = process.env.MOBILE_MAP_INFO_UI_URL || 'http://127.0.0.1:8765/';
const query = '?mobileAuditFixture=many&mobileAuditView=map&mobileAuditLocation=current&mobileAuditRadius=toronto&mobileAuditSheet=collapsed&mobileAuditRoads=on&mobileAuditBoundaries=on';

const VIEWPORTS = [
  { name: '320x700', width: 320, height: 700 },
  { name: '375x812', width: 375, height: 812 },
  { name: '390x844', width: 390, height: 844 },
  { name: '430x932', width: 430, height: 932 },
  { name: '844x390-landscape', width: 844, height: 390, isMobile: true, hasTouch: true },
  { name: '932x342-browser-chrome', width: 932, height: 342, isMobile: true, hasTouch: true }
];

// The collapsed disclosure is a single header row. It must stay compact rather
// than stretching to the available vertical space.
const MAX_COLLAPSED_HEIGHT = 80;
// The expanded panel must leave a substantial slice of the map visible above it.
const MIN_VISIBLE_MAP_FRACTION = 0.2;
// Story 50: the map info's own top edge is not enough to prove the map is
// usable. In landscape the navigation band and filter summary were chained below
// the layer-control stack, so they consumed the middle of the viewport while the
// bottom-anchored map info rose to meet them, leaving a 7px map band even though
// the map info's top edge was still below 20% of the viewport. Assert the real
// visible map band: the vertical gap between the lowest top chrome and the
// highest bottom chrome.
const MIN_VISIBLE_MAP_BAND_FRACTION = 0.25;

// Feature-specific selectors for the map-info regression. The shared helper
// reads the rectangles; the open/hidden state reads stay here.
const MAP_INFO_SELECTORS = {
  mapInfo: '#mapInfo',
  mapInfoBody: '.map-info-body',
  summary: '#mobileFocusFilterSummary',
  nav: '.mobile-view-toggle',
  sheet: '#mobileBottomSheet',
  focus: '#mobileMapFocusToggle',
  road: '.map-layer-toggle',
  police: '.map-panel .leaflet-top.leaflet-right .leaflet-control-layers',
  zoom: '.leaflet-control-zoom',
  attribution: '.leaflet-control-attribution',
  mapStage: '#mapView'
};

async function measure(page) {
  const rects = await measureChrome(page, MAP_INFO_SELECTORS);
  const extras = await page.evaluate(() => {
    const mapInfo = document.querySelector('#mapInfo');
    const summary = document.querySelector('#mobileFocusFilterSummary');
    return {
      focusMode: document.documentElement.dataset.mobileFocus || null,
      mapInfoOpen: mapInfo ? mapInfo.open : null,
      summaryHidden: summary ? summary.hidden : null,
      docScrollWidth: document.documentElement.scrollWidth,
      docClientWidth: document.documentElement.clientWidth,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    };
  });
  return { ...rects, ...extras };
}

function assertMapInfoWithinViewport(state, viewport, label) {
  assertInViewport(state.mapInfo, viewport, `${label}: map info`);
}

function assertChromeClear(state, label) {
  // The map info must not overlap the navigation band, the filter summary, the
  // bottom sheet, the focus control, the layer controls, the zoom control, or
  // the attribution.
  assertNoOverlap(state, [
    ['mapInfo', 'nav'],
    ['mapInfo', 'summary'],
    ['mapInfo', 'sheet'],
    ['mapInfo', 'focus'],
    ['mapInfo', 'road'],
    ['mapInfo', 'police'],
    ['mapInfo', 'zoom'],
    ['mapInfo', 'attribution']
  ], label);
}

async function assertLandscapeSheet(page, viewport) {
  for (const sheetState of ['half', 'expanded', 'collapsed']) {
    if (sheetState === 'half') await page.locator('#mobileSheetToggle').click();
    else await page.locator(`[data-sheet-target="${sheetState}"]`).click();
    await page.waitForTimeout(350);
    const state = await measure(page);
    const label = `${viewport.name} sheet ${sheetState}`;
    assertChromeClear(state, label);
    assertNoOverlap(state, [
      ['summary', 'road'], ['summary', 'police'], ['summary', 'zoom'],
      ['zoom', 'road'], ['zoom', 'police'], ['nav', 'road'], ['nav', 'police']
    ], label);
    assert.ok(Math.abs(state.focus.top - state.nav.top) < 2, `${label}: close is not top-aligned`);
    const header = await page.locator('#mapInfo > summary').boundingBox();
    assert.ok(header.height >= 44, `${label}: Map info touch target is too small`);
    assert.ok(header.y + header.height <= state.mapInfo.bottom + 1, `${label}: Map info header is clipped`);
    await page.locator('#mapInfo > summary').tap();
    await page.waitForFunction(() => document.querySelector('#mapInfo').open);
    assertChromeClear(await measure(page), `${label} info open`);
    const scrolled = await page.locator('#mapInfo').evaluate(el => {
      el.scrollTop = el.scrollHeight;
      const bottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
      el.scrollTop = 0;
      return bottom;
    });
    assert.ok(scrolled, `${label}: Map info content is not scrollable to its end`);
    await page.locator('#mapInfo > summary').tap();
    await page.waitForFunction(() => !document.querySelector('#mapInfo').open);
    if (sheetState !== 'collapsed') {
      const body = await page.locator('#mobileSheetBody').boundingBox();
      assert.ok(body.height >= 60, `${label}: no usable call content area`);
      const headerRect = await page.locator('#mobileSheetToggle').boundingBox();
      const controls = await page.locator('.mobile-sheet-state-controls').boundingBox();
      assert.ok(headerRect.x + headerRect.width <= controls.x, `${label}: sheet heading overlaps state buttons`);
      if (sheetState === 'expanded') {
        await page.setViewportSize({ width: viewport.height, height: viewport.width });
        await page.waitForTimeout(350);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.waitForTimeout(350);
        assertChromeClear(await measure(page), `${label} rotated back`);
        assert.equal(await page.locator('html').getAttribute('data-mobile-sheet-state'), 'expanded');
      }
    }
  }
}

// Story 50: the visible map band is the vertical gap between the lowest top
// chrome (navigation band, filter summary, layer controls, focus control) and
// the highest bottom chrome (map info, sheet, attribution, zoom control). With
// the map info collapsed, a usable map must remain between them. (When the map
// info is expanded it intentionally covers the map, so this check applies to the
// collapsed state only.)
function assertVisibleMapBand(state, viewport, label) {
  const topChrome = ['nav', 'summary', 'road', 'police', 'focus']
    .map(key => state[key])
    .filter(Boolean);
  const bottomChrome = ['mapInfo', 'sheet', 'attribution', 'zoom']
    .map(key => state[key])
    .filter(Boolean);
  const topChromeBottom = Math.max(...topChrome.map(rect => rect.bottom));
  const bottomChromeTop = Math.min(...bottomChrome.map(rect => rect.top));
  const band = bottomChromeTop - topChromeBottom;
  assert.ok(
    band >= viewport.height * MIN_VISIBLE_MAP_BAND_FRACTION,
    `${label}: visible map band is only ${band}px (min ${Math.round(viewport.height * MIN_VISIBLE_MAP_BAND_FRACTION)}px)`
  );
}

function assertCollapsed(state, viewport, label) {
  assert.equal(state.mapInfoOpen, false, `${label}: map info should be collapsed`);
  assert.ok(state.mapInfo, `${label}: map info is not rendered`);
  // The collapsed disclosure is a compact header, not a stretched panel.
  assert.ok(state.mapInfo.height <= MAX_COLLAPSED_HEIGHT, `${label}: collapsed map info is ${state.mapInfo.height}px tall (max ${MAX_COLLAPSED_HEIGHT})`);
  assert.ok(state.mapInfo.height > 0, `${label}: collapsed map info has no height`);
  // The body is clipped by the collapsed container (a <details> keeps its body
  // in the DOM), so the container height is what must stay compact.
  // The map stays substantially visible.
  const visibleMap = state.mapInfo.top;
  assert.ok(visibleMap >= viewport.height * MIN_VISIBLE_MAP_FRACTION, `${label}: collapsed map info leaves only ${visibleMap}px of map visible`);
  assertMapInfoWithinViewport(state, viewport, label);
  assertChromeClear(state, label);
  assertVisibleMapBand(state, viewport, label);
  assertNoHorizontalOverflow(state, label);
}

function assertExpanded(state, viewport, label) {
  assert.equal(state.mapInfoOpen, true, `${label}: map info should be expanded`);
  assert.ok(state.mapInfo, `${label}: map info is not rendered`);
  // The expanded panel sizes to its content within a sensible maximum height.
  assert.ok(state.mapInfo.height <= viewport.height * 0.75, `${label}: expanded map info is ${state.mapInfo.height}px tall (over 75% of the viewport)`);
  // The map stays substantially visible above the panel.
  const visibleMap = state.mapInfo.top;
  assert.ok(visibleMap >= viewport.height * MIN_VISIBLE_MAP_FRACTION, `${label}: expanded map info leaves only ${visibleMap}px of map visible`);
  assertMapInfoWithinViewport(state, viewport, label);
  assertChromeClear(state, label);
  assertNoHorizontalOverflow(state, label);
}

async function enterFocus(page) {
  await page.evaluate(() => {
    const stage = document.querySelector('#mapView');
    const card = document.querySelector('.controls-card');
    const cardBottom = card ? card.getBoundingClientRect().bottom : 0;
    window.scrollTo({ top: stage.getBoundingClientRect().top + window.scrollY - Math.max(0, cardBottom), behavior: 'instant' });
  });
  await page.waitForTimeout(50);
  await page.evaluate(() => {
    document.querySelector('#mobileMapFocusToggle')?.scrollIntoView({ block: 'center', behavior: 'instant' });
  });
  await page.waitForTimeout(50);
  await page.locator('#mobileMapFocusToggle').click();
  await page.waitForFunction(() => document.documentElement.dataset.mobileFocus === 'on');
  await page.waitForTimeout(100);
}

async function exitFocus(page) {
  await page.locator('#mobileMapFocusToggle').click();
  await page.waitForFunction(() => document.documentElement.dataset.mobileFocus === 'off');
  await page.waitForTimeout(100);
}

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE });
const errors = [];
const results = [];
try {
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
      isMobile: viewport.isMobile || true,
      hasTouch: viewport.hasTouch || true
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(`${viewport.name}: ${error.message}`));
    await page.goto(`${base}${query}`, { waitUntil: 'domcontentloaded' });
    await awaitFixtureReady(page);
    await page.waitForSelector('#mobileMapFocusToggle');

    // --- Enter fullscreen: collapsed map info must be a compact header ---
    await enterFocus(page);
    const collapsed = await measure(page);
    assert.equal(collapsed.focusMode, 'on', `${viewport.name}: focus mode did not activate`);
    assertCollapsed(collapsed, viewport, `${viewport.name} collapsed`);

    // --- Expand: the panel sizes to its content and stays bounded ---
    await page.locator('#mapInfo > summary').click();
    await page.waitForFunction(() => document.querySelector('#mapInfo')?.open === true);
    await page.waitForTimeout(100);
    const expanded = await measure(page);
    assertExpanded(expanded, viewport, `${viewport.name} expanded`);
    // The expanded panel is taller than the collapsed header (content is shown).
    assert.ok(expanded.mapInfo.height > collapsed.mapInfo.height, `${viewport.name}: expanded map info is not taller than collapsed`);

    // --- Close again: back to the compact header ---
    await page.locator('#mapInfo > summary').click();
    await page.waitForFunction(() => document.querySelector('#mapInfo')?.open === false);
    await page.waitForTimeout(100);
    const reclosed = await measure(page);
    assertCollapsed(reclosed, viewport, `${viewport.name} reclosed`);

    // --- Reopen: still content-sized ---
    await page.locator('#mapInfo > summary').click();
    await page.waitForFunction(() => document.querySelector('#mapInfo')?.open === true);
    await page.waitForTimeout(100);
    const reopened = await measure(page);
    assertExpanded(reopened, viewport, `${viewport.name} reopened`);

    // --- Close the disclosure, then exit fullscreen: normal layout restored ---
    await page.locator('#mapInfo > summary').click();
    await page.waitForFunction(() => document.querySelector('#mapInfo')?.open === false);
    await page.waitForTimeout(100);
    await exitFocus(page);
    const exited = await measure(page);
    assert.notEqual(exited.focusMode, 'on', `${viewport.name}: focus mode did not exit`);
    assert.equal(exited.summaryHidden, true, `${viewport.name}: filter summary is still visible after exit`);
    assertNoHorizontalOverflow(exited, `${viewport.name} exited`);
    // The map info returns to normal document flow (not fixed over the map).
    const exitedStyle = await page.evaluate(() => {
      const el = document.querySelector('#mapInfo');
      const cs = getComputedStyle(el);
      return { position: cs.position, maxHeight: cs.maxHeight, height: cs.height };
    });
    assert.equal(exitedStyle.position, 'static', `${viewport.name}: map info is still fixed after exit`);
    assert.equal(exitedStyle.maxHeight, 'none', `${viewport.name}: map info kept a stale max-height after exit`);

    // --- Re-enter fullscreen: the compact collapsed state returns ---
    await enterFocus(page);
    const reentered = await measure(page);
    assert.equal(reentered.focusMode, 'on', `${viewport.name}: focus mode did not re-enter`);
    assertCollapsed(reentered, viewport, `${viewport.name} reentered`);

    if (viewport.width > viewport.height) {
      await assertLandscapeSheet(page, viewport);
      // A long applied-filter label must scroll within its reserved column.
      await page.locator('#mobileFocusFilterSummary').evaluate(el => {
        el.textContent = 'Toronto-wide · Last 24 hours · Fire and Police · Event: fire · '.repeat(5);
      });
      await page.waitForTimeout(200);
      await assertLandscapeSheet(page, viewport);
    }

    results.push({
      viewport: viewport.name,
      collapsedHeight: collapsed.mapInfo.height,
      expandedHeight: expanded.mapInfo.height,
      visibleMapAboveExpanded: expanded.mapInfo.top
    });

    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ story: '43', viewports: results, errors }, null, 2));
} finally {
  await browser.close();
}
