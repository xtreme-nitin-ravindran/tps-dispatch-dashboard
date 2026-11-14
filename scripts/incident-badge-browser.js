/* global document, getComputedStyle, matchMedia */
// Rendered-browser regression for the call-result badges (NEW / UPDATED / ONGOING).
//
// All three pills share one larger 11px treatment. NEW blinks on a 1.2s smooth
// cycle, UPDATED on a 2s cycle (duration override on the --updated modifier),
// and ONGOING on a 1.6s cycle; prefers-reduced-motion disables every blink while
// keeping the larger labels. The deterministic `many` fixture renders all three
// states (NEW on mobile-audit-selected, UPDATED on mobile-audit-medical, ONGOING
// on every TFS row), and a second mobile viewport asserts the badges stay
// visible and unclipped at 440px.
import assert from 'node:assert/strict';
import { awaitFixtureReady, awaitUiState } from './lib/browser-fixture.js';
import { createBrowserTiming, resolveTimingFormat } from './lib/browser-timing.js';

const timing = createBrowserTiming();
const timingFormat = resolveTimingFormat(process.env);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');

const base = process.env.INCIDENT_BADGE_UI_URL || 'http://127.0.0.1:8765/';
const query = '?mobileAuditFixture=many&mobileAuditView=calls&mobileAuditSheet=expanded&mobileAuditRoads=off&mobileAuditBoundaries=off';

const badgeState = () => {
  const list = document.querySelector('#callList');
  const newBadge = [...list.querySelectorAll('.incident-change-badge:not([hidden])')]
    .find(node => !node.classList.contains('incident-change-badge--updated'));
  const ongoingBadge = list.querySelector('.incident-status:not([hidden])');
  const read = node => {
    if (!node) return null;
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    const card = node.closest('.incident-card');
    const cardRect = card ? card.getBoundingClientRect() : null;
    const listRect = list.getBoundingClientRect();
    return {
      fontSize: style.fontSize,
      animationName: style.animationName,
      animationDuration: style.animationDuration,
      animationIteration: style.animationIterationCount,
      animationTiming: style.animationTimingFunction,
      text: node.textContent,
      width: rect.width,
      height: rect.height,
      insideCard: Boolean(cardRect) && rect.left >= cardRect.left - 1 && rect.right <= cardRect.right + 1 && rect.top >= cardRect.top - 1 && rect.bottom <= cardRect.bottom + 1,
      cardInsideList: Boolean(cardRect) && cardRect.left >= listRect.left && cardRect.right <= listRect.right,
      rect: { left: Math.round(rect.left), right: Math.round(rect.right), top: Math.round(rect.top), bottom: Math.round(rect.bottom) },
      cardRect: cardRect ? { left: Math.round(cardRect.left), right: Math.round(cardRect.right), top: Math.round(cardRect.top), bottom: Math.round(cardRect.bottom) } : null
    };
  };
  return { newBadge: read(newBadge), ongoingBadge: read(ongoingBadge), newElementFound: Boolean(newBadge), ongoingElementFound: Boolean(ongoingBadge) };
};

async function assertBadges(page) {
  const state = await page.evaluate(badgeState);
  assert.ok(state.newElementFound && state.newBadge, 'a visible NEW badge must render');
  assert.ok(state.ongoingElementFound && state.ongoingBadge, 'a visible ONGOING badge must render');
  for (const [label, badge] of [['NEW', state.newBadge], ['ONGOING', state.ongoingBadge]]) {
    assert.equal(badge.fontSize, '11px', `${label} badge must use the larger 11px label`);
    assert.equal(badge.animationName, 'badge-blink', `${label} badge must run the badge-blink animation`);
    assert.equal(badge.animationIteration, 'infinite', `${label} badge must blink continuously`);
    assert.equal(badge.animationTiming, 'ease-in-out', `${label} badge must blink smoothly`);
    assert.ok(badge.width >= 30 && badge.height >= 18, `${label} badge must retain visible pill geometry`);
    assert.ok(badge.insideCard, `${label} badge must stay inside its card: ${JSON.stringify(badge)}`);
    assert.ok(badge.cardInsideList, `${label} badge card must stay inside the calls list`);
  }
  assert.equal(state.newBadge.animationDuration, '1.2s', 'NEW must blink on the fast 1.2s cycle');
  assert.equal(state.ongoingBadge.animationDuration, '1.6s', 'ONGOING must blink on the middle 1.6s cycle');
  return state;
}

async function assertUpdatedDuration(page) {
  const state = await page.evaluate(() => {
    const badge = document.querySelector('#callList .incident-change-badge--updated:not([hidden])');
    if (!badge) return null;
    const style = getComputedStyle(badge);
    const rect = badge.getBoundingClientRect();
    const cardRect = badge.closest('.incident-card').getBoundingClientRect();
    return {
      duration: style.animationDuration,
      fontSize: style.fontSize,
      name: style.animationName,
      text: badge.textContent,
      insideCard: rect.left >= cardRect.left - 1 && rect.right <= cardRect.right + 1 && rect.top >= cardRect.top - 1 && rect.bottom <= cardRect.bottom + 1
    };
  });
  assert.ok(state, 'a visible UPDATED badge must render');
  assert.equal(state.duration, '2s', 'UPDATED must blink on the slow 2s cycle');
  assert.equal(state.fontSize, '11px', 'UPDATED badge must use the larger 11px label');
  assert.equal(state.name, 'badge-blink', 'UPDATED badge must keep the shared blink animation');
  assert.equal(state.text, 'UPDATED');
  assert.ok(state.insideCard, 'UPDATED badge must stay inside its card');
}

async function expandToUpdated(page) {
  // mobile-audit-medical sorts to ~position 65 (dense 0-minute rows first), so
  // the UPDATED badge needs one more batch beyond the initial 40 cards.
  await page.locator('.incident-list-more button').click();
  await page.waitForFunction(() => [...document.querySelectorAll('#callList .incident-card')]
    .some(card => card.dataset.callId === 'mobile-audit-medical'), null, { timeout: 5000 });
}

async function assertReducedMotion(page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  try {
    const state = await page.evaluate(badgeState);
    assert.equal(state.newBadge.animationName, 'none', 'reduced motion must stop the NEW blink');
    assert.equal(state.ongoingBadge.animationName, 'none', 'reduced motion must stop the ONGOING blink');
    assert.equal(state.newBadge.fontSize, '11px', 'reduced motion must keep the larger label');
  } finally {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  }
}

async function loadAndWait(page, label) {
  await timing.time(`page-goto${label}`, () => page.goto(`${base}${query}`, { waitUntil: 'domcontentloaded' }));
  await timing.time(`fixture-ready${label}`, () => awaitFixtureReady(page));
  await timing.time(`badges-rendered${label}`, () => awaitUiState(page, () => {
    const list = document.querySelector('#callList');
    return Boolean(list && list.querySelector('.incident-change-badge:not([hidden])') && list.querySelector('.incident-status:not([hidden])'));
  }, { description: 'call-result badges' }));
}

const browser = await timing.time('chromium-launch', () => chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE }));
const errors = [];
try {
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await loadAndWait(page, '');
    const state = await assertBadges(page);
    await expandToUpdated(page);
    await assertUpdatedDuration(page);
    await assertReducedMotion(page);
    console.log(JSON.stringify({ story: 'incident-badge-blink', new: state.newBadge.text, ongoing: state.ongoingBadge.text, mobile: false, errors }, null, 2));
    await context.close();
  }
  {
    const context = await browser.newContext({ viewport: { width: 440, height: 965 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await loadAndWait(page, '-mobile');
    const state = await assertBadges(page);
    await expandToUpdated(page);
    await assertUpdatedDuration(page);
    assert.ok(await page.evaluate(() => matchMedia('(max-width: 680px)').matches), 'mobile context must cross the 680px breakpoint');
    console.log(JSON.stringify({ story: 'incident-badge-blink', new: state.newBadge.text, ongoing: state.ongoingBadge.text, mobile: true, errors }, null, 2));
    await context.close();
  }
  assert.deepEqual(errors, []);
} finally {
  await timing.time('browser-close', () => browser.close());
  console.log(timing.format({ format: timingFormat, label: 'test:incident-badge:browser' }));
}
