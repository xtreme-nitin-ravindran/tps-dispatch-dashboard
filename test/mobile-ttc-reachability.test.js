import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, css, app] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../assets/css/styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/app.js', import.meta.url), 'utf8')
]);

const mobileQuery = '@media (max-width: 680px), (max-width: 950px) and (max-height: 500px) and (pointer: coarse)';
const mobileRules = css.slice(css.indexOf(mobileQuery));
const callsStart = html.indexOf('<section class="content-grid" id="callsView">');
const disruptionsStart = html.indexOf('<section class="panel disruptions-panel"');
const sheetStart = html.indexOf('<aside class="mobile-bottom-sheet"');
const sheetMarkup = html.slice(sheetStart, html.indexOf('</aside>', sheetStart));

test('[STORY-37D] mobile Disruptions exposes the single production disruption panel', () => {
  assert.equal(html.match(/id="disruptions"/g)?.length, 1);
  assert.ok(callsStart >= 0 && callsStart < disruptionsStart);
  assert.match(mobileRules, /html:is\(\[data-mobile-view="map"\], \[data-mobile-view="calls"\]\) \.disruptions-panel \{ display: none; \}/);
  assert.match(html, /data-mobile-view="disruptions"[^>]*>Disruptions<\/button>/);
  assert.doesNotMatch(sheetMarkup, /id="(?:nearby)?Transit/);
});

test('[STORY-37D] TTC keeps production renderer, disclosures, source states, and wrapping contract', () => {
  assert.match(app, /renderDisruptions\(state\.disruptions, radiusFilterOrigin\(\), state\.radiusKm, dispatchMap\)/);
  assert.equal(app.match(/renderDisruptions\(state\.disruptions/g)?.length, 3);
  assert.match(html, /<details id="observedDiversions" open>/);
  assert.match(html, /<summary>TTC service alerts · citywide/);
  assert.match(css, /\.disruption-item \{[^}]*overflow-wrap: anywhere;/);
});

test('[STORY-37D] desktop disruption order and layout rules remain unchanged', () => {
  assert.ok(disruptionsStart > html.indexOf('<details class="panel map-info" id="mapInfo">'));
  assert.match(css, /\.disruptions-panel \{ margin: 20px 0; \}/);
  assert.doesNotMatch(css.slice(0, css.indexOf(mobileQuery)), /data-mobile-view=/);
});
