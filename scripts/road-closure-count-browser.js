/* global document, getComputedStyle */
// Desktop road-closure count regression.
//
// The defect this guards: the "N current" road-closure count rendered beneath
// the "Road closures" map-layer label on desktop. The count must not be visible
// at desktop viewport sizes, while the checkbox, dashed red legend key, and
// "Road closures" label remain. The count stays in the DOM for assistive
// technology and is surfaced in the disruptions panel (#roadCount).
//
// Regex-only CSS assertions cannot prove the count is visually absent, so this
// script measures the real rendered geometry of #roadOverlayStatus and asserts
// it is clipped to a non-visible box at desktop widths.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import assert from 'node:assert/strict';
import { awaitFixtureReady } from './lib/browser-fixture.js';
import { createBrowserTiming, resolveTimingFormat } from './lib/browser-timing.js';

const timing = createBrowserTiming();
const timingFormat = resolveTimingFormat(process.env);

const base = process.env.ROAD_CLOSURE_COUNT_UI_URL || 'http://127.0.0.1:8765/';
const query = '?mobileAuditFixture=many&mobileAuditView=map&mobileAuditLocation=current&mobileAuditRadius=toronto&mobileAuditSheet=collapsed&mobileAuditRoads=on&mobileAuditBoundaries=on';

// Desktop viewports (above the 680px mobile breakpoint).
const DESKTOP_VIEWPORTS = [
  { name: '1280x800', width: 1280, height: 800 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1024x768', width: 1024, height: 768 }
];

async function measure(page) {
  return page.evaluate(() => {
    const status = document.querySelector('#roadOverlayStatus');
    const toggle = document.querySelector('.map-layer-toggle');
    const label = toggle ? [...toggle.querySelectorAll('span')].find(span => span.textContent.trim() === 'Road closures') : null;
    const checkbox = document.querySelector('#roadOverlay');
    const key = toggle ? toggle.querySelector('.road-key') : null;
    const rect = el => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
    };
    const statusStyle = status ? getComputedStyle(status) : null;
    return {
      statusText: status ? status.textContent.trim() : null,
      statusRect: rect(status),
      statusClipPath: statusStyle ? statusStyle.clipPath : null,
      statusOverflow: statusStyle ? statusStyle.overflow : null,
      statusPosition: statusStyle ? statusStyle.position : null,
      toggleRect: rect(toggle),
      labelRect: rect(label),
      labelText: label ? label.textContent.trim() : null,
      checkboxPresent: Boolean(checkbox),
      checkboxChecked: checkbox ? checkbox.checked : null,
      keyRect: rect(key),
      keyBorderTop: key ? getComputedStyle(key).borderTopColor : null,
      keyBorderStyle: key ? getComputedStyle(key).borderTopStyle : null,
      roadCountText: (document.querySelector('#roadCount')?.textContent || '').trim()
    };
  });
}

function assertCountHidden(state, viewport) {
  const label = viewport.name;
  assert.ok(state.statusText, `${label}: road-closure status element is missing`);
  // The count text is still in the DOM (for assistive technology) but must be
  // clipped to a non-visible box.
  assert.ok(state.statusRect, `${label}: road-closure status has no rendered box`);
  assert.ok(state.statusRect.width <= 1.5, `${label}: road-closure count is ${state.statusRect.width}px wide, not clipped`);
  assert.ok(state.statusRect.height <= 1.5, `${label}: road-closure count is ${state.statusRect.height}px tall, not clipped`);
  assert.match(state.statusClipPath || '', /inset\(50%\)/, `${label}: road-closure count is not clipped (clip-path ${state.statusClipPath})`);
  assert.equal(state.statusOverflow, 'hidden', `${label}: road-closure count overflow is not hidden`);
  assert.equal(state.statusPosition, 'absolute', `${label}: road-closure count is not taken out of flow`);

  // The count must not be visible inside the toggle's rendered box.
  const toggle = state.toggleRect;
  assert.ok(toggle, `${label}: Road closures toggle is not rendered`);
  const status = state.statusRect;
  const visibleInsideToggle = status.width > 1.5 && status.height > 1.5
    && status.left >= toggle.left && status.right <= toggle.right
    && status.top >= toggle.top && status.bottom <= toggle.bottom;
  assert.ok(!visibleInsideToggle, `${label}: road-closure count is visible inside the toggle`);

  // The checkbox, dashed red legend key, and label must remain.
  assert.ok(state.checkboxPresent, `${label}: Road closures checkbox is missing`);
  assert.ok(state.labelText === 'Road closures', `${label}: Road closures label is missing (${state.labelText})`);
  assert.ok(state.keyRect && state.keyRect.width > 0 && state.keyRect.height > 0, `${label}: dashed red legend key is not rendered`);
  assert.ok(state.keyBorderTop && state.keyBorderTop !== 'rgba(0, 0, 0, 0)', `${label}: legend key has no visible colour`);
  assert.equal(state.keyBorderStyle, 'dashed', `${label}: legend key is not dashed`);

  // The count remains available in the disruptions panel.
  assert.ok(state.roadCountText && state.roadCountText !== '—', `${label}: disruptions panel road count is empty`);
}

const browser = await timing.time('chromium-launch', () => chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE }));
const errors = [];
const results = [];
try {
  for (const viewport of DESKTOP_VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(`${viewport.name}: ${error.message}`));
    await timing.time(`page-goto:${viewport.name}`, () => page.goto(`${base}${query}`, { waitUntil: 'domcontentloaded' }));
    await timing.time(`fixture-ready:${viewport.name}`, () => awaitFixtureReady(page));
    await page.waitForSelector('.map-layer-toggle');
    await page.waitForTimeout(100);
    const state = await measure(page);
    assertCountHidden(state, viewport);
    results.push({ viewport: viewport.name, statusText: state.statusText, statusWidth: state.statusRect.width, statusHeight: state.statusRect.height, roadCount: state.roadCountText });
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ story: 'road-closure-count', viewports: results, errors }, null, 2));
} finally {
  await timing.time('browser-close', () => browser.close());
  console.log(timing.format({ format: timingFormat, label: 'test:road-closure-count:browser' }));
}
