import test from 'node:test';
import assert from 'node:assert/strict';
import { intersectionQueries, intersectionDivision, lookupIntersection } from '../src/intersection-lookup.js';
const location = 'FORT YORK BLVD, TT / QUEENS WHARF RD / BATHURST ST';
test('splits a TFS street segment into two cleaned intersections', () => {
  assert.deepEqual(intersectionQueries(location), ['FORT YORK BLVD & QUEENS WHARF RD, Toronto, Ontario','FORT YORK BLVD & BATHURST ST, Toronto, Ontario']);
  assert.deepEqual(intersectionQueries('KING ST, NY / BAY ST / BAY ST'), ['KING ST & BAY ST, Toronto, Ontario']);
  for (const input of ['/', 'M5A', '', null]) assert.deepEqual(intersectionQueries(input), []);
});
const feature = (name, x) => ({ properties:{AREA_NAME:name}, geometry:{type:'Polygon', coordinates:[[[x,0],[x+2,0],[x+2,2],[x,2],[x,0]]]}});
const boundaries = {features:[feature('14',0),feature('52',3)]};
test('requires all endpoints and reports both possible divisions', () => {
  assert.equal(intersectionDivision(location, [[1,1],[1,1.5]], boundaries), 'Division 14');
  assert.equal(intersectionDivision(location, [[1,1],[1,4]], boundaries), 'Possible divisions 14 / 52');
  for (const points of [undefined, [[1,1]], [[1,1],null], [[1,1],[20,20]]]) assert.equal(intersectionDivision(location, points, boundaries), 'Unknown');
  assert.equal(intersectionDivision('', [], boundaries), 'Unknown');
});
test('accepts only high confidence Canadian intersection matches', async () => {
  const valid = {score:100, attributes:{Country:'CAN',Addr_type:'StreetInt'},location:{x:-79.4,y:43.64}};
  const fetcher = candidate => async () => ({ok:true,json:async()=>({candidates:[candidate]})});
  assert.deepEqual(await lookupIntersection('test',fetcher(valid)),[43.64,-79.4]);
  for (const candidate of [{...valid,score:50},{...valid,attributes:{Country:'CAN',Addr_type:'StreetName'}},{...valid,location:{x:null,y:43.64}}]) assert.equal(await lookupIntersection('test',fetcher(candidate)),null);
  assert.equal(await lookupIntersection('test',async()=>({ok:false})),null);
  assert.equal(await lookupIntersection('test',fetcher({...valid,location:undefined})),null);
  assert.equal(await lookupIntersection('test',async()=>{throw Error('offline')}),null);
});
