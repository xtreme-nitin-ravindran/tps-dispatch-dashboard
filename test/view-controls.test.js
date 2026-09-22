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
import { clusterPoints, spreadPoint } from '../src/map-clusters.js';
test('clustering preserves calls and separates distant screen cells', () => {
  const items=[{coordinates:[1,1]},{coordinates:[2,2]},{coordinates:[200,200]}];
  const groups=clusterPoints(items,([x,y])=>({x,y}));
  assert.deepEqual(groups.map(g=>g.length),[2,1]);
  assert.equal(groups.flat().length,items.length);
  assert.deepEqual(clusterPoints([],()=>{}),[]);
  const points=Array.from({length:5},(_,i)=>spreadPoint(i,5,{x:0,y:0}));
  assert.equal(new Set(points.map(p=>JSON.stringify(p))).size,5);
});
import { focusGroup } from '../src/map-clusters.js';
test('row selection finds the entire overlapping group, or none for missing calls', () => {
  const items=[{call:{id:'a'},coordinates:[1,1]},{call:{id:'b'},coordinates:[1,1]},{call:{id:'c'},coordinates:[200,200]}];
  const project=([x,y])=>({x,y});
  assert.deepEqual(focusGroup(items,'b',project).map(i=>i.call.id),['a','b']);
  assert.deepEqual(focusGroup(items,'missing',project),[]);
});
