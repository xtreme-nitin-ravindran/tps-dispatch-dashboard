import test from 'node:test';
import assert from 'node:assert/strict';
import { updateLabel } from '../src/view-controls.js';
test('updates distinguish new calls from revisions and removals', () => {
  assert.equal(updateLabel([{id:'a'}], [{id:'a'}, {id:'b'}]), '1 new call available');
  assert.equal(updateLabel([{id:'a'}], [{id:'b'}, {id:'c'}]), '2 new calls available');
  assert.equal(updateLabel([{id:'a'}], []), 'Call updates available');
  assert.equal(updateLabel([{id:'a'}], [{id:'a', changed:true}]), 'Call updates available');
});
import { filterDefaults, filterSummary } from '../src/view-controls.js';
test('summary includes each applied filter and clear defaults', () => {
  assert.equal(filterSummary(filterDefaults), 'Last 24 hours');
  assert.equal(filterSummary({...filterDefaults, hours:1}), 'Last 1 hour');
  assert.equal(filterSummary({...filterDefaults, hours:12}), 'Last 12 hours');
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
  assert.deepEqual(readFilters(new URLSearchParams('event=medical&division=51&q=alarm')), {
    ...filterDefaults, eventFilter:'medical', division:'51', search:'alarm'
  });
});
import { clusterPoints, spreadPoint } from '../src/map-clusters.js';
test('clustering preserves calls and separates distant screen cells', () => {
  const items=[{coordinates:[1,1]},{coordinates:[2,2]},{coordinates:[200,200]}];
  const groups=clusterPoints(items,([x,y])=>({x,y}));
  assert.deepEqual(groups.map(g=>g.length),[2,1]);
  assert.equal(groups.flat().length,items.length);
  assert.deepEqual(clusterPoints([],assert.fail),[]);
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
import { preferenceRecord, loadPreferences, savePreferences } from '../src/view-controls.js';
test('preferences are validated, exclude private session data and tolerate blocked storage', () => {
  let raw;
  const storage={setItem:(_,v)=>raw=v,getItem:()=>raw};
  savePreferences(storage,{...filterDefaults,hours:6,nearby:[43,-79],search:'private street'},{roads:true,boundaries:false});
  assert.ok(!raw.includes('private')); assert.ok(!raw.includes('nearby'));
  const restored=loadPreferences(storage);
  assert.equal(restored.filters.hours,6); assert.equal(restored.filters.search,'');
  assert.equal(restored.roads,true); assert.equal(restored.boundaries,false);
  raw='null'; assert.equal(loadPreferences(storage),null);
  raw='[]'; assert.equal(loadPreferences(storage),null);
  raw='{"division":7}';
  assert.deepEqual(loadPreferences(storage), {filters:filterDefaults,roads:false,boundaries:true});
  raw='{'; assert.equal(loadPreferences(storage),null);
  const blocked={getItem(){throw Error();},setItem(){throw Error();}};
  assert.equal(loadPreferences(blocked),null);
  assert.doesNotThrow(()=>savePreferences(blocked,filterDefaults,{}));
});

import { sourceStatus } from '../src/source-status.js';
test('source lines distinguish published times from successful checks', () => {
  const now=Date.parse('2026-09-22T18:00:00Z');
  const feed={fetchedAt:'2026-09-22T18:00:00Z',sourceUpdatedAt:'2026-09-22T17:58:00Z'};
  assert.equal(sourceStatus('TTC alerts',feed,now).label,'TTC alerts updated');
  assert.equal(sourceStatus('Road restrictions',{fetchedAt:feed.fetchedAt},now).label,'Road restrictions checked');
  assert.equal(sourceStatus('TPS',null,now).timestamp,null);
  assert.equal(sourceStatus('TPS',{fetchedAt:'2026-09-22T17:00:00Z'},now).status,'stale');
  assert.equal(sourceStatus('TTC alerts',{...feed,status:'unavailable'},now).status,'unavailable');
});
