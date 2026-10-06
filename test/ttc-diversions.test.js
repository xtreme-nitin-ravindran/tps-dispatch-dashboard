import test from 'node:test';
import assert from 'node:assert/strict';
import bindings from 'gtfs-realtime-bindings';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { at, vehicle, protobuf, staticIndex } from './fixtures/ttc-vehicles/builders.js';
import { parseTtcVehicles } from '../src/ttc/vehicle-feed.js';
import { detectVehicles, VEHICLE_POLICY } from '../src/ttc/vehicle-detector.js';
import { parseTtcAlerts, updateTtcAlerts } from '../src/ttc/alerts.js';
import { correlateState } from '../src/ttc/correlation.js';
import { inferDiversions, trajectorySimilarity, validateDiversionState, validateDiversionOutput, diversionGeoJson, DIVERSION_POLICY } from '../src/ttc/diversion-inference.js';
import { simplifyGeometry, corridorDistance } from '../src/ttc/diversion-geometry.js';
import { runVehiclePolling } from '../scripts/ttc-vehicles.js';
const index=staticIndex();
const path=[[43.65,-79.404],[43.652,-79.403],[43.652,-79.402],[43.652,-79.400],[43.65,-79.398],[43.65,-79.397],[43.65,-79.396]];
function run({paths=[path,path],alerts,advisories,start=0,step=30,previous,detector}={}) {
  let state=previous,vehicles=detector,result;const cycles=[];
  for (let i=0;i<Math.max(...paths.map(p=>p.length));i++) {
    const seconds=start+i*step;
    const rows=paths.flatMap((p,j)=>p[i]?[vehicle(seconds,{vehicle:{id:String(j)},position:{latitude:p[i][0],longitude:p[i][1]}})]:[]);
    const feed=parseTtcVehicles(protobuf(rows,seconds),at(seconds));
    vehicles=detectVehicles(vehicles,feed,index,at(seconds),alerts).state;
    result=inferDiversions(state,vehicles,index,at(seconds),alerts,{advisories});state=result.state;cycles.push(result);
  }
  return {...result,vehicles,cycles};
}
const empty=s=>({schemaVersion:1,staticVersion:index.version,status:'ok',checkedAt:at(s).toISOString(),fetchedAt:at(s).toISOString(),sourceUpdatedAt:at(s).toISOString(),tracks:[]});
function fromEpisodes(episodes,seconds=180,records=[]) {
  return inferDiversions({schemaVersion:1,staticVersion:index.version,status:'ok',checkedAt:at(seconds).toISOString(),episodes,records},empty(seconds),index,at(seconds));
}
const only=r=>{assert.equal(r.output.diversions.length,1);return r.output.diversions[0];};
test('Story 51E: bounded episode lifecycle counters explain inference continuity',()=>{
  // The first cycle has no evidence yet; the second creates episodes; later cycles load them.
  const r=run();
  assert.equal(r.cycles[0].report.episodesLoaded,0);assert.equal(r.cycles[0].report.episodesCreated,0);assert.equal(r.cycles[0].report.episodesRetained,0);
  assert.equal(r.cycles[1].report.episodesLoaded,0);assert.equal(r.cycles[1].report.episodesCreated,2);assert.equal(r.cycles[1].report.episodesRetained,2);
  assert.equal(r.report.episodesLoaded,2);assert.equal(r.report.episodesCreated,0);assert.equal(r.report.episodesRetained,2);
  const restored=inferDiversions(r.state,r.vehicles,index,at(180));
  assert.equal(restored.report.episodesLoaded,2);assert.equal(restored.report.episodesCreated,0);assert.equal(restored.report.episodesRetained,2);
  // Completed episodes are closed; the count reflects closed episodes at run end.
  assert.equal(r.report.episodesClosed,2);
  // Expired episodes are counted when evidence ages out beyond the retention window.
  const expired=inferDiversions(r.state,empty(2100),index,at(2100));
  assert.equal(expired.report.episodesExpired,2);assert.equal(expired.report.episodesRetained,0);assert.equal(expired.report.episodesClosed,0);
  // An incomplete episode orphaned mid-run is closed but retained until expiry.
  const partial=run({paths:[path.slice(0,4),path.slice(0,4)]});
  const orphaned=inferDiversions(partial.state,empty(180),index,at(180));
  assert.equal(orphaned.report.episodesClosed,2);assert.equal(orphaned.report.episodesRetained,2);
});

test('one vehicle and repeated polling of one episode never confirm',()=>{
  const r=run({paths:[path]});assert.equal(only(r).status,'candidate');assert.equal(only(r).evidence.trajectoryCount,1);
  const repeated=inferDiversions(r.state,r.vehicles,index,at(180));assert.equal(only(repeated).evidence.trajectoryCount,1);assert.equal(only(repeated).id,only(r).id);
});
test('Story 51C: an active route-compatible advisory is associated without changing confirmation',()=>{
  const advisories={schemaVersion:1,source:'ttc-service-change',status:'ok',checkedAt:at(0).toISOString(),sourceUpdatedAt:null,fetchedAt:null,
    advisories:[{ref:'ttc-service-change:0504',source:'ttc-service-change',sourceId:'0504',title:'504 detour',effect:'DETOUR',url:null,routeIds:['0504'],activePeriods:[]}]};
  const r=run({advisories}),d=only(r);
  // The advisory is associated but the confirmation rule is unchanged.
  assert.equal(d.status,'confirmed');assert.deepEqual(d.relatedAdvisoryRefs,['ttc-service-change:0504']);assert.equal(d.confidence.advisorySupported,true);
  assert.deepEqual(d.relatedAlertIds,[]);assert.equal(d.confidence.alertSupported,false);
  // Without the advisory context the same evidence produces no association.
  assert.deepEqual(only(run()).relatedAdvisoryRefs,[]);
});
test('Story 51C: an unrelated-route advisory is never associated with the observed path',()=>{
  const advisories={schemaVersion:1,source:'ttc-service-change',status:'ok',checkedAt:at(0).toISOString(),sourceUpdatedAt:null,fetchedAt:null,
    advisories:[{ref:'ttc-service-change:501',source:'ttc-service-change',sourceId:'501',title:'501 detour',effect:'DETOUR',url:null,routeIds:['501'],activePeriods:[]}]};
  assert.deepEqual(only(run({advisories})).relatedAdvisoryRefs,[]);
});
test('two independent complete vehicles confirm a path and preserve raw/projection evidence',()=>{
  const r=run(),d=only(r);assert.equal(d.status,'confirmed');assert.equal(d.evidence.vehicleCount,2);assert.equal(d.geometrySource,'sirento-observed');
  assert.equal(d.departure.method,'on-route-projection');assert.ok(Math.abs(d.departure.point[0]+79.404)<.00001);assert.equal(d.departure.point[1],43.65);
  assert.ok(Math.abs(d.rejoin.point[0]+79.398)<.00001);assert.equal(d.departure.rawEvidence.length,2);
  assert.ok(d.geometry.some(p=>p[1]>43.6519));assert.ok(d.scheduledAffectedSegment.geometry.every(p=>p[1]===43.65));
  assert.equal(d.episodeIds,undefined);assert.equal(d.identityAnchor,undefined);
});
test('a single transient ambiguous observation does not demote a confirmed diversion',()=>{
  // Regression: deleting the track on one unmatched/ambiguous observation discarded a
  // confirmed deviation's history and anchor, so a single transient gap demoted a
  // confirmed diversion to candidate. The confirmed path must survive the gap.
  const long=[[43.65,-79.404],[43.652,-79.403],[43.652,-79.402],[43.652,-79.400],[43.65,-79.398],[43.65,-79.397],[43.65,-79.396],[43.65,-79.395],[43.65,-79.394]];
  const clean=only(run({paths:[long,long]}));
  assert.equal(clean.status,'confirmed');
  assert.equal(clean.evidence.completedVehicleCount,2);
  // Inject one ambiguous observation for vehicle 0 mid-episode, then resume.
  let state,vehicles,result;
  for (let i=0;i<long.length;i++) {
    const seconds=i*30;
    const rows=[0,1].map(j=>{
      const ambiguous=j===0&&seconds===120;
      return vehicle(seconds,{vehicle:{id:String(j)},...(ambiguous?{trip:{routeId:'0504'}}:{position:{latitude:long[i][0],longitude:long[i][1]}})});
    });
    const feed=parseTtcVehicles(protobuf(rows,seconds),at(seconds));
    vehicles=detectVehicles(vehicles,feed,index,at(seconds)).state;
    result=inferDiversions(state,vehicles,index,at(seconds));state=result.state;
  }
  const interrupted=only(result);
  assert.equal(interrupted.status,'confirmed');
  assert.equal(interrupted.evidence.completedVehicleCount,2);
  assert.equal(interrupted.id,clean.id);
});
test('same vehicle separate completed episodes count independently; two are insufficient',()=>{
  let r=run({paths:[path]});
  r=run({paths:[path],start:210,previous:r.state,detector:r.vehicles});assert.equal(only(r).status,'candidate');assert.equal(only(r).evidence.trajectoryCount,2);
  r=run({paths:[path],start:420,previous:r.state,detector:r.vehicles});assert.equal(only(r).status,'confirmed');assert.equal(only(r).evidence.vehicleCount,1);assert.equal(only(r).evidence.trajectoryCount,3);
});
test('incomplete repeated paths are likely with no rejoin and retain stable identity on completion',()=>{
  const r=run();const partial=r.cycles[3];const d=only(partial);
  assert.equal(d.status,'likely');assert.equal(d.rejoin,undefined);assert.equal(d.scheduledAffectedSegment.geometry,null);
  assert.equal(only(r).id,d.id);
});
test('cold start without departure anchor cannot confirm a complete path',()=>{
  const r=run({paths:[path.slice(1),path.slice(1)]});assert.equal(only(r).status,'likely');assert.equal(only(r).departure.method,'off-route-projection');
});
test('small spatial noise and different sampling density tolerate lane variation and dwells',()=>{
  const noisy=path.map(([lat,lon],i)=>[lat+(i>0&&i<4?.00008:0),lon+.00005]);
  assert.equal(only(run({paths:[path,noisy]})).status,'confirmed');
  const a=[[-79.404,43.65],[-79.404,43.652],[-79.4,43.652]];
  assert.ok(corridorDistance(a,[a[0],a[0],[-79.404,43.651],a[1],[-79.402,43.652],a[2]])<45);
});
test('opposite direction and different pattern/branch never merge',()=>{
  const e=run({paths:[path]}).state.episodes[0];
  for (const change of [{directionId:1},{patternId:'other-branch'},{routeId:'other-route'}]) assert.equal(trajectorySimilarity(e,{...e,...change}),Infinity);
});
test('different corridors remain independent simultaneous clusters and material change gets new identity',()=>{
  const south=path.map(([lat,lon])=>[43.65-(lat-43.65),lon]);
  const r=run({paths:[path,path,south,south]});assert.equal(r.output.diversions.length,2);assert.ok(r.output.diversions.every(d=>d.status==='confirmed'));
  assert.notEqual(r.output.diversions[0].id,r.output.diversions[1].id);
  const northOnly=run();const changed=run({paths:[south,south],start:210,previous:northOnly.state,detector:northOnly.vehicles});
  assert.equal(changed.output.diversions.length,2);assert.ok(changed.output.diversions.some(d=>d.id===only(northOnly).id));
});
test('different departure/rejoin regions and reversed travel order are incompatible',()=>{
  const e=run({paths:[path]}).state.episodes[0];
  for (const boundary of ['departure','rejoin']) assert.equal(trajectorySimilarity(e,{...e,[boundary]:{...e[boundary],progressMeters:e[boundary].progressMeters+200}}),Infinity);
  const a=[[-79.4,43.65],[-79.4,43.652],[-79.396,43.652]];assert.ok(corridorDistance(a,[...a].reverse())>100);
});
test('GPS outlier is rejected by 30D and never distorts inference',()=>{
  const p=[path[0],path[1],[44,-79],path[2],path[3],...path.slice(4)];
  const r=run({paths:[p,p]});assert.equal(only(r).status,'confirmed');assert.ok(r.state.episodes.every(e=>e.points.every(p=>p.latitude<44)));
});
test('conservative simplification keeps turns/endpoints and never increases tolerance to force a size limit',()=>{
  const p=[[-79.404,43.65],[-79.404,43.651],[-79.404,43.652],[-79.402,43.652],[-79.4,43.652],[-79.4,43.65]];
  const s=simplifyGeometry(p,8);assert.equal(s.length,4);assert.deepEqual(s,[p[0],p[2],p[4],p[5]]);
  assert.throws(()=>simplifyGeometry(p,100));
});
test('stable ID survives additional slightly noisy evidence and geometry refinement',()=>{
  const r=run();const noisy=path.map(([lat,lon])=>[lat,lon+.00005]);
  const updated=run({paths:[noisy,noisy],start:210,previous:r.state,detector:r.vehicles});
  assert.equal(only(updated).id,only(r).id);assert.equal(only(updated).evidence.trajectoryCount,4);
});
test('stale evidence expires with injected time; unavailable feed suppresses output and cannot add paths',()=>{
  const r=run();const failed=inferDiversions(r.state,{...empty(210),status:'unavailable'},index,at(210));
  assert.deepEqual(failed.output.diversions,[]);assert.equal(failed.state.episodes.length,2);
  const expired=inferDiversions(failed.state,empty(2100),index,at(2100));assert.equal(expired.output.diversions.length,0);assert.equal(expired.state.episodes.length,0);assert.equal(expired.report.expiredClusters,1);
});
test('route reassignment, gap and static version cannot join episodes or invent rejoin',()=>{
  const r=run({paths:[path.slice(0,4)]});
  // The gap must exceed the cadence-aware maxGapMs to be treated as discontinuous.
  const shifted=run({paths:[path],start:90+VEHICLE_POLICY.maxGapMs/1000+30,previous:r.state,detector:r.vehicles});
  assert.equal(shifted.state.episodes.length,2);assert.equal(shifted.state.episodes.filter(e=>e.completed).length,1);
  const v={...empty(240),staticVersion:'changed'};const next=inferDiversions(r.state,v,{...index,version:'changed'},at(240));assert.equal(next.state.episodes.length,0);
});
async function alerts() {
  const bytes=bindings.transit_realtime.FeedMessage.encode({header:{gtfsRealtimeVersion:'2.0',timestamp:+at(0)/1000},entity:[{id:'detour',alert:{effect:4,cause:3,informedEntity:[{routeId:'0504',trip:{tripId:'t1'},stopId:'A'},{routeId:'0504',trip:{tripId:'t1'},stopId:'D'}]}}]}).finish();
  return correlateState(await updateTtcAlerts(undefined,at(0),async()=>parseTtcAlerts(bytes,at(0)),()=>{}),index,at(0));
}
test('end-to-end protobuf alerts/lifecycle/static/vehicle detection/inference/compact artifact and GeoJSON',async()=>{
  const before=JSON.stringify([...index.shapes]);const a=await alerts();const r=run({alerts:a});const d=only(r);
  assert.equal(d.status,'confirmed');assert.deepEqual(d.relatedAlertIds,['detour']);assert.equal(d.confidence.alertSupported,true);
  assert.equal(d.evidence.vehicleCount,2);assert.equal(JSON.stringify([...index.shapes]),before);
  assert.ok(d.rejoin.progressMeters>d.departure.progressMeters);assert.equal(d.geometrySource,'sirento-observed');
  const kinds=new Set(diversionGeoJson(r.state,index).features.map(f=>f.properties.kind));
  assert.deepEqual(kinds,new Set(['inferred-diversion','scheduled-route','scheduled-affected-segment','departure','rejoin','trajectory']));
});
test('alert must be active, scoped and overlap; no alert never invents cause',async()=>{
  const a=await alerts();
  for (const change of [s=>s.status='unavailable',s=>s.items[0].activePeriods=[{end:at(-1).toISOString()}],s=>s.items[0].correlation.status='ambiguous',s=>s.items[0].correlation.candidates[0].affectedSegment.geometry=[[-79.41,43.65],[-79.409,43.65]]]) {
    const copy=structuredClone(a);change(copy);assert.deepEqual(only(run({alerts:copy})).relatedAlertIds,[]);
  }
  const d=only(run());assert.deepEqual(d.relatedAlertIds,[]);assert.equal(d.cause,undefined);assert.equal(d.status,'confirmed');
});
test('compact and restart schema reject corrupt coordinates, counts, confidence, references, ordering and bounds',()=>{
  const r=run();
  for (const mutate of [d=>d.geometry=[[0,100],[0,0]],d=>d.geometry=[[0,0]],d=>d.geometry=Array(123).fill([0,0]),d=>d.evidence.vehicleCount=-1,d=>d.evidence.completedVehicleCount=0,d=>d.status='official',d=>d.patternId='bad',d=>d.rejoin.progressMeters=0,d=>d.geometrySource='ttc-official']) {
    const o=structuredClone(r.output);mutate(o.diversions[0]);assert.throws(()=>validateDiversionOutput(o,index));
  }
  for (const mutate of [s=>s.episodes[0].points[0].latitude=100,s=>s.episodes[0].points=Array(121).fill(s.episodes[0].points[0]),s=>s.records[0].episodeIds=['missing'],s=>s.episodes[0].points[1].observedAt=s.episodes[0].points[0].observedAt]) {
    const s=structuredClone(r.state);mutate(s);assert.throws(()=>validateDiversionState(s,index));
  }
});
test('point/time bounds mark long episodes unusable instead of creating shortcuts',()=>{
  const long=Array.from({length:130},(_,i)=>i===0?path[0]:[43.652,-79.403+(i%10)*.0002]);
  const r=run({paths:[long],step:10});assert.ok(r.state.episodes.length>0);assert.ok(r.state.episodes.every(e=>e.points.length<=DIVERSION_POLICY.maxPoints));assert.equal(r.output.diversions.length,0);
});
test('cluster and episode capacity is explicit and deterministic',()=>{
  const base=run({paths:[path]}).state.episodes[0];
  const many=Array.from({length:510},(_,i)=>({...structuredClone(base),id:`episode-${i}`,vehicleId:`vehicle-${i}`}));
  // Oversized persisted inputs are rejected before inference.
  assert.throws(()=>fromEpisodes(many));
  const r=fromEpisodes(many.slice(0,500));assert.ok(r.state.records.length<=12);assert.ok(r.state.records.every(c=>c.evidence.trajectoryCount<=24));
});
test('polling persists inference between invocations; cold fallback never fabricates complete evidence; static failure clears exports',async()=>{
  const dir=await mkdtemp(`${tmpdir()}/ttc-diversions-`);
  try {
    const fixture=path.map((p,i)=>({now:at(i*30).toISOString(),protobufBase64:Buffer.from(protobuf([0,1].map(j=>vehicle(i*30,{vehicle:{id:String(j)},position:{latitude:p[0],longitude:p[1]}})),i*30)).toString('base64')}));
    const options={statePath:`${dir}/vehicles.json`,outputPath:`${dir}/deviations.json`,geoJsonPath:`${dir}/geometry.geojson`,loadStatic:async()=>({index}),log:()=>{},wait:async()=>{},clock:()=>at(0)};
    await runVehiclePolling({...options,polls:4,fixture:fixture.slice(0,4)});
    let out=JSON.parse(await readFile(`${dir}/diversions.json`));assert.equal(out.diversions[0].status,'likely');
    await runVehiclePolling({...options,polls:3,fixture:fixture.slice(4)});
    out=JSON.parse(await readFile(`${dir}/diversions.json`));assert.equal(out.diversions[0].status,'confirmed');
    assert.ok(JSON.parse(await readFile(`${dir}/geometry.geojson`)).features.length>0);
    await runVehiclePolling({...options,inferOnly:true,clock:()=>at(180),refresh:assert.fail});
    assert.equal(JSON.parse(await readFile(`${dir}/diversions.json`)).diversions[0].evidence.trajectoryCount,2);
    await runVehiclePolling({...options,inferOnly:true,clock:()=>at(500)});
    assert.equal(JSON.parse(await readFile(`${dir}/diversions.json`)).status,'unavailable');
    await runVehiclePolling({...options,loadStatic:async()=>{throw new Error('offline');}});
    out=JSON.parse(await readFile(`${dir}/diversions.json`));assert.equal(out.status,'unavailable');assert.deepEqual(out.diversions,[]);
  } finally {await rm(dir,{recursive:true,force:true});}
});
test('ended alert shortens stale lifetime across refreshes without resurrection',async()=>{
  const r=run({alerts:await alerts()});
  let s=r.state;
  for (const seconds of [240,480,780,810]) {
    const next=inferDiversions(s,empty(seconds),index,at(seconds),{status:'ok',items:[]});s=next.state;
    assert.equal(next.output.diversions.length,seconds<780?1:0);
  }
});
test('three observed scheduled traversals retire old support; one vehicle rejoining does not',()=>{
  const r=run();const template=r.vehicles.tracks[0];
  const tracks=Array.from({length:3},(_,i)=>({...structuredClone(template),vehicleId:`returned-${i}`,lastObservedAt:at(240).toISOString(),history:[
    {...template.history[0],observedAt:at(180).toISOString(),evidence:'on',progressMeters:100,longitude:-79.408},
    {...template.history.at(-1),observedAt:at(210).toISOString(),evidence:'on',progressMeters:1100,longitude:-79.396},
    {...template.history.at(-1),observedAt:at(240).toISOString(),evidence:'on',progressMeters:2200,longitude:-79.382}
  ]}));
  let state=inferDiversions(r.state,{...empty(240),tracks},index,at(240)).state;
  assert.equal(state.records.length,1);
  const expired=inferDiversions(state,empty(420),index,at(420));assert.equal(expired.output.diversions.length,0);
  state=inferDiversions(expired.state,empty(450),index,at(450)).state;assert.equal(state.records.length,0);
});
test('ambiguous shared-prefix incomplete trajectory cannot vote for either divergent completed cluster',()=>{
  const north=run({paths:[path]}).state.episodes[0];
  const variant=structuredClone(north);variant.id='variant';variant.vehicleId='variant';
  variant.points[2].latitude+=.004;
  const prefix=structuredClone(north);prefix.id='prefix';prefix.vehicleId='prefix';prefix.completed=false;delete prefix.rejoin;delete prefix.endedAt;
  prefix.points=prefix.points.slice(0,1); // add nearby distinct accepted samples for minimum trajectory size
  prefix.points.push({...prefix.points[0],observedAt:at(60).toISOString(),longitude:prefix.points[0].longitude+.00001});
  prefix.points.push({...prefix.points[1],observedAt:at(90).toISOString(),longitude:prefix.points[1].longitude+.00001});
  const r=fromEpisodes([north,variant,prefix]);assert.equal(r.output.diversions.length,2);assert.ok(r.output.diversions.every(d=>d.evidence.trajectoryCount===1));
});
test('restart rejects overlapping completed episodes from the same vehicle',()=>{
  const r=run({paths:[path]});const e=structuredClone(r.state.episodes[0]);e.id='forged-independent-episode';
  assert.throws(()=>fromEpisodes([...r.state.episodes,e]));
});
test('confirmation count cannot be forged in restart state',()=>{
  const r=run();r.state.records[0].evidence.trajectoryCount=3;r.state.records[0].episodeIds.push('fake');
  assert.throws(()=>validateDiversionState(r.state,index));
});
test('comparison geometry budget rejects oversized corridors without crashing or shortcutting',()=>{
  const oscillating=[path[0],...Array.from({length:50},(_,i)=>[i%2?43.652:43.654,-79.402])];
  const r=run({paths:[oscillating]});assert.equal(r.output.diversions.length,0);assert.ok(r.report.geometryRejected>0);
});

test('public geometry CLI publishes only confirmed allow-listed paths and replaces stale output with empty state',async()=>{
  const {publicTtcGeometry}=await import('../scripts/publish-ttc-geometry.js');
  const {execFileSync}=await import('node:child_process');
  const {writeFile}=await import('node:fs/promises');
  const dir=await mkdtemp(`${tmpdir()}/ttc-public-`);
  try {
    const r=run();delete r.output.diversions[0].expiresAt;
    const projected=publicTtcGeometry(r.output);assert.equal(projected.diversions.length,1);
    assert.equal(Date.parse(projected.diversions[0].expiresAt),Date.parse(projected.diversions[0].lastObservedAt)+1800000);
    assert.deepEqual(publicTtcGeometry(run({paths:[path]}).output).diversions,[]);
    for(const output of [r.output,{...r.output,status:'unavailable',diversions:[]},{...r.output,diversions:[]}]) {
      await writeFile(`${dir}/input.json`,JSON.stringify(output));
      execFileSync(process.execPath,['scripts/publish-ttc-geometry.js',`${dir}/input.json`,`${dir}/public/data.json`]);
      const saved=JSON.parse(await readFile(`${dir}/public/data.json`));assert.equal(saved.diversions.length,output.diversions.length);
      assert.doesNotMatch(JSON.stringify(saved),/vehicleId|episodeIds|rawEvidence|confidence|identityAnchor/);
    }
  } finally {await rm(dir,{recursive:true,force:true});}
});
test('scheduled segment retains intermediate vertices and simplification handles closed paths',async()=>{
  const {scheduledSegment}=await import('../src/ttc/diversion-geometry.js');
  const shape=[[0,43,-79],[1,43.1,-79.1],[2,43.2,-79.2]];
  assert.deepEqual(scheduledSegment(shape,{point:[-79,43],progressMeters:0,segmentIndex:0},{point:[-79.2,43.2],progressMeters:100,segmentIndex:1}),[[-79,43],[-79.1,43.1],[-79.2,43.2]]);
  const closed=[[-79,43],[-79.001,43.001],[-79,43]];assert.deepEqual(simplifyGeometry(closed),closed);
});

test('unequal vehicle journeys do not invent missing observations',()=>{
  const r=run({paths:[path,path.slice(0,4)]});assert.equal(only(r).status,'likely');assert.equal(only(r).evidence.completedVehicleCount,1);
});
test('inference schema rejects invalid headers, boundary projection, scheduled segment and forged members',()=>{
  const r=run();
  for(const mutate of [o=>o.schemaVersion=2,o=>o.diversions[0].departure.segmentFraction=NaN,o=>o.diversions[0].scheduledAffectedSegment.shapeId='other',o=>o.diversions[0].geometry[0]=[-79.5,43.65],o=>o.diversions=Array.from({length:13},(_,i)=>({...o.diversions[0],id:`path-${i}`}))]) {
    const bad=structuredClone(r.output);mutate(bad);assert.throws(()=>validateDiversionOutput(bad,index),/diversion output/);
  }
  const bad=structuredClone(r.state);bad.episodes[0].vehicleId='same';bad.episodes[1].vehicleId='same';assert.throws(()=>validateDiversionState(bad,index),/diversion state/);
});
test('legacy output without retirement TTL gets bounded expiry',async()=>{
  const {diversionOutput}=await import('../src/ttc/diversion-inference.js');const r=run();delete r.state.records[0].retirementMs;
  assert.equal(Date.parse(diversionOutput(r.state).diversions[0].expiresAt),Date.parse(only(r).lastObservedAt)+DIVERSION_POLICY.evidenceMs);
});
test('ambiguous departure and stale vehicle history cannot become observed geometry',async()=>{
  const {collectEpisodes}=await import('../src/ttc/diversion-inference.js');
  const r=run({paths:[path.slice(0,4)]}),vehicles=structuredClone(r.vehicles);
  vehicles.tracks[0].history.forEach(h=>h.projectionAmbiguous=true);
  delete vehicles.tracks[0].tripId;
  const episodes=collectEpisodes(undefined,vehicles,at(90));assert.equal(episodes[0].departure,null);assert.equal(episodes[0].tripId,undefined);
  assert.deepEqual(collectEpisodes(undefined,vehicles,at(211)),[]);
});
test('related construction alert still requires supported pattern and projected affected segment',async()=>{
  const a=await alerts();
  for(const change of [s=>{s.items[0].effect='OTHER_EFFECT';s.items[0].cause='CONSTRUCTION';},s=>s.items[0].correlation.candidates[0].affectedSegment.geometryStatus='missing',s=>s.items[0].informedEntities.forEach(e=>e.trip.directionId=1)]) {
    const copy=structuredClone(a);change(copy);const d=only(run({alerts:copy}));
    assert.deepEqual(d.relatedAlertIds,copy.items[0].effect==='OTHER_EFFECT'?['detour']:[]);
  }
});
test('multiple prior identities merge deterministically into the oldest supported path',()=>{
  const r=run(),copy=structuredClone(r.state.records[0]);copy.id='other-id';
  r.state.records.push(copy);
  const merged=inferDiversions(r.state,r.vehicles,index,at(180));assert.equal(merged.output.diversions.length,1);assert.equal(merged.report.clustersMerged,1);
});

test('confirmed detector history can initialize inference without a prior inference cache',()=>{
  const r=run({paths:[path.slice(0,4),path.slice(0,4)]});
  const cold=inferDiversions(undefined,r.vehicles,index,at(90));assert.equal(only(cold).status,'likely');assert.equal(cold.report.clustersCreated,1);
});
test('lost departure history and discontinuous restored evidence fail safely',async()=>{
  const {collectEpisodes}=await import('../src/ttc/diversion-inference.js');
  const r=run({paths:[path.slice(0,4)]}),vehicles=structuredClone(r.vehicles);
  vehicles.tracks[0].history.forEach(h=>h.evidence='neutral');
  assert.deepEqual(collectEpisodes(undefined,vehicles,at(90)),[]);
  const old=structuredClone(r.state.episodes[0]);old.points=old.points.slice(0,1);old.lastObservedAt=old.points[0].observedAt;
  old.points[0].latitude=44;
  const truncated=collectEpisodes([old],r.vehicles,at(90));assert.equal(truncated[0].truncated,true);
});
test('unrelated official selector cannot lend confidence to an inferred path',async()=>{
  const a=await alerts();a.items[0].informedEntities.forEach(e=>e.trip.tripId='different-trip');
  const d=only(run({alerts:a}));assert.deepEqual(d.relatedAlertIds,[]);assert.equal(d.confidence.alertSupported,false);
});
test('thirteen independent route branches enforce the twelve-cluster publication bound',()=>{
  const base=run({paths:[path]}).state.episodes[0],idx={...index,patterns:new Map(index.patterns)};
  const episodes=Array.from({length:13},(_,i)=>{
    const patternId=`branch-${i}`;idx.patterns.set(patternId,{...index.patterns.get(base.patternId),patternId});
    return {...structuredClone(base),id:`episode-${i}`,vehicleId:`vehicle-${i}`,patternId};
  });
  const previous={schemaVersion:1,staticVersion:index.version,status:'ok',checkedAt:at(180).toISOString(),episodes,records:[]};
  const r=inferDiversions(previous,empty(180),idx,at(180));assert.equal(r.output.diversions.length,12);assert.equal(r.report.capacityDropped,1);
});
test('three complete but unanchored episodes from one vehicle remain likely, never confirmed',()=>{
  const base=run({paths:[path]}).state.episodes[0];
  const episodes=Array.from({length:3},(_,i)=>{
    const e=structuredClone(base),shift=i*210000;
    e.id=`episode-${i}`;e.departure.method='off-route-projection';
    for(const k of ['startedAt','lastObservedAt','lastOffAt','endedAt']) e[k]=new Date(Date.parse(e[k])+shift).toISOString();
    for(const p of [...e.points,...e.departure.rawEvidence,...e.rejoin.rawEvidence]) p.observedAt=new Date(Date.parse(p.observedAt)+shift).toISOString();
    return e;
  });
  const r=fromEpisodes(episodes,600);assert.equal(only(r).status,'likely');assert.equal(only(r).evidence.completedTrajectoryCount,3);assert.equal(only(r).evidence.anchoredCompletedCount,0);
});

test('newly ambiguous static correlation withdraws alert support from retained vehicle evidence',async()=>{
  const a=await alerts(),r=run({alerts:a});a.items[0].correlation.status='ambiguous';
  const next=inferDiversions(r.state,r.vehicles,index,at(180),a);
  assert.equal(only(next).status,'confirmed');assert.deepEqual(only(next).relatedAlertIds,[]);assert.equal(only(next).confidence.alertSupported,false);
});
