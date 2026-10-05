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

const base = process.env.MOBILE_MAP_INFO_UI_URL || 'http://127.0.0.1:8765/';
const query = '?mobileAuditFixture=many&mobileAuditView=map&mobileAuditLocation=current&mobileAuditRadius=toronto&mobileAuditSheet=collapsed&mobileAuditRoads=on&mobileAuditBoundaries=on';

const VIEWPORTS = [
  { name: '320x700', width: 320, height: 700 },
  { name: '375x812', width: 375, height: 812 },
  { name: '390x844', width: 390, height: 844 },
  { name: '430x932', width: 430, height: 932 },
  { name: '844x390-landscape', width: 844, height: 390, isMobile: true, hasTouch: true }
];

// The collapsed disclosure is a single header row. It must stay compact rather
// than stretching to the available vertical space.
const MAX_COLLAPSED_HEIGHT = 80;
// The expanded panel must leave a substantial slice of the map visible above it.
const MIN_VISIBLE_MAP_FRACTION = 0.2;

function intersects(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function rectOf(box) {
  return { left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height };
}

async function measure(page) {
  return page.evaluate(() => {
    const rect = selector => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
    };
    const mapInfo = document.querySelector('#mapInfo');
    const summary = document.querySelector('#mobileFocusFilterSummary');
    return {
      focusMode: document.documentElement.dataset.mobileFocus || null,
      mapInfoOpen: mapInfo ? mapInfo.open : null,
      mapInfo: rect('#mapInfo'),
      mapInfoBody: rect('.map-info-body'),
      summary: rect('#mobileFocusFilterSummary'),
      summaryHidden: summary ? summary.hidden : null,
      nav: rect('.mobile-view-toggle'),
      sheet: rect('#mobileBottomSheet'),
      focus: rect('#mobileMapFocusToggle'),
      road: rect('.map-layer-toggle'),
      police: rect('.map-panel .leaflet-top.leaflet-right .leaflet-control-layers'),
      zoom: rect('.leaflet-control-zoom'),
      attribution: rect('.leaflet-control-attribution'),
      mapStage: rect('#mapView'),
      docScrollWidth: document.documentElement.scrollWidth,
      docClientWidth: document.documentElement.clientWidth,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    };
  });
}

function assertNoHorizontalOverflow(state, label) {
  assert.ok(state.docScrollWidth <= state.docClientWidth + 1, `${label}: horizontal overflow (${state.docScrollWidth} > ${state.docClientWidth})`);
}

function assertMapInfoWithinViewport(state, viewport, label) {
  const box = rectOf(state.mapInfo);
  assert.ok(box.left >= -0.5, `${label}: map info starts left of the viewport`);
  assert.ok(box.right <= viewport.width + 0.5, `${label}: map info overflows the right edge`);
  assert.ok(box.top >= -0.5, `${label}: map info starts above the viewport`);
  assert.ok(box.bottom <= viewport.height + 0.5, `${label}: map info overflows the bottom edge`);
}

function assertChromeClear(state, label) {
  const mapInfo = rectOf(state.mapInfo);
  // The map info must not overlap the navigation band, the filter summary, the
  // bottom sheet, the focus control, the layer controls, the zoom control, or
  // the attribution.
  for (const [name, box] of [
    ['navigation', state.nav],
    ['filter summary', state.summary],
    ['bottom sheet', state.sheet],
    ['focus control', state.focus],
    ['Road closures', state.road],
    ['Police divisions', state.police],
    ['zoom control', state.zoom],
    ['attribution', state.attribution]
  ]) {
    if (!box) continue;
    assert.ok(!intersects(mapInfo, rectOf(box)), `${label}: map info intersects ${name}`);
  }
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
  const visibleMap = state.mapInfo.y;
  assert.ok(visibleMap >= viewport.height * MIN_VISIBLE_MAP_FRACTION, `${label}: collapsed map info leaves only ${visibleMap}px of map visible`);
  assertMapInfoWithinViewport(state, viewport, label);
  assertChromeClear(state, label);
  assertNoHorizontalOverflow(state, label);
}

function assertExpanded(state, viewport, label) {
  assert.equal(state.mapInfoOpen, true, `${label}: map info should be expanded`);
  assert.ok(state.mapInfo, `${label}: map info is not rendered`);
  // The expanded panel sizes to its content within a sensible maximum height.
  assert.ok(state.mapInfo.height <= viewport.height * 0.75, `${label}: expanded map info is ${state.mapInfo.height}px tall (over 75% of the viewport)`);
  // The map stays substantially visible above the panel.
  const visibleMap = state.mapInfo.y;
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
    await page.waitForFunction(() => document.documentElement.dataset.incidentLoadState === 'ready');
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

    results.push({
      viewport: viewport.name,
      collapsedHeight: collapsed.mapInfo.height,
      expandedHeight: expanded.mapInfo.height,
      visibleMapAboveExpanded: expanded.mapInfo.y
    });

    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ story: '43', viewports: results, errors }, null, 2));
} finally {
  await browser.close();
}
