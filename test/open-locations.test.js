import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createOpenLocationResolver } from '../src/pipeline/open-locations.js';
const index = JSON.parse(readFileSync(new URL('../data/geography/toronto-locations.json',import.meta.url)));
const boundaries = JSON.parse(readFileSync(new URL('../data/police-divisions.geojson',import.meta.url)));
const resolve = createOpenLocationResolver(index,boundaries);
test('bundled open data resolves postal areas and the supplied Lake Shore segment', () => {
  const postal = resolve('M5A');
  assert.equal(postal.approximate,true);
  assert.equal(postal.division,'Division 51');
  const segment = resolve('LAKE SHORE BLVD, ET / NORRIS CRES / DOUGLAS BLVD');
  assert.equal(segment.approximate,false);
  assert.ok(segment.coordinates);
  assert.equal(segment.text,'Lake Shore Boulevard between Norris Crescent & Douglas Boulevard');
});
test('missing cross street does not imply a resolved division or exact match', () => {
  const result = resolve('LAKE SHORE BLVD, ET / NORRIS CRES / NONEXISTENT ST');
  assert.equal(result.approximate,true);
  assert.equal(result.division,'Unknown');
  assert.ok(result.coordinates);
});
test('ambiguous shared intersections are rejected', () => {
  const resolve = createOpenLocationResolver({streets:{'A St':['1','2'],'B St':['1','2']},nodes:{'1':[43.6,-79.4],'2':[43.7,-79.4]},postal:{}},boundaries);
  assert.equal(resolve('A ST / B ST').coordinates,null);
});

test('unknown postal areas and empty locations remain unresolved', () => {
  const resolve = createOpenLocationResolver({streets:{},nodes:{},postal:{}},boundaries);
  assert.equal(resolve('M5A').coordinates,null);
  assert.equal(resolve(null).coordinates,null);
});
