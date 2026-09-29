import { validCoordinate } from './static-gtfs.js';
import { isAlertActive } from './lifecycle.js';
import { compileShape, projectVehicle, geographicDistance } from './vehicle-geometry.js';
import { MAX_OBSERVATION_AGE_MS, fetchTtcVehicles } from './vehicle-feed.js';

export const VEHICLE_POLICY = Object.freeze({entryMeters:100,exitMeters:50,terminalMeters:150,
  confirmationCount:3,confirmationMs:60000,confirmationMovementMeters:100,rejoinCount:3,rejoinMs:60000,
  historyCount:20,historyMs:600000,inactivityMs:180000,maxGapMs:90000,maxVehicles:3000,
  maxSpeedMetersPerSecond:40,jumpSlackMeters:100,maxArtifactBytes:32*1024*1024});
const states = ['on-route','possible','confirmed','rejoining','unknown'];
const instant = s => typeof s === 'string' && Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s;
const id = s => typeof s === 'string' && s.trim().length > 0;
const finite = n => Number.isFinite(n) && n >= 0;
const assignment = o => JSON.stringify([o.routeId??null,o.tripId??null,o.directionId??null,o.startDate??null,o.startTime??null]);

export function correlateVehicle(o,index) {
  if (o.scheduleRelationship !== undefined && o.scheduleRelationship !== 0) return {quality:'unmatched'};
  const trip = index.trips.get(o.tripId);
  let candidates, quality;
  if (trip) {
    if ((o.routeId !== undefined && o.routeId !== trip.routeId) || (o.directionId !== undefined && o.directionId !== trip.directionId)) return {quality:'unmatched',conflict:true};
    candidates = trip.patternId ? [index.patterns.get(trip.patternId)] : [];
    quality = 'exact';
  } else {
    candidates = (index.byRoute.get(o.routeId) || []).filter(p=>o.directionId === undefined || p.directionId === o.directionId);
    quality = 'probable';
  }
  // Contradictory stop context is unsafe even for an exact trip ID.
  if (o.stopId !== undefined) candidates = candidates.filter(p=>p.stopIds.includes(o.stopId));
  candidates = candidates.filter(p=>[0,3,11].includes(index.routes.get(p.routeId)?.routeType));
  if (!candidates.length) return {quality:'unmatched'};
  // Do not choose the first branch, or nearest branch while a vehicle is off-route.
  if (candidates.length > 1) return {quality:'ambiguous'};
  const pattern = candidates[0];
  if (!index.shapes.has(pattern.shapeId)) return {quality:'unmatched'};
  return {quality,pattern};
}

function relatedAlerts(alerts,p,o,now) {
  if (alerts?.status !== 'ok') return [];
  return alerts.items.filter(a=>{
    if (!isAlertActive(a,now) || !a.routes.includes(p.routeId)) return false;
    const selectors=a.informedEntities.filter(e=>(e.routeId || e.trip?.routeId)===p.routeId);
    const routeOnly=a.routes.length===1 && selectors.length>0 && a.informedEntities.every(e=>e.stopId===undefined && e.trip?.tripId===undefined && (e.routeId||e.trip?.routeId)===p.routeId);
    const exactPattern=a.correlation?.status==='exact' && a.correlation.candidates.some(c=>c.patternId===p.patternId);
    return (routeOnly || exactPattern) && selectors.some(e=>
      (e.trip?.tripId===undefined || e.trip.tripId===o.tripId) &&
      ((e.directionId??e.trip?.directionId)===undefined || (e.directionId??e.trip?.directionId)===p.directionId));
  }).map(a=>a.id).sort();
}

/** Stateful backend only. Reference time and fetched observations are injected. */
export function detectVehicles(previous,feed,index,now,alerts,{geometryCache = new Map()} = {}) {
  const start = performance.now(), policy = VEHICLE_POLICY;
  if (previous) validateVehicleState(previous,previous.staticVersion === index.version ? index : undefined);
  const report = {...feed?.diagnostics,exact:0,probable:0,ambiguous:0,unmatched:0,tripIdMatched:0,tripIdUnmatched:0,tripContextConflicts:0,withRoute:0,withTrip:0,
    stale:feed?.diagnostics?.stale || 0,duplicateOrOutOfOrder:0,gpsAnomalies:0,expired:0,resets:0,rejoined:0,terminalSuppressed:0,capacityDropped:0,matchingMs:0,geometryMs:0};
  const tracks = new Map();
  for (const t of previous?.tracks || []) {
    if (previous.staticVersion !== index.version || +now-Date.parse(t.lastObservedAt)>policy.inactivityMs) { report.expired++; continue; }
    tracks.set(t.vehicleId,structuredClone(t));
  }
  const distances = [];
  for (const o of feed?.observations || []) {
    if (!id(o.vehicleId) || !validCoordinate(o.latitude,o.longitude) || !instant(o.observedAt) || !instant(o.fetchedAt)) throw new Error('Invalid normalized vehicle observation');
    if (+now-Date.parse(o.observedAt)>MAX_OBSERVATION_AGE_MS || Date.parse(o.observedAt)>+now+30000) { report.stale++; continue; }
    let t = tracks.get(o.vehicleId);
    if (t && o.observedAt<=t.lastObservedAt) { report.duplicateOrOutOfOrder++; continue; }
    const old = t?.history.at(-1), gap = old ? Date.parse(o.observedAt)-Date.parse(old.observedAt) : 0;
    // Physical sanity precedes reassignment; rejected points never enter history.
    if (old && geographicDistance(o,old)>policy.jumpSlackMeters+policy.maxSpeedMetersPerSecond*gap/1000) { report.gpsAnomalies++; continue; }
    const matchStart = performance.now();
    const match = correlateVehicle(o,index);
    report.matchingMs += performance.now()-matchStart;
    report[match.quality]++;
    if (match.conflict) report.tripContextConflicts++;
    if (o.routeId) report.withRoute++;
    if (o.tripId) { report.withTrip++; report[index.trips.has(o.tripId)?'tripIdMatched':'tripIdUnmatched']++; }
    if (!match.pattern) { tracks.delete(o.vehicleId); continue; }
    const p = match.pattern, shapeKey = `${index.version}:${p.shapeId}`;
    const geoStart = performance.now();
    if (!geometryCache.has(shapeKey)) geometryCache.set(shapeKey,compileShape(index.shapes.get(p.shapeId)));
    const projection = projectVehicle(o,geometryCache.get(shapeKey));
    report.geometryMs += performance.now()-geoStart;
    if (!projection) { tracks.delete(o.vehicleId); continue; }
    distances.push(projection.distanceFromShapeMeters);
    if (t && (t.assignment!==assignment(o) || t.patternId!==p.patternId || gap>policy.maxGapMs)) { t = null; report.resets++; }
    if (!t) t = {vehicleId:o.vehicleId,assignment:assignment(o),routeId:p.routeId,...(o.tripId?{tripId:o.tripId}:{}),directionId:p.directionId,
      patternId:p.patternId,shapeId:p.shapeId,quality:match.quality,state:'unknown',history:[],relatedAlertIds:[]};
    const terminal = projection.endpointDistanceMeters<policy.terminalMeters;
    const evidence = projection.distanceFromShapeMeters<policy.exitMeters ? 'on' : terminal ? 'neutral' : projection.distanceFromShapeMeters>policy.entryMeters ? 'off' : 'neutral';
    if (terminal) report.terminalSuppressed++;
    const sample = {observedAt:o.observedAt,latitude:o.latitude,longitude:o.longitude,...projection,evidence};
    t.history = [...t.history,sample].filter(h=>Date.parse(o.observedAt)-Date.parse(h.observedAt)<=policy.historyMs).slice(-policy.historyCount);
    t.lastObservedAt = o.observedAt;
    t.quality = match.quality;
    t.relatedAlertIds = relatedAlerts(alerts,p,o,now);
    const run = [];
    for (let i=t.history.length-1;i>=0&&t.history[i].evidence===evidence;i--) run.unshift(t.history[i]);
    const duration = Date.parse(o.observedAt)-Date.parse(run[0].observedAt);
    // Displacement (not summed jitter) avoids a stationary vehicle confirming.
    const movement = Math.max(...run.map(h=>geographicDistance(run[0],h)));
    if (evidence==='off') {
      if (!['possible','confirmed','rejoining'].includes(t.state)) t.deviationStartedAt=o.observedAt;
      if (['confirmed','rejoining'].includes(t.state)) t.state='confirmed';
      else t.state = run.length>=policy.confirmationCount && duration>=policy.confirmationMs && movement>=policy.confirmationMovementMeters ? 'confirmed' : 'possible';
    } else if (evidence==='on') {
      if (['confirmed','rejoining'].includes(t.state)) {
        if (run.length>=policy.rejoinCount && duration>=policy.rejoinMs) { t.state='on-route'; report.rejoined++; }
        else t.state='rejoining';
      } else t.state='on-route';
    } else if (!['confirmed','rejoining'].includes(t.state)) t.state='unknown';
    if (['on-route','unknown'].includes(t.state)) delete t.deviationStartedAt;
    tracks.set(o.vehicleId,t);
  }
  let sorted = [...tracks.values()].sort((a,b)=>b.lastObservedAt.localeCompare(a.lastObservedAt)||a.vehicleId.localeCompare(b.vehicleId));
  report.capacityDropped = Math.max(0,sorted.length-policy.maxVehicles);
  sorted = sorted.slice(0,policy.maxVehicles).sort((a,b)=>a.vehicleId.localeCompare(b.vehicleId));
  for (const t of sorted) {
    t.history = t.history.filter(h=>+now-Date.parse(h.observedAt)<=policy.historyMs);
    // Alert support is live context, not sticky evidence from a previous poll.
    t.relatedAlertIds = relatedAlerts(alerts,index.patterns.get(t.patternId),t,now);
  }
  distances.sort((a,b)=>a-b);
  const result = {schemaVersion:1,staticVersion:index.version,status:feed?'ok':'unavailable',checkedAt:now.toISOString(),
    fetchedAt:feed?now.toISOString():previous?.fetchedAt??null,sourceUpdatedAt:feed?.sourceUpdatedAt??previous?.sourceUpdatedAt??null,tracks:sorted};
  Object.assign(report,{onRoute:sorted.filter(t=>t.state==='on-route').length,possible:sorted.filter(t=>t.state==='possible').length,confirmed:sorted.filter(t=>t.state==='confirmed').length,
    rejoining:sorted.filter(t=>t.state==='rejoining').length,relatedAlerts:sorted.filter(t=>t.relatedAlertIds.length).length,
    maxDistanceMeters:distances.at(-1)??null,p50Meters:distances[Math.floor(distances.length*.5)]??null,p95Meters:distances[Math.floor(distances.length*.95)]??null,p99Meters:distances[Math.floor(distances.length*.99)]??null,
    processingMs:performance.now()-start,rssBytes:process.memoryUsage().rss});
  validateVehicleState(result,index);
  return {state:result,report};
}

// Separate backend export: no full shapes, raw fleet, or duplication in current.json.
export function deviationOutput(state) {
  validateVehicleState(state);
  const output = {schemaVersion:1,staticVersion:state.staticVersion,status:state.status,...(state.reason?{reason:state.reason}:{}),checkedAt:state.checkedAt,sourceUpdatedAt:state.sourceUpdatedAt,
    deviations:state.status==='ok' ? state.tracks.filter(t=>['possible','confirmed','rejoining'].includes(t.state) && Date.parse(state.checkedAt)-Date.parse(t.lastObservedAt)<=MAX_OBSERVATION_AGE_MS).map(t=>({
      vehicleId:t.vehicleId,routeId:t.routeId,...(t.tripId?{tripId:t.tripId}:{}),directionId:t.directionId,patternId:t.patternId,shapeId:t.shapeId,quality:t.quality,state:t.state,
      firstObservedAt:t.deviationStartedAt,lastObservedAt:t.lastObservedAt,
      maxDistanceFromShapeMeters:Math.max(...t.history.filter(h=>h.observedAt>=t.deviationStartedAt).map(h=>h.distanceFromShapeMeters)),observations:t.history.filter(h=>h.observedAt>=t.deviationStartedAt),relatedAlertIds:t.relatedAlertIds})) : []};
  validateDeviationOutput(output);
  return output;
}

export function validateDeviationOutput(output,index) {
  if (!output || !Array.isArray(output.deviations) || (output.status==='unavailable'&&output.deviations.length)) throw new Error('Invalid TTC deviation output');
  const state={...output,fetchedAt:output.checkedAt,tracks:output.deviations.map(d=>{
    if (!['possible','confirmed','rejoining'].includes(d.state)||!finite(d.maxDistanceFromShapeMeters)||!Array.isArray(d.observations)||!d.observations.length||d.maxDistanceFromShapeMeters!==Math.max(...d.observations.map(h=>h.distanceFromShapeMeters))||d.observations.some(h=>h.observedAt<d.firstObservedAt)) throw new Error('Invalid TTC deviation evidence');
    return {...d,assignment:assignment(d),deviationStartedAt:d.firstObservedAt,history:d.observations};
  })};
  validateVehicleState(state,index);
  return output;
}

export function validateVehicleState(s,index) {
  const fail = () => { throw new Error('Invalid TTC vehicle state'); };
  if (!s || s.schemaVersion!==1 || !id(s.staticVersion) || !['ok','unavailable'].includes(s.status) || !instant(s.checkedAt) || !(s.fetchedAt===null||instant(s.fetchedAt)) || !(s.sourceUpdatedAt===null||instant(s.sourceUpdatedAt)) || !Array.isArray(s.tracks) || s.tracks.length>VEHICLE_POLICY.maxVehicles || (index&&s.staticVersion!==index.version)) fail();
  if (Buffer.byteLength(JSON.stringify(s))>VEHICLE_POLICY.maxArtifactBytes) fail();
  const ids = new Set();
  for (const t of s.tracks) {
    if (!id(t.vehicleId)||ids.has(t.vehicleId)||!id(t.routeId)||!id(t.assignment)||!id(t.patternId)||!id(t.shapeId)||!states.includes(t.state)||!['exact','probable'].includes(t.quality)||![null,0,1].includes(t.directionId)||!instant(t.lastObservedAt)||!Array.isArray(t.history)||!t.history.length||t.history.length>VEHICLE_POLICY.historyCount||!Array.isArray(t.relatedAlertIds)||!t.relatedAlertIds.every(id)||new Set(t.relatedAlertIds).size!==t.relatedAlertIds.length) fail();
    if (['possible','confirmed','rejoining'].includes(t.state) && (!instant(t.deviationStartedAt)||t.deviationStartedAt>t.lastObservedAt)) fail();
    if (Date.parse(t.lastObservedAt)>Date.parse(s.checkedAt)+30000) fail();
    ids.add(t.vehicleId);
    const p = index?.patterns.get(t.patternId), shape = index?.shapes.get(t.shapeId);
    if (index&&(!p||p.shapeId!==t.shapeId||p.routeId!==t.routeId||p.directionId!==t.directionId||!shape)) fail();
    const trip=index?.trips.get(t.tripId);
    if (index && ((t.quality==='exact'&&!trip) || (trip&&trip.patternId!==t.patternId))) fail();
    for (let i=0;i<t.history.length;i++) {
      const h=t.history[i];
      if (!validCoordinate(h.latitude,h.longitude)||!instant(h.observedAt)||!finite(h.distanceFromShapeMeters)||!finite(h.progressMeters)||!finite(h.shapeLengthMeters)||h.progressMeters>h.shapeLengthMeters||!finite(h.endpointDistanceMeters)||!Number.isInteger(h.segmentIndex)||h.segmentIndex<0||(shape&&h.segmentIndex>=shape.length-1)||!finite(h.segmentFraction)||h.segmentFraction>1||typeof h.projectionAmbiguous!=='boolean'||!Array.isArray(h.projectedPoint)||h.projectedPoint.length!==2||!validCoordinate(h.projectedPoint[1],h.projectedPoint[0])||!['on','off','neutral'].includes(h.evidence)||(i&&h.observedAt<=t.history[i-1].observedAt)||Date.parse(t.lastObservedAt)-Date.parse(h.observedAt)>VEHICLE_POLICY.historyMs) fail();
    }
    if (t.history.at(-1).observedAt!==t.lastObservedAt) fail();
  }
  return s;
}

export async function refreshVehicles(previous,index,now,alerts,{fetchSource=fetchTtcVehicles,log=()=>{},geometryCache}={}) {
  let feed, reason;
  try { feed=await fetchSource(now); }
  catch (error) { reason=error.reason||'fetch'; log({source:'ttc-vehicles',status:'unavailable',reason,error:error.message}); }
  const result=detectVehicles(previous,feed,index,now,alerts,{geometryCache});
  if (reason) result.state.reason=reason;
  log({source:'ttc-vehicles',status:result.state.status,...result.report,artifactBytes:Buffer.byteLength(JSON.stringify(deviationOutput(result.state)))});
  return result;
}
