/* global document, getComputedStyle */
// Story 42: rendered-browser regression for the mobile bottom-sheet header.
//
// The defects this guards:
//   1. The header rendered an internal sheet-state label (COLLAPSED / HALF /
//      EXPANDED) that read as an implementation/debug surface.
//   2. The call summary/details text was truncated with an ellipsis instead of
//      wrapping, so long summaries were unreadable on narrow phones.
//
// Regex-only CSS assertions cannot prove the label is visually absent or that
// the summary wraps without clipping, so this script measures the real rendered
// geometry at supported narrow phone widths and drives the real sheet states.
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

const base = process.env.MOBILE_SHEET_HEADER_UI_URL || 'http://127.0.0.1:8765/';
const query = '?mobileAuditFixture=many&mobileAuditView=map&mobileAuditLocation=current&mobileAuditRadius=toronto&mobileAuditSheet=collapsed&mobileAuditRoads=on&mobileAuditBoundaries=on';

// Supported narrow phone widths plus a landscape phone.
const VIEWPORTS = [
  { name: '320x700', width: 320, height: 700 },
  { name: '375x812', width: 375, height: 812 },
  { name: '390x844', width: 390, height: 844 },
  { name: '430x932', width: 430, height: 932 },
  { name: '844x390-landscape', width: 844, height: 390, isMobile: true, hasTouch: true }
];

// A deliberately long summary that must wrap rather than truncate. It mirrors
// the shape of the real mobile summary (count · closest · latest · window) but
// is long enough to overflow a single line at every supported width.
const LONG_SUMMARY = '1,212 calls · Closest 0.2 km · Latest 4 min ago · Last 24h · Toronto-wide scope with a deliberately long deterministic audit label';

const SHEET_STATES = ['collapsed', 'half', 'expanded'];

// Feature-specific selectors for the sheet-header regression. The shared helper
// reads the rectangles; the computed-style/text/state reads stay here.
const SHEET_SELECTORS = {
  sheetRect: '#mobileBottomSheet',
  headerRect: '#mobileSheetToggle',
  summaryRect: '#mobileSheetSummary',
  handleRect: '.mobile-sheet-handle',
  stateControlsRect: '.mobile-sheet-state-controls'
};

async function measure(page) {
  const rects = await measureChrome(page, SHEET_SELECTORS);
  const extras = await page.evaluate(() => {
    const summary = document.querySelector('#mobileSheetSummary');
    const summaryStyle = summary ? getComputedStyle(summary) : null;
    const header = document.querySelector('#mobileSheetToggle');
    const sheet = document.querySelector('#mobileBottomSheet');
    // Any element that still carries the removed state-label class or id.
    const stateLabel = document.querySelector('#mobileSheetState, .mobile-sheet-state');
    const stateLabelStyle = stateLabel ? getComputedStyle(stateLabel) : null;
    return {
      sheetState: document.documentElement.dataset.mobileSheetState || null,
      summaryText: summary ? summary.textContent : null,
      summaryScrollWidth: summary ? summary.scrollWidth : null,
      summaryClientWidth: summary ? summary.clientWidth : null,
      summaryScrollHeight: summary ? summary.scrollHeight : null,
      summaryClientHeight: summary ? summary.clientHeight : null,
      summaryTextOverflow: summaryStyle ? summaryStyle.textOverflow : null,
      summaryWhiteSpace: summaryStyle ? summaryStyle.whiteSpace : null,
      summaryOverflow: summaryStyle ? summaryStyle.overflow : null,
      stateLabelPresent: Boolean(stateLabel),
      stateLabelVisible: Boolean(stateLabel && stateLabelStyle && stateLabelStyle.display !== 'none' && stateLabelStyle.visibility !== 'hidden' && stateLabel.getClientRects().length > 0),
      stateLabelText: stateLabel ? stateLabel.textContent.trim() : null,
      headerText: header ? header.textContent.replace(/\s+/g, ' ').trim() : null,
      sheetVisible: Boolean(sheet && sheet.getClientRects().length > 0),
      docScrollWidth: document.documentElement.scrollWidth,
      docClientWidth: document.documentElement.clientWidth
    };
  });
  return { ...rects, ...extras };
}

function assertNoStateLabel(state, label) {
  // The removed label must not be present or visible at any sheet position.
  assert.ok(!state.stateLabelPresent, `${label}: a sheet-state label element is still rendered (${state.stateLabelText})`);
  assert.ok(!state.stateLabelVisible, `${label}: a sheet-state label is still visible`);
  // The header text must not contain the internal state words.
  assert.doesNotMatch(state.headerText || '', /\bCOLLAPSED\b|\bHALF\b|\bEXPANDED\b/i, `${label}: header still shows an internal state label (${state.headerText})`);
}

function assertSummaryWraps(state, viewport, label) {
  assert.ok(state.summaryRect, `${label}: sheet summary is not rendered`);
  // No ellipsis / nowrap truncation.
  assert.notEqual(state.summaryTextOverflow, 'ellipsis', `${label}: summary still uses an ellipsis`);
  assert.notEqual(state.summaryWhiteSpace, 'nowrap', `${label}: summary is still forced onto one line`);
  // The full text is laid out: the scroll box must not exceed the client box.
  assert.ok(state.summaryScrollWidth <= state.summaryClientWidth + 1, `${label}: summary is horizontally clipped (${state.summaryScrollWidth} > ${state.summaryClientWidth})`);
  assert.ok(state.summaryScrollHeight <= state.summaryClientHeight + 1, `${label}: summary is vertically clipped (${state.summaryScrollHeight} > ${state.summaryClientHeight})`);
  // The long summary must actually wrap onto more than one line at phone widths.
  const lineHeight = state.summaryRect.height;
  assert.ok(lineHeight > 0, `${label}: summary has no rendered height`);
  // No horizontal page overflow.
  assertNoHorizontalOverflow(state, label);
  // The summary must stay inside the viewport.
  assertInViewport(state.summaryRect, viewport, `${label}: summary`);
}

function assertSummaryClear(state, label) {
  // The wrapped summary must not overlap the drag handle or the sheet controls.
  assertNoOverlap(state, [
    ['summaryRect', 'handleRect'],
    ['summaryRect', 'stateControlsRect']
  ], label);
  // The header must contain the summary (the header grows to fit it).
  const summary = state.summaryRect;
  const header = state.headerRect;
  assert.ok(summary.top >= header.top - 0.5 && summary.bottom <= header.bottom + 0.5, `${label}: summary escapes the header box`);
}

async function setLongSummary(page) {
  await page.evaluate(text => {
    const summary = document.querySelector('#mobileSheetSummary');
    if (summary) summary.textContent = text;
  }, LONG_SUMMARY);
  await page.waitForTimeout(50);
}

// The sheet header is the toggle: clicking it cycles collapsed -> half ->
// expanded -> collapsed. The body's state controls are only reachable once the
// sheet is open, so drive the states through the header itself.
async function setSheetState(page, state) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await page.evaluate(() => document.documentElement.dataset.mobileSheetState);
    if (current === state) break;
    await page.locator('#mobileSheetToggle').click();
    await page.waitForFunction(target => document.documentElement.dataset.mobileSheetState === target, state, { timeout: 2000 }).catch(() => { });
    await page.waitForTimeout(50);
  }
  await page.waitForFunction(target => document.documentElement.dataset.mobileSheetState === target, state);
  await page.waitForTimeout(50);
}

const browser = await timing.time('chromium-launch', () => chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE }));
const errors = [];
const results = [];
try {
  for (const viewport of VIEWPORTS) {
    // All contexts are touch/mobile so the coarse-pointer landscape media query
    // applies after rotation, matching a real phone.
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(`${viewport.name}: ${error.message}`));
    await timing.time(`page-goto:${viewport.name}`, () => page.goto(`${base}${query}`, { waitUntil: 'domcontentloaded' }));
    await timing.time(`fixture-ready:${viewport.name}`, () => awaitFixtureReady(page));
    await page.waitForSelector('#mobileSheetToggle');

    // --- Every sheet position: no state label, summary wraps without overlap ---
    for (const sheetState of SHEET_STATES) {
      await setSheetState(page, sheetState);
      await setLongSummary(page);
      const state = await measure(page);
      assert.equal(state.sheetState, sheetState, `${viewport.name} ${sheetState}: sheet state did not apply`);
      assertNoStateLabel(state, `${viewport.name} ${sheetState}`);
      assertSummaryWraps(state, viewport, `${viewport.name} ${sheetState}`);
      assertSummaryClear(state, `${viewport.name} ${sheetState}`);
      results.push({ viewport: viewport.name, sheetState, summaryHeight: state.summaryRect.height, summaryWidth: state.summaryRect.width });
    }

    // --- Snapping still works: collapsed -> half -> expanded -> collapsed ---
    await setSheetState(page, 'collapsed');
    const collapsed = await measure(page);
    await setSheetState(page, 'half');
    const half = await measure(page);
    await setSheetState(page, 'expanded');
    const expanded = await measure(page);
    assert.ok(half.sheetRect.height > collapsed.sheetRect.height, `${viewport.name}: half sheet is not taller than collapsed`);
    assert.ok(expanded.sheetRect.height > half.sheetRect.height, `${viewport.name}: expanded sheet is not taller than half`);
    // The header stays visible and the summary stays readable in every state.
    for (const [name, state] of [['collapsed', collapsed], ['half', half], ['expanded', expanded]]) {
      assertNoStateLabel(state, `${viewport.name} snap-${name}`);
      assertSummaryWraps(state, viewport, `${viewport.name} snap-${name}`);
      assertSummaryClear(state, `${viewport.name} snap-${name}`);
    }

    // --- View transitions preserve the header behavior ---
    await page.locator('button[data-mobile-view="calls"]').click();
    await page.waitForFunction(() => document.documentElement.dataset.mobileView === 'calls');
    await page.waitForTimeout(50);
    const calls = await measure(page);
    // The sheet is hidden in Calls mode; no state label may leak into the header.
    assertNoStateLabel(calls, `${viewport.name} calls`);
    await page.locator('button[data-mobile-view="map"]').click();
    await page.waitForFunction(() => document.documentElement.dataset.mobileView === 'map');
    await page.waitForTimeout(50);
    await setLongSummary(page);
    const backToMap = await measure(page);
    assertNoStateLabel(backToMap, `${viewport.name} map-return`);
    assertSummaryWraps(backToMap, viewport, `${viewport.name} map-return`);
    assertSummaryClear(backToMap, `${viewport.name} map-return`);

    // --- Viewport / orientation change preserves the header behavior ---
    await page.setViewportSize({ width: viewport.height, height: viewport.width });
    await page.waitForTimeout(100);
    await setLongSummary(page);
    const rotated = await measure(page);
    assertNoStateLabel(rotated, `${viewport.name} rotated`);
    assertSummaryWraps(rotated, { width: viewport.height, height: viewport.width }, `${viewport.name} rotated`);
    assertSummaryClear(rotated, `${viewport.name} rotated`);
    // Restore the original viewport for the next iteration.
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.waitForTimeout(50);

    results.push({ viewport: viewport.name, collapsed: collapsed.sheetRect.height, half: half.sheetRect.height, expanded: expanded.sheetRect.height });
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ story: '42', viewports: results, errors }, null, 2));
} finally {
  await timing.time('browser-close', () => browser.close());
  console.log(timing.format({ format: timingFormat, label: 'test:story-42:browser' }));
}
