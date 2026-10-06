import { digest, validCoordinate } from './static-gtfs.js';
import { validateVehicleState, VEHICLE_POLICY } from './vehicle-detector.js';
import { isAlertActive } from './lifecycle.js';
import { compileShape, projectVehicle, geographicDistance } from './vehicle-geometry.js';
import { coordinate, distance, corridorDistance, simplifyGeometry, scheduledSegment } from './diversion-geometry.js';
import { validateOfficialAdvisories } from './official-advisories.js';

export const DIVERSION_POLICY=Object.freeze({maxEpisodes:500,maxPoints:120,maxClustersPerRoute:12,maxClusters:200,
  maxMembers:24,maxGeometryPoints:122,evidenceMs:1800000,maxEpisodeMs:1800000,endpointMeters:150,corridorMeters:100,
  simplificationMeters:8,maxArtifactBytes:16*1024*1024,returnedMs:300000,endedAlertMs:600000});
const iso=s=>typeof s==='string'&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString()===s;
const id=s=>typeof s==='string'&&s.length>0;
const integer=n=>Number.isInteger(n)&&n>=0;
const coord=p=>Array.isArray(p)&&p.length===2&&validCoordinate(p[1],p[0]);
const key=e=>JSON.stringify([e.routeId,e.directionId,e.patternId,e.shapeId]);
const episodeId=(version,t)=>digest(JSON.stringify([version,t.vehicleId,t.assignment,t.patternId,t.deviationStartedAt]));
const last=a=>a.at(-1);
const raw=p=>({observedAt:p.observedAt,latitude:p.latitude,longitude:p.longitude,distanceFromShapeMeters:p.distanceFromShapeMeters});
function boundary(on,off) {
  const p=on||off;
  if (!p||p.projectionAmbiguous) return null;
  return {point:p.projectedPoint,progressMeters:p.progressMeters,segmentIndex:p.segmentIndex,segmentFraction:p.segmentFraction,
    method:on?'on-route-projection':'off-route-projection',uncertaintyMeters:on?Math.max(50,geographicDistance(on,off)):Math.max(150,off.distanceFromShapeMeters),
    rawEvidence:[...(on?[raw(on)]:[]),raw(off)]};
}
const usable=e=>e.confirmed&&!e.truncated&&e.departure&&e.points.length>=3;
const episodeGeometry=e=>[e.departure.point,...e.points.map(coordinate),...(e.rejoin?[e.rejoin.point]:[])];

/** Capture only Story 30D's accepted history and transitions, never classify GPS anew. */
export function collectEpisodes(previous,vehicles,now,report) {
  const prior=(previous||[]);
  const episodes=new Map(prior.filter(e=>+now-Date.parse(e.lastObservedAt)<=DIVERSION_POLICY.evidenceMs).map(e=>[e.id,structuredClone(e)]));
  if (report) { report.episodesLoaded=prior.length; report.episodesExpired=prior.length-episodes.size; }
  if (vehicles.status==='ok') for (const t of vehicles.tracks) {
    if (+now-Date.parse(t.lastObservedAt)>120000) continue;
    const eid=t.deviationStartedAt?episodeId(vehicles.staticVersion,t):null;
    let e=eid?episodes.get(eid):[...episodes.values()].find(v=>v.vehicleId===t.vehicleId&&v.assignment===t.assignment&&v.patternId===t.patternId&&!v.closed);
    if (!e && eid) {
      const off=t.history.find(h=>h.observedAt>=t.deviationStartedAt&&h.evidence==='off');
      if (!off||+now-Date.parse(t.deviationStartedAt)>DIVERSION_POLICY.maxEpisodeMs) continue;
      const on=t.history.filter(h=>h.observedAt<off.observedAt&&h.evidence==='on').at(-1);
      e={id:eid,vehicleId:t.vehicleId,assignment:t.assignment,routeId:t.routeId,directionId:t.directionId,patternId:t.patternId,shapeId:t.shapeId,
        ...(t.tripId?{tripId:t.tripId}:{}),startedAt:t.deviationStartedAt,lastObservedAt:off.observedAt,lastOffAt:off.observedAt,
        confirmed:false,completed:false,closed:false,truncated:false,departure:boundary(on,off),points:[],relatedAlertIds:[]};
      episodes.set(e.id,e);
      if (report) report.episodesCreated++;
    }
    if (!e||e.closed) continue;
    const fresh=t.history.filter(h=>h.observedAt>=e.startedAt&&(!e.points.length||h.observedAt>e.lastObservedAt));
    // A reset or missed recovery must never stitch discontinuous history together.
    if ((fresh.length&&e.points.length&&Date.parse(fresh[0].observedAt)-Date.parse(e.lastObservedAt)>VEHICLE_POLICY.maxGapMs)||t.assignment!==e.assignment) { e.closed=true; continue; }
    for (const h of fresh) {
      const p=last(e.points);
      if (p&&geographicDistance(p,h)>100+40*(Date.parse(h.observedAt)-Date.parse(p.observedAt))/1000) { e.truncated=true; break; }
      if (e.points.length>=DIVERSION_POLICY.maxPoints||Date.parse(h.observedAt)-Date.parse(e.startedAt)>DIVERSION_POLICY.maxEpisodeMs) { e.truncated=true;e.closed=true;break; }
      e.points.push(structuredClone(h));e.lastObservedAt=h.observedAt;
      if (h.evidence==='off') e.lastOffAt=h.observedAt;
    }
    e.confirmed ||= ['confirmed','rejoining'].includes(t.state);
    e.relatedAlertIds=t.relatedAlertIds;
    if (t.state==='on-route') {
      const recovery=[];
      for (let i=e.points.length-1;i>=0&&e.points[i].evidence==='on';i--) recovery.unshift(e.points[i]);
      const off=e.points.filter(h=>h.observedAt<recovery[0]?.observedAt&&h.evidence!=='on').at(-1);
      if (e.confirmed&&recovery.length>=3&&Date.parse(last(recovery).observedAt)-Date.parse(recovery[0].observedAt)>=60000&&off) {
        const rejoin=boundary(recovery[0],off);
        if (rejoin&&e.departure&&rejoin.progressMeters>e.departure.progressMeters) {
          e.rejoin=rejoin;e.completed=true;e.endedAt=recovery[0].observedAt;
          e.points=e.points.filter(p=>p.observedAt<=e.endedAt);
        }
      }
      e.closed=true;
    }
  }
  // Close orphaned evidence, but retain it as explicitly incomplete until expiry.
  for (const e of episodes.values()) {
    const t=vehicles.tracks.find(t=>t.vehicleId===e.vehicleId);
    if (!t||t.assignment!==e.assignment||t.patternId!==e.patternId||
      (t.deviationStartedAt&&episodeId(vehicles.staticVersion,t)!==e.id)||+now-Date.parse(e.lastObservedAt)>VEHICLE_POLICY.maxGapMs) e.closed=true;
  }
  let bytes=0;
  return [...episodes.values()].sort((a,b)=>b.lastObservedAt.localeCompare(a.lastObservedAt)||a.id.localeCompare(b.id)).slice(0,DIVERSION_POLICY.maxEpisodes).filter(e=>{
    bytes+=Buffer.byteLength(JSON.stringify(e));return bytes<=DIVERSION_POLICY.maxArtifactBytes/2;
  });
}

export function trajectorySimilarity(a,b) {
  if (key(a)!==key(b)||!a.departure||!b.departure||Math.abs(a.departure.progressMeters-b.departure.progressMeters)>DIVERSION_POLICY.endpointMeters||
    (a.rejoin&&b.rejoin&&Math.abs(a.rejoin.progressMeters-b.rejoin.progressMeters)>DIVERSION_POLICY.endpointMeters)) return Infinity;
  return corridorDistance(a.geometry||episodeGeometry(a),b.geometry||episodeGeometry(b),!a.rejoin,!b.rejoin);
}
function alertSupport(group,alerts,index,now) {
  if (alerts?.status!=='ok') return [];
  const e=group[0], end=Math.max(...group.map(v=>v.rejoin?.progressMeters??v.points.at(-1).progressMeters));
  const start=Math.min(...group.map(v=>v.departure.progressMeters));
  const geometry=compileShape(index.shapes.get(e.shapeId));
  return alerts.items.filter(a=>{
    if (!isAlertActive(a,now)||!a.routes.includes(e.routeId)||!(a.effect==='DETOUR'||a.cause==='CONSTRUCTION')) return false;
    // 30D has already checked selector/trip/direction scope against safe joins.
    if (!group.some(v=>v.relatedAlertIds.includes(a.id))) return false;
    if (a.correlation?.status!=='exact') return false;
    const s=a.correlation.candidates.find(c=>c.patternId===e.patternId)?.affectedSegment;
    if (s?.geometryStatus!=='projected') return false;
    const projections=s.geometry.map(p=>projectVehicle({longitude:p[0],latitude:p[1]},geometry));
    return projections.every(p=>p&&!p.projectionAmbiguous)&&Math.max(...projections.map(p=>p.progressMeters))>=start&&Math.min(...projections.map(p=>p.progressMeters))<=end;
  }).map(a=>a.id).sort();
}
// Story 51C: associate independently observed trajectories with active official
// Service Changes using structured route/time evidence only. The observed pattern
// and GTFS directionId remain the authority for the path direction; website prose
// ("eastbound", "both ways") is never converted into a direction id and never
// generates geometry. When more than one active, route-compatible advisory is
// indistinguishable, no advisory relationship is claimed.
const ADVISORY_DETOUR_EFFECTS=new Set(['DETOUR','MODIFIED SERVICE']);
function advisorySupport(group,advisories,now) {
  if (advisories?.status!=='ok') return {refs:[],ambiguous:false};
  const routeId=group[0].routeId;
  const candidates=advisories.advisories.filter(a=>{
    if (!a.routeIds.includes(routeId)||!ADVISORY_DETOUR_EFFECTS.has(a.effect)) return false;
    // Half-open active periods; absent bounds are unlimited. An advisory with no
    // periods is treated as active, matching the GTFS-RT lifecycle semantics.
    return !a.activePeriods.length||a.activePeriods.some(p=>(!p.start||Date.parse(p.start)<=+now)&&(!p.end||+now<Date.parse(p.end)));
  }).map(a=>a.ref).sort();
  // Two or more indistinguishable same-route advisories cannot be safely claimed.
  if (candidates.length>1) return {refs:[],ambiguous:true};
  return {refs:candidates,ambiguous:false};
}
function confidence(group,related,advisory) {
  const completed=group.filter(e=>e.completed&&e.departure.method==='on-route-projection');
  const vehicles=new Set(group.map(e=>e.vehicleId)).size;
  const completedVehicles=new Set(completed.map(e=>e.vehicleId)).size;
  const confirmed=completedVehicles>=2||completed.length>=3;
  const likely=vehicles>=2||group.filter(e=>e.completed).length>=3;
  return {status:confirmed?'confirmed':likely?'likely':'candidate',rule:confirmed?'two-completed-vehicles-or-three-completed-episodes':likely?'repeated-incomplete-evidence':'insufficient-independent-evidence',
    alertSupported:related.length>0,advisorySupported:advisory.refs.length>0};
}
function representative(group) {
  const anchored=group.filter(e=>e.completed&&e.departure.method==='on-route-projection');
  const pool=anchored.length?anchored:group.some(e=>e.completed)?group.filter(e=>e.completed):group;
  // Observed medoid avoids averaging corners into unobserved shortcuts.
  return pool.map(e=>({e,score:pool.reduce((n,p)=>n+trajectorySimilarity(e,p),0)})).sort((a,b)=>a.score-b.score||a.e.id.localeCompare(b.e.id))[0].e;
}
function anchor(e) { return {routeId:e.routeId,directionId:e.directionId,patternId:e.patternId,shapeId:e.shapeId,departure:e.departure,...(e.rejoin?{rejoin:e.rejoin}:{}),geometry:episodeGeometry(e)}; }

export function inferDiversions(previous,vehicles,index,now,alerts,{simplificationMeters=DIVERSION_POLICY.simplificationMeters,advisories}={}) {
  const started=performance.now();validateVehicleState(vehicles,index);
  // Story 51C: official advisory context is validated, counted, and associated
  // with observed trajectories through structured route/time evidence only.
  if (advisories) validateOfficialAdvisories(advisories);
  if (previous) validateDiversionState(previous,previous.staticVersion===index.version?index:undefined);
  if (previous?.staticVersion!==index.version) previous=undefined;
  const report={clustersCreated:0,clustersMerged:0,clustersSplit:0,expiredClusters:0,geometryUpdates:0,capacityDropped:0,geometryRejected:0,
    officialAdvisories:advisories?.advisories?.length||0,
    // Bounded episode lifecycle diagnostics: loaded/created/closed/expired/retained.
    episodesLoaded:0,episodesCreated:0,episodesClosed:0,episodesExpired:0,episodesRetained:0,
    advisoryAssociated:0,advisoryAmbiguous:0};
  const episodes=collectEpisodes(previous?.episodes,vehicles,now,report);
  Object.assign(report,{episodesReceived:episodes.filter(e=>e.confirmed).length,completedTrajectories:episodes.filter(e=>e.completed).length,
    incompleteTrajectories:episodes.filter(e=>e.confirmed&&!e.completed).length});
  const groups=[],buckets=new Map(),routeCounts=new Map();
  const candidates=episodes.filter(usable).filter(e=>{
    if (Number.isFinite(trajectorySimilarity(e,e))) return true;
    report.geometryRejected++;return false;
  }).sort((a,b)=>Number(b.completed)-Number(a.completed)||a.startedAt.localeCompare(b.startedAt)||a.id.localeCompare(b.id));
  // Route/pattern/direction + adjacent 150 m departure bins bound comparisons.
  for (const e of candidates) {
    const bin=Math.floor(e.departure.progressMeters/DIVERSION_POLICY.endpointMeters),prefix=key(e);
    const plausible=[-1,0,1].flatMap(d=>buckets.get(`${prefix}:${bin+d}`)||[]);
    const matches=plausible.filter(g=>g.every(p=>trajectorySimilarity(e,p)<=DIVERSION_POLICY.corridorMeters));
    // An incomplete shared prefix is not evidence for either of two divergent paths.
    if (matches.length>1&&!e.completed) { report.capacityDropped++;continue; }
    if (matches.length) { if (matches[0].length<DIVERSION_POLICY.maxMembers) matches[0].push(e);else report.capacityDropped++;continue; }
    if ((routeCounts.get(e.routeId)||0)>=DIVERSION_POLICY.maxClustersPerRoute||groups.length>=DIVERSION_POLICY.maxClusters) { report.capacityDropped++;continue; }
    const g=[e];groups.push(g);routeCounts.set(e.routeId,(routeCounts.get(e.routeId)||0)+1);
    const k=`${prefix}:${bin}`;if (!buckets.has(k)) buckets.set(k,[]);buckets.get(k).push(g);
  }
  const used=new Set(),retired=new Set(),records=[],similarities=[],advisoryAmbiguous=new Set();
  for (const group of groups) {
    const rep=representative(group),related=alertSupport(group,alerts,index,now),advisory=advisorySupport(group,advisories,now),c=confidence(group,related,advisory);
    if (advisory.ambiguous) { advisoryAmbiguous.add(rep.routeId); report.advisoryAmbiguous++; }
    else if (advisory.refs.length) report.advisoryAssociated++;
    const old=(previous?.records||[]).filter(r=>!used.has(r.id)&&trajectorySimilarity(anchor(rep),r.identityAnchor)<=DIVERSION_POLICY.corridorMeters)
      .sort((a,b)=>a.firstObservedAt.localeCompare(b.firstObservedAt)||a.id.localeCompare(b.id))[0];
    const firstObservedAt=old?.firstObservedAt||group.map(e=>e.startedAt).sort()[0];
    const lastObservedAt=group.map(e=>e.lastOffAt).sort().at(-1);
    const returns=vehicles.tracks.filter(t=>{
      if (key(t)!==key(rep)||t.state!=='on-route'||!rep.rejoin) return false;
      const run=[];
      for (let i=t.history.length-1;i>=0;i--) {
        const h=t.history[i];
        if (h.evidence!=='on'||h.projectionAmbiguous||h.observedAt<=lastObservedAt) break;
        run.unshift(h);
      }
      return run.length>=3&&Date.parse(last(run).observedAt)-Date.parse(run[0].observedAt)>=60000&&
        run[0].progressMeters<=rep.departure.progressMeters&&last(run).progressMeters>=rep.rejoin.progressMeters&&
        run.every((h,i)=>!i||h.progressMeters>=run[i-1].progressMeters);
    }).length;
    const endedAlert=old?.confidence.alertSupported&&alerts?.status==='ok'&&!related.length;
    const currentExpiry=returns>=3?DIVERSION_POLICY.returnedMs:endedAlert?DIVERSION_POLICY.endedAlertMs:DIVERSION_POLICY.evidenceMs;
    // Remember cessation evidence while this same last supporting observation ages.
    // Fresh supporting movement or renewed alert support can reset the shorter TTL.
    const expiry=old?.lastObservedAt===lastObservedAt&&!related.length?Math.min(old.retirementMs,currentExpiry):currentExpiry;
    if (+now-Date.parse(lastObservedAt)>expiry) { for (const e of group) retired.add(e.id);continue; }
    const geometry=simplifyGeometry(episodeGeometry(rep),simplificationMeters);
    const scheduled=scheduledSegment(index.shapes.get(rep.shapeId),rep.departure,rep.rejoin);
    // At most maxPoints (120) accepted samples plus two boundary points (122).
    const spread=Math.max(0,...group.map(e=>trajectorySimilarity(rep,e)));similarities.push(spread);
    // A cluster can split when one member's trajectory diverges. The inherited id
    // must stay unique: the group that does not claim the previous record derives a
    // fresh id from its own representative, which can collide with the previous
    // record's original derivation. Disambiguate deterministically from the group.
    const baseId=old?.id||`diversion-${digest(JSON.stringify([index.version,rep.id])).slice(0,24)}`;
    const taken=new Set([...used,...records.map(r=>r.id)]);
    const recordId=taken.has(baseId)?`diversion-${digest(JSON.stringify([index.version,rep.id,group.map(e=>e.id).sort()])).slice(0,24)}`:baseId;
    const record={id:recordId,
      routeId:rep.routeId,directionId:rep.directionId,patternId:rep.patternId,shapeId:rep.shapeId,status:c.status,confidence:c,geometrySource:'sirento-observed',
      firstObservedAt,lastObservedAt,departure:rep.departure,...(rep.rejoin?{rejoin:rep.rejoin}:{}),geometry,
      scheduledAffectedSegment:{shapeId:rep.shapeId,fromMeters:rep.departure.progressMeters,toMeters:rep.rejoin?.progressMeters??null,
        geometry:scheduled&&scheduled.length<=DIVERSION_POLICY.maxGeometryPoints?scheduled:null},
      evidence:{trajectoryCount:group.length,vehicleCount:new Set(group.map(e=>e.vehicleId)).size,completedTrajectoryCount:group.filter(e=>e.completed).length,
        anchoredCompletedCount:group.filter(e=>e.completed&&e.departure.method==='on-route-projection').length,
        completedVehicleCount:new Set(group.filter(e=>e.completed&&e.departure.method==='on-route-projection').map(e=>e.vehicleId)).size,maxCorridorDistanceMeters:spread},
      relatedAlertIds:related,relatedAdvisoryRefs:advisory.refs,retirementMs:expiry,identityAnchor:old?.identityAnchor?.rejoin?old.identityAnchor:anchor(rep),episodeIds:group.map(e=>e.id).sort()};
    if (old) {used.add(old.id);if (JSON.stringify(old.geometry)!==JSON.stringify(geometry)) report.geometryUpdates++;}
    else {report.clustersCreated++;if ((previous?.records||[]).some(r=>key(r)===key(record)&&Math.abs(r.departure.progressMeters-record.departure.progressMeters)<=DIVERSION_POLICY.endpointMeters)) report.clustersSplit++;}
    report.clustersMerged+=(previous?.records||[]).filter(r=>r.id!==old?.id&&r.episodeIds.some(id=>record.episodeIds.includes(id))).length;
    records.push(record);
  }
  report.expiredClusters=(previous?.records||[]).filter(r=>!records.some(n=>n.id===r.id)).length;
  const state={schemaVersion:1,staticVersion:index.version,status:vehicles.status,checkedAt:now.toISOString(),episodes:episodes.filter(e=>!retired.has(e.id)),records};
  report.episodesRetained=state.episodes.length;
  report.episodesClosed=state.episodes.filter(e=>e.closed).length;
  Object.assign(report,{candidate:records.filter(r=>r.status==='candidate').length,likely:records.filter(r=>r.status==='likely').length,confirmed:records.filter(r=>r.status==='confirmed').length,
    clustersWithOneVehicle:records.filter(r=>r.evidence.vehicleCount===1).length,clustersWithMultipleVehicles:records.filter(r=>r.evidence.vehicleCount>=2).length,
    routesAffected:[...new Set(records.map(r=>r.routeId))].sort(),averageClusterDistanceMeters:similarities.length?similarities.reduce((a,b)=>a+b,0)/similarities.length:0,
    maxClusterDistanceMeters:Math.max(0,...similarities),relatedAlertCount:records.reduce((n,r)=>n+r.relatedAlertIds.length,0),
    relatedAdvisoryCount:records.reduce((n,r)=>n+r.relatedAdvisoryRefs.length,0),advisoryAmbiguousCount:records.filter(r=>advisoryAmbiguous.has(r.routeId)).length,
    processingMs:performance.now()-started,rssBytes:process.memoryUsage().rss});
  validateDiversionState(state,index);
  return {state,output:diversionOutput(state),report};
}

export function diversionOutput(state) {
  const output={schemaVersion:1,staticVersion:state.staticVersion,status:state.status,checkedAt:state.checkedAt,
    diversions:state.status==='ok'?state.records.map(({identityAnchor,episodeIds,retirementMs,...r})=>{void identityAnchor;void episodeIds;return {...r,expiresAt:new Date(Date.parse(r.lastObservedAt)+(retirementMs ?? DIVERSION_POLICY.evidenceMs)).toISOString()};}):[]};
  validateDiversionOutput(output);return output;
}
function validateBoundary(b,shape) {
  if (b&&shape) {
    const g=compileShape(shape),segment=g?.segments[b.segmentIndex];
    if (!segment||!Number.isFinite(b.segmentFraction)) return false;
    const point=[g.origin[2]+(segment.x+b.segmentFraction*segment.dx)/g.sx,g.origin[1]+(segment.y+b.segmentFraction*segment.dy)/g.sy];
    if (!coord(b.point)||distance(b.point,point)>1||Math.abs(b.progressMeters-segment.offset-b.segmentFraction*segment.size)>1) return false;
  }
  return b&&coord(b.point)&&Number.isFinite(b.progressMeters)&&b.progressMeters>=0&&integer(b.segmentIndex)&&(!shape||b.segmentIndex<shape.length-1)&&
    Number.isFinite(b.segmentFraction)&&b.segmentFraction>=0&&b.segmentFraction<=1&&Number.isFinite(b.uncertaintyMeters)&&b.uncertaintyMeters>=0&&
    ['on-route-projection','off-route-projection'].includes(b.method)&&Array.isArray(b.rawEvidence)&&b.rawEvidence.length>=1&&b.rawEvidence.length<=2&&b.rawEvidence.every(p=>iso(p.observedAt)&&validCoordinate(p.latitude,p.longitude)&&Number.isFinite(p.distanceFromShapeMeters)&&p.distanceFromShapeMeters>=0);
}
function context(r,index) {
  const p=index?.patterns.get(r.patternId);
  return id(r.routeId)&&id(r.patternId)&&id(r.shapeId)&&[null,0,1].includes(r.directionId)&&(!index||(p&&p.routeId===r.routeId&&p.directionId===r.directionId&&p.shapeId===r.shapeId&&index.shapes.has(r.shapeId)));
}
function header(s,index) {
  return s&&s.schemaVersion===1&&id(s.staticVersion)&&['ok','unavailable'].includes(s.status)&&iso(s.checkedAt)&&(!index||s.staticVersion===index.version)&&Buffer.byteLength(JSON.stringify(s))<=DIVERSION_POLICY.maxArtifactBytes;
}
export function validateDiversionOutput(s,index) {
  const fail=()=>{throw new Error('Invalid TTC diversion output');};
  if (!header(s,index)||!Array.isArray(s.diversions)||s.diversions.length>DIVERSION_POLICY.maxClusters||(s.status==='unavailable'&&s.diversions.length)) fail();
  const ids=new Set(),routes=new Map();
  for (const r of s.diversions) {
    const e=r.evidence,shape=index?.shapes.get(r.shapeId);
    if ((r.expiresAt!==undefined&&(!iso(r.expiresAt)||r.expiresAt<r.lastObservedAt))||!id(r.id)||ids.has(r.id)||!context(r,index)||r.geometrySource!=='sirento-observed'||!['candidate','likely','confirmed'].includes(r.status)||
      !iso(r.firstObservedAt)||!iso(r.lastObservedAt)||r.firstObservedAt>r.lastObservedAt||Date.parse(r.lastObservedAt)>Date.parse(s.checkedAt)+30000||
      !validateBoundary(r.departure,shape)||(r.rejoin&&(!validateBoundary(r.rejoin,shape)||r.rejoin.progressMeters<=r.departure.progressMeters))||
      !Array.isArray(r.geometry)||r.geometry.length<2||r.geometry.length>DIVERSION_POLICY.maxGeometryPoints||!r.geometry.every(coord)||
      !Array.isArray(r.relatedAlertIds)||!r.relatedAlertIds.every(id)||new Set(r.relatedAlertIds).size!==r.relatedAlertIds.length||
      !Array.isArray(r.relatedAdvisoryRefs)||!r.relatedAdvisoryRefs.every(id)||new Set(r.relatedAdvisoryRefs).size!==r.relatedAdvisoryRefs.length||
      !e||!['trajectoryCount','vehicleCount','completedTrajectoryCount','anchoredCompletedCount','completedVehicleCount'].every(k=>integer(e[k]))||
      e.trajectoryCount<1||e.trajectoryCount>DIVERSION_POLICY.maxMembers||e.vehicleCount<1||e.vehicleCount>e.trajectoryCount||e.completedTrajectoryCount>e.trajectoryCount||e.anchoredCompletedCount>e.completedTrajectoryCount||e.completedVehicleCount>e.anchoredCompletedCount||e.completedVehicleCount>e.vehicleCount||
      !Number.isFinite(e.maxCorridorDistanceMeters)||e.maxCorridorDistanceMeters<0||e.maxCorridorDistanceMeters>DIVERSION_POLICY.corridorMeters||
      (r.status==='confirmed'&&(!(e.completedVehicleCount>=2||e.anchoredCompletedCount>=3)||!r.rejoin||r.departure.method!=='on-route-projection'))||
      (r.status==='likely'&&!(e.vehicleCount>=2||e.completedTrajectoryCount>=3))||!r.confidence||r.confidence.status!==r.status||!id(r.confidence.rule)||r.confidence.alertSupported!==(r.relatedAlertIds.length>0)||r.confidence.advisorySupported!==(r.relatedAdvisoryRefs.length>0)) fail();
    const seg=r.scheduledAffectedSegment;
    if (!seg||seg.shapeId!==r.shapeId||seg.fromMeters!==r.departure.progressMeters||seg.toMeters!==(r.rejoin?.progressMeters??null)||
      !(seg.geometry===null||(Array.isArray(seg.geometry)&&seg.geometry.length>=2&&seg.geometry.length<=DIVERSION_POLICY.maxGeometryPoints&&seg.geometry.every(coord)))) fail();
    if (distance(r.geometry[0],r.departure.point)>.01||(r.rejoin&&distance(r.geometry.at(-1),r.rejoin.point)>.01)) fail();
    ids.add(r.id);routes.set(r.routeId,(routes.get(r.routeId)||0)+1);
    if (routes.get(r.routeId)>DIVERSION_POLICY.maxClustersPerRoute) fail();
  }
  return s;
}
export function validateDiversionState(s,index) {
  const fail=()=>{throw new Error('Invalid TTC diversion state');};
  if (!header(s,index)||!Array.isArray(s.episodes)||s.episodes.length>DIVERSION_POLICY.maxEpisodes||!Array.isArray(s.records)) fail();
  validateDiversionOutput({...s,status:'ok',diversions:s.records},index);
  const ids=new Set();
  for (const e of s.episodes) {
    if (!id(e.id)||ids.has(e.id)||!id(e.vehicleId)||!id(e.assignment)||!context(e,index)||!iso(e.startedAt)||!iso(e.lastObservedAt)||!iso(e.lastOffAt)||Date.parse(e.lastObservedAt)-Date.parse(e.startedAt)>DIVERSION_POLICY.maxEpisodeMs||e.startedAt>e.lastOffAt||e.lastOffAt>e.lastObservedAt||Date.parse(e.lastObservedAt)>Date.parse(s.checkedAt)+30000||
      !['confirmed','completed','closed','truncated'].every(k=>typeof e[k]==='boolean')||!Array.isArray(e.relatedAlertIds)||!e.relatedAlertIds.every(id)||
      (e.departure&&!validateBoundary(e.departure,index?.shapes.get(e.shapeId)))||!Array.isArray(e.points)||!e.points.length||e.points.length>DIVERSION_POLICY.maxPoints||
      (e.completed&&(!e.confirmed||!e.closed||!iso(e.endedAt)||!validateBoundary(e.rejoin,index?.shapes.get(e.shapeId))||!e.departure||e.rejoin.progressMeters<=e.departure.progressMeters))) fail();
    for (let i=0;i<e.points.length;i++) {
      const p=e.points[i];
      if (!validCoordinate(p.latitude,p.longitude)||!iso(p.observedAt)||p.observedAt<e.startedAt||p.observedAt>e.lastObservedAt||!Number.isFinite(p.distanceFromShapeMeters)||p.distanceFromShapeMeters<0||!['on','off','neutral'].includes(p.evidence)||
        !Number.isFinite(p.progressMeters)||p.progressMeters<0||!coord(p.projectedPoint)||typeof p.projectionAmbiguous!=='boolean'||!integer(p.segmentIndex)||!Number.isFinite(p.segmentFraction)||p.segmentFraction<0||p.segmentFraction>1||
        (i&&(p.observedAt<=e.points[i-1].observedAt||geographicDistance(p,e.points[i-1])>100+40*(Date.parse(p.observedAt)-Date.parse(e.points[i-1].observedAt))/1000))) fail();
    }
    ids.add(e.id);
  }
  for (const r of s.records) {
    if (![DIVERSION_POLICY.returnedMs,DIVERSION_POLICY.endedAlertMs,DIVERSION_POLICY.evidenceMs].includes(r.retirementMs)||!Array.isArray(r.episodeIds)||r.episodeIds.length!==r.evidence.trajectoryCount||new Set(r.episodeIds).size!==r.episodeIds.length||r.episodeIds.some(v=>!ids.has(v))||!context(r.identityAnchor,index)||key(r.identityAnchor)!==key(r)||
      (r.identityAnchor.rejoin&&(!validateBoundary(r.identityAnchor.rejoin,index?.shapes.get(r.shapeId))||r.identityAnchor.rejoin.progressMeters<=r.identityAnchor.departure.progressMeters))||
      !validateBoundary(r.identityAnchor.departure,index?.shapes.get(r.shapeId))||!Array.isArray(r.identityAnchor.geometry)||r.identityAnchor.geometry.length<2||r.identityAnchor.geometry.length>DIVERSION_POLICY.maxGeometryPoints||!r.identityAnchor.geometry.every(coord)) fail();
  }
  for (const r of s.records) {
    const members=s.episodes.filter(e=>r.episodeIds.includes(e.id));
    if (members.some(e=>!usable(e)||key(e)!==key(r))||new Set(members.map(e=>e.vehicleId)).size!==r.evidence.vehicleCount||
      members.filter(e=>e.completed).length!==r.evidence.completedTrajectoryCount||
      members.filter(e=>e.completed&&e.departure.method==='on-route-projection').length!==r.evidence.anchoredCompletedCount||
      new Set(members.filter(e=>e.completed&&e.departure.method==='on-route-projection').map(e=>e.vehicleId)).size!==r.evidence.completedVehicleCount) fail();
  }
  const vehicleEpisodes=new Map();
  for (const e of s.episodes.filter(e=>e.completed)) {
    const prior=vehicleEpisodes.get(e.vehicleId)||[];
    if (prior.some(p=>e.startedAt<=p.endedAt&&p.startedAt<=e.endedAt)) fail();
    prior.push(e);vehicleEpisodes.set(e.vehicleId,prior);
  }
  return s;
}

export function diversionGeoJson(state,index) {
  validateDiversionState(state,index);
  const features=[],add=(type,coordinates,kind,properties)=>features.push({type:'Feature',properties:{kind,...properties},geometry:{type,coordinates}});
  for (const r of state.records) {
    const props={id:r.id,routeId:r.routeId,status:r.status,geometrySource:r.geometrySource,sourceStatus:state.status,checkedAt:state.checkedAt,lastObservedAt:r.lastObservedAt};
    add('LineString',r.geometry,'inferred-diversion',props);
    add('LineString',index.shapes.get(r.shapeId).map(p=>[p[2],p[1]]),'scheduled-route',props);
    if (r.scheduledAffectedSegment.geometry) add('LineString',r.scheduledAffectedSegment.geometry,'scheduled-affected-segment',props);
    add('Point',r.departure.point,'departure',props);
    if (r.rejoin) add('Point',r.rejoin.point,'rejoin',props);
    for (const e of state.episodes.filter(e=>r.episodeIds.includes(e.id))) add('LineString',e.points.map(coordinate),'trajectory',{...props,episodeId:e.id,completed:e.completed});
  }
  return {type:'FeatureCollection',features};
}
