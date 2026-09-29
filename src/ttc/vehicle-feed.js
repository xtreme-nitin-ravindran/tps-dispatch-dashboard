import { decodeRealtime, realtimeInstant } from './realtime.js';
import { validCoordinate } from './static-gtfs.js';

export const TTC_VEHICLES_URL = 'https://bustime.ttc.ca/gtfsrt/vehicles';
export const MAX_OBSERVATION_AGE_MS = 120000;
export const MAX_FEED_BYTES = 8 * 1024 * 1024;
const usableId = s => typeof s === 'string' && s.trim().length > 0;
export class VehicleSourceError extends Error {
  constructor(reason, message) { super(message); this.reason = reason; }
}
export function parseTtcVehicles(bytes, now = new Date()) {
  let feed;
  try { feed = decodeRealtime(bytes); }
  catch (error) { throw new VehicleSourceError('decode', error.message); }
  let sourceUpdatedAt;
  try { sourceUpdatedAt = realtimeInstant(feed.header.timestamp); }
  catch { throw new VehicleSourceError('stale-feed','Invalid vehicle feed time'); }
  if (!sourceUpdatedAt || now - new Date(sourceUpdatedAt) > MAX_OBSERVATION_AGE_MS || Date.parse(sourceUpdatedAt) > +now + 30000) throw new VehicleSourceError('stale-feed','Missing, stale or future vehicle feed time');
  const diagnostics = {decoded:0,invalid:0,missingIdentity:0,stale:0,duplicates:0,conflicts:0};
  const records = new Map(), conflicts = new Set();
  for (const entity of feed.entity || []) {
    if (entity.isDeleted || !entity.vehicle) continue;
    diagnostics.decoded++;
    const v = entity.vehicle, p = v.position, t = v.trip || {};
    if (!usableId(v.vehicle?.id)) { diagnostics.missingIdentity++; continue; }
    let observedAt;
    try { observedAt = realtimeInstant(v.timestamp); } catch { /* count below */ }
    if (!p || !validCoordinate(p.latitude,p.longitude) || !observedAt) { diagnostics.invalid++; continue; }
    if (+now-Date.parse(observedAt)>MAX_OBSERVATION_AGE_MS || Date.parse(observedAt)>+now+30000) { diagnostics.stale++; continue; }
    const o = {vehicleId:v.vehicle.id,latitude:p.latitude,longitude:p.longitude,observedAt,fetchedAt:now.toISOString(),source:'ttc-gtfs-rt'};
    for (const [key,value] of Object.entries({routeId:t.routeId,tripId:t.tripId,startDate:t.startDate,startTime:t.startTime,stopId:v.stopId})) if (usableId(value)) o[key] = value;
    for (const [key,value,valid] of [['directionId',t.directionId,[0,1].includes(t.directionId)],['bearing',p.bearing,Number.isFinite(p.bearing)&&p.bearing>=0&&p.bearing<=360],['speed',p.speed,Number.isFinite(p.speed)&&p.speed>=0],['stopSequence',v.currentStopSequence,Number.isInteger(v.currentStopSequence)&&v.currentStopSequence>=0],['currentStatus',v.currentStatus,[0,1,2].includes(v.currentStatus)],['scheduleRelationship',t.scheduleRelationship,Number.isInteger(t.scheduleRelationship)]]) if (valid) o[key] = value;
    const key = `${o.vehicleId}\n${o.observedAt}`;
    if (conflicts.has(key)) continue;
    if (records.has(key)) {
      diagnostics.duplicates++;
      if (JSON.stringify(records.get(key)) !== JSON.stringify(o)) { diagnostics.conflicts++; records.delete(key); conflicts.add(key); }
    } else records.set(key,o);
  }
  return {sourceUpdatedAt,observations:[...records.values()].sort((a,b)=>a.observedAt.localeCompare(b.observedAt)||a.vehicleId.localeCompare(b.vehicleId)),diagnostics};
}
export async function fetchTtcVehicles(now = new Date(), fetchImpl = fetch) {
  let bytes;
  try {
    const response = await fetchImpl(TTC_VEHICLES_URL,{signal:AbortSignal.timeout(12000)});
    if (!response.ok) throw new Error(`TTC vehicles HTTP ${response.status}`);
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > MAX_FEED_BYTES) throw new Error('Vehicle feed exceeds size limit');
      chunks.push(chunk);
    }
    bytes = Buffer.concat(chunks);
  } catch (error) { throw new VehicleSourceError('fetch',error.message); }
  return parseTtcVehicles(bytes,now);
}
