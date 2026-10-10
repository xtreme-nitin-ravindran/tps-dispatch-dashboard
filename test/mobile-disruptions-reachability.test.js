import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, css, app] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../assets/css/styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/app.js', import.meta.url), 'utf8')
]);

const mobileQuery = '@media (max-width: 680px), (max-width: 950px) and (max-height: 500px) and (pointer: coarse)';
const desktopRules = css.slice(0, css.indexOf(mobileQuery));
const mobileRules = css.slice(css.indexOf(mobileQuery));
const handlerStart = app.indexOf("mobileDisruptionsControl?.addEventListener('click'");
const handler = app.slice(handlerStart, app.indexOf('\nsetMobileView(mobileView', handlerStart));

test('mobile Disruptions control exists with a clear 44px touch target', () => {
  assert.match(html, /id="mobileDisruptionsControl" aria-controls="disruptions">Disruptions<\/button>/);
  assert.match(desktopRules, /\.mobile-view-toggle \{ display: none; \}/);
  assert.match(mobileRules, /\.mobile-view-toggle \{ display: grid;/);
  assert.match(mobileRules, /\.mobile-view-toggle button \{ min-height: 44px;/);
});

test('desktop layout and disruptions presentation stay unchanged', () => {
  assert.doesNotMatch(desktopRules, /mobileDisruptionsControl|data-mobile-disruptions/);
  assert.match(css, /\.disruptions-panel \{ margin: 20px 0; \}/);
  assert.doesNotMatch(handler, /renderDisruptions|renderTtc|setRoadOverlayVisibility/);
});

test('tapping reaches and focuses the existing disruptions content', () => {
  assert.match(html, /id="disruptions" aria-labelledby="disruptionHeading" tabindex="-1"/);
  assert.match(handler, /document\.querySelector\('#disruptions'\)/);
  assert.match(handler, /disruptions\?\.scrollIntoView\(\{/);
  assert.match(handler, /disruptions\?\.focus\(\{ preventScroll: true \}\)/);
});

test('the production disruptions panel is not duplicated', () => {
  assert.equal(html.match(/id="disruptions"/g)?.length, 1);
  assert.equal(html.match(/id="disruptionHeading"/g)?.length, 1);
  assert.doesNotMatch(handler, /cloneNode|innerHTML|insertAdjacentHTML|createElement/);
});

test('the control works from Map and Calls without creating a third view', () => {
  assert.match(handler, /if \(mobileView === 'map'\)[\s\S]*?setMobileView\('calls'\)/);
  assert.match(handler, /requestAnimationFrame\([\s\S]*?scrollIntoView/);
  assert.doesNotMatch(handler, /setMobileView\('disruptions'\)/);
  assert.match(app, /if \(view !== "map" && view !== "calls"\) return;/);
});

test('three controls stay within narrow mobile widths without horizontal overflow', () => {
  assert.match(mobileRules, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(mobileRules, /\.mobile-view-toggle \{[^}]*width: 100%; max-width: 100%;/);
  assert.doesNotMatch(mobileRules, /\.mobile-view-toggle\s*\{[^}]*overflow-x:\s*(?:auto|scroll)/);
});
