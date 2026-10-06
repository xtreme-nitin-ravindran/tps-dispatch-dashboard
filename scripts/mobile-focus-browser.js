/* global document, window */
// Story 40E: rendered-browser regression for the fullscreen/× focus control.
//
// The defect this guards: the focus button and the Police divisions Leaflet
// control occupied the same rendered position, so pointer/touch activation
// landed on the layer control and focus mode could not be entered or exited.
// Regex-only CSS assertions cannot catch that, so this script measures real
// bounding rectangles and performs unforced pointer clicks.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import assert from 'node:assert/strict';
import {
  measureChrome,
  assertNoOverlap,
  assertInViewport,
  assertNoHorizontalOverflow
} from './lib/mobile-chrome-assert.js';
import { awaitFixtureReady } from './lib/browser-fixture.js';
import { createBrowserTiming, resolveTimingFormat } from './lib/browser-timing.js';

const timing = createBrowserTiming();
const timingFormat = resolveTimingFormat(process.env);

const base = process.env.MOBILE_FOCUS_UI_URL || 'http://127.0.0.1:8765/';
const query = '?mobileAuditFixture=many&mobileAuditView=map&mobileAuditLocation=current&mobileAuditRadius=toronto&mobileAuditSheet=collapsed&mobileAuditRoads=on&mobileAuditBoundaries=on';

const VIEWPORTS = [
  { name: '320x700', width: 320, height: 700 },
  { name: '375x812', width: 375, height: 812 },
  { name: '390x844', width: 390, height: 844 },
  { name: '430x932', width: 430, height: 932 },
  { name: '844x390-landscape', width: 844, height: 390, isMobile: true, hasTouch: true }
];

const MIN_TARGET = 44;

// Simulates the iOS Safari failure: the two layer-control labels wrap taller than
// they do in Brave, so a fixed offset would place the focus control underneath
// Road closures. The focus control must still anchor below the real row bottom.
const TALLER_LAYER_ROW_CSS = `
  .map-layer-toggle { min-height: 84px !important; align-items: flex-start !important; }
  .map-panel .leaflet-control-layers-overlays label { min-height: 80px !important; }
`;

// Story 40F: iOS Safari wraps the attribution to two lines, making the box
// taller than it is in Brave. The attribution must still sit below the zoom
// control and clear of the focus control and layer controls.
const WRAPPED_ATTRIBUTION_CSS = `
  .leaflet-control-attribution { white-space: normal !important; max-width: 180px !important; height: 40px !important; }
`;

// Feature-specific selectors for the focus-control regression. The shared
// helper reads the rectangles; the extra hit-test/label/state reads stay here.
const FOCUS_SELECTORS = {
  focus: '#mobileMapFocusToggle',
  road: '.map-layer-toggle',
  police: '.map-panel .leaflet-top.leaflet-right .leaflet-control-layers',
  nav: '.mobile-view-toggle',
  summary: '#mobileFocusFilterSummary',
  mapInfo: '#mapInfo',
  sheet: '#mobileBottomSheet',
  attribution: '.leaflet-control-attribution',
  zoom: '.leaflet-control-zoom'
};

async function measure(page) {
  const rects = await measureChrome(page, FOCUS_SELECTORS);
  const extras = await page.evaluate(() => {
    const focus = document.querySelector('#mobileMapFocusToggle');
    const focusRect = focus?.getBoundingClientRect();
    const centre = focusRect
      ? { x: focusRect.x + focusRect.width / 2, y: focusRect.y + focusRect.height / 2 }
      : null;
    const hit = centre ? document.elementFromPoint(centre.x, centre.y) : null;
    const attribution = document.querySelector('.leaflet-control-attribution');
    const attributionRect = attribution?.getBoundingClientRect();
    const attributionCentre = attributionRect
      ? { x: attributionRect.x + attributionRect.width / 2, y: attributionRect.y + attributionRect.height / 2 }
      : null;
    const attributionHit = attributionCentre ? document.elementFromPoint(attributionCentre.x, attributionCentre.y) : null;
    return {
      attributionHitIsLink: Boolean(attributionHit && attribution && (attributionHit === attribution || attribution.contains(attributionHit))),
      attributionHitTag: attributionHit ? `${attributionHit.tagName.toLowerCase()}${attributionHit.id ? '#' + attributionHit.id : ''}` : null,
      focusLabel: focus?.getAttribute('aria-label') || null,
      focusPressed: focus?.getAttribute('aria-pressed') || null,
      focusMode: document.documentElement.dataset.mobileFocus || null,
      hitIsFocus: Boolean(hit && focus && (hit === focus || focus.contains(hit))),
      hitTag: hit ? `${hit.tagName.toLowerCase()}${hit.id ? '#' + hit.id : ''}` : null,
      docScrollWidth: document.documentElement.scrollWidth,
      docClientWidth: document.documentElement.clientWidth
    };
  });
  return { ...rects, ...extras };
}

function assertLayout(state, viewport, mode) {
  const label = `${viewport.name} ${mode}`;
  assert.ok(state.focus, `${label}: focus control is not rendered`);

  // The focus control must be a real 44px+ target.
  assert.ok(state.focus.width >= MIN_TARGET, `${label}: focus width ${state.focus.width} < ${MIN_TARGET}`);
  assert.ok(state.focus.height >= MIN_TARGET, `${label}: focus height ${state.focus.height} < ${MIN_TARGET}`);

  // It must not intersect the layer controls, navigation, or the filter summary.
  assertNoOverlap(state, [
    ['focus', 'road'],
    ['focus', 'police'],
    ['focus', 'nav'],
    ['focus', 'summary'],
    ['focus', 'attribution']
  ], label);

  // Story 40F: the OpenStreetMap attribution must stay in the lower-right chrome,
  // clear of the focus control, layer controls, zoom control, navigation, filter
  // summary, and bottom sheet, and must remain the topmost hit target at its own
  // centre so the required credit stays reachable.
  assert.ok(state.attribution, `${label}: attribution is not rendered`);
  assertNoOverlap(state, [
    ['attribution', 'road'],
    ['attribution', 'police'],
    ['attribution', 'zoom'],
    ['attribution', 'nav'],
    ['attribution', 'summary'],
    ['attribution', 'sheet']
  ], label);
  assert.ok(state.attributionHitIsLink, `${label}: attribution centre resolved to ${state.attributionHitTag}, not the attribution link`);
  assertInViewport(state.attribution, viewport, `${label}: attribution`);

  // It must be the topmost hit-test target at its visual centre.
  assert.ok(state.hitIsFocus, `${label}: elementFromPoint resolved to ${state.hitTag}, not the focus control`);

  // It must stay inside the viewport.
  assertInViewport(state.focus, viewport, `${label}: focus control`);

  // No horizontal overflow.
  assertNoHorizontalOverflow(state, label);

  // The layer controls keep their 44px targets.
  for (const [name, box] of [['Road closures', state.road], ['Police divisions', state.police]]) {
    if (!box) continue;
    assert.ok(box.height >= MIN_TARGET - 0.5, `${label}: ${name} target ${box.height} < ${MIN_TARGET}`);
  }
}

// Runs the full entry/exit sequence for one layout state and returns the
// measured rectangles. Uses real, unforced pointer clicks (no force: true).
async function runScenario(page, viewport, label) {
  // The map sits below the pre-map stack, and the pre-map card is sticky on
  // short landscape viewports. Scroll so the map top clears the sticky card,
  // then bring the focus control itself into view so it is genuinely reachable
  // regardless of the scroll state left by a previous scenario.
  await page.evaluate(() => {
    const stage = document.querySelector('#mapView');
    const card = document.querySelector('.controls-card');
    const cardBottom = card ? card.getBoundingClientRect().bottom : 0;
    const offset = Math.max(0, cardBottom);
    window.scrollTo({ top: stage.getBoundingClientRect().top + window.scrollY - offset, behavior: 'instant' });
  });
  await page.waitForTimeout(50);
  await page.evaluate(() => {
    document.querySelector('#mobileMapFocusToggle')?.scrollIntoView({ block: 'center', behavior: 'instant' });
  });
  await page.waitForTimeout(50);
  const normal = await measure(page);
  assert.notEqual(normal.focusMode, 'on', `${viewport.name} ${label}: focus mode should start off`);
  assert.equal(normal.focusLabel, 'Full screen map', `${viewport.name} ${label}: unexpected initial label`);
  assertLayout(normal, viewport, `${label} normal`);

  // Unforced pointer click enters focus mode.
  await page.locator('#mobileMapFocusToggle').click();
  await page.waitForFunction(() => document.documentElement.dataset.mobileFocus === 'on');
  const focused = await measure(page);
  assert.equal(focused.focusMode, 'on', `${viewport.name} ${label}: pointer click did not enter focus mode`);
  assert.equal(focused.focusLabel, 'Exit full screen map', `${viewport.name} ${label}: label did not change on entry`);
  assert.equal(focused.focusPressed, 'true', `${viewport.name} ${label}: aria-pressed not set on entry`);
  assertLayout(focused, viewport, `${label} focused`);

  // Unforced pointer click exits focus mode.
  await page.locator('#mobileMapFocusToggle').click();
  await page.waitForFunction(() => document.documentElement.dataset.mobileFocus === 'off');
  const exited = await measure(page);
  assert.notEqual(exited.focusMode, 'on', `${viewport.name} ${label}: pointer click did not exit focus mode`);
  assert.equal(exited.focusLabel, 'Full screen map', `${viewport.name} ${label}: label did not return on exit`);
  assert.equal(exited.focusPressed, 'false', `${viewport.name} ${label}: aria-pressed not cleared on exit`);

  // Keyboard activation still works.
  await page.locator('#mobileMapFocusToggle').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.documentElement.dataset.mobileFocus === 'on');
  assert.equal((await measure(page)).focusMode, 'on', `${viewport.name} ${label}: keyboard activation did not enter focus mode`);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.documentElement.dataset.mobileFocus === 'off');

  return { ...normal, focused };
}

// Story 40F: focused Calls/Disruptions navigation-position regression.
//
// The defect this guards: while focus mode stayed active, tapping Calls or
// Disruptions left the Map / Calls / Disruptions navigation at its focused-map
// vertical offset, reserving a large blank band for the map-only controls
// (Road closures, Police divisions, the fullscreen × control) that are hidden in
// those views. The navigation must move to the top safe-area position and the
// calls/disruptions content must start just below it.
const CALLS_SELECTORS = {
  nav: '.mobile-view-toggle',
  navBand: '.radius-controls',
  // #callsView is the .content-grid, which uses display:contents in Calls
  // view, so its own rect is empty; the real calls surface is .calls-panel.
  calls: '.calls-panel',
  callList: '#callList',
  disruptions: '#disruptions',
  focus: '#mobileMapFocusToggle',
  road: '.map-layer-toggle',
  police: '.map-panel .leaflet-top.leaflet-right .leaflet-control-layers',
  summary: '#mobileFocusFilterSummary',
  mapInfo: '#mapInfo'
};

async function measureCalls(page) {
  const rects = await measureChrome(page, CALLS_SELECTORS);
  const extras = await page.evaluate(() => {
    const nav = document.querySelector('.mobile-view-toggle');
    const navRect = nav?.getBoundingClientRect();
    const navCentre = navRect
      ? { x: navRect.x + navRect.width / 2, y: navRect.y + navRect.height / 2 }
      : null;
    const hit = navCentre ? document.elementFromPoint(navCentre.x, navCentre.y) : null;
    return {
      focusMode: document.documentElement.dataset.mobileFocus || null,
      mobileView: document.documentElement.dataset.mobileView || null,
      navHitIsNav: Boolean(hit && nav && (hit === nav || nav.contains(hit))),
      navHitTag: hit ? `${hit.tagName.toLowerCase()}${hit.id ? '#' + hit.id : ''}` : null,
      docScrollWidth: document.documentElement.scrollWidth,
      docClientWidth: document.documentElement.clientWidth
    };
  });
  return { ...rects, ...extras };
}

function assertTopAlignedNav(state, viewport, label) {
  assert.ok(state.nav, `${label}: navigation is not rendered`);
  const nav = state.nav;
  // The navigation band begins near the top of the usable viewport (8px + safe area).
  assert.ok(nav.top <= 12, `${label}: navigation top ${nav.top} is not near the viewport top`);
  assert.ok(nav.top >= -0.5, `${label}: navigation starts above the viewport`);
  // No large blank band is reserved above it for the hidden map-only controls.
  assert.ok(nav.top < 40, `${label}: navigation leaves a large blank band above it (top ${nav.top})`);
  // Every navigation control keeps its 44px touch target.
  assert.ok(state.nav.height >= MIN_TARGET - 0.5, `${label}: navigation band ${state.nav.height} < ${MIN_TARGET}`);
  // The navigation is the topmost hit-test target at its centre.
  assert.ok(state.navHitIsNav, `${label}: elementFromPoint resolved to ${state.navHitTag}, not the navigation`);
  // No horizontal overflow.
  assertNoHorizontalOverflow(state, label);
}

function assertContentBelowNav(state, viewport, label, contentKey, maxGap) {
  const nav = state.nav;
  const content = state[contentKey] || null;
  assert.ok(content, `${label}: ${contentKey} is not rendered`);
  // The content starts below the navigation without overlapping it.
  assert.ok(content.top >= nav.bottom - 0.5, `${label}: ${contentKey} overlaps the navigation (${content.top} < ${nav.bottom})`);
  if (maxGap != null) {
    assert.ok(content.top - nav.bottom <= maxGap, `${label}: ${contentKey} gap below navigation is too large (${content.top - nav.bottom})`);
  }
}

async function runCallsScenario(page, viewport) {
  // Enter focus mode from Map using a real, unforced pointer click.
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

  // Tap Calls.
  await page.locator('button[data-mobile-view="calls"]').click();
  await page.waitForFunction(() => document.documentElement.dataset.mobileView === 'calls');
  await page.waitForTimeout(50);
  const calls = await measureCalls(page);
  assert.equal(calls.focusMode, 'on', `${viewport.name} focused-calls: focus mode was cleared by tapping Calls`);
  assert.equal(calls.mobileView, 'calls', `${viewport.name} focused-calls: Calls view not active`);
  assertTopAlignedNav(calls, viewport, `${viewport.name} focused-calls`);
  assertContentBelowNav(calls, viewport, `${viewport.name} focused-calls`, 'calls', 24);
  // The map-only controls are hidden in the Calls view (the map stage is
  // display:none, so their rendered rectangles collapse to zero).
  const hidden = box => !box || box.width === 0 || box.height === 0;
  assert.ok(hidden(calls.road), `${viewport.name} focused-calls: Road closures control is still visible`);
  assert.ok(hidden(calls.focus), `${viewport.name} focused-calls: fullscreen × control is still visible`);

  // Tap Disruptions: same top-aligned navigation, existing disruptions panel below it.
  await page.locator('#mobileDisruptionsControl').click();
  await page.waitForTimeout(50);
  const disruptions = await measureCalls(page);
  assert.equal(disruptions.focusMode, 'on', `${viewport.name} focused-disruptions: focus mode was cleared`);
  assert.equal(disruptions.mobileView, 'calls', `${viewport.name} focused-disruptions: disruptions must reuse the Calls view`);
  assertTopAlignedNav(disruptions, viewport, `${viewport.name} focused-disruptions`);
  assertContentBelowNav(disruptions, viewport, `${viewport.name} focused-disruptions`, 'disruptions');

  // Tap Map: the focused full-screen map layout returns unchanged.
  await page.locator('button[data-mobile-view="map"]').click();
  await page.waitForFunction(() => document.documentElement.dataset.mobileView === 'map');
  await page.waitForTimeout(50);
  const backToMap = await measure(page);
  assert.equal(backToMap.focusMode, 'on', `${viewport.name} focused-map-return: focus mode was cleared by returning to Map`);
  assertLayout(backToMap, viewport, `${viewport.name} focused-map-return`);

  return { calls, disruptions, backToMap };
}

const browser = await timing.time('chromium-launch', () => chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE }));
const errors = [];
const results = [];
try {
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
      isMobile: viewport.isMobile || false,
      hasTouch: viewport.hasTouch || false
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(`${viewport.name}: ${error.message}`));
    await timing.time(`page-goto:${viewport.name}`, () => page.goto(`${base}${query}`, { waitUntil: 'domcontentloaded' }));
    await timing.time(`fixture-ready:${viewport.name}`, () => awaitFixtureReady(page));
    await page.waitForSelector('#mobileMapFocusToggle');

    // --- Normal mobile Map mode ---
    const normal = await runScenario(page, viewport, 'normal');
    results.push({ viewport: viewport.name, normal: normal.focus, focused: normal.focused.focus });

    // --- Taller, wrapped Safari-style layer row ---
    // Reproduces the physical iPhone Safari failure: the layer labels render
    // taller, so the focus control must still sit below the real row bottom.
    await page.addStyleTag({ content: TALLER_LAYER_ROW_CSS });
    await page.waitForTimeout(50);
    const taller = await runScenario(page, viewport, 'taller-layer-row');
    const rowHeight = taller.road ? taller.road.height : 0;
    assert.ok(rowHeight >= 80, `${viewport.name} taller-row: layer row did not grow (${rowHeight})`);
    results.push({ viewport: viewport.name, tallerRow: taller.focus, rowHeight });

    // --- Wrapped (iOS Safari) attribution ---
    // Reproduces the physical iPhone Safari failure: the attribution wraps to a
    // taller box. It must still sit below the zoom control and clear of the
    // focus control and layer controls.
    await page.addStyleTag({ content: WRAPPED_ATTRIBUTION_CSS });
    await page.waitForTimeout(50);
    const wrapped = await runScenario(page, viewport, 'wrapped-attribution');
    assert.ok(wrapped.attribution && wrapped.attribution.height >= 30, `${viewport.name} wrapped-attribution: attribution did not grow (${wrapped.attribution?.height})`);
    results.push({ viewport: viewport.name, wrappedAttribution: wrapped.attribution, wrappedFocus: wrapped.focus });

    // --- Focused Calls / Disruptions navigation position (Story 40F) ---
    await page.evaluate(() => {
      const style = document.querySelector('style[data-story-40f]');
      if (style) style.remove();
    });
    const callsRun = await runCallsScenario(page, viewport);
    results.push({
      viewport: viewport.name,
      focusedCallsNavTop: callsRun.calls.nav.top,
      focusedCallsContentTop: callsRun.calls.calls.top,
      focusedDisruptionsNavTop: callsRun.disruptions.nav.top,
      focusedDisruptionsTop: callsRun.disruptions.disruptions.top
    });

    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ story: '40E', viewports: results, errors }, null, 2));
} finally {
  await timing.time('browser-close', () => browser.close());
  console.log(timing.format({ format: timingFormat, label: 'test:story-40e:browser' }));
}
