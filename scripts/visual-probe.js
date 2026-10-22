/* global document, getComputedStyle */
// Story 74 visual probe: rendered-browser geometry evidence for the map
// bubble. Loads a fixture URL, clicks a TTC sign marker, and prints the
// computed popup geometry that the visible-acceptance rules require (the
// symmetric 16px padding, edge-to-edge fill, and red kicker asserted by the
// rendered-browser suites).
//
// Usage:
//   node scripts/visual-probe.js [fixture-url]
//   TTC_VISUAL_URL='http://localhost:8766/?mobileAuditFixture=many&ttcFixture=affected' node scripts/visual-probe.js
// Defaults to the deterministic browser server with the confirmed TTC fixture.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');

const url = process.argv[2]
  || process.env.TTC_VISUAL_URL
  || 'http://127.0.0.1:8765/?mobileAuditFixture=many&ttcFixture=confirmed';

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.incidentLoadState === 'ready', null, { timeout: 60000 });
  await page.waitForSelector('.ttc-line-sign', { timeout: 15000 });
  await page.locator('.ttc-line-sign').first().dispatchEvent('click');
  await page.waitForSelector('.leaflet-popup article.ttc-detail.closure-detail', { timeout: 10000 });
  const geometry = await page.evaluate(() => {
    const article = document.querySelector('.leaflet-popup article.ttc-detail.closure-detail');
    const content = document.querySelector('.leaflet-popup .leaflet-popup-content');
    const a = article.getBoundingClientRect(), c = content.getBoundingClientRect(), s = getComputedStyle(article);
    return {
      popupCount: document.querySelectorAll('.leaflet-popup').length,
      padding: [s.paddingLeft, s.paddingRight],
      borderBottomWidth: s.borderBottomWidth,
      edgeGaps: [Math.round(a.left - c.left), Math.round(c.right - a.right)],
      kickerColor: getComputedStyle(article.querySelector('.closure-detail-kicker')).color
    };
  });
  console.log(JSON.stringify({ url, errors, geometry }, null, 2));
} finally {
  await browser.close();
}
