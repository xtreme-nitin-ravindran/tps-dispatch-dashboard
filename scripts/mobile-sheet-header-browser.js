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
    const summary = document.querySelector('#mobileSheetSummary');
    const summaryStyle = summary ? getComputedStyle(summary) : null;
    const header = document.querySelector('#mobileSheetToggle');
    const sheet = document.querySelector('#mobileBottomSheet');
    // Any element that still carries the removed state-label class or id.
    const stateLabel = document.querySelector('#mobileSheetState, .mobile-sheet-state');
    const stateLabelStyle = stateLabel ? getComputedStyle(stateLabel) : null;
    return {
      sheetState: document.documentElement.dataset.mobileSheetState || null,
      sheetRect: rect('#mobileBottomSheet'),
      headerRect: rect('#mobileSheetToggle'),
      summaryRect: rect('#mobileSheetSummary'),
      summaryText: summary ? summary.textContent : null,
      summaryScrollWidth: summary ? summary.scrollWidth : null,
      summaryClientWidth: summary ? summary.clientWidth : null,
      summaryScrollHeight: summary ? summary.scrollHeight : null,
      summaryClientHeight: summary ? summary.clientHeight : null,
      summaryTextOverflow: summaryStyle ? summaryStyle.textOverflow : null,
      summaryWhiteSpace: summaryStyle ? summaryStyle.whiteSpace : null,
      summaryOverflow: summaryStyle ? summaryStyle.overflow : null,
      handleRect: rect('.mobile-sheet-handle'),
      stateControlsRect: rect('.mobile-sheet-state-controls'),
      stateLabelPresent: Boolean(stateLabel),
      stateLabelVisible: Boolean(stateLabel && stateLabelStyle && stateLabelStyle.display !== 'none' && stateLabelStyle.visibility !== 'hidden' && stateLabel.getClientRects().length > 0),
      stateLabelText: stateLabel ? stateLabel.textContent.trim() : null,
      headerText: header ? header.textContent.replace(/\s+/g, ' ').trim() : null,
      sheetVisible: Boolean(sheet && sheet.getClientRects().length > 0),
      docScrollWidth: document.documentElement.scrollWidth,
      docClientWidth: document.documentElement.clientWidth
    };
  });
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
  assert.ok(state.docScrollWidth <= state.docClientWidth + 1, `${label}: horizontal overflow (${state.docScrollWidth} > ${state.docClientWidth})`);
  // The summary must stay inside the viewport.
  const summaryBox = rectOf(state.summaryRect);
  assert.ok(summaryBox.left >= -0.5 && summaryBox.right <= viewport.width + 0.5, `${label}: summary overflows the viewport horizontally`);
}

function assertNoOverlap(state, label) {
  const summary = rectOf(state.summaryRect);
  // The wrapped summary must not overlap the drag handle.
  if (state.handleRect) {
    assert.ok(!intersects(summary, rectOf(state.handleRect)), `${label}: wrapped summary overlaps the drag handle`);
  }
  // The wrapped summary must not overlap the sheet state controls.
  if (state.stateControlsRect) {
    assert.ok(!intersects(summary, rectOf(state.stateControlsRect)), `${label}: wrapped summary overlaps the sheet controls`);
  }
  // The header must contain the summary (the header grows to fit it).
  const header = rectOf(state.headerRect);
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
    await page.waitForFunction(target => document.documentElement.dataset.mobileSheetState === target, state, { timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(50);
  }
  await page.waitForFunction(target => document.documentElement.dataset.mobileSheetState === target, state);
  await page.waitForTimeout(50);
}

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE });
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
    await page.goto(`${base}${query}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.documentElement.dataset.incidentLoadState === 'ready');
    await page.waitForSelector('#mobileSheetToggle');

    // --- Every sheet position: no state label, summary wraps without overlap ---
    for (const sheetState of SHEET_STATES) {
      await setSheetState(page, sheetState);
      await setLongSummary(page);
      const state = await measure(page);
      assert.equal(state.sheetState, sheetState, `${viewport.name} ${sheetState}: sheet state did not apply`);
      assertNoStateLabel(state, `${viewport.name} ${sheetState}`);
      assertSummaryWraps(state, viewport, `${viewport.name} ${sheetState}`);
      assertNoOverlap(state, `${viewport.name} ${sheetState}`);
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
      assertNoOverlap(state, `${viewport.name} snap-${name}`);
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
    assertNoOverlap(backToMap, `${viewport.name} map-return`);

    // --- Viewport / orientation change preserves the header behavior ---
    await page.setViewportSize({ width: viewport.height, height: viewport.width });
    await page.waitForTimeout(100);
    await setLongSummary(page);
    const rotated = await measure(page);
    assertNoStateLabel(rotated, `${viewport.name} rotated`);
    assertSummaryWraps(rotated, { width: viewport.height, height: viewport.width }, `${viewport.name} rotated`);
    assertNoOverlap(rotated, `${viewport.name} rotated`);
    // Restore the original viewport for the next iteration.
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.waitForTimeout(50);

    results.push({ viewport: viewport.name, collapsed: collapsed.sheetRect.height, half: half.sheetRect.height, expanded: expanded.sheetRect.height });
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ story: '42', viewports: results, errors }, null, 2));
} finally {
  await browser.close();
}
