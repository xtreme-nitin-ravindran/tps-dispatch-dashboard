// Story 76 — TTC-published detour shapes from the GTFS-RT TripModifications feed.
//
// livemap.ttc.ca/alerts/detours draws its detour geometry from this feed: each
// `tripModifications` entity selects scheduled trip ids and references a
// companion `shape` entity whose `encodedPolyline` is the published temporary
// route. This module decodes that geometry and joins the trip ids to the shared
// static GTFS index, so the published shapes reach the map without any inferred
// path. Published geometry is never simplified or re-derived.
import { validCoordinate } from './static-gtfs.js';

// The host is what the TTC's own livemap consumes; it is not a documented
// public API, so a fetch failure is treated like any other feed failure
// (retain the previous artifact, mark the source unavailable).
export const TTC_TRIP_MODIFICATIONS_URL = 'https://ttcmapsapi-ewacfyffhjffhces.canadacentral-01.azurewebsites.net/api/trip-modifications';
export const DETOUR_POLICY = Object.freeze({ maxDetours: 200, maxGeometryPoints: 5000, maxServiceDates: 60, maxArtifactBytes: 8 * 1024 * 1024 });

const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
// A valid published line: at least two [longitude, latitude] points within the
// geometry budget, each a validated coordinate pair.
export const validGeometryLine = geometry => Array.isArray(geometry) && geometry.length >= 2 && geometry.length <= DETOUR_POLICY.maxGeometryPoints &&
  geometry.every(p => Array.isArray(p) && p.length === 2 && validCoordinate(p[1],p[0]));
const id = value => typeof value === 'string' && value.length > 0;
const serviceDate = value => typeof value === 'string' && /^\d{8}$/.test(value);
const dateAt = time => new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(time).replaceAll('-','');

// Standard Google encoded-polyline decoding; output is [longitude, latitude]
// pairs to match the diversion part geometry contract.
export function decodePolyline(polyline) {
  if (!id(polyline)) throw new Error('Missing detour polyline');
  const points = [];
  let latitude = 0, longitude = 0;
  for (let at = 0; at < polyline.length;) {
    let value = 0, shift = 0, byte;
    do {
      byte = polyline.charCodeAt(at++) - 63;
      if (!Number.isInteger(byte) || byte < 0) throw new Error('Invalid detour polyline');
      value |= (byte & 0x1f) << shift; shift += 5;
    } while (byte >= 0x20);
    latitude += value & 1 ? ~(value >> 1) : value >> 1;
    value = 0; shift = 0;
    do {
      byte = polyline.charCodeAt(at++) - 63;
      if (!Number.isInteger(byte) || byte < 0) throw new Error('Invalid detour polyline');
      value |= (byte & 0x1f) << shift; shift += 5;
    } while (byte >= 0x20);
    longitude += value & 1 ? ~(value >> 1) : value >> 1;
    points.push([longitude / 1e5, latitude / 1e5]);
  }
  if (points.length < 2) throw new Error('Detour polyline has fewer than two points');
  if (points.length > DETOUR_POLICY.maxGeometryPoints) throw new Error('Detour polyline exceeds point limit');
  for (const [longitude, latitude] of points) if (!validCoordinate(latitude, longitude)) throw new Error('Detour polyline coordinates out of range');
  return points;
}

// Normalize the live feed against the static index. Detours whose trip ids do
// not resolve to exactly one route, whose shape is missing or undecodable, or
// whose service dates exclude today are dropped with a bounded reason. Detours
// sharing an identical route/direction/geometry collapse into one record (the
// TTC publishes per-block duplicates of the same physical shape).
export function normalizeTripModifications(payload, index, now = new Date()) {
  if (!payload || !Array.isArray(payload.entity)) throw new Error('Invalid TTC trip-modifications feed');
  const shapes = new Map();
  for (const entity of payload.entity) {
    const shape = entity?.shape;
    if (!shape || !id(shape.shapeId) || !id(shape.encodedPolyline)) continue;
    shapes.set(shape.shapeId, shape.encodedPolyline);
  }
  const today = dateAt(now);
  const report = { shapeEntities: shapes.size, noTrips: 0, ambiguousRoute: 0, noShape: 0, polyline: 0, missingId: 0, capacity: 0 };
  const records = [], bySignature = new Map();
  for (const entity of payload.entity) {
    const tm = entity?.tripModifications;
    if (!tm || !Array.isArray(tm.selectedTrips) || !tm.selectedTrips.length) continue;
    const serviceDates = [...new Set((Array.isArray(tm.serviceDates) ? tm.serviceDates : []).filter(serviceDate))].sort();
    if (serviceDates.length && !serviceDates.includes(today)) continue;
    const tripIds = [...new Set(tm.selectedTrips.flatMap(s => Array.isArray(s.tripIds) ? s.tripIds.filter(id) : []))];
    const routes = [...new Set(tripIds.map(tripId => index.trips.get(tripId)?.routeId).filter(Boolean))];
    if (!routes.length) { report.noTrips++; continue; }
    if (routes.length > 1) { report.ambiguousRoute++; continue; }
    const routeId = routes[0];
    const directions = [...new Set(tripIds.map(tripId => index.trips.get(tripId)?.directionId).filter(d => d !== null && d !== undefined))];
    const shapeId = tm.selectedTrips[0]?.shapeId;
    const polyline = id(shapeId) ? shapes.get(shapeId) : undefined;
    if (!polyline) { report.noShape++; continue; }
    let geometry;
    try { geometry = decodePolyline(polyline); } catch { report.polyline++; continue; }
    if (!id(entity.id)) { report.missingId++; continue; }
    const first = tm.modifications?.[0];
    const start = Number.isInteger(first?.startStopSelector?.stopSequence) ? first.startStopSelector.stopSequence : null;
    const end = Number.isInteger(first?.endStopSelector?.stopSequence) ? first.endStopSelector.stopSequence : null;
    const signature = JSON.stringify([routeId, directions.length === 1 ? directions[0] : null, geometry]);
    const existing = bySignature.get(signature);
    if (existing) {
      existing.tripCount += tripIds.length;
      existing.serviceDates = [...new Set([...existing.serviceDates, ...serviceDates])].sort();
      continue;
    }
    if (records.length >= DETOUR_POLICY.maxDetours) { report.capacity++; continue; }
    const route = index.routes.get(routeId);
    const record = { id: entity.id, shapeId, routeId, routeLabel: [route?.routeShortName, route?.routeLongName].filter(Boolean).join(' ') || routeId,
      directionId: directions.length === 1 ? directions[0] : null, serviceDates, tripCount: tripIds.length,
      startStopSequence: start, endStopSequence: end, geometry };
    records.push(record); bySignature.set(signature, record);
  }
  return { detours: records, report };
}

export function validateTtcDetours(value) {
  const fail = () => { throw new Error('Invalid TTC detour artifact'); };
  // Null stop selectors are valid (unknown stop sequence); numeric selectors
  // must be non-negative integers.
  const nonnegative = n => n === null || n === undefined || (Number.isInteger(n) && n >= 0);
  if (!value || value.schemaVersion !== 1 || !['ok','unavailable'].includes(value.status) || !Array.isArray(value.detours) ||
    !iso(value.checkedAt) || !(iso(value.fetchedAt) || (value.status === 'unavailable' && value.fetchedAt === null && !value.detours.length))) fail();
  if (Buffer.byteLength(JSON.stringify(value)) > DETOUR_POLICY.maxArtifactBytes) fail();
  const ids = new Set();
  for (const d of value.detours) {
    if (!d || !id(d.id) || ids.has(d.id)) fail();
    if (!id(d.shapeId) || !id(d.routeId) || !id(d.routeLabel)) fail();
    if (![null,0,1].includes(d.directionId)) fail();
    if (!Array.isArray(d.serviceDates) || d.serviceDates.length > DETOUR_POLICY.maxServiceDates) fail();
    if (d.serviceDates.some(v => !serviceDate(v) || d.serviceDates.filter(x => x === v).length > 1)) fail();
    if (!nonnegative(d.tripCount) || d.tripCount < 1) fail();
    if (!nonnegative(d.startStopSequence) || !nonnegative(d.endStopSequence)) fail();
    if (!validGeometryLine(d.geometry)) fail();
    ids.add(d.id);
  }
  return value;
}

export async function fetchTripModifications(fetchImpl = fetch) {
  const response = await fetchImpl(TTC_TRIP_MODIFICATIONS_URL,{signal:AbortSignal.timeout(12000)});
  if (!response.ok) throw new Error(`TTC trip modifications HTTP ${response.status}`);
  return await response.json();
}

export async function updateTtcDetours(previous, now = new Date(), { index, fetchSource = fetchTripModifications, log = entry => console.log(JSON.stringify(entry)) } = {}) {
  if (previous) validateTtcDetours(previous);
  if (!index) {
    log({source:'ttc-detours',status:'unavailable',reason:'static-index',retainedCount:previous?.detours.length || 0});
    return {...(previous || {schemaVersion:1,status:'unavailable',fetchedAt:null,checkedAt:null,detours:[]}),status:'unavailable',checkedAt:now.toISOString()};
  }
  try {
    // Story 78: the default source (fetchTripModifications) takes its fetch
    // implementation positionally, not `now`, so pass no arguments. Every
    // injected source in the callers and tests is zero-argument too.
    const payload = await fetchSource();
    const {detours,report} = normalizeTripModifications(payload,index,now);
    const result = {schemaVersion:1,status:'ok',fetchedAt:now.toISOString(),checkedAt:now.toISOString(),detours};
    validateTtcDetours(result);
    log({source:'ttc-detours',status:'ok',count:detours.length,...report});
    return result;
  } catch (error) {
    log({source:'ttc-detours',status:'unavailable',error:error.message,retainedCount:previous?.detours.length || 0});
    return {...(previous || {schemaVersion:1,status:'unavailable',fetchedAt:null,checkedAt:null,detours:[]}),status:'unavailable',checkedAt:now.toISOString()};
  }
}
