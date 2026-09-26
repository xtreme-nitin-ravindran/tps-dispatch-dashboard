import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, css, app] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../app.js', import.meta.url), 'utf8')
]);

const mobileRules = css.slice(css.indexOf('@media (max-width: 680px) {\n  .nearby-feature'));

test('mobile Quick Look keeps its primary action and status immediately visible', () => {
  const nearby = html.match(/<section class="nearby-feature"[\s\S]*?<\/section>/)[0];
  assert.match(nearby, /id="nearMe"/);
  assert.match(nearby, /id="nearStatus" role="status"/);
  assert.ok(nearby.indexOf('id="nearMe"') < nearby.indexOf('class="nearby-options"'));
  assert.ok(nearby.indexOf('id="nearStatus"') < nearby.indexOf('class="nearby-options"'));
  assert.match(mobileRules, /#nearMe \{ min-height: 48px/);
});

test('secondary location management and Watch action use one native disclosure on mobile and desktop markup', () => {
  const options = html.match(/<details class="nearby-options" open>[\s\S]*?<\/details>/)[0];
  assert.match(options, /<summary>Location &amp; more options<\/summary>/);
  assert.match(options, /id="savedLocationControls"/);
  assert.match(options, /id="openWatch"/);
  assert.equal([...html.matchAll(/id="savedLocationControls"/g)].length,1);
  assert.equal([...html.matchAll(/id="openWatch"/g)].length,1);
  assert.match(css, /\.nearby-options \{ display: contents; \}/);
  assert.match(app, /nearbyOptions\.open = !mobile/);
});

test('mobile compaction is scoped and preserves readable controls', () => {
  assert.match(mobileRules, /\.nearby-feature \{[\s\S]*?margin: 10px 0; padding: 14px;/);
  assert.match(mobileRules, /\.nearby-feature > div:first-child > p \{ display: none; \}/);
  assert.match(mobileRules, /#hearSirens \{ display: none; \}/);
  assert.match(mobileRules, /\.nearby-options summary \{ min-height: 44px;/);
  assert.doesNotMatch(css.slice(0, css.indexOf('@media (max-width: 680px) {\n  .nearby-feature')), /#hearSirens \{ display: none/);
});

test('unavailable and denied fixtures reuse the production fallback path without expanding options', () => {
  assert.match(app, /locationState === 'unavailable'[\s\S]*?showLocationFallback\('Location is unavailable in this browser\.'\)/);
  assert.match(app, /locationState === 'denied'[\s\S]*?showLocationFallback\('Location permission was denied\.'\)/);
  assert.doesNotMatch(app, /nearby-options['"]\)\.open|\.open = true/);
});
