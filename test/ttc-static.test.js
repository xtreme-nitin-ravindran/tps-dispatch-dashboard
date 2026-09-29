import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bindings from 'gtfs-realtime-bindings';
import { buildStaticIndex, csvRows, zipTables, serviceActive } from '../src/ttc/static-gtfs.js';
import { correlateState, projectStop, validateCorrelation } from '../src/ttc/correlation.js';
import { loadStaticGtfs } from '../src/ttc/static-source.js';
import { updateTtcBackend } from '../src/ttc/backend.js';
import { parseTtcAlerts, updateTtcAlerts, validateTtcAlerts } from '../src/ttc/alerts.js';
import { runTfsEtl } from '../scripts/tfs-etl.js';
const now = new Date('2026-09-28T16:00:00Z');
const names = ['routes.txt','stops.txt','trips.txt','stop_times.txt','shapes.txt','calendar.txt','calendar_dates.txt'];
const tables = Object.fromEntries(names.map(n => [n,readFileSync(new URL(`fixtures/ttc-static/${n}`,import.meta.url),'utf8')]));
const indexFor = (overrides = {}) => buildStaticIndex(n => ({...tables,...overrides})[n]);
const index = indexFor();
const alert = (routes = ['0504'], stops = ['A','C'], extra = {}) => ({id:'a',routes,stops,informedEntities:[],activePeriods:[],...extra});
const correlate = (item = alert(), idx = index) => correlateState({items:[item]},idx,now);
const correlation = (item,idx) => correlate(item,idx).items[0].correlation;

test('exact source IDs and metadata, sorted stop coordinates, equivalent trips grouped', () => {
  const result = correlate(); validateCorrelation(result);
  const c = result.items[0].correlation;
  assert.equal(c.status,'exact'); assert.equal(c.routes[0].routeId,'0504'); assert.equal(c.routes[0].routeShortName,'504'); assert.equal(c.routes[0].routeType,0);
  assert.equal(c.stops[0].latitude,43.65005); assert.equal(c.stops[0].stopName,'Alpha');
  assert.equal(c.candidates.length,1);
  assert.equal(result.staticCorrelation.patterns[c.candidates[0].patternId].tripCount,2);
  assert.equal(index.patterns.size,3);
});
test('unknown routes/stops/trips retained; duplicates deduplicated deterministically', () => {
  assert.equal(correlation(alert(['504'],[])).status,'unmatched');
  const c = correlation(alert(['0504'],['C','unknown','A','A']));
  assert.equal(c.status,'partial'); assert.deepEqual(c.stops.map(s => s.stopId),['A','C','unknown']); assert.deepEqual(c.stops[2],{stopId:'unknown',matched:false});
  assert.deepEqual(correlate(alert(['missing'],[])).staticCorrelation.report.unmatchedRouteIds,['missing']);
  assert.equal(correlation(alert(['0504'],['A'],{informedEntities:[{trip:{tripId:'unknown'}}]})).trips[0].matched,false);
});
test('direction/branch candidates and ambiguous shared stop set; missing direction retained', () => {
  assert.equal(correlation().candidates.length,1);
  assert.equal(correlation(alert(['0504'],['A','D'])).status,'ambiguous');
  const c = correlation(alert(['0504'],['A','D'],{informedEntities:[{routeId:'0504',directionId:1}]}));
  assert.equal(c.status,'exact'); assert.equal(index.patterns.get(c.candidates[0].patternId).directionId,1);
  assert.equal(correlation(alert(['29'],['A','B'])).status,'exact');
});
test('partial set, explicit stop order mismatch, and route-only have no false exact segment', () => {
  assert.equal(correlation(alert(['0504'],['B','E'])).status,'partial');
  const c = correlation(alert(['0504'],['A','C'],{affectedStopOrder:['C','A']}));
  assert.equal(c.status,'partial'); assert.equal(c.candidates[0].affectedSegment,undefined);
  const route = correlation(alert(['0504'],[])); assert.equal(route.status,'partial'); assert.deepEqual(route.candidates,[]);
  assert.equal(correlation(alert([],['A','B'])).status,'partial');
});
test('shape ordered by sequence and nearby projection clips scheduled intermediate stops', () => {
  assert.deepEqual(index.shapes.get('s1').map(p => p[0]),[1,2,3,4]);
  const s = correlation().candidates[0].affectedSegment;
  assert.deepEqual(s.stopIds,['A','B','C']); assert.equal(s.shapeId,'s1'); assert.equal(s.geometryStatus,'projected');
  assert.deepEqual(s.geometry,[[-79.4,43.65],[-79.399,43.65],[-79.398,43.65]]);
  assert.equal(projectStop({latitude:44,longitude:-79.4},index.shapes.get('s1')),null);
  const loop = [[0,43.65,-79.4],[1,43.65,-79.399],[2,43.651,-79.399],[3,43.65,-79.4]];
  assert.equal(projectStop({latitude:43.65,longitude:-79.4},loop),null);
});
test('missing shape preserves exact stop match and shape reference without geometry', () => {
  const c = correlation(alert(['29'],['A','B'])); assert.equal(c.status,'exact');
  assert.equal(c.candidates[0].affectedSegment.geometryStatus,'missing'); assert.equal(c.candidates[0].affectedSegment.geometry,undefined);
});
test('calendar prefers current service, applies exceptions, keeps unknown schedules conservative', () => {
  const idx = indexFor({'trips.txt':tables['trips.txt']+'0504,inactive,t5,0,s2\n','stop_times.txt':tables['stop_times.txt']+'t5,A,1\nt5,B,2\nt5,C,3\n','calendar.txt':tables['calendar.txt']+'inactive,0,0,0,0,0,1,0,20260101,20261231\n'});
  assert.equal(correlation(alert(),idx).status,'exact');
  assert.equal(serviceActive(idx,'weekday','20261225'),false);
  const noCalendar = indexFor({'calendar.txt':undefined,'calendar_dates.txt':undefined});
  assert.equal(serviceActive(noCalendar,'weekday','20260928'),null);
});
test('multi-route selector stop sets correlated independently; trip ID constrains pattern', () => {
  const c = correlation(alert(['0504','29'],['A','B','C'],{informedEntities:[{routeId:'0504',stopId:'A'},{routeId:'0504',stopId:'C'},{routeId:'29',stopId:'A'},{routeId:'29',stopId:'B'}]}));
  assert.equal(c.status,'exact'); assert.equal(c.routeResults.length,2); assert.equal(c.candidates.length,2);
  const trip = correlation(alert(['0504'],['A','D'],{informedEntities:[{trip:{tripId:'t1',routeId:'0504'}}]}));
  assert.equal(trip.status,'exact'); assert.equal(trip.trips[0].matched,true); assert.equal(trip.candidates.length,1);
});
test('CSV quotes, malformed data, duplicate sequences and unknown references', () => {
  assert.deepEqual([...csvRows('id,name\r\n1,"a,""b""\nc"\r\n')],[{id:'1',name:'a,"b"\nc'}]);
  assert.throws(() => [...csvRows('a,b\n"x,y')]);
  assert.throws(() => indexFor({'shapes.txt':tables['shapes.txt']+'s1,43,-79,1\n'}));
  assert.throws(() => indexFor({'stop_times.txt':tables['stop_times.txt']+'missing,A,1\n'}));
  assert.throws(() => indexFor({'stops.txt':tables['stops.txt'].replace('43.65005','999')}));
  assert.throws(() => indexFor({'routes.txt':'route_id,route_type\n'}));
});
test('schema rejects broken geometry, exact without route, and missing pattern refs without mutation', () => {
  const result = correlate(), before = JSON.stringify(result); validateCorrelation(result); assert.equal(JSON.stringify(result),before);
  for (const mutate of [r => {r.items[0].correlation.routes=[];},r => {r.items[0].correlation.candidates[0].patternId='missing';},r => {r.items[0].correlation.candidates[0].affectedSegment.geometry[0]=[500,43];},r => {r.items[0].correlation.stops[0].latitude=NaN;}]) {
    const bad = structuredClone(result); mutate(bad); assert.throws(() => validateCorrelation(bad));
  }
});
// Stored-member ZIP fixture builder; no external zip utility or live source required.
function zip(source = tables, compressed = false) {
  const local = [], central = []; let offset = 0;
  for (const [name,text] of Object.entries(source)) {
    const n = Buffer.from(name), raw = Buffer.from(text), data = compressed ? deflateRawSync(raw) : raw, h = Buffer.alloc(30), c = Buffer.alloc(46);
    h.writeUInt32LE(0x04034b50); h.writeUInt32LE(data.length,18); h.writeUInt32LE(raw.length,22); h.writeUInt16LE(n.length,26);
    c.writeUInt32LE(0x02014b50); c.writeUInt32LE(data.length,20); c.writeUInt32LE(raw.length,24); c.writeUInt16LE(compressed ? 8 : 0,10); c.writeUInt16LE(n.length,28); c.writeUInt32LE(offset,42);
    local.push(h,n,data); central.push(c,n); offset += h.length+n.length+data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(source).length,10); end.writeUInt32LE(directory.length,12); end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}
test('validated cache reuses download, retains good stale bytes and rejects invalid replacement', async () => {
  const dir = await mkdtemp(join(tmpdir(),'ttc-static-')), cachePath = join(dir,'cache.zip'); let requests = 0;
  try {
    const bytes = zip(); assert.equal(buildStaticIndex(zipTables(bytes)).patterns.size,3);
    const fetchImpl = async () => {requests++; return {ok:true,body:[bytes]};};
    const first = await loadStaticGtfs({cachePath,fetchImpl}); assert.equal(first.metadata.status,'ok');
    await loadStaticGtfs({cachePath,fetchImpl}); assert.equal(requests,1);
    const stale = await loadStaticGtfs({cachePath,maxAgeMs:0,fetchImpl:async () => ({ok:true,body:[Buffer.from('bad')]})});
    assert.equal(stale.metadata.status,'stale'); assert.deepEqual(await readFile(cachePath),bytes);
    await writeFile(cachePath,'broken');
    await assert.rejects(loadStaticGtfs({cachePath,fetchImpl:async () => {throw new Error('offline');}}));
  } finally { await rm(dir,{recursive:true,force:true}); }
});
test('protobuf → lifecycle → correlation → production snapshot and failure retention', async () => {
  const bytes = bindings.transit_realtime.FeedMessage.encode({header:{gtfsRealtimeVersion:'2.0',timestamp:now.getTime()/1000},entity:[{id:'source-id',alert:{effect:4,informedEntity:[{routeId:'0504',stopId:'A'},{routeId:'0504',stopId:'C'}]}}]}).finish();
  const parsed = parseTtcAlerts(bytes,now), log = () => {};
  const updateAlerts = (previous,date) => updateTtcAlerts(previous,date,async () => parsed,log);
  const loadStatic = async () => ({index,metadata:{status:'ok'},metrics:{}});
  const backend = (previous,date) => updateTtcBackend(previous,date,{updateAlerts,loadStatic,log});
  const dir = await mkdtemp(join(tmpdir(),'ttc-e2e-'));
  try {
    const snapshot = await runTfsEtl({outputPath:join(dir,'current.json'),now,fetchTtc:backend,fetchSource:async () => ({updatedAt:now.toISOString(),incidents:[]})});
    const state = snapshot.ttcAlerts, item = state.items[0];
    validateTtcAlerts(state,{published:true});
    assert.equal(item.id,'source-id'); assert.deepEqual(item.routes,['0504']); assert.deepEqual(item.stops,['A','C']); assert.equal(item.state,'active');
    assert.equal(item.correlation.status,'exact'); assert.equal(item.correlation.candidates[0].affectedSegment.shapeId,'s1');
    assert.equal(JSON.parse(await readFile(join(dir,'current.json'),'utf8')).ttcAlerts.items[0].correlation.status,'exact');
    const repeated = await backend(state,now); assert.deepEqual(repeated.changes.unchanged,['source-id']);
    const failed = await updateTtcBackend(state,now,{updateAlerts,loadStatic:async () => {throw new Error('offline');},log});
    assert.equal(failed.staticCorrelation.status,'unavailable'); assert.deepEqual(failed.items[0].correlation,item.correlation);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
test('live-style trips without stop times remain resolvable but cannot fabricate patterns', () => {
  const idx = indexFor({'trips.txt':tables['trips.txt']+'0504,weekday,no-stops,0,s1\n'});
  assert.equal(idx.counts.tripsWithoutStops,1);
  const state = correlate(alert(['0504'],[],{informedEntities:[{trip:{tripId:'no-stops'}}]}),idx);
  assert.equal(state.items[0].correlation.trips[0].matched,true);
  assert.equal(state.items[0].correlation.trips[0].patternId,null);
  assert.equal(state.items[0].correlation.status,'partial');
  validateCorrelation(state);
});
test('route-only selector does not inherit another routes scoped stops', () => {
  const c = correlation(alert(['0504','29'],['A','C'],{informedEntities:[{routeId:'0504',stopId:'A'},{routeId:'0504',stopId:'C'},{routeId:'29'}]}));
  assert.equal(c.status,'partial'); assert.equal(c.candidates.length,1);
  assert.equal(c.routeResults.find(r => r.routeId === '29').status,'partial');
});
test('buffer CSV preserves quotes and UTF-8 across decoder boundaries', () => {
  const name = 'é'.repeat(32760)+'"end';
  const csv = Buffer.from(`id,name\n1,"${name.replaceAll('"','""')}"\n`);
  assert.deepEqual([...csvRows(csv)],[{id:'1',name}]);
});
test('ambiguous/reversed projections and repeated stops retain references without guessed geometry', () => {
  const reversed = indexFor({'shapes.txt':tables['shapes.txt'].replace('s1,43.65,-79.397,4','s1,43.65,-79.397,0')});
  const c = correlation(alert(),reversed);
  assert.equal(c.candidates[0].affectedSegment.geometryStatus,'ambiguous');
  const repeated = indexFor({'stop_times.txt':tables['stop_times.txt']+'t1,A,50\nt2,A,5\n'});
  assert.equal(correlation(alert(),repeated).candidates[0].affectedSegment,undefined);
});
test('pattern identity and output are deterministic under static row reordering', () => {
  const overrides = Object.fromEntries(Object.entries(tables).map(([name,text]) => {
    const [header,...rows] = text.trimEnd().split('\n'); return [name,[header,...rows.reverse()].join('\n')+'\n'];
  }));
  assert.deepEqual(correlate(),correlate(alert(),indexFor(overrides)));
});
test('static failure never transfers correlation onto changed alert content', async () => {
  const make = stop => bindings.transit_realtime.FeedMessage.encode({header:{gtfsRealtimeVersion:'2.0',timestamp:now.getTime()/1000},entity:[{id:'same',alert:{effect:4,informedEntity:[{routeId:'0504',stopId:stop}]}}]}).finish();
  const log = () => {}, update = stop => (prior,date) => updateTtcAlerts(prior,date,async () => parseTtcAlerts(make(stop),date),log);
  const first = await updateTtcBackend(undefined,now,{updateAlerts:update('A'),loadStatic:async () => ({index}),log});
  const result = await updateTtcBackend(first,now,{updateAlerts:update('B'),loadStatic:async () => {throw new Error('offline');},log});
  assert.equal(result.items[0].correlation,undefined); assert.equal(result.staticCorrelation.status,'unavailable');
  assert.deepEqual(result.changes.updated,['same']); validateTtcAlerts(result,{published:true});
});

test('valid explicit stop ordering, future service date and trip diagnostics survive scoped mismatch',()=>{
  assert.equal(correlation(alert(['0504'],['A','C'],{affectedStopOrder:['A','C']})).status,'exact');
  const future=correlation(alert(['0504'],['A','C'],{state:'scheduled',activePeriods:[{}, {start:'2026-10-01T16:00:00Z'}]}));
  assert.equal(future.serviceDate,'20261001');
  const trip=correlate(alert(['0504'],[],{informedEntities:[{trip:{tripId:'t1',directionId:1}}]}));
  assert.equal(trip.items[0].correlation.candidates.length,0);
  assert.ok(trip.staticCorrelation.patterns[trip.items[0].correlation.trips[0].patternId]);
  const absent=alert([],['unknown']);delete absent.informedEntities;delete absent.activePeriods;
  assert.equal(correlation(absent).status,'unmatched');
  assert.equal(projectStop({latitude:43.65,longitude:-79.4},[[0,43.65,-79.4],[1,43.65,-79.4]]).distance,0);
  assert.equal(serviceActive(index,'missing','20260928'),false);
});
test('CSV rejects invalid quoting, duplicate headers and row widths',()=>{
  for(const csv of ['a,b\nx"y,z\n','a,a\n1,2\n','a,b\n1\n']) assert.throws(()=>[...csvRows(csv)],/CSV/);
});
test('static validation rejects malformed numeric, identity, calendar and empty-network inputs',()=>{
  for(const [name,value] of [
    ['routes.txt','route_id,route_type\n,0\n'],
    ['routes.txt','route_id,route_type\nx,\n'],
    ['routes.txt','route_id,route_type\nx,no\n'],
    ['routes.txt','route_id,route_type\nx,-1\n'],
    ['routes.txt','route_id,route_type\nx,0.5\n'],
    ['routes.txt',tables['routes.txt']+'0504,504,King,0\n'],
    ['trips.txt',tables['trips.txt'].replace(',0,s1',',2,s1')],
    ['calendar.txt',tables['calendar.txt'].replace('20260101','bad')],
    ['calendar.txt',tables['calendar.txt'].replace('20261231','bad')],
    ['calendar.txt',tables['calendar.txt'].replace('20260101','20270101')],
    ['calendar.txt',tables['calendar.txt'].replace(',1,',',2,')],
    ['calendar_dates.txt','service_id,date,exception_type\nweekday,bad,1\n'],
    ['calendar_dates.txt','service_id,date,exception_type\nweekday,20260928,3\n'],
    ['trips.txt','route_id,service_id,trip_id,direction_id,shape_id\n'],
    ['stop_times.txt','trip_id,stop_id,stop_sequence\n']
  ]) assert.throws(()=>indexFor({[name]:value,...(name==='trips.txt' && !value.includes('s1')?{'stop_times.txt':'trip_id,stop_id,stop_sequence\n'}:{})}),undefined,name);
  const unnamed=indexFor({'routes.txt':tables['routes.txt'].replace('504,King',','),'stops.txt':tables['stops.txt'].replace('Alpha',''),'trips.txt':tables['trips.txt'].replaceAll(',s1',',')});
  assert.equal(unnamed.routes.get('0504').routeShortName,null);assert.equal(unnamed.routes.get('0504').routeLongName,null);
  assert.equal(unnamed.stops.get('A').stopName,null);assert.equal(unnamed.trips.get('t1').shapeId,null);
});
test('ZIP directory and member corruption is rejected before use',()=>{
  const original=zip(),end=original.length-22,central=original.readUInt32LE(end+16);
  for(const [offset,value,size] of [[end+4,1,2],[end+6,1,2],[central,0,4],[central+8,1,2],[central+10,99,2],[central+24,805306369,4],[0,0,4]]) {
    const bad=Buffer.from(original);bad[`writeUInt${size*8}LE`](value,offset);assert.throws(()=>zipTables(bad));
  }
  const bad=Buffer.from(original);bad.writeUInt32LE(1,central+24);assert.throws(()=>zipTables(bad)('routes.txt'),/Truncated/);
  assert.throws(()=>zipTables(zip({'routes.txt':tables['routes.txt']})),/Missing GTFS/);
  const commented=Buffer.concat([original,Buffer.from('comment')]);assert.equal(buildStaticIndex(zipTables(commented)).routes.size,index.routes.size);
});
test('static download HTTP and size failures retain prior cache; unreadable cache reports failure',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'ttc-static-errors-'));
  try {
    const cachePath=join(dir,'cache.zip'),logs=[];await writeFile(cachePath,zip());
    for(const fetchImpl of [async()=>({ok:false,status:503}),async()=>({ok:true,body:[{length:128*1024*1024+1}]})]) {
      const result=await loadStaticGtfs({cachePath,maxAgeMs:0,fetchImpl,log:e=>logs.push(e)});assert.equal(result.metadata.status,'stale');
    }
    await assert.rejects(loadStaticGtfs({cachePath:dir,fetchImpl:async()=>({ok:false,status:503}),log:e=>logs.push(e)}));
    assert.ok(logs.some(e=>e.cacheError));assert.ok(logs.some(e=>e.error?.includes('size limit')));
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('correlation schema rejects corrupt catalog, metadata and inconsistent references',()=>{
  const base=correlate(alert(['0504'],['A','C'],{informedEntities:[{trip:{tripId:'t1'}}]}));
  for(const mutate of [
    s=>delete s.staticCorrelation,
    s=>s.staticCorrelation.schemaVersion=2,
    s=>s.staticCorrelation.checkedAt='invalid',
    s=>delete s.staticCorrelation.version,
    s=>s.staticCorrelation.counts.routes=-1,
    s=>s.staticCorrelation.report.alerts=-1,
    s=>Object.values(s.staticCorrelation.patterns)[0].tripCount=0,
    s=>delete s.items[0].correlation,
    s=>s.items[0].correlation.status='invented',
    s=>s.items[0].correlation.routes.push(s.items[0].correlation.routes[0]),
    s=>s.items[0].correlation.routes[0].matched='true',
    s=>s.items[0].correlation.routes[0].routeType=-1,
    s=>s.items[0].correlation.trips[0].patternId='missing',
    s=>s.items[0].correlation.routeResults=[],
    s=>s.items[0].correlation.routeResults[0].status='invented',
    s=>s.items[0].correlation.routeResults[0].status='partial',
    s=>s.items[0].correlation.trips[0].matched=false,
    s=>{s.items[0].correlation.status='partial';s.items[0].correlation.candidates.push(s.items[0].correlation.candidates[0]);},
    s=>s.items[0].correlation.candidates[0].affectedSegment.firstStopId='missing',
    s=>s.items[0].correlation.candidates[0].affectedSegment.stopIds=['A','C'],
    s=>s.items[0].correlation.candidates[0].affectedSegment.geometry=[],
    s=>s.items[0].correlation.candidates[0].affectedSegment.geometryStatus='missing'
  ]) {const bad=structuredClone(base);mutate(bad);assert.throws(()=>validateCorrelation(bad),/correlation/);}
  const tripsOnly=correlation(alert(['0504'],[],{informedEntities:[{trip:{tripId:'t1'}}]}));
  assert.equal(tripsOnly.candidates.length,1);assert.equal(tripsOnly.status,'partial');
});

 test('deflated GTFS ZIP members decode to the same validated network as stored members',()=>{
  assert.deepEqual(buildStaticIndex(zipTables(zip(tables,true))),buildStaticIndex(zipTables(zip())));
});
