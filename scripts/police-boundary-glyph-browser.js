/* global document, getComputedStyle */
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
    return {
      signGlyph: sign ? getComputedStyle(sign, '::before').content : null,
      signClip: sign ? getComputedStyle(sign).clipPath : null,
      signPosition: sign ? getComputedStyle(sign).position : null,
      keyPresent: Boolean(key),
      markerCount: document.querySelectorAll('.police-boundary-symbol').length
    };
  });
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
    const state = await measure(page);
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
    const state = await measure(page);
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
