import { digest, serviceActive, sortedUnique, validCoordinate } from './static-gtfs.js';

const dateAt = time => new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(time).replaceAll('-','');

// Nearest projection in a local equirectangular plane. 100 m maximum offset;
// distinct equally-near positions (within 5 m) on loops retain the shape reference only.
export function projectStop(stop, shape) {
  if (!shape || shape.length < 2) return null;
  const scale = Math.cos(stop.latitude * Math.PI / 180), options = [];
  for (let i = 0; i < shape.length - 1; i++) {
    const a = shape[i], b = shape[i+1];
    const ax = (a[2]-stop.longitude)*111320*scale, ay = (a[1]-stop.latitude)*111320;
    const dx = (b[2]-a[2])*111320*scale, dy = (b[1]-a[1])*111320;
    const t = dx*dx+dy*dy ? Math.max(0,Math.min(1,-(ax*dx+ay*dy)/(dx*dx+dy*dy))) : 0;
    options.push({position:i+t,distance:Math.hypot(ax+t*dx,ay+t*dy),point:[a[2]+t*(b[2]-a[2]),a[1]+t*(b[1]-a[1])]});
  }
  options.sort((a,b) => a.distance-b.distance || a.position-b.position);
  const best = options[0];
  if (best.distance > 100 || options.some(p => Math.abs(p.position-best.position)>1 && p.distance<=best.distance+5)) return null;
  return best;
}
function segmentFor(pattern, affected, index) {
  if (affected.length < 2) return null;
  const positions = affected.map(id => pattern.stopIds.indexOf(id));
  // Repeated stops make occurrence selection uncertain.
  if (affected.some(id => pattern.stopIds.indexOf(id) !== pattern.stopIds.lastIndexOf(id))) return null;
  const first = Math.min(...positions), last = Math.max(...positions);
  const stopIds = pattern.stopIds.slice(first,last+1), shape = index.shapes.get(pattern.shapeId);
  const segment = {firstStopId:stopIds[0],lastStopId:stopIds.at(-1),stopIds,shapeId:pattern.shapeId,geometryStatus:shape ? 'ambiguous' : 'missing'};
  // Check all intermediate scheduled stops to avoid clipping through the wrong loop.
  const projections = stopIds.map(id => projectStop(index.stops.get(id),shape));
  if (projections.some(p => !p) || projections.some((p,i) => i && p.position < projections[i-1].position) || projections[0].position >= projections.at(-1).position) return segment;
  const a = projections[0], b = projections.at(-1);
  segment.geometry = [a.point,...shape.slice(Math.floor(a.position)+1,Math.ceil(b.position)).map(p => [p[2],p[1]]),b.point];
  segment.geometryStatus = 'projected';
  return segment;
}
function orderedMatch(stops, order) {
  let from = 0;
  for (const stop of order) { const at = stops.indexOf(stop,from); if (at < 0) return false; from = at + 1; }
  return true;
}

export function correlateAlert(item, index, now, catalog) {
  const selectors = item.informedEntities || [];
  const tripIds = sortedUnique(selectors.flatMap(e => e.trip?.tripId ? [e.trip.tripId] : []));
  const trips = tripIds.map(tripId => ({tripId,matched:index.trips.has(tripId),...(index.trips.has(tripId) ? {routeId:index.trips.get(tripId).routeId,patternId:index.trips.get(tripId).patternId} : {})}));
  const routeIds = sortedUnique([...item.routes,...trips.filter(t => t.matched).map(t => t.routeId)]);
  const routes = routeIds.map(routeId => ({routeId,matched:index.routes.has(routeId),...(index.routes.get(routeId) || {})}));
  const stops = sortedUnique(item.stops).map(stopId => ({stopId,matched:index.stops.has(stopId),...(index.stops.get(stopId) || {})}));
  const candidates = [], routeResults = [];
  const future = (item.activePeriods || []).filter(p => p.start && Date.parse(p.start)>now.getTime()).map(p => p.start).sort()[0];
  const reference = item.state === 'scheduled' && future ? new Date(future) : now;
  const serviceDate = dateAt(reference);
  // Include previous service day for overnight service; lack of times deliberately preserves candidates.
  const previousDate = dateAt(new Date(reference.getTime()-86400000));
  const searchRoutes = routeIds.length ? routeIds : sortedUnique(stops.flatMap(s => [...(index.byStop.get(s.stopId) || [])].map(id => index.patterns.get(id).routeId)));
  for (const routeId of searchRoutes) {
    const selectorRoute = e => e.routeId || e.trip?.routeId || index.trips.get(e.trip?.tripId)?.routeId;
    const relevant = selectors.filter(e => !selectorRoute(e) || selectorRoute(e) === routeId);
    const scopedStops = sortedUnique(selectors.some(e => e.stopId) ? relevant.filter(e => e.stopId).map(e => e.stopId) : item.stops);
    const scopedTrips = relevant.filter(e => e.trip?.tripId).map(e => e.trip.tripId);
    const directions = relevant.length && relevant.every(e => (e.directionId ?? e.trip?.directionId) !== undefined)
      ? sortedUnique(relevant.map(e => e.directionId ?? e.trip.directionId)) : [];
    let pool = (index.byRoute.get(routeId) || []).filter(p => (!directions.length || directions.includes(p.directionId)) &&
      (!scopedTrips.length || !relevant.every(e => e.trip?.tripId) || scopedTrips.some(id => index.trips.get(id)?.patternId === p.patternId)));
    if (!scopedStops.length && !scopedTrips.length) { routeResults.push({routeId,status:index.routes.has(routeId) ? 'partial' : 'unmatched'}); continue; }
    pool = pool.map(p => ({p,matched:scopedStops.filter(id => p.stopIds.includes(id)),active:p.serviceIds.some(id => serviceActive(index,id,serviceDate) === true || serviceActive(index,id,previousDate) === true)}));
    pool = pool.filter(c => c.matched.length || scopedTrips.length);
    const best = Math.max(0,...pool.map(c => c.matched.length));
    pool = pool.filter(c => c.matched.length === best);
    if (pool.some(c => c.active)) pool = pool.filter(c => c.active);
    // GTFS-RT informed_entity is a SET, not an ordered stop list. Optional explicit
    // affectedStopOrder is reserved for callers with actual sequence evidence.
    const order = item.affectedStopOrder;
    const complete = scopedStops.length > 0 && best === scopedStops.length && pool.every(c => !order || orderedMatch(c.p.stopIds,order));
    const status = !pool.length ? 'unmatched' : !complete ? 'partial' : pool.length > 1 ? 'ambiguous' : 'exact';
    routeResults.push({routeId,status});
    for (const {p,matched,active} of pool) {
      catalog[p.patternId] = {patternId:p.patternId,routeId:p.routeId,directionId:p.directionId,shapeId:p.shapeId,shapeAvailable:index.shapes.has(p.shapeId),stopIds:p.stopIds,tripCount:p.tripCount};
      const segment = (!order || orderedMatch(p.stopIds,order)) ? segmentFor(p,matched,index) : null;
      candidates.push({patternId:p.patternId,matchedStopIds:matched,missingStopIds:scopedStops.filter(id => !matched.includes(id)),serviceActive:active,...(segment ? {affectedSegment:segment} : {})});
    }
  }
  // Trip diagnostics must reference the shared catalog even if no candidate survives.
  for (const trip of trips) if (trip.matched && trip.patternId && !catalog[trip.patternId]) {
    const p = index.patterns.get(trip.patternId);
    catalog[p.patternId] = {patternId:p.patternId,routeId:p.routeId,directionId:p.directionId,shapeId:p.shapeId,shapeAvailable:index.shapes.has(p.shapeId),stopIds:p.stopIds,tripCount:p.tripCount};
  }
  const statuses = routeResults.map(r => r.status);
  const unknown = routes.some(r => !r.matched) || stops.some(s => !s.matched) || trips.some(t => !t.matched);
  const status = routes.some(r => r.matched) && statuses.length && statuses.every(s => s === 'exact') && !unknown ? 'exact'
    : statuses.includes('ambiguous') && !unknown && !statuses.includes('partial') && !statuses.includes('unmatched') ? 'ambiguous'
    : routes.some(r => r.matched) || stops.some(s => s.matched) || candidates.length ? 'partial' : 'unmatched';
  return {status,routes,stops,trips,routeResults,serviceDate,candidates};
}

export function correlateState(state,index,now, metadata = {}) {
  const patterns = {};
  const items = state.items.map(item => ({...item,correlation:correlateAlert(item,index,now,patterns)}));
  const counts = {exact:0,partial:0,ambiguous:0,unmatched:0};
  for (const item of items) counts[item.correlation.status]++;
  const unmatched = key => sortedUnique(items.flatMap(i => i.correlation[key].filter(v => !v.matched).map(v => v[{routes:'routeId',stops:'stopId',trips:'tripId'}[key]])));
  return {...state,items,staticCorrelation:{schemaVersion:1,status:'ok',version:index.version,...metadata,counts:index.counts,patterns,
    report:{alerts:items.length,...counts,unmatchedRouteIds:unmatched('routes'),unmatchedStopIds:unmatched('stops'),unmatchedTripIds:unmatched('trips')}}};
}

export function validateCorrelation(state) {
  const meta = state.staticCorrelation;
  if (!meta) { if (state.items.some(i => i.correlation)) throw new Error('Missing static correlation metadata'); return; }
  const fail = () => { throw new Error('Invalid TTC correlation'); };
  const nonnegative = n => Number.isInteger(n) && n >= 0;
  const instant = s => typeof s === 'string' && Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s;
  const ids = a => Array.isArray(a) && a.every(v => typeof v === 'string' && v.length);
  if (meta.schemaVersion !== 1 || !['ok','stale','unavailable'].includes(meta.status) || !meta.patterns || typeof meta.patterns !== 'object' || Array.isArray(meta.patterns)) fail();
  if (['fetchedAt','checkedAt'].some(k => meta[k] !== undefined && !instant(meta[k]))) fail();
  if (meta.status !== 'unavailable' && (typeof meta.version !== 'string' || !meta.version || !meta.counts || !meta.report)) fail();
  if (meta.counts && Object.values(meta.counts).some(v => !nonnegative(v))) fail();
  if (meta.report && (!['alerts','exact','partial','ambiguous','unmatched'].every(k => nonnegative(meta.report[k])) || !['unmatchedRouteIds','unmatchedStopIds','unmatchedTripIds'].every(k => ids(meta.report[k])))) fail();
  for (const [key,p] of Object.entries(meta.patterns)) {
    if (!p || key !== p.patternId || !/^[a-f0-9]{64}$/.test(key) || typeof p.routeId !== 'string' || !p.routeId || !ids(p.stopIds) || !p.stopIds.length || ![null,0,1].includes(p.directionId) || !(p.shapeId === null || typeof p.shapeId === 'string') || typeof p.shapeAvailable !== 'boolean' || !Number.isInteger(p.tripCount) || p.tripCount < 1 || key !== digest(JSON.stringify([p.routeId,p.directionId,p.shapeId,p.stopIds])) || (p.shapeAvailable && !p.shapeId)) fail();
  }
  for (const item of state.items) {
    const c = item.correlation;
    if (!c) { if (meta.status !== 'unavailable') fail(); continue; }
    if (!['exact','partial','ambiguous','unmatched'].includes(c.status) || !['routes','stops','trips','routeResults','candidates'].every(k => Array.isArray(c[k]))) fail();
    for (const [key,id] of [['routes','routeId'],['stops','stopId'],['trips','tripId']]) {
      if (new Set(c[key].map(v => v[id])).size !== c[key].length) fail();
      for (const v of c[key]) {
        if (typeof v[id] !== 'string' || !v[id] || typeof v.matched !== 'boolean') fail();
        if (key === 'routes' && v.matched && (!Number.isInteger(v.routeType) || v.routeType < 0)) fail();
        if (key === 'stops' && v.matched && !validCoordinate(v.latitude,v.longitude)) fail();
        if (key === 'trips' && v.matched && v.patternId !== null && !meta.patterns[v.patternId]) fail();
      }
    }
    if (item.routes.some(id => !c.routes.some(v => v.routeId === id)) || item.stops.some(id => !c.stops.some(v => v.stopId === id))) fail();
    if (new Set(c.routeResults.map(r => r.routeId)).size !== c.routeResults.length || c.routes.some(r => !c.routeResults.some(v => v.routeId === r.routeId)) || !/^\d{8}$/.test(c.serviceDate)) fail();
    if (c.routeResults.some(r => !r || typeof r.routeId !== 'string' || !['exact','partial','ambiguous','unmatched'].includes(r.status))) fail();
    if (c.status === 'exact' && (c.routeResults.some(r => r.status !== 'exact') || new Set(c.candidates.map(v => meta.patterns[v.patternId]?.routeId)).size !== c.candidates.length || c.stops.some(s => !c.candidates.some(v => v.matchedStopIds?.includes(s.stopId))))) fail();
    if (c.status === 'exact' && (!c.candidates.length || !c.routes.some(r => r.matched) || c.routes.some(r => !r.matched) || c.stops.some(s => !s.matched) || c.trips.some(t => !t.matched))) fail();
    if (new Set(c.candidates.map(p => p.patternId)).size !== c.candidates.length) fail();
    for (const candidate of c.candidates) {
      const p = meta.patterns[candidate.patternId], s = candidate.affectedSegment;
      if (!p || typeof candidate.serviceActive !== 'boolean' || (c.status === 'exact' && !candidate.matchedStopIds?.length) || !ids(candidate.matchedStopIds) || !ids(candidate.missingStopIds) || candidate.matchedStopIds.some(id => !p.stopIds.includes(id) || !c.stops.some(s => s.stopId === id && s.matched)) || (c.status === 'exact' && candidate.missingStopIds.length)) fail();
      if (s) {
        if (!ids(s.stopIds) || !candidate.matchedStopIds.includes(s.firstStopId) || !candidate.matchedStopIds.includes(s.lastStopId) || s.stopIds.length < 2 || s.firstStopId !== s.stopIds[0] || s.lastStopId !== s.stopIds.at(-1) || s.shapeId !== p.shapeId || !['missing','ambiguous','projected'].includes(s.geometryStatus)) fail();
        const at = p.stopIds.indexOf(s.firstStopId);
        if (JSON.stringify(p.stopIds.slice(at,at+s.stopIds.length)) !== JSON.stringify(s.stopIds)) fail();
        if (s.geometryStatus === 'projected' && (!p.shapeAvailable || !Array.isArray(s.geometry) || s.geometry.length < 2)) fail();
        if (s.geometry !== undefined && (s.geometryStatus !== 'projected' || !Array.isArray(s.geometry) || s.geometry.some(v => !Array.isArray(v) || v.length !== 2 || !validCoordinate(v[1],v[0])))) fail();
      }
    }
  }
}
