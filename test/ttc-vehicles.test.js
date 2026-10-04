import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import bindings from 'gtfs-realtime-bindings';
import { parseTtcVehicles, fetchTtcVehicles } from '../src/ttc/vehicle-feed.js';
import { correlateVehicle, detectVehicles, deviationOutput, refreshVehicles, validateVehicleState, validateDeviationOutput, VEHICLE_POLICY } from '../src/ttc/vehicle-detector.js';
import { compileShape, projectVehicle } from '../src/ttc/vehicle-geometry.js';
import { parseTtcAlerts, updateTtcAlerts } from '../src/ttc/alerts.js';
import { correlateState } from '../src/ttc/correlation.js';
import { runVehiclePolling } from '../scripts/ttc-vehicles.js';
import { at, vehicle, protobuf, staticIndex } from './fixtures/ttc-vehicles/builders.js';
const index=staticIndex();
const parse=(seconds=0,overrides={})=>parseTtcVehicles(protobuf([vehicle(seconds,overrides)],seconds),at(seconds));
const observation=(seconds=0,overrides={})=>parse(seconds,overrides).observations[0];
function sequence(times,overrides=()=>({}),alerts) {
  let state; const results=[];
  for (const seconds of times) { const result=detectVehicles(state,parse(seconds,overrides(seconds)),index,at(seconds),alerts); state=result.state; results.push(result); }
  return results;
}
test('vehicle protobuf preserves exact IDs and supplied optional fields',()=>{
  const o=observation(0,{position:{latitude:43.65,longitude:-79.4,bearing:95,speed:5},currentStopSequence:20,stopId:'B',currentStatus:1});
  assert.equal(o.vehicleId,'001');assert.equal(o.routeId,'0504');assert.equal(o.tripId,'t1');assert.equal(o.directionId,0);
  assert.equal(o.startDate,'20260928');assert.equal(o.startTime,'12:00:00');assert.equal(o.bearing,95);assert.equal(o.speed,5);
  assert.equal(o.stopSequence,20);assert.equal(o.stopId,'B');assert.equal(o.currentStatus,1);assert.equal(o.observedAt,at(0).toISOString());
});
test('optional context is absent, never invented; no identity is diagnostics only',()=>{
  const o=observation(0,{trip:undefined}); assert.equal(o.routeId,undefined);assert.equal(o.speed,undefined);assert.equal(o.stopId,undefined);
  const feed=parse(0,{vehicle:{label:'001'}});assert.equal(feed.observations.length,0);assert.equal(feed.diagnostics.missingIdentity,1);
});
test('invalid coordinates, missing times and future/stale observations rejected',()=>{
  for (const position of [{latitude:91,longitude:0},{latitude:0,longitude:181},{latitude:NaN,longitude:0},{latitude:0,longitude:Infinity}]) assert.equal(parse(0,{position}).diagnostics.invalid,1);
  assert.equal(parse(0,{timestamp:undefined}).diagnostics.invalid,1);
  assert.equal(parse(0,{timestamp:+at(-121)/1000}).diagnostics.stale,1);
  assert.equal(parse(0,{timestamp:+at(31)/1000}).diagnostics.stale,1);
  assert.throws(()=>detectVehicles(undefined,{observations:[{...observation(),latitude:'43'}]},index,at(0)),/Invalid normalized/);
});
test('successful empty, decode failure, stale header and HTTP error are distinct',async()=>{
  assert.equal(parseTtcVehicles(protobuf([],0),at(0)).observations.length,0);
  assert.throws(()=>parseTtcVehicles(new Uint8Array([255]),at(0)),e=>e.reason==='decode');
  assert.throws(()=>parseTtcVehicles(protobuf([],0),at(121)),e=>e.reason==='stale-feed');
  await assert.rejects(fetchTtcVehicles(at(0),async()=>({ok:false,status:503})),e=>e.reason==='fetch');
});
test('exact trip, route/direction fallback, ambiguous and unmatched correlation',()=>{
  assert.equal(correlateVehicle(observation(),index).quality,'exact');
  assert.equal(correlateVehicle(observation(0,{trip:{routeId:'0504',directionId:0,tripId:'not-static'}}),index).quality,'probable');
  assert.equal(correlateVehicle(observation(0,{trip:{routeId:'0504'}}),index).quality,'ambiguous');
  for (const trip of [{routeId:'unknown'},{tripId:'t1',routeId:'29'},{tripId:'t1',directionId:1},{tripId:'t1',scheduleRelationship:2}]) assert.equal(correlateVehicle(observation(0,{trip}),index).quality,'unmatched');
  assert.equal(correlateVehicle(observation(0,{stopId:'not-static'}),index).quality,'unmatched');
  const result=detectVehicles(undefined,parse(0,{trip:{routeId:'0504'}}),index,at(0));assert.equal(result.state.tracks.length,0);assert.equal(result.report.ambiguous,1);
});
test('one off-route point is possible; three distinct moving samples over 60s confirm',()=>{
  const results=sequence([0,30,60]);assert.equal(results[0].state.tracks[0].state,'possible');assert.equal(results[1].state.tracks[0].state,'possible');assert.equal(results[2].state.tracks[0].state,'confirmed');
  assert.equal(deviationOutput(results[2].state).deviations.length,1);
});
test('on route, stationary off-route and overly short evidence never confirm',()=>{
  assert.equal(sequence([0,30,60],()=>({position:{latitude:43.65,longitude:-79.4}})).at(-1).state.tracks[0].state,'on-route');
  assert.equal(sequence([0,30,60,90,120],()=>({position:{latitude:43.6512,longitude:-79.4}})).at(-1).state.tracks[0].state,'possible');
  assert.equal(sequence([0,1,2]).at(-1).state.tracks[0].state,'possible');
});
test('single GPS jump cannot enter evidence or break subsequent recovery',()=>{
  let state=sequence([0,30]).at(-1).state;
  const jump=detectVehicles(state,parse(31,{position:{latitude:44,longitude:-79.4}}),index,at(31));
  assert.equal(jump.report.gpsAnomalies,1);assert.deepEqual(jump.state.tracks,state.tracks);
  state=detectVehicles(jump.state,parse(60),index,at(60)).state;assert.equal(state.tracks[0].state,'confirmed');assert.equal(state.tracks[0].history.length,3);
});
test('duplicates and out of order do not advance evidence; conflicting duplicates discarded',()=>{
  const state=sequence([0,30]).at(-1).state;
  for (const seconds of [0,30]) {
    const r=detectVehicles(state,parse(seconds),index,at(30));assert.equal(r.report.duplicateOrOutOfOrder,1);assert.deepEqual(r.state.tracks,state.tracks);
  }
  const same=parseTtcVehicles(protobuf([vehicle(),vehicle()],0),at(0));assert.equal(same.observations.length,1);
  const conflict=parseTtcVehicles(protobuf([vehicle(),vehicle(0,{position:{latitude:43.65,longitude:-79.4}}),vehicle()],0),at(0));assert.equal(conflict.observations.length,0);
});
test('rejoin requires three on-route observations over 60 seconds',()=>{
  let state=sequence([0,30,60]).at(-1).state;
  for (const seconds of [90,120,150]) {
    state=detectVehicles(state,parse(seconds,{position:{latitude:43.65,longitude:-79.395}}),index,at(seconds)).state;
    assert.equal(state.tracks[0].state,seconds===150?'on-route':'rejoining');
  }
});
test('hysteresis neutral observations preserve confirmed state and interrupt recovery count',()=>{
  let state=sequence([0,30,60]).at(-1).state;
  for (const seconds of [90,120,150]) state=detectVehicles(state,parse(seconds,{position:{latitude:43.6507,longitude:-79.395}}),index,at(seconds)).state;
  assert.equal(state.tracks[0].state,'confirmed');
});
test('terminus layover off-route points are neutral',()=>{
  const result=sequence([0,30,60],()=>({position:{latitude:43.651,longitude:-79.41}})).at(-1);
  assert.equal(result.state.tracks[0].state,'unknown');assert.equal(result.report.terminalSuppressed,1);
});
test('assignment changes, gaps and static versions reset evidence',()=>{
  const previous=sequence([0,30,60]).at(-1).state;
  for (const trip of [{tripId:'t2',routeId:'0504',directionId:0},{tripId:'t1',routeId:'0504',directionId:0,startTime:'13:00:00'}]) {
    const r=detectVehicles(previous,parse(90,{trip}),index,at(90));assert.equal(r.state.tracks[0].state,'possible');assert.equal(r.state.tracks[0].history.length,1);
  }
  const g=detectVehicles(previous,parse(60+VEHICLE_POLICY.maxGapMs/1000+1),index,at(60+VEHICLE_POLICY.maxGapMs/1000+1));assert.equal(g.state.tracks[0].history.length,1);
  const r=detectVehicles(previous,parse(90),{...index,version:'new'},at(90));assert.equal(r.state.tracks[0].history.length,1);
});
test('disappearance expires state; reappearance starts fresh; failures suppress export immediately',async()=>{
  const previous=sequence([0,30,60]).at(-1).state;
  const r=await refreshVehicles(previous,index,at(90),undefined,{fetchSource:async()=>{throw new Error('offline');}});
  assert.equal(r.state.status,'unavailable');assert.equal(deviationOutput(r.state).deviations.length,0);
  const expired=detectVehicles(previous,{observations:[]},index,at(60+VEHICLE_POLICY.inactivityMs/1000+1));assert.equal(expired.state.tracks.length,0);assert.equal(expired.report.expired,1);
  assert.equal(detectVehicles(expired.state,parse(60+VEHICLE_POLICY.inactivityMs/1000+30),index,at(60+VEHICLE_POLICY.inactivityMs/1000+30)).state.tracks[0].state,'possible');
});
test('history is count/time bounded and tracker fleet cap is explicit',()=>{
  const result=sequence(Array.from({length:35},(_,i)=>i*30),()=>({position:{latitude:43.6512,longitude:-79.4}}));
  assert.equal(result.at(-1).state.tracks[0].history.length,20);
  const obs=observation();
  const fleet=detectVehicles(undefined,{observations:Array.from({length:3002},(_,i)=>({...obs,vehicleId:String(i)}))},index,at(0));
  assert.equal(fleet.state.tracks.length,3000);assert.equal(fleet.report.capacityDropped,2);
});
test('schema rejects invalid coordinates, timestamps, distances, states, references and bounds',()=>{
  const valid=sequence([0,30,60]).at(-1).state;
  for (const mutate of [s=>s.tracks[0].history[0].latitude=100,s=>s.tracks[0].history[0].distanceFromShapeMeters=-1,s=>s.tracks[0].state='detour',s=>s.checkedAt='today',s=>s.tracks[0].shapeId='s2',s=>s.tracks[0].history=Array(21).fill(s.tracks[0].history[0]),s=>s.tracks[0].history[0].segmentIndex=999]) {
    const copy=structuredClone(valid);mutate(copy);assert.throws(()=>validateVehicleState(copy,index));
  }
  assert.equal(VEHICLE_POLICY.historyMs,600000);
});
const geom=points=>compileShape(points.map(([lat,lon],i)=>[i,lat,lon]));
test('geometry on line, perpendicular distance, vertex and Toronto longitude scale',()=>{
  const g=geom([[43.65,-79.41],[43.65,-79.39]]);
  assert.equal(projectVehicle({latitude:43.65,longitude:-79.4},g).distanceFromShapeMeters,0);
  assert.ok(Math.abs(projectVehicle({latitude:43.651,longitude:-79.4},g).distanceFromShapeMeters-111.32)<.01);
  assert.ok(Math.abs(projectVehicle({latitude:43.65,longitude:-79.411},g).distanceFromShapeMeters-80.55)<.2);
  assert.ok(projectVehicle({latitude:43.65,longitude:-79.39},g).distanceFromShapeMeters<.001);
});
test('geometry curves, duplicates, degenerate shape and self crossing projection ambiguity',()=>{
  assert.equal(geom([[43,-79],[43,-79]]),null);
  const g=geom([[43.65,-79.4],[43.65,-79.4],[43.65,-79.39],[43.66,-79.39]]);
  assert.ok(projectVehicle({latitude:43.655,longitude:-79.39},g).distanceFromShapeMeters<.001);
  const cross=geom([[43.65,-79.4],[43.66,-79.39],[43.65,-79.39],[43.66,-79.4]]);
  assert.equal(projectVehicle({latitude:43.655,longitude:-79.395},cross).projectionAmbiguous,true);
});
test('nearest parallel segment is chosen globally, without claiming unique progress on ties',()=>{
  const g=geom([[43.65,-79.41],[43.65,-79.39],[43.652,-79.39],[43.652,-79.41]]);
  assert.equal(projectVehicle({latitude:43.6518,longitude:-79.4},g).segmentIndex,2);
  assert.equal(projectVehicle({latitude:43.651,longitude:-79.4},g).projectionAmbiguous,true);
});
test('end-to-end static index, protobuf, lifecycle alert, projection, state and compact output',async()=>{
  const bytes=bindings.transit_realtime.FeedMessage.encode({header:{gtfsRealtimeVersion:'2.0',timestamp:+at(0)/1000},entity:[{id:'alert',alert:{effect:4,informedEntity:[{routeId:'0504',trip:{tripId:'t1'},stopId:'A'},{routeId:'0504',trip:{tripId:'t1'},stopId:'D'}]}}]}).finish();
  const alerts=correlateState(await updateTtcAlerts(undefined,at(0),async()=>parseTtcAlerts(bytes,at(0)),()=>{}),index,at(0));
  const output=deviationOutput(sequence([0,30,60],()=>({}),alerts).at(-1).state);
  assert.equal(output.deviations[0].state,'confirmed');assert.deepEqual(output.deviations[0].relatedAlertIds,['alert']);
  assert.equal(output.deviations[0].observations.length,3);assert.equal(output.deviations[0].cause,undefined);assert.equal(output.shapes,undefined);
  assert.deepEqual(deviationOutput(sequence([0,30,60]).at(-1).state).deviations[0].relatedAlertIds,[]);
  assert.deepEqual(deviationOutput(sequence([0,30,60],()=>({}),{...alerts,status:'unavailable'}).at(-1).state).deviations[0].relatedAlertIds,[]);
});
test('bounded polling writes backend artifacts using shared code and injected time',async()=>{
  const dir=await mkdtemp(`${tmpdir()}/ttc-vehicles-`);
  try {
    const fixture=[0,30,60].map(s=>({now:at(s).toISOString(),protobufBase64:Buffer.from(protobuf([vehicle(s)],s)).toString('base64')}));
    await runVehiclePolling({polls:3,fixture,loadStatic:async()=>({index}),clock:()=>at(0),wait:async()=>{},log:()=>{},statePath:`${dir}/state.json`,outputPath:`${dir}/output.json`});
    const output=JSON.parse(await readFile(`${dir}/output.json`,'utf8'));assert.equal(output.deviations[0].state,'confirmed');
    await runVehiclePolling({loadStatic:async()=>{throw new Error('static offline');},clock:()=>at(90),log:()=>{},statePath:`${dir}/state.json`,outputPath:`${dir}/output.json`});
    const failed=JSON.parse(await readFile(`${dir}/output.json`,'utf8'));assert.equal(failed.status,'unavailable');assert.deepEqual(failed.deviations,[]);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
test('explicit route-only alert supports detection without forcing ambiguous pattern selectors',()=>{
  const base={id:'route-alert',routes:['0504'],activePeriods:[],informedEntities:[{routeId:'0504'}],correlation:{status:'partial',candidates:[]}};
  const state=sequence([0,30,60],()=>({}),{status:'ok',items:[base]}).at(-1).state;
  assert.deepEqual(state.tracks[0].relatedAlertIds,['route-alert']);
  const ambiguous={...base,informedEntities:[{routeId:'0504',stopId:'A'}],correlation:{status:'ambiguous',candidates:[]}};
  assert.deepEqual(sequence([0,30,60],()=>({}),{status:'ok',items:[ambiguous]}).at(-1).state.tracks[0].relatedAlertIds,[]);
});
test('a new deviation episode excludes evidence from a prior recovered episode',()=>{
  let state=sequence([0,30,60]).at(-1).state;
  for (const s of [90,120,150]) state=detectVehicles(state,parse(s,{position:{latitude:43.65,longitude:-79.395}}),index,at(s)).state;
  state=detectVehicles(state,parse(180),index,at(180)).state;
  const d=deviationOutput(state).deviations[0];assert.equal(d.firstObservedAt,at(180).toISOString());assert.equal(d.observations.length,1);
});
test('route/direction/pattern reassignment cannot inherit a confirmed deviation',()=>{
  const prior=sequence([0,30,60]).at(-1).state;
  const switched=detectVehicles(prior,parse(90,{trip:{routeId:'0504',tripId:'t3',directionId:1},position:{latitude:43.6532,longitude:-79.397}}),index,at(90));
  assert.equal(switched.state.tracks[0].state,'possible');assert.equal(switched.state.tracks[0].shapeId,'s2');assert.equal(switched.state.tracks[0].history.length,1);
  const unknown=detectVehicles(prior,parse(90,{trip:{routeId:'29'}}),index,at(90));assert.equal(unknown.state.tracks.length,0);
});
test('stale observations cannot confirm; missing polls within the gap limit can',()=>{
  const prior=sequence([0,30]).at(-1).state;
  const stale=detectVehicles(prior,{observations:[observation(60)]},index,at(181));
  assert.equal(stale.report.stale,1);assert.equal(stale.state.tracks[0].state,'possible');
  assert.equal(sequence([0,30,110]).at(-1).state.tracks[0].state,'confirmed');
});

test('five-minute cadence gap preserves a track so a departure-to-rejoin episode can complete across runs',()=>{
  // Regression: the data writer runs every five minutes, so consecutive bursts are
  // ~300 s apart. The old 180 s inactivity and 90 s gap limits dropped or reset every
  // track at the start of each run, so no episode could ever complete and the published
  // diversion artifact stayed permanently empty.
  const cadence=300;
  let state=sequence([0,30,60]).at(-1).state;
  assert.equal(state.tracks[0].state,'confirmed');
  // Next run starts ~300 s later; the track must survive the cadence gap.
  state=detectVehicles(state,parse(cadence),index,at(cadence)).state;
  assert.equal(state.tracks[0].state,'confirmed');
  assert.equal(state.tracks[0].history.length,4);
  // The vehicle rejoins within the same run: three on-route samples over 60 s.
  let rejoined=0;
  for (const s of [cadence+30,cadence+60,cadence+90]) { const r=detectVehicles(state,parse(s,{position:{latitude:43.65,longitude:-79.395}}),index,at(s)); state=r.state; rejoined+=r.report.rejoined; }
  assert.equal(state.tracks[0].state,'on-route');
  assert.equal(rejoined,1);
  assert.equal(VEHICLE_POLICY.inactivityMs>cadence*1000,true);
  assert.equal(VEHICLE_POLICY.maxGapMs>cadence*1000,true);
});
test('time bound prunes history before count limit; ambiguous context breaks confirmation',()=>{
  const state=sequence(Array.from({length:12},(_,i)=>i*80),()=>({position:{latitude:43.6512,longitude:-79.4}})).at(-1).state;
  assert.equal(state.tracks[0].history.length,8);
  const prior=sequence([0,30]).at(-1).state;
  const unknown=detectVehicles(prior,parse(60,{trip:{routeId:'0504'}}),index,at(60)).state;
  assert.equal(detectVehicles(unknown,parse(90),index,at(90)).state.tracks[0].state,'possible');
});
test('compact schema validates index references and does not accept malformed evidence',()=>{
  const output=deviationOutput(sequence([0,30,60]).at(-1).state);
  assert.equal(validateDeviationOutput(output,index),output);
  for (const mutate of [o=>o.deviations[0].observations[0].distanceFromShapeMeters=-1,o=>o.deviations[0].patternId='bad',o=>o.deviations[0].firstObservedAt='bad',o=>o.deviations[0].maxDistanceFromShapeMeters=0]) {
    const copy=structuredClone(output);mutate(copy);assert.throws(()=>validateDeviationOutput(copy,index));
  }
});
test('unscoped alert stop selectors cannot masquerade as route-wide evidence',()=>{
  const alert={id:'scoped',routes:['0504'],activePeriods:[],informedEntities:[{routeId:'0504'},{stopId:'A'}],correlation:{status:'ambiguous',candidates:[]}};
  assert.deepEqual(sequence([0,30,60],()=>({}),{status:'ok',items:[alert]}).at(-1).state.tracks[0].relatedAlertIds,[]);
});

test('streamed vehicle source handles chunked protobuf, size limits and transport interruptions',async()=>{
  const bytes=Buffer.from(protobuf([vehicle()],0));
  const result=await fetchTtcVehicles(at(0),async()=>({ok:true,body:[bytes.subarray(0,8),bytes.subarray(8)]}));
  assert.equal(result.observations[0].vehicleId,'001');
  await assert.rejects(fetchTtcVehicles(at(0),async()=>({ok:true,body:[{length:8*1024*1024+1}]})),/size limit/);
  await assert.rejects(fetchTtcVehicles(at(0),async()=>{throw new Error('connection reset');}),/connection reset/);
});
test('missing and degenerate shapes cannot create projections or deviations',()=>{
  assert.equal(compileShape(undefined),null);assert.equal(compileShape([]),null);assert.equal(projectVehicle(observation(),null),null);
  const degenerate=staticIndex();degenerate.shapes.set('s1',[[0,43,-79],[1,43,-79]]);
  assert.equal(detectVehicles(undefined,parse(),degenerate,at(0)).state.tracks.length,0);
  const noStops=staticIndex();noStops.trips.set('empty',{...noStops.trips.get('t1'),patternId:null});
  assert.equal(correlateVehicle({...observation(),tripId:'empty'},noStops).quality,'unmatched');
});
test('conflicting trip diagnostics and route-only observations retain exact source semantics',()=>{
  const conflict=detectVehicles(undefined,parse(0,{trip:{tripId:'t1',routeId:'29'}}),index,at(0));
  assert.equal(conflict.report.tripContextConflicts,1);
  const probable=detectVehicles(undefined,parse(0,{trip:{routeId:'0504',directionId:0,tripId:'missing'}}),index,at(0));
  assert.equal(probable.report.tripIdUnmatched,1);
  const routeOnly=detectVehicles(undefined,parse(0,{trip:{routeId:'0504',directionId:0}}),index,at(0));
  assert.equal(routeOnly.state.tracks[0].tripId,undefined);assert.equal(deviationOutput(routeOnly.state).deviations[0].tripId,undefined);
  const tripOnly=detectVehicles(undefined,parse(0,{trip:{tripId:'t1'}}),index,at(0));assert.equal(tripOnly.state.tracks[0].routeId,'0504');
  const unavailable=detectVehicles(undefined,undefined,index,at(0)).state;assert.equal(unavailable.sourceUpdatedAt,null);assert.equal(unavailable.fetchedAt,null);
});

test('polling rejects invalid limits, corrupt restart state and missing infer-only evidence',async()=>{
  const {writeFile,truncate}=await import('node:fs/promises');
  const dir=await mkdtemp(`${tmpdir()}/ttc-restart-`),logs=[];
  const options={statePath:`${dir}/vehicle.json`,outputPath:`${dir}/output.json`,loadStatic:async()=>({index}),clock:()=>at(0),log:e=>logs.push(e),inferOnly:true};
  try {
    for(const polls of [0,21,1.5]) await assert.rejects(runVehiclePolling({...options,polls}),/polls/);
    for(const intervalMs of [14999,60001,30000.5]) await assert.rejects(runVehiclePolling({...options,intervalMs}),/intervals/);
    await assert.rejects(runVehiclePolling(options),/valid Story 30D/);
    await writeFile(options.statePath,'invalid');await writeFile(`${dir}/diversion-state.json`,'invalid');
    await assert.rejects(runVehiclePolling(options),/valid Story 30D/);
    await truncate(options.statePath,32*1024*1024+1);await truncate(`${dir}/diversion-state.json`,16*1024*1024+1);
    await assert.rejects(runVehiclePolling(options),/valid Story 30D/);
    assert.ok(logs.some(e=>e.error==='Vehicle cache too large'));assert.ok(logs.some(e=>e.error==='Diversion cache too large'));
    const failed=await runVehiclePolling({...options,inferOnly:false,freshState:true,geoJsonPath:`${dir}/debug.json`,loadStatic:async()=>{throw new Error('offline');}});
    assert.equal(failed.staticVersion,'unavailable');assert.deepEqual(JSON.parse(await readFile(`${dir}/debug.json`)).features,[]);
  } finally {await rm(dir,{recursive:true,force:true});}
});
test('vehicle polling CLI runs deterministic protobuf evidence with isolated artifact paths',async()=>{
  const {execFileSync}=await import('node:child_process');const {writeFile,cp}=await import('node:fs/promises');
  const dir=await mkdtemp(`${tmpdir()}/ttc-cli-`);
  try {
    await cp('test/fixtures/ttc-static',`${dir}/static`,{recursive:true});
    await writeFile(`${dir}/static/shapes.txt`,'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\ns1,43.65,-79.41,1\ns1,43.65,-79.38,2\ns2,43.652,-79.41,1\ns2,43.652,-79.38,2\n');
    const fixture=[0,30,60].map(s=>({now:at(s).toISOString(),protobufBase64:Buffer.from(protobuf([vehicle(s)],s)).toString('base64'),alerts:{status:'ok',items:[]}}));
    await writeFile(`${dir}/fixture.json`,JSON.stringify(fixture));
    const env={...process.env,TTC_VEHICLE_STATE:`${dir}/vehicle.json`,TTC_VEHICLE_OUTPUT:`${dir}/output.json`,TTC_DIVERSION_STATE:`${dir}/inference.json`,TTC_DIVERSION_OUTPUT:`${dir}/diversions.json`};
    execFileSync(process.execPath,['scripts/ttc-vehicles.js','--fixture',`${dir}/fixture.json`,'--static-fixture',`${dir}/static`,'--geojson',`${dir}/debug.json`],{env});
    assert.equal(JSON.parse(await readFile(`${dir}/output.json`)).deviations[0].state,'confirmed');
    assert.equal(JSON.parse(await readFile(`${dir}/diversions.json`)).diversions[0].status,'candidate');
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('normal polling correlates official alerts and uses injected transport independently of fixture mode',async()=>{
  const dir=await mkdtemp(`${tmpdir()}/ttc-normal-`);
  try {
    let updates=0;
    const result=await runVehiclePolling({statePath:`${dir}/state.json`,outputPath:`${dir}/output.json`,loadStatic:async()=>({index,metadata:{status:'ok'}}),clock:()=>at(0),log:()=>{},
      updateAlerts:async()=>{updates++;return {status:'ok',items:[]};},refresh:async(previous,idx,now,alerts,options)=>{
        assert.equal(options.fetchSource,undefined);assert.equal(alerts.staticCorrelation.status,'ok');return detectVehicles(previous,parse(),idx,now,alerts);
      }});
    assert.equal(updates,1);assert.equal(result.tracks.length,1);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('vehicle feed ignores deleted and unrelated entities and rejects out-of-range timestamps',()=>{
  const encode=message=>bindings.transit_realtime.FeedMessage.encode(message).finish();
  const header={gtfsRealtimeVersion:'2.0',timestamp:+at(0)/1000};
  assert.equal(parseTtcVehicles(encode({header,entity:[{id:'deleted',isDeleted:true,vehicle:vehicle()},{id:'alert'}]}),at(0)).observations.length,0);
  assert.throws(()=>parseTtcVehicles(encode({header:{...header,timestamp:'9999999999999999'}}),at(0)),/Invalid vehicle feed time/);
  assert.equal(parse(0,{timestamp:'9999999999999999'}).diagnostics.invalid,1);
});
test('related alerts honor trip-based routes and direction-specific scope',()=>{
  const base={id:'direction',routes:['0504'],activePeriods:[],correlation:{status:'partial',candidates:[]}};
  for(const directionId of [0,1]) {
    const alert={...base,informedEntities:[{trip:{routeId:'0504',directionId}}]};
    const result=sequence([0,30,60],()=>({}),{status:'ok',items:[alert]}).at(-1).state;
    assert.deepEqual(result.tracks[0].relatedAlertIds,directionId===0?['direction']:[]);
  }
});

test('restart validation rejects oversized state, missing episode time, future observations and inconsistent last sample',()=>{
  const base=sequence([0,30,60]).at(-1).state;
  for(const mutate of [s=>s.extra='x'.repeat(32*1024*1024),s=>delete s.tracks[0].deviationStartedAt,s=>s.checkedAt=at(0).toISOString(),s=>s.tracks[0].tripId='missing',s=>s.tracks[0].lastObservedAt=at(61).toISOString()]) {
    const bad=structuredClone(base);mutate(bad);assert.throws(()=>validateVehicleState(bad,index),/vehicle state/);
  }
  for(const bad of [null,{}, {status:'unavailable',deviations:[{}]}]) assert.throws(()=>validateDeviationOutput(bad),/deviation output/);
});

test('CLI infer-only uses saved evidence without live fetch and tolerates optional static tables',async()=>{
  const {execFileSync}=await import('node:child_process');const {cp,mkdir,writeFile}=await import('node:fs/promises');const {resolve}=await import('node:path');
  const dir=await mkdtemp(`${tmpdir()}/ttc-cli-offline-`),script=resolve('scripts/ttc-vehicles.js');
  try {
    await cp('test/fixtures/ttc-static',`${dir}/static`,{recursive:true});await rm(`${dir}/static/calendar_dates.txt`);
    await mkdir(`${dir}/.cache/ttc`,{recursive:true});
    const saved={schemaVersion:1,staticVersion:'fixture',status:'ok',checkedAt:at(0).toISOString(),fetchedAt:at(0).toISOString(),sourceUpdatedAt:at(0).toISOString(),tracks:[]};
    await writeFile(`${dir}/.cache/ttc/vehicle-state.json`,JSON.stringify(saved));
    execFileSync(process.execPath,[script,'--infer-only','--static-fixture',`${dir}/static`],{cwd:dir});
    assert.equal(JSON.parse(await readFile(`${dir}/.cache/ttc/diversions.json`)).status,'unavailable');
    await mkdir(`${dir}/static/calendar_dates.txt`);
    assert.throws(()=>execFileSync(process.execPath,[script,'--infer-only','--static-fixture',`${dir}/static`],{cwd:dir,stdio:'pipe'}),/EISDIR/);
    await writeFile(`${dir}/offline.mjs`,"globalThis.fetch=async()=>{throw new Error('offline fixture');};\n");
    execFileSync(process.execPath,['--import',`${dir}/offline.mjs`,script,'--polls','1'],{cwd:dir});
    assert.equal(JSON.parse(await readFile(`${dir}/.cache/ttc/deviations.json`)).status,'unavailable');
  } finally {await rm(dir,{recursive:true,force:true});}
});
