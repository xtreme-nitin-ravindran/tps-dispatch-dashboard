import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildStaticIndex } from '../src/ttc/static-gtfs.js';
import { DETOUR_POLICY, decodePolyline, fetchTripModifications, normalizeTripModifications, updateTtcDetours, validateTtcDetours, TTC_TRIP_MODIFICATIONS_URL } from '../src/ttc/trip-modifications.js';

// Toronto afternoon on a Tuesday; the service date helper resolves 20260928.
const now = new Date('2026-09-28T16:00:00Z');
const names = ['routes.txt','stops.txt','trips.txt','stop_times.txt','shapes.txt','calendar.txt','calendar_dates.txt'];
const tables = Object.fromEntries(names.map(n => [n,readFileSync(new URL(`fixtures/ttc-static/${n}`,import.meta.url),'utf8')]));
const index = buildStaticIndex(n => tables[n]);
// 0504 (504 King) trips t1/t2 direction 0, t3 direction 1; 29 trip t4 with no direction.
const encodeValue = value => { value = Math.round(value * 1e5) << 1; if (value < 0) value = ~value;
  let chunk = ''; while (value >= 0x20) { chunk += String.fromCharCode((0x20 | (value & 0x1f)) + 63); value >>= 5; }
  return chunk + String.fromCharCode(value + 63); };
const polyline = points => { let latitude = 0, longitude = 0, output = '';
  for (const [lng,lat] of points) { output += encodeValue(lat - latitude) + encodeValue(lng - longitude); latitude = lat; longitude = lng; }
  return output; };
const shapeEntity = (shapeId, points) => ({id:`${shapeId}-entity`,shape:{shapeId,encodedPolyline:polyline(points)}});
const modification = (id, tripIds, shapeId, extra = {}) => ({id,tripModifications:{selectedTrips:[{tripIds,shapeId}],serviceDates:['20260928'],modifications:[{startStopSelector:{stopSequence:2},endStopSelector:{stopSequence:5}}],...extra}});
const TWO = 'okliG~xrcNSgE';
const detour = (overrides = {}) => ({id:'d1',shapeId:'sh1',routeId:'0504',routeLabel:'504 King',directionId:0,serviceDates:['20260928'],tripCount:2,startStopSequence:2,endStopSequence:5,geometry:[[-79.4,43.65],[-79.399,43.6501]],...overrides});
const artifact = (overrides = {}) => ({schemaVersion:1,status:'ok',fetchedAt:now.toISOString(),checkedAt:now.toISOString(),detours:[detour()],...overrides});

test('[STORY-76] published polylines decode to longitude/latitude pairs with bounded rejection', () => {
  assert.deepEqual(decodePolyline(TWO),[[-79.4,43.65],[-79.399,43.6501]]);
  assert.deepEqual(decodePolyline('okliG~xrcNfEfE'),[[-79.4,43.65],[-79.401,43.649]]);
  for (const bad of ['',null,42,undefined]) assert.throws(() => decodePolyline(bad),/Missing detour polyline/);
  assert.throws(() => decodePolyline('okliG~xrcNSg'),/Invalid detour polyline/);
  assert.throws(() => decodePolyline('okliG~xrcN'),/fewer than two points/);
  assert.throws(() => decodePolyline('_uybQ~xrcNSgE'),/out of range/);
  const long = polyline(Array.from({length:DETOUR_POLICY.maxGeometryPoints+1},(_,i)=>[-79.4+i*1e-4,43.65]));
  assert.throws(() => decodePolyline(long),/point limit/);
});

test('[STORY-76] trip modifications join static trips, dates, selectors and route labels', () => {
  const payload = {entity:[shapeEntity('sh1',[[-79.4,43.65],[-79.399,43.6501]]),modification('d1',['t1','t2','t1'],'sh1')]};
  const {detours,report} = normalizeTripModifications(payload,index,now);
  assert.equal(report.shapeEntities,1);assert.equal(detours.length,1);
  assert.deepEqual(detours[0],{id:'d1',shapeId:'sh1',routeId:'0504',routeLabel:'504 King',directionId:0,serviceDates:['20260928'],tripCount:2,startStopSequence:2,endStopSequence:5,geometry:[[-79.4,43.65],[-79.399,43.6501]]});
  // Mixed directions collapse to null; trips with no direction are excluded.
  const mixed = normalizeTripModifications({entity:[shapeEntity('sh1',[[-79.4,43.65],[-79.399,43.6501]]),modification('d2',['t1','t3'],'sh1')]},index,now).detours[0];
  assert.equal(mixed.directionId,null);
  const none = normalizeTripModifications({entity:[shapeEntity('sh1',[[-79.4,43.65],[-79.399,43.6501]]),modification('d3',['t4'],'sh1')]},index,now).detours[0];
  assert.equal(none.directionId,null);assert.equal(none.routeId,'29');assert.equal(none.routeLabel,'29 Dufferin');
});

test('[STORY-76] malformed feeds and service dates exclude detours without losing valid siblings', () => {
  for (const payload of [null,{},undefined,{entity:{}}]) assert.throws(() => normalizeTripModifications(payload,index,now),/Invalid TTC trip-modifications feed/);
  const empty = normalizeTripModifications({entity:[{id:'no-tm'},{tripModifications:{selectedTrips:[]}},{tripModifications:{selectedTrips:[{tripIds:['t1'],shapeId:'sh1'}]}}]},index,now);
  assert.deepEqual(empty.detours,[]);assert.equal(empty.report.noShape,1);
  const otherDay = normalizeTripModifications({entity:[shapeEntity('sh1',[[-79.4,43.65],[-79.399,43.6501]]),modification('d1',['t1'],'sh1',{serviceDates:['20260929']})]},index,now);
  assert.deepEqual(otherDay.detours,[]);
  const noDates = normalizeTripModifications({entity:[shapeEntity('sh1',[[-79.4,43.65],[-79.399,43.6501]]),modification('d1',['t1'],'sh1',{serviceDates:[]})]},index,now);
  assert.equal(noDates.detours.length,1);
  const cleaned = normalizeTripModifications({entity:[shapeEntity('sh1',[[-79.4,43.65],[-79.399,43.6501]]),modification('d1',['t1'],'sh1',{serviceDates:['20260928','bad','20260928']})]},index,now);
  assert.deepEqual(cleaned.detours[0].serviceDates,['20260928']);
});

test('[STORY-76] unresolved trips, ambiguous routes, bad shapes and missing ids are bounded rejections', () => {
  const payload = {entity:[
    shapeEntity('sh1',[[-79.4,43.65],[-79.399,43.6501]]),
    modification('a',['nope'],'sh1'),
    modification('b',['t1','t4'],'sh1'),
    modification('c',['t1'],'missing'),
    modification('',['t1'],'sh1'),
    {id:'e',tripModifications:{selectedTrips:[{tripIds:['t1'],shapeId:'sh1'}],serviceDates:['20260928']}},
    {id:'f',tripModifications:{selectedTrips:[{tripIds:['t1'],shapeId:'badshape'}],serviceDates:['20260928']},shape:{shapeId:'badshape',encodedPolyline:'!!!'}},
    modification('g',['t1'],'sh1',{selectedTrips:[{tripIds:'not-array',shapeId:'sh1'}]}),
    modification('h',['t1'],42)
  ]};
  const run = normalizeTripModifications(payload,index,now);
  assert.equal(run.report.noTrips,2);assert.equal(run.report.ambiguousRoute,1);assert.equal(run.report.noShape,2);assert.equal(run.report.missingId,1);assert.equal(run.report.polyline,1);
  assert.equal(run.detours.length,1);assert.equal(run.detours[0].id,'e');
  // A route with no short/long name degrades its label to the bare route id.
  const bareIndex = buildStaticIndex(n => ({...tables,'routes.txt':tables['routes.txt']+'x,,,3\n','trips.txt':tables['trips.txt']+'x,weekday,tx,0,s1\n','stop_times.txt':tables['stop_times.txt']+'tx,A,1\n'})[n]);
  const bare = normalizeTripModifications({entity:[shapeEntity('sh1',[[-79.4,43.65],[-79.399,43.6501]]),modification('bare',['tx'],'sh1')]},bareIndex,now);
  assert.equal(bare.detours[0].routeLabel,'x');
  // Malformed shape entities are skipped without poisoning the shape map.
  const shapes = normalizeTripModifications({entity:[{shape:{shapeId:'',encodedPolyline:'x'}},{shape:{shapeId:42,encodedPolyline:'x'}},{shape:{shapeId:'sh1'}},modification('g',['t1'],'sh1')]},index,now);
  assert.equal(shapes.report.shapeEntities,0);assert.equal(shapes.report.noShape,1);
});

test('[STORY-76] identical route/direction/geometry collapses into one record and capacity is bounded', () => {
  const points=[[-79.4,43.65],[-79.399,43.6501]];
  const payload = {entity:[shapeEntity('sh1',points),modification('d1',['t1'],'sh1',{serviceDates:['20260928']}),modification('d2',['t2'],'sh1',{serviceDates:['20260928','20260929']})]};
  const {detours} = normalizeTripModifications(payload,index,now);
  assert.equal(detours.length,1);assert.equal(detours[0].id,'d1');assert.equal(detours[0].tripCount,2);
  assert.deepEqual(detours[0].serviceDates,['20260928','20260929']);
  const many = {entity:[]};
  for (let i=0;i<DETOUR_POLICY.maxDetours+1;i++) {
    many.entity.push(shapeEntity(`sh${i}`,[[-79.4,43.65],[-79.4+i*1e-4,43.6501]]));
    many.entity.push(modification(`d${i}`,['t1'],`sh${i}`));
  }
  const capped = normalizeTripModifications(many,index,now);
  assert.equal(capped.detours.length,DETOUR_POLICY.maxDetours);assert.equal(capped.report.capacity,1);
});

test('[STORY-76] the detour artifact schema rejects malformed records and accepts unavailable retention', () => {
  validateTtcDetours(artifact());
  const retained = {schemaVersion:1,status:'unavailable',fetchedAt:now.toISOString(),checkedAt:now.toISOString(),detours:[detour()]};
  validateTtcDetours(retained);
  const empty = {schemaVersion:1,status:'unavailable',fetchedAt:null,checkedAt:now.toISOString(),detours:[]};
  validateTtcDetours(empty);
  for (const [label,mutate] of [
    ['schema',a=>a.schemaVersion=2],['status',a=>a.status='stale'],['detours',a=>a.detours='x'],['checkedAt',a=>a.checkedAt='bad'],
    ['ok-fetchedAt',a=>a.fetchedAt=null],['unavailable-retained',a=>{a.status='unavailable';a.fetchedAt=null;}],
    ['dup-id',a=>a.detours.push(detour())],['shapeId',a=>a.detours[0].shapeId=''],['routeId',a=>a.detours[0].routeId=''],
    ['routeLabel',a=>a.detours[0].routeLabel=''],['direction',a=>a.detours[0].directionId=2],
    ['dates-type',a=>a.detours[0].serviceDates='x'],['dates-count',a=>a.detours[0].serviceDates=Array.from({length:DETOUR_POLICY.maxServiceDates+1},(_,i)=>String(20260101+i))],
    ['date-format',a=>a.detours[0].serviceDates=['bad']],['date-dup',a=>a.detours[0].serviceDates=['20260928','20260928']],
    ['trip-count',a=>a.detours[0].tripCount=0],['trip-integer',a=>a.detours[0].tripCount=1.5],
    ['start',a=>a.detours[0].startStopSequence=-1],['end',a=>a.detours[0].endStopSequence=-1],
    ['geometry-short',a=>a.detours[0].geometry=[[-79.4,43.65]]],['geometry-point',a=>a.detours[0].geometry=[[-79.4,43.65,0],[-79.399,43.6501,0]]],
    ['geometry-not-array',a=>a.detours[0].geometry=[[-79.4,43.65],null]],
    ['geometry-null-first',a=>a.detours[0].geometry=[null,[-79.399,43.6501]]],
    ['geometry-range',a=>a.detours[0].geometry=[[500,43.65],[-79.399,43.6501]]],
    ['geometry-long',a=>a.detours[0].geometry=Array.from({length:DETOUR_POLICY.maxGeometryPoints+1},(_,i)=>[-79.4+i*1e-4,43.65])]
  ]) { const bad = artifact(); mutate(bad); assert.throws(()=>validateTtcDetours(bad),undefined,label); }
  const oversized = {schemaVersion:1,status:'ok',fetchedAt:now.toISOString(),checkedAt:now.toISOString(),detours:Array.from({length:200},(_,i)=>detour({id:`d${i}`,geometry:Array.from({length:DETOUR_POLICY.maxGeometryPoints},(_,j)=>[-79.4+j*1e-4,43.65])}))};
  assert.throws(()=>validateTtcDetours(oversized),/Invalid TTC detour artifact/);
});

test('[STORY-76] fetch propagates HTTP failures and returns parsed JSON', async () => {
  await assert.rejects(fetchTripModifications(async()=>({ok:false,status:503})),/HTTP 503/);
  const payload = {entity:[]};
  assert.deepEqual(await fetchTripModifications(async()=>({ok:true,json:async()=>payload})),payload);
  assert.equal(TTC_TRIP_MODIFICATIONS_URL.includes('trip-modifications'),true);
});

test('[STORY-76] the update path retains previous artifacts on static and fetch failure', async () => {
  await assert.rejects(updateTtcDetours({schemaVersion:2,status:'ok',fetchedAt:now.toISOString(),checkedAt:now.toISOString(),detours:[]},{index}),/Invalid TTC detour artifact/);
  const logs = [],log = entry=>logs.push(entry);
  const prior = artifact();
  const noIndex = await updateTtcDetours(prior,now,{log});
  assert.equal(noIndex.status,'unavailable');assert.deepEqual(noIndex.detours,prior.detours);assert.equal(noIndex.checkedAt,now.toISOString());
  assert.equal(logs[0].reason,'static-index');assert.equal(logs[0].retainedCount,1);
  const cold = await updateTtcDetours(undefined,now,{log});
  assert.equal(cold.status,'unavailable');assert.deepEqual(cold.detours,[]);assert.equal(cold.fetchedAt,null);
  const payload = {entity:[shapeEntity('sh1',[[-79.4,43.65],[-79.399,43.6501]]),modification('d1',['t1','t2'],'sh1')]};
  const ok = await updateTtcDetours(prior,now,{index,fetchSource:async()=>payload,log});
  assert.equal(ok.status,'ok');assert.equal(ok.detours.length,1);assert.equal(ok.detours[0].routeLabel,'504 King');
  assert.equal(logs.at(-1).count,1);assert.equal(logs.at(-1).status,'ok');
  const failed = await updateTtcDetours(prior,now,{index,fetchSource:async()=>{throw new Error('down');},log});
  assert.equal(failed.status,'unavailable');assert.deepEqual(failed.detours,prior.detours);
  assert.equal(logs.at(-1).error,'down');
  const coldFailed = await updateTtcDetours(undefined,now,{index,fetchSource:async()=>{throw new Error('down');},log});
  assert.equal(coldFailed.status,'unavailable');assert.deepEqual(coldFailed.detours,[]);
});
