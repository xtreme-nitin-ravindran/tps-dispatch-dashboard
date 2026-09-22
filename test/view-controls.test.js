import test from 'node:test';
import assert from 'node:assert/strict';
import { updateLabel } from '../src/view-controls.js';
test('updates distinguish new calls from revisions and removals', () => {
  assert.equal(updateLabel([{id:'a'}], [{id:'a'}, {id:'b'}]), '1 new call available');
  assert.equal(updateLabel([{id:'a'}], []), 'Call updates available');
  assert.equal(updateLabel([{id:'a'}], [{id:'a', changed:true}]), 'Call updates available');
});
import { filterDefaults, filterSummary } from '../src/view-controls.js';
test('summary includes each applied filter and clear defaults', () => {
  assert.equal(filterSummary(filterDefaults), 'Last 24 hours');
  const summary = filterSummary({...filterDefaults, hours:72, search:'Queen', division:'Division 11', eventFilter:'fire', serviceFilter:'TFS', nearby:[43,-79], radiusKm:2});
  for (const text of ['Last 3 days','Queen','Division 11','fire','TFS','Within 2 km']) assert.ok(summary.includes(text));
});
import { readFilters, shareView } from '../src/view-controls.js';
test('share links round trip filters without coordinates or unrelated URL data', () => {
  const filters = {...filterDefaults, search:'Queen & Bay', hours:6, serviceFilter:'TPS'};
  const url = new URL(shareView('https://example.com/?secret=x#location', {...filters, nearby:[43,-79],radiusKm:5}));
  assert.deepEqual(readFilters(url.searchParams), filters);
  assert.ok(!url.href.includes('secret')); assert.ok(!url.href.includes('43')); assert.equal(url.hash,'');
  assert.deepEqual(readFilters(new URLSearchParams('hours=-1&service=bad&event=bad')),filterDefaults);
});
