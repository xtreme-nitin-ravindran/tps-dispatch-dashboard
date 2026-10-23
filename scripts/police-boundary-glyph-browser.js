/* global document, getComputedStyle, matchMedia */
// Rendered-browser regression for the police boundary badge glyph.
//
// The police boundary legend (Leaflet layers control) and the boundary outline
// must both carry the 🚔 badge glyph, matching the road-closure ⛔ and TTC 🚧
// layer glyphs. The glyph markers are non-interactive divIcons spaced along the
// polygon rings, so a bare source-text pin cannot prove they actually render.
// A second mobile viewport asserts the Story 40D label-clipping rule does not
// collapse the injected glyph (the rule targets every nested span under the
// overlay label, which the glyph shares structurally).
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import assert from 'node:assert/strict';
import { awaitFixtureReady, awaitUiState } from './lib/browser-fixture.js';
import { createBrowserTiming, resolveTimingFormat } from './lib/browser-timing.js';

const timing = createBrowserTiming();
const timingFormat = resolveTimingFormat(process.env);

const base = process.env.POLICE_BOUNDARY_GLYPH_UI_URL || 'http://127.0.0.1:8765/';
const query = '?mobileAuditFixture=many&mobileAuditView=map&mobileAuditLocation=current&mobileAuditRadius=toronto&mobileAuditSheet=collapsed&mobileAuditBoundaries=on';

async function measure(page) {
  return page.evaluate(() => {
    const sign = document.querySelector('.leaflet-control-layers .police-sign');
    const key = document.querySelector('.leaflet-control-layers .police-key');
    const label = sign.closest('label');
    const input = label.querySelector('input');
    const wrap = sign.parentElement;
    const rect = element => {
      const { x, y, width, height, right, bottom } = element.getBoundingClientRect();
      return { x, y, width, height, right, bottom };
    };
    const text = input.parentElement.lastElementChild;
    return {
      signGlyph: sign.textContent,
      pseudoGlyph: getComputedStyle(sign, '::before').content,
      input: rect(input), key: rect(key), sign: rect(sign), label: rect(label),
      text: rect(text),
      mobile: matchMedia('(max-width: 680px)').matches,
      wrapClip: getComputedStyle(wrap).clipPath,
      wrapCount: label.querySelectorAll('.police-key-wrap').length,
      inputFirst: input.nextElementSibling === wrap,
      inputLabel: input.getAttribute('aria-label'),
      labelLabel: label.getAttribute('aria-label'),
      signClip: sign ? getComputedStyle(sign).clipPath : null,
      signPosition: sign ? getComputedStyle(sign).position : null,
      keyPresent: Boolean(key),
      markerCount: document.querySelectorAll('.police-boundary-symbol').length
    };
  });
}

async function assertLegend(page) {
  const checkbox = page.getByLabel('Police Divisions', { exact: true });
  assert.equal(await checkbox.count(), 1, 'exact label must select only the checkbox');
  assert.equal(await checkbox.getAttribute('type'), 'checkbox');
  const state = await measure(page);
  assert.equal(state.signGlyph, '🚔', 'legend glyph must be real text');
  assert.ok(['none', 'normal'].includes(state.pseudoGlyph), 'glyph must not come from a pseudo-element');
  assert.equal(state.inputLabel, 'Police Divisions');
  assert.equal(state.labelLabel, null, 'label must not acquire a duplicate accessible name');
  assert.equal(state.wrapCount, 1, 'rebuild must inject exactly one key');
  assert.ok(state.inputFirst, 'key must immediately follow the checkbox inside the holder');
  assert.equal(state.wrapClip, 'none');
  assert.equal(state.signClip, 'none');
  assert.equal(state.signPosition, 'static');
  assert.equal(state.key.width, 24);
  assert.ok(state.input.right <= state.key.x, 'checkbox must precede the key');
  assert.ok(state.key.right <= state.sign.x, 'key must precede the glyph');
  for (const part of [state.input, state.key, state.sign]) {
    assert.ok(part.x >= state.label.x && part.right <= state.label.right, 'row content must fit horizontally');
    assert.ok(part.y >= state.label.y && part.bottom <= state.label.bottom, 'row content must fit vertically');
    assert.ok(Math.abs(part.y + part.height / 2 - state.sign.y - state.sign.height / 2) < 5, 'checkbox, line and glyph must share one row');
  }
  assert.ok(state.sign.width > 8 && state.sign.height > 8, 'glyph must retain visible dimensions');
  if (!state.mobile) {
    assert.ok(state.sign.right <= state.text.x, 'glyph must precede the visible label');
    assert.ok(Math.abs(state.text.y + state.text.height / 2 - state.sign.y - state.sign.height / 2) < 5, 'label must share the glyph row');
  }
  return state;
}

async function assertToggleRebuild(page) {
  await page.getByLabel('Police Divisions', { exact: true }).uncheck();
  await awaitUiState(page, () => document.querySelectorAll('.police-boundary-symbol').length === 0 && document.querySelector('.police-sign'), { description: 'boundary off and rebuilt legend' });
  await assertLegend(page);
  await page.getByLabel('Police Divisions', { exact: true }).check();
  await awaitUiState(page, () => document.querySelector('.police-sign') && document.querySelector('.leaflet-control-layers-overlays input').checked, { description: 'enabled boundary legend rebuilt' });
  await assertLegend(page);
}

async function loadAndWait(page, label) {
  await timing.time(`page-goto${label}`, () => page.goto(`${base}${query}`, { waitUntil: 'domcontentloaded' }));
  await timing.time(`fixture-ready${label}`, () => awaitFixtureReady(page));
  await timing.time(`glyph-rendered${label}`, () => awaitUiState(page, () => document.querySelectorAll('.police-boundary-symbol').length > 0, { description: 'police boundary badge glyph markers' }));
}

const browser = await timing.time('chromium-launch', () => chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE }));
const errors = [];
try {
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await loadAndWait(page, '');
    const state = await assertLegend(page);
    await assertToggleRebuild(page);
    assert.ok(state.signGlyph && state.signGlyph.includes('🚔'), 'legend must show the badge glyph');
    assert.ok(state.keyPresent, 'legend must show the boundary key line');
    assert.ok(state.markerCount > 0, 'map must render boundary badge glyph markers');
    console.log(JSON.stringify({ story: 'police-boundary-glyph', legend: state.signGlyph, markerCount: state.markerCount, errors }, null, 2));
    await context.close();
  }
  {
    const context = await browser.newContext({ viewport: { width: 440, height: 965 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await loadAndWait(page, '-mobile');
    const state = await assertLegend(page);
    await assertToggleRebuild(page);
    assert.equal(state.signClip, 'none', 'mobile legend glyph must not be clip-pathed');
    assert.equal(state.signPosition, 'static', 'mobile legend glyph must stay in-flow');
    assert.ok(state.markerCount > 0, 'map must render boundary badge glyph markers on mobile');
    await context.close();
  }
  assert.deepEqual(errors, []);
} finally {
  await timing.time('browser-close', () => browser.close());
  console.log(timing.format({ format: timingFormat, label: 'test:police-boundary-glyph:browser' }));
}
