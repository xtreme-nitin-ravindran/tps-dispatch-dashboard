/* global document */
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { awaitFixtureReady } from './lib/browser-fixture.js';
import { createBrowserTiming, resolveTimingFormat } from './lib/browser-timing.js';

const timing = createBrowserTiming();
const timingFormat = resolveTimingFormat(process.env);

const output = process.env.CLUSTER_VISUAL_OUTPUT || '.cache/cluster-connectors';
await mkdir(output, { recursive: true });
const browser = await timing.time('chromium-launch', () => chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE }));
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));

async function connectorState() {
  return page.evaluate(() => {
    const connectors = [...document.querySelectorAll('.cluster-connector')];
    const lengths = connectors.map(path => path.getTotalLength());
    const clusters = [...document.querySelectorAll('.call-cluster')]
      .map(node => Number(node.textContent)).filter(Number.isFinite);
    return {
      count: connectors.length,
      lengths,
      duplicatePaths: connectors.length - new Set(connectors.map(path => path.getAttribute('d'))).size,
      largestCluster: Math.max(0, ...clusters),
      selectedMarkers: document.querySelectorAll('.leaflet-marker-icon[title^="Selected incident:"]').length,
      selectedCards: document.querySelectorAll('[data-call-id="mobile-audit-selected"].selected').length
    };
  });
}

async function assertBounded({ selected = true, largeCluster = true } = {}) {
  // Bounded wait for the expected selection state instead of a fixed sleep.
  // The app marks the selected incident card `.selected` during an async render
  // pass, so a fixed delay can race it. Wait for the state the assertions below
  // already require, then assert against the real DOM. This never weakens the
  // connector invariants; it only removes the timing race.
  if (selected) {
    await page.waitForFunction(
      () => document.querySelectorAll('[data-call-id="mobile-audit-selected"].selected').length >= 1,
      undefined,
      { timeout: 5000 }
    );
  } else {
    await page.waitForFunction(
      () => document.querySelectorAll('[data-call-id="mobile-audit-selected"].selected').length === 0,
      undefined,
      { timeout: 5000 }
    );
  }
  const state = await connectorState();
  assert.ok(state.count <= 12, `rendered ${state.count} cluster connectors`);
  assert.ok(state.lengths.every(length => length <= 96.5), `connector exceeded 96 px: ${state.lengths}`);
  assert.equal(state.duplicatePaths, 0, 'duplicate connector paths remain in the DOM');
  if (largeCluster) assert.ok(state.largestCluster > 12, `large cluster was fully expanded: ${state.largestCluster}`);
  if (selected) {
    assert.equal(state.selectedMarkers, 1, 'selected incident is not represented by exactly one map marker');
    assert.ok(state.selectedCards >= 1, 'selected incident card was not preserved');
  }
  return state;
}

try {
  const base = process.env.CLUSTER_UI_URL || 'http://127.0.0.1:8765/';
  const query = '?mobileAuditFixture=many&mobileAuditView=map&mobileAuditLocation=current&mobileAuditRadius=toronto&mobileAuditSheet=collapsed&mobileAuditRoads=on&mobileAuditBoundaries=on&incident=mobile-audit-selected';
  await timing.time('page-goto:390x844', () => page.goto(`${base}${query}`, { waitUntil: 'domcontentloaded' }));
  await timing.time('fixture-ready:390x844', () => awaitFixtureReady(page));
  await page.waitForSelector('.call-cluster');
  await assertBounded();

  for (const state of ['half', 'expanded', 'collapsed']) {
    await page.locator(`[data-sheet-target="${state}"]`).click({ force: true });
    await assertBounded();
  }

  await page.locator('button[data-mobile-view="calls"]').click();
  assert.equal((await connectorState()).count, 0, 'connectors remained after Map to Calls');
  await page.locator('button[data-mobile-view="map"]').click();
  await assertBounded();

  await page.locator('.leaflet-control-zoom-in').click({ force: true });
  await assertBounded({ largeCluster: false });
  await page.locator('.leaflet-control-zoom-out').click({ force: true });
  await assertBounded();
  const mapBox = await page.locator('.leaflet-container').boundingBox();
  assert.ok(mapBox);
  await page.mouse.move(mapBox.x + 250, mapBox.y + 260);
  await page.mouse.down();
  await page.mouse.move(mapBox.x + 180, mapBox.y + 260, { steps: 5 });
  await page.mouse.up();
  await assertBounded({ largeCluster: false });

  await page.locator('[data-radius-km="5"]').click();
  assert.equal((await connectorState()).count, 0, 'connectors remained after radius change');
  await page.locator('[data-radius-km="toronto"]').click();
  await assertBounded();

  const replacement = page.locator('.incident-card--list:not([data-call-id="mobile-audit-selected"])').first();
  await replacement.click();
  await assertBounded({ selected: false, largeCluster: false });
  await page.locator('#searchInput').fill('no incident can match this deterministic text');
  await page.locator('#searchInput').dispatchEvent('input');
  assert.equal((await connectorState()).count, 0, 'connectors remained after deselection/filter removal');

  await timing.time('page-goto:390x844-half', () => page.goto(`${base}${query.replace('mobileAuditSheet=collapsed', 'mobileAuditSheet=half')}`, { waitUntil: 'domcontentloaded' }));
  await timing.time('fixture-ready:390x844-half', () => awaitFixtureReady(page));
  await page.waitForSelector('.call-cluster');
  await assertBounded();
  await page.locator('#dispatchMap').screenshot({ path: `${output}/story-39a-390x844.png`, animations: 'disabled' });

  const smallCluster = page.locator('.call-cluster').filter({ hasText: /^3$/ });
  await smallCluster.dispatchEvent('click');
  await page.locator('.call-cluster').filter({ hasText: /^3$/ }).dispatchEvent('click');
  await page.locator('.call-cluster').filter({ hasText: /^3$/ }).dispatchEvent('click');
  await page.locator('.call-cluster').filter({ hasText: /^3$/ }).dispatchEvent('click');
  const expandedFan = await assertBounded({ largeCluster: false });
  assert.equal(expandedFan.count, 3, 'deterministic small cluster did not create its bounded connector fan');
  await page.locator('.leaflet-control-zoom-out').click({ force: true });
  await page.waitForFunction(() => document.querySelectorAll('.cluster-connector').length === 0);
  assert.equal((await connectorState()).count, 0, 'connectors remained after cluster collapse/zoom change');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ viewport: '390x844', ...(await connectorState()), errors }, null, 2));
} finally {
  await timing.time('browser-close', () => browser.close());
  console.log(timing.format({ format: timingFormat, label: 'test:story-39a:browser' }));
}
