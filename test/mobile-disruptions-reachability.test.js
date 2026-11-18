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
const handlerStart = app.indexOf('mobileViewToggles.forEach(toggle => toggle.addEventListener("click"');
const handler = app.slice(handlerStart, app.indexOf('// The layer panel reuses', handlerStart));

test('[STORY-39B] mobile Disruptions control exists with a clear 44px touch target', () => {
  assert.match(html, /id="mobileDisruptionsControl" data-mobile-view="disruptions" aria-pressed="false" aria-controls="disruptions">Disruptions<\/button>/);
  assert.match(desktopRules, /\.mobile-view-toggle \{ display: none; \}/);
  assert.match(mobileRules, /\.mobile-view-toggle \{ display: grid;/);
  assert.match(mobileRules, /\.mobile-view-toggle button \{ min-height: 44px;/);
});

test('[STORY-39B] desktop layout and disruptions presentation stay unchanged', () => {
  assert.doesNotMatch(desktopRules, /mobileDisruptionsControl|data-mobile-disruptions/);
  assert.match(css, /\.disruptions-panel \{ margin: 20px 0; \}/);
  assert.doesNotMatch(handler, /renderDisruptions|renderTtc|setRoadOverlayVisibility/);
});

test('[STORY-39B] tapping Disruptions opens the existing panel at the top of the page', () => {
  assert.match(html, /id="disruptions" aria-labelledby="disruptionHeading" tabindex="-1"/);
  assert.match(handler, /setMobileView\(toggle\.dataset\.mobileView/);
  assert.match(handler, /if \(changed\) window\.scrollTo\(\{ top: 0, behavior: 'instant' \}\)/);
  assert.doesNotMatch(handler, /scrollIntoView/);
});

test('[STORY-39B] the production disruptions panel is not duplicated', () => {
  assert.equal(html.match(/id="disruptions"/g)?.length, 1);
  assert.equal(html.match(/id="disruptionHeading"/g)?.length, 1);
  assert.doesNotMatch(handler, /cloneNode|innerHTML|insertAdjacentHTML|createElement/);
});

test('[STORY-39B] the dedicated view exposes Disruptions and hides the other views', () => {
  assert.match(app, /disruptionsView\?\.setAttribute\("aria-hidden", String\(view !== "disruptions"\)\)/);
  assert.match(app, /callsView\?\.setAttribute\("aria-hidden", String\(view !== "calls"\)\)/);
  assert.match(app, /mapView\?\.setAttribute\("aria-hidden", String\(view !== "map"\)\)/);
});
