/* global document, window, requestAnimationFrame */
// [STORY-38C] Preserve loaded batches and reading position through real refreshes.
// Instrumentation is injected into the served module only; production has no test hook.
import assert from 'node:assert/strict';
import { awaitFixtureReady } from './lib/browser-fixture.js';
import { createBrowserTiming, resolveTimingFormat } from './lib/browser-timing.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const timing = createBrowserTiming();
const browser = await timing.time('chromium-launch', () => chromium.launch({ headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE || undefined }));
try {
  for (const viewport of [{width:320,height:700}, {width:390,height:844}, {width:430,height:932}, {width:1280,height:900}]) {
    for (const view of viewport.width < 500 ? ['calls', 'map'] : ['calls']) {
      const page = await browser.newPage({ viewport });
      await page.route('**/src/app/app.js*', async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text()) + `
          globalThis.refreshReadingFixture = async (removed = [], inserted = 0, unchanged = false) => {
            const originalFetch = fetchSnapshot;
            fetchSnapshot = async () => {
              const snapshot = await originalFetch();
              snapshot.calls = snapshot.calls.filter(call => !removed.includes(call.id));
              for (let index = 0; index < inserted; index++) {
                snapshot.calls.unshift({...snapshot.calls[0], id: 'refresh-insert-' + index,
                  timestamp: Date.now() - 1000 + index});
              }
              if (unchanged) snapshot.calls = state.calls;
              return snapshot;
            };
            try { await loadData(); } finally { fetchSnapshot = originalFetch; }
          };
        ` });
      });
      await timing.time('navigation', () => page.goto((process.env.CALL_REFRESH_UI_URL || 'http://127.0.0.1:8765/') +
        '?mobileAuditFixture=many&mobileAuditView=' + view + '&mobileAuditSheet=expanded&mobileAuditRoads=off&mobileAuditBoundaries=off'));
      await timing.time('fixture-ready', () => awaitFixtureReady(page));
      await timing.time('suite-execution', async () => {
        for (let batch = 0; batch < 2; batch++) {
          await page.locator('.incident-list-more button').click();
          await page.waitForFunction(count => document.querySelectorAll('#callList .incident-card').length === count, 80 + batch * 40);
        }
        const before = await page.evaluate(() => {
          const card = document.querySelectorAll('#callList .incident-card')[95];
          card.scrollIntoView({block:'start', behavior:'instant'});
          return {id:card.dataset.callId, top:card.getBoundingClientRect().top};
        });
        await page.evaluate(() => window.refreshReadingFixture([], 50));
        const read = id => page.evaluate(id => {
          const card = [...document.querySelectorAll('#callList .incident-card')].find(card => card.dataset.callId === id);
          return {top:card?.getBoundingClientRect().top, count:document.querySelectorAll('#callList .incident-card').length};
        }, id);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const after = await read(before.id);
        assert.ok(after.count >= 120, 'refresh must preserve loaded batches');
        assert.ok(Math.abs(after.top - before.top) <= 1, `reading anchor moved: ${JSON.stringify({viewport,view,before,after})}`);
        const neighbour = await page.evaluate(id => {
          const cards = [...document.querySelectorAll('#callList .incident-card')];
          const index = cards.findIndex(card => card.dataset.callId === id);
          const card = cards[index - 1];
          return {id:card.dataset.callId, top:card.getBoundingClientRect().top};
        }, before.id);
        await page.evaluate(id => window.refreshReadingFixture([id], 50), before.id);
        const fallback = await read(neighbour.id);
        assert.ok(Math.abs(fallback.top - neighbour.top) <= 1, 'removed anchor must preserve surviving neighbour');
        // Unchanged snapshots and repeated refreshes must remain stable too.
        await page.evaluate(id => window.refreshReadingFixture([id], 50), before.id);
        assert.ok(Math.abs((await read(neighbour.id)).top - neighbour.top) <= 1);
        await page.evaluate(() => window.refreshReadingFixture([], 0, true));
        assert.ok(Math.abs((await read(neighbour.id)).top - neighbour.top) <= 1, 'unchanged calls must not move');
        await page.locator('#searchInput').fill('medical');
        assert.ok(await page.locator('#callList .incident-card').count() <= 40, 'intentional filters retain initial batching');
        await page.locator('#searchInput').fill('missing-deterministic-call');
        await page.evaluate(() => window.refreshReadingFixture());
        assert.equal(await page.locator('#callList .incident-card').count(), 0);
        assert.match(await page.locator('#callList').innerText(), /No calls match your search/);
      });
      await page.close();
      console.log(`call refresh: ${viewport.width}×${viewport.height} ${view} passed`);
    }
  }
} finally {
  await timing.time('teardown', () => browser.close());
  console.log(timing.format({ format: resolveTimingFormat(process.env), label: 'call-refresh' }));
}
