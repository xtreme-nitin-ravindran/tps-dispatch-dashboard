import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { respondingUnitLabel } from '../src/call-presentation.js';

const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('responding-unit wording is singular or plural as appropriate', () => {
  assert.equal(respondingUnitLabel(1), '1 responding unit');
  assert.equal(respondingUnitLabel(4), '4 responding units');
});

test('unavailable, invalid, and zero counts are omitted', () => {
  for (const count of [undefined, null, 0, -1, 1.5, '4']) {
    assert.equal(respondingUnitLabel(count), '');
  }
  assert.doesNotMatch(html, />0 responding units</);
});

test('responding-unit count is a secondary More details field', () => {
  const details = html.match(/<details class="call-details">[\s\S]*?<\/details>/)?.[0];
  assert.ok(details);
  assert.match(details, /<summary>More details<\/summary>[\s\S]*?call-responding-units[^>]* hidden[\s\S]*?responding-unit-count/);
  assert.match(app, /respondingUnitLabel\(call\.respondingUnitCount\)[\s\S]*?respondingUnitsDetail\.hidden = !respondingUnits/);
});

test('list and map popup share the unchanged incident-card renderer', () => {
  assert.match(app, /fragment\.appendChild\(createIncidentCard\(call, \{ distance \}\)\)/);
  assert.match(app, /\.bindPopup\(createIncidentCard\(call, \{[\s\S]*?variant: "popup"/);
  assert.match(html, /call-title[\s\S]*?call-location[\s\S]*?distance-away[\s\S]*?time-ago[\s\S]*?<details class="call-details">/);
});
