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
