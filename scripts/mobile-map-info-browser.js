/* global document, window, getComputedStyle */
// Stories 43/58: rendered fullscreen panel regression. Guard the original
// stretch/clipping failures while verifying compact closed chrome, usable map
// area, existing checkbox handlers, and panel/navigation lifecycle behavior.
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

const base = process.env.MOBILE_MAP_INFO_UI_URL || 'http://127.0.0.1:8765/';
const query = '?mobileAuditFixture=many&mobileAuditView=map&mobileAuditLocation=current&mobileAuditRadius=toronto&mobileAuditSheet=collapsed&mobileAuditRoads=on&mobileAuditBoundaries=on&ttcFixture=confirmed';

const VIEWPORTS = [
  { name: '320x700', width: 320, height: 700 },
  { name: '375x812', width: 375, height: 812 },
  { name: '390x844', width: 390, height: 844 },
  { name: '430x932', width: 430, height: 932 },
  { name: '844x390-landscape', width: 844, height: 390, isMobile: true, hasTouch: true },
  { name: '932x342-browser-chrome', width: 932, height: 342, isMobile: true, hasTouch: true }
];

// Story 58 replaces the large collapsed disclosure and layer stack with two
// launchers. Keep the old stretch/overflow regressions on the opened panels.
const MAP_INFO_SELECTORS = {
  mapInfo: '#mapInfo', layersPanel: '#mobileMapLayersPanel',
  summary: '#mobileFocusFilterSummary', nav: '.mobile-view-toggle',
  sheet: '#mobileBottomSheet', focus: '#mobileMapFocusToggle',
  layers: '#mobileMapLayersToggle', info: '#mobileMapInfoToggle',
  zoom: '.leaflet-control-zoom', attribution: '.leaflet-control-attribution'
};

async function measure(page) {
  return {
    ...await measureChrome(page, MAP_INFO_SELECTORS),
    ...await page.evaluate(() => ({
      focusMode: document.documentElement.dataset.mobileFocus,
      mapInfoOpen: document.querySelector('#mapInfo').open,
      summaryHidden: document.querySelector('#mobileFocusFilterSummary').hidden,
      docScrollWidth: document.documentElement.scrollWidth,
      docClientWidth: document.documentElement.clientWidth
    }))
  };
}

async function assertHit(page, selector) {
  assert.ok(await page.locator(selector).evaluate(el => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return el === hit || el.contains(hit);
  }), `${selector}: centre is obstructed`);
}

async function assertClosed(page, viewport) {
  const state = await measure(page);
  assert.equal(state.mapInfoOpen, false);
  for (const key of ['mapInfo', 'layersPanel', 'sheet']) assert.equal(state[key].height, 0, `${key} should be hidden`);
  for (const key of ['focus', 'nav', 'summary', 'layers', 'info', 'zoom', 'attribution']) {
    assertInViewport(state[key], viewport, `${viewport.name}: ${key}`);
    await assertHit(page, MAP_INFO_SELECTORS[key]);
  }
  assertNoOverlap(state, [
    ['focus', 'nav'], ['summary', 'nav'], ['summary', 'focus'],
    ['summary', 'layers'], ['layers', 'info'], ['info', 'zoom'],
    ['info', 'attribution'], ['zoom', 'attribution']
  ], viewport.name);
  for (const key of ['layers', 'info']) {
    assert.ok(state[key].width >= 44 && state[key].height >= 44, `${key}: touch target`);
    assert.equal(await page.locator(MAP_INFO_SELECTORS[key]).getAttribute('aria-expanded'), 'false');
  }
  assert.ok(Math.abs(state.focus.top - state.nav.top) < 2, 'close and navigation must share the top row');
  assertNoHorizontalOverflow(state, viewport.name);
  // Conservatively subtract full top rows and the side-control columns. Unlike
  // a vertical band this counts the usable map beside the round launchers.
  const top = Math.max(state.focus.bottom, state.nav.bottom, state.summary.bottom);
  const sideWidth = Math.max(viewport.width - state.layers.left, viewport.width - state.zoom.left);
  const freeFraction = (viewport.height - top - state.attribution.height) * (viewport.width - sideWidth) / (viewport.width * viewport.height);
  assert.ok(freeFraction > 0.5, `${viewport.name}: only ${freeFraction} map interaction space`);
  return Math.round(freeFraction * 100);
}

async function assertPanel(page, viewport, kind) {
  const state = await measure(page);
  const key = kind === 'info' ? 'mapInfo' : 'layersPanel';
  assert.ok(state[key].height > 44, `${key}: no panel content`);
  assertInViewport(state[key], viewport, key);
  assertNoOverlap(state, [
    [key, 'nav'], [key, 'summary'], [key, 'focus'],
    [key, 'layers'], [key, 'info'], [key, 'zoom'], [key, 'attribution']
  ], `${viewport.name}: ${key}`);
  await assertHit(page, kind === 'info' ? '#mobileMapInfoClose' : '#mobileMapLayersClose');
  assert.ok(await page.locator(MAP_INFO_SELECTORS[key]).evaluate(el => {
    el.scrollTop = el.scrollHeight;
    const reachesEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
    const close = el.querySelector('.mobile-map-panel-heading button').getBoundingClientRect();
    const panel = el.getBoundingClientRect();
    const closeVisible = close.top >= panel.top && close.bottom <= panel.bottom;
    el.scrollTop = 0;
    return reachesEnd && closeVisible;
  }), `${key}: content must scroll to its end`);
  assertNoHorizontalOverflow(state, key);
}

async function runPanels(page, viewport) {
  await page.locator('#mobileMapLayersToggle').click();
  await page.waitForFunction(() => !document.querySelector('#mobileMapLayersPanel').hidden);
  await assertPanel(page, viewport, 'layers');
  if (viewport.width === 390) await page.screenshot({ path: '.cache/story58-layers.png' });
  await page.waitForSelector('#ttcLayerControl', { state: 'visible' });
  assert.equal(await page.locator('#mobileMapLayersBody input[type="checkbox"]:visible').count(), 3);
  // Same DOM nodes and Leaflet handlers remain live, including checked states.
  const original = await page.locator('#mobileMapLayersBody input[type="checkbox"]').evaluateAll(els => els.map(el => el.checked));
  await page.locator('#roadOverlayLabel').evaluate(el => { el.textContent = 'Road closures · source repaired'; });
  await page.locator('#roadOverlay').click();
  await page.locator('#mobileMapLayersClose').click();
  assert.equal(await page.locator('#roadOverlay').isChecked(), !original[1]);
  assert.equal(await page.locator('#mobileMapLayersToggle').evaluate(el => el === document.activeElement), true);
  await page.locator('#mobileMapLayersToggle').click();
  await assertHit(page, '#roadOverlayLabel');
  const label = await page.locator('#roadOverlayLabel').boundingBox();
  const panel = await page.locator('#mobileMapLayersPanel').boundingBox();
  assert.ok(label.width > 0 && label.x + label.width <= panel.x + panel.width + 1, 'repair disclosure is clipped');
  await page.locator('#roadOverlay').click();
  const police = page.locator('#mobileMapLayersBody .leaflet-control-layers-selector');
  await police.click();
  assert.equal(await police.isChecked(), !original[0]);
  await police.click();
  // Two-checkbox availability uses the existing hidden TTC control.
  await page.locator('#ttcLayerControl').evaluate(el => { el.hidden = true; });
  assert.equal(await page.locator('#mobileMapLayersBody input[type="checkbox"]:visible').count(), 2);
  await page.locator('#ttcLayerControl').evaluate(el => { el.hidden = false; });
  await page.locator('#ttcOverlay').click();
  assert.equal(await page.locator('#ttcOverlay').isChecked(), !original[2]);
  await page.locator('#ttcOverlay').click();
  await page.locator('#mobileMapInfoToggle').click();
  await page.waitForFunction(() => document.querySelector('#mapInfo').open);
  assert.equal(await page.locator('#mobileMapLayersPanel').isVisible(), false);
  assert.equal(await page.locator('#mobileMapLayersToggle').getAttribute('aria-expanded'), 'false');
  await assertPanel(page, viewport, 'info');
  if (viewport.width === 390) await page.screenshot({ path: '.cache/story58-info.png' });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#mobileMapInfoToggle').evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('Enter');
  await assertPanel(page, viewport, 'info');
  await page.locator('#mobileMapInfoClose').click();
  await page.locator('#mobileMapInfoToggle').click();
  await page.locator('#mobileMapLayersToggle').click();
  assert.equal(await page.locator('#mapInfo').isVisible(), false);
  await page.keyboard.press('Escape');
  assert.deepEqual(await page.locator('#mobileMapLayersBody input[type="checkbox"]').evaluateAll(els => els.map(el => el.checked)), original);
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

const browser = await timing.time('chromium-launch', () => chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE }));
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
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(`${viewport.name}: ${error.message}`));
    await timing.time(`page-goto:${viewport.name}`, () => page.goto(`${base}${query}`, { waitUntil: 'domcontentloaded' }));
    await timing.time(`fixture-ready:${viewport.name}`, () => awaitFixtureReady(page));
    await page.waitForSelector('#mobileMapFocusToggle');

    await enterFocus(page);
    const usableMapPercent = await assertClosed(page, viewport);
    if (viewport.width === 390) await page.screenshot({ path: '.cache/story58-closed.png' });
    await runPanels(page, viewport);
    await assertClosed(page, viewport);

    // Long context remains bounded; rotation keeps open panels and selections.
    await page.locator('#mobileFocusFilterSummary').evaluate(el => {
      el.textContent = 'Toronto-wide · Last 24 hours · Fire and Police · Event: fire · '.repeat(5);
    });
    await page.waitForFunction(() => {
      const r = document.querySelector('#mobileFocusFilterSummary').getBoundingClientRect();
      return Math.abs(parseFloat(document.documentElement.style.getPropertyValue('--mobile-summary-bottom')) - r.bottom) < 2;
    }, null, { timeout: 5000 });
    await assertClosed(page, viewport);
    await page.locator('#mobileMapInfoToggle').click();
    await assertPanel(page, viewport, 'info');
    await page.setViewportSize({ width: viewport.height, height: viewport.width });
    await page.waitForFunction(() => document.querySelector('#mapInfo').getBoundingClientRect().width > 0, null, { timeout: 5000 });
    await assertPanel(page, { width: viewport.height, height: viewport.width, name: 'rotated' }, 'info');
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.waitForFunction(() => document.querySelector('#mapInfo').open);
    await assertPanel(page, viewport, 'info');

    await exitFocus(page);
    assert.equal(await page.locator('#mobileMapLayersToggle').isVisible(), false);
    assert.equal(await page.locator('#mobileFocusFilterSummary').isVisible(), false);
    assert.equal(await page.locator('#mapInfo').evaluate(el => getComputedStyle(el).position), 'static');
    assert.equal(await page.locator('.leaflet-top.leaflet-right .leaflet-control-layers').count(), 1);
    assert.equal(await page.locator('.map-wrap > .road-overlay-toggle').count(), 1);
    await enterFocus(page);
    await assertClosed(page, viewport);
    await page.locator('button[data-mobile-view="calls"]').click();
    await page.waitForFunction(() => document.documentElement.dataset.mobileView === 'calls');
    assert.equal(await page.locator('#mobileMapInfoToggle').isVisible(), false);
    await page.locator('#mobileDisruptionsControl').click();
    await page.locator('button[data-mobile-view="map"]').click();
    await page.waitForFunction(() => document.documentElement.dataset.mobileView === 'map');
    await assertClosed(page, viewport);
    results.push({ viewport: viewport.name, usableMapPercent });
    console.log(`${viewport.name}: panels and navigation passed (${usableMapPercent}% usable map)`);

    await context.close();
  }
  // Zero results must not gain an unavailable warning; stale/outage context
  // remains visible in fullscreen rather than disappearing behind the map.
  for (const fixture of ['zero', 'stale', 'unavailable']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(`${fixture}: ${error.message}`));
    console.log(`Checking ${fixture} source context`);
    await page.goto(`${base}?mobileAuditFixture=${fixture}&mobileAuditView=map`, { waitUntil: 'domcontentloaded' });
    if (fixture === 'unavailable') {
      await page.waitForFunction(() => document.documentElement.dataset.incidentLoadState === 'unavailable', null, { timeout: 10000 });
    } else await awaitFixtureReady(page);
    await enterFocus(page);
    await assertClosed(page, { width: 390, height: 844, name: fixture });
    const text = await page.locator('#mobileFocusFilterSummary').textContent();
    if (fixture === 'zero') assert.doesNotMatch(text, /unavailable|stale/);
    else assert.match(text, fixture === 'stale' ? /data may be stale/ : /data unavailable/);
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ story: '43', viewports: results, errors }, null, 2));
} finally {
  await timing.time('browser-close', () => browser.close());
  console.log(timing.format({ format: timingFormat, label: 'test:story-43:browser' }));
}
