import test from 'node:test';
import assert from 'node:assert/strict';
import { updateLabel } from '../src/view-controls.js';
test('updates distinguish new calls from revisions and removals', () => {
  assert.equal(updateLabel([{id:'a'}], [{id:'a'}, {id:'b'}]), '1 new call available');
  assert.equal(updateLabel([{id:'a'}], []), 'Call updates available');
  assert.equal(updateLabel([{id:'a'}], [{id:'a', changed:true}]), 'Call updates available');
});
