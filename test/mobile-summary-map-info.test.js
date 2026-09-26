import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, css, app] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../app.js', import.meta.url), 'utf8')
]);
const mobileQuery = '@media (max-width: 680px), (max-width: 950px) and (max-height: 500px) and (pointer: coarse)';
const mobileRules = css.slice(css.indexOf(mobileQuery));
const desktopRules = css.slice(0, css.indexOf(mobileQuery));

test('mobile uses one concise production-rendered summary per active view', () => {
  assert.match(html, /id="nearbySummaryText" class="desktop-nearby-summary-text"/);
  assert.match(html, /id="mobileNearbySummaryText" class="mobile-nearby-summary-text"/);
  assert.match(app, /mobileNearbySummary\([\s\S]*?state\.filtered, state\.radiusKm/);
  assert.match(app, /mobileSheetSummary\.textContent = mobileSummaryText/);
  assert.match(mobileRules, /data-mobile-view="map"\] \.nearby-summary \{ display: none; \}/);
  assert.match(mobileRules, /\.nearby-summary \.desktop-nearby-summary-text \{ display: none; \}/);
  assert.doesNotMatch(desktopRules, /desktop-nearby-summary-text \{ display: none/);
});

test('secondary located count, source times, marker shapes, ages, and resolution guide stay in Map info', () => {
  const info = html.match(/<details class="panel map-info"[\s\S]*?<\/details>/)[0];
  assert.match(info, /<span class="mobile-map-info-label">Map info<\/span>/);
  assert.match(info, /id="mobileMapStatus"/);
  assert.match(info, /id="sourceUpdated"/);
  assert.match(info, /Resolved intersection \/ street segment/);
  assert.match(info, /Approximate location/);
  assert.match(info, /TFS circle/);
  assert.match(info, /TPS square/);
  assert.match(info, /0–10 min · strongest/);
  assert.doesNotMatch(info.match(/<summary>[\s\S]*?<\/summary>/)[0], /sourceUpdated|marker guide/);
  assert.match(mobileRules, /\.map-info > summary \.map-status \{ display: none; \}/);
});

test('critical stale and unavailable incident warnings remain outside Map info', () => {
  assert.match(html, /id="mobileMapDataWarning"[\s\S]*?role="status" aria-live="polite"/);
  assert.ok(html.indexOf('id="mobileMapDataWarning"') < html.indexOf('id="mapView"'));
  assert.match(app, /mobileMapDataWarning\.textContent=messages\.join\(' '\)/);
  assert.match(app, /Data may be stale/);
  assert.match(app, /data is temporarily unavailable/);
  assert.match(mobileRules, /\.mobile-map-data-warning\[hidden\] \{ display: none; \}/);
});

test('Calls mode reserves no Map info or warning space and desktop disclosure is unchanged', () => {
  assert.match(mobileRules, /data-mobile-view="calls"\] \.map-stage,[\s\S]*?\.map-info,[\s\S]*?\.mobile-bottom-sheet \{ display: none; \}/);
  assert.match(mobileRules, /data-mobile-view="calls"\] \.mobile-map-data-warning \{ display: none; \}/);
  assert.match(html, /<span class="desktop-map-info-label">Map info &amp; legend<\/span>/);
  assert.match(desktopRules, /\.map-info > summary \{[\s\S]*?min-height: 54px/);
});

test('mobile collapsed density is bounded and keeps a 44px disclosure target', () => {
  assert.match(mobileRules, /\.nearby-summary \{[\s\S]*?padding: 8px 12px/);
  assert.match(mobileRules, /\.map-info > summary \{ min-height: 44px; padding: 0 12px; \}/);
  assert.match(mobileRules, /\.mobile-nearby-summary-text \{[\s\S]*?font-size: 14px;[\s\S]*?line-height: 1\.3/);
  assert.match(mobileRules, /\.mobile-map-data-warning \{[\s\S]*?padding: 9px 12px/);
});
