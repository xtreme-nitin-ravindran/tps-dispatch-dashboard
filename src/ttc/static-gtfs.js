import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { StringDecoder } from 'node:string_decoder';

export const STATIC_URL = 'https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/bd4809dd-e289-4de8-bbde-c5c00dafbf4f/resource/28514055-d011-4ed7-8bb0-97961dfe2b66/download/surfacegtfs.zip';
const required = ['routes.txt','stops.txt','trips.txt','stop_times.txt'];
const files = [...required,'shapes.txt','calendar.txt','calendar_dates.txt'];
export const sortedUnique = values => [...new Set(values)].sort();
export const digest = value => createHash('sha256').update(value).digest('hex');

// Read only named members, never extract paths. Reject ZIP64/encryption and oversized members.
export function zipTables(bytes) {
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0 || bytes.readUInt32LE(end) !== 0x06054b50) throw new Error('Invalid GTFS ZIP');
  if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) throw new Error('Multipart GTFS ZIP');
  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid ZIP directory');
    const flags = bytes.readUInt16LE(offset + 8), method = bytes.readUInt16LE(offset + 10);
    const size = bytes.readUInt32LE(offset + 20), expanded = bytes.readUInt32LE(offset + 24);
    const length = bytes.readUInt16LE(offset + 28), extra = bytes.readUInt16LE(offset + 30), comment = bytes.readUInt16LE(offset + 32);
    const name = bytes.subarray(offset + 46, offset + 46 + length).toString('utf8');
    if (files.includes(name)) {
      if (entries.has(name) || flags & 1 || ![0,8].includes(method) || expanded > 768 * 1024 * 1024) throw new Error('Unsupported GTFS ZIP member');
      const local = bytes.readUInt32LE(offset + 42);
      if (bytes.readUInt32LE(local) !== 0x04034b50) throw new Error('Invalid ZIP member');
      const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
      entries.set(name, () => {
        const compressed = bytes.subarray(start,start + size);
        const result = method === 0 ? compressed : inflateRawSync(compressed,{maxOutputLength:768 * 1024 * 1024});
        if (result.length !== expanded) throw new Error('Truncated GTFS member');
        return result;
      });
    }
    offset += 46 + length + extra + comment;
  }
  for (const name of required) if (!entries.has(name)) throw new Error(`Missing GTFS ${name}`);
  return name => entries.get(name)?.();
}

// RFC4180 records, including escaped quotes, commas and multiline quoted fields.
export function* csvRows(input) {
  if (input === undefined) return;
  // Decode bounded chunks: stop_times can exceed 350 MB; never duplicate its
  // entire inflated buffer as a JavaScript string. Carry CSV state across chunks.
  function* chunks() {
    if (typeof input === 'string') { yield input; return; }
    const decoder = new StringDecoder('utf8');
    for (let at = 0; at < input.length; at += 65536) yield decoder.write(input.subarray(at,at+65536));
    yield decoder.end();
  }
  let row = [], value = '', quoted = false, pendingQuote = false, header, first = true;
  for (let chunk of (function* () { yield* chunks(); yield '\n'; })()) {
    if (first) { chunk = chunk.replace(/^\uFEFF/,''); first = false; }
    for (const c of chunk) {
      if (pendingQuote) {
        pendingQuote = false;
        if (c === '"') { value += '"'; continue; }
        quoted = false;
      }
      if (quoted) {
        if (c === '"') pendingQuote = true;
        else value += c;
      } else if (c === '"') {
        if (value !== '') throw new Error('Invalid CSV quote');
        quoted = true;
      } else if (c === ',' || c === '\n') {
        row.push(value.replace(/\r$/,'')); value = '';
        if (c !== ',') {
          if (row.some(v => v !== '')) {
            if (!header) { header = row; if (new Set(header).size !== header.length) throw new Error('Duplicate CSV column'); }
            else { if (row.length !== header.length) throw new Error('Invalid CSV width'); yield Object.fromEntries(header.map((key,j) => [key,row[j]])); }
          }
          row = [];
        }
      } else value += c;
    }
  }
  if (quoted) throw new Error('Unclosed CSV quote');
}

const id = value => { if (typeof value !== 'string' || !value) throw new Error('Missing GTFS identifier'); return value; };
const number = value => { if (value === undefined || value === '' || !Number.isFinite(Number(value))) throw new Error('Invalid GTFS number'); return Number(value); };
const integer = value => { const n = number(value); if (!Number.isInteger(n) || n < 0) throw new Error('Invalid GTFS sequence/type'); return n; };
export const validCoordinate = (lat,lon) => Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lon) && Math.abs(lon) <= 180;
const coordinates = (lat,lon) => { const pair = [number(lat),number(lon)]; if (!validCoordinate(...pair)) throw new Error('Invalid GTFS coordinates'); return pair; };
function put(map,key,value) { if (map.has(key)) throw new Error(`Duplicate GTFS identifier: ${key}`); map.set(id(key),value); }
function sequence(rows) {
  rows.sort((a,b) => a[0] - b[0]);
  if (rows.some((r,i) => i && r[0] === rows[i-1][0])) throw new Error('Duplicate GTFS sequence');
  return rows;
}

export function buildStaticIndex(read, version = 'fixture') {
  const routes = new Map(), stops = new Map(), trips = new Map(), shapes = new Map(), calendars = new Map(), exceptions = new Map();
  for (const r of csvRows(read('routes.txt'))) put(routes,r.route_id,{routeId:r.route_id,routeShortName:r.route_short_name || null,routeLongName:r.route_long_name || null,routeType:integer(r.route_type)});
  for (const r of csvRows(read('stops.txt'))) {
    const [latitude,longitude] = coordinates(r.stop_lat,r.stop_lon);
    put(stops,r.stop_id,{stopId:r.stop_id,stopName:r.stop_name || null,latitude,longitude});
  }
  for (const r of csvRows(read('trips.txt'))) {
    if (!routes.has(r.route_id)) throw new Error('Trip references missing route');
    const directionId = r.direction_id === '' || r.direction_id === undefined ? null : integer(r.direction_id);
    if (directionId !== null && ![0,1].includes(directionId)) throw new Error('Invalid direction');
    put(trips,r.trip_id,{routeId:r.route_id,directionId,shapeId:r.shape_id || null,serviceId:id(r.service_id),rows:[]});
  }
  const stopRows = new Map();
  for (const r of csvRows(read('stop_times.txt'))) {
    const trip = trips.get(r.trip_id);
    if (!trip || !stops.has(r.stop_id)) throw new Error('Stop time references missing trip/stop');
    const sequence = integer(r.stop_sequence), key = `${sequence}:${r.stop_id}`;
    if (!stopRows.has(key)) stopRows.set(key,[sequence,stops.get(r.stop_id).stopId]);
    trip.rows.push(stopRows.get(key));
  }
  stopRows.clear();
  for (const r of csvRows(read('shapes.txt'))) {
    const key = id(r.shape_id);
    if (!shapes.has(key)) shapes.set(key,[]);
    shapes.get(key).push([integer(r.shape_pt_sequence),...coordinates(r.shape_pt_lat,r.shape_pt_lon)]);
  }
  for (const rows of shapes.values()) sequence(rows);
  const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  for (const r of csvRows(read('calendar.txt'))) {
    if (!/^\d{8}$/.test(r.start_date) || !/^\d{8}$/.test(r.end_date) || r.start_date > r.end_date || dayNames.some(d => !['0','1'].includes(r[d]))) throw new Error('Invalid GTFS calendar');
    put(calendars,r.service_id,{start:r.start_date,end:r.end_date,days:dayNames.map(d => r[d] === '1')});
  }
  for (const r of csvRows(read('calendar_dates.txt'))) {
    if (!/^\d{8}$/.test(r.date) || !['1','2'].includes(r.exception_type)) throw new Error('Invalid calendar exception');
    put(exceptions,`${id(r.service_id)}:${r.date}`,Number(r.exception_type));
  }
  if (!routes.size || !stops.size || !trips.size) throw new Error('Empty GTFS network');
  const patterns = new Map(), byRoute = new Map(), byStop = new Map();
  for (const [tripId,trip] of trips) {
    if (!trip.rows.length) { delete trip.rows; trip.patternId = null; continue; }
    const stopIds = sequence(trip.rows).map(r => r[1]);
    const key = digest(JSON.stringify([trip.routeId,trip.directionId,trip.shapeId,stopIds]));
    if (!patterns.has(key)) patterns.set(key,{patternId:key,routeId:trip.routeId,directionId:trip.directionId,shapeId:trip.shapeId,stopIds,serviceIds:new Set(),tripCount:0});
    const pattern = patterns.get(key);
    pattern.serviceIds.add(trip.serviceId); pattern.tripCount++;
    delete trip.rows; trip.patternId = key;
    trips.set(tripId,trip);
  }
  for (const p of [...patterns.values()].sort((a,b) => a.patternId.localeCompare(b.patternId))) {
    p.serviceIds = sortedUnique(p.serviceIds);
    if (!byRoute.has(p.routeId)) byRoute.set(p.routeId,[]);
    byRoute.get(p.routeId).push(p);
    for (const stopId of new Set(p.stopIds)) {
      if (!byStop.has(stopId)) byStop.set(stopId,new Set());
      byStop.get(stopId).add(p.patternId);
    }
  }
  if (!patterns.size) throw new Error('GTFS has no usable patterns');
  return {version,routes,stops,trips,patterns,byRoute,byStop,shapes,calendars,exceptions,
    counts:{routes:routes.size,stops:stops.size,trips:trips.size,patterns:patterns.size,shapes:shapes.size,tripsWithoutStops:[...trips.values()].filter(t => !t.patternId).length}};
}

export function serviceActive(index, serviceId, date) {
  const exception = index.exceptions.get(`${serviceId}:${date}`);
  if (exception) return exception === 1;
  const c = index.calendars.get(serviceId);
  if (!c) return index.calendars.size || index.exceptions.size ? false : null;
  const weekday = new Date(`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}T12:00:00Z`).getUTCDay();
  return date >= c.start && date <= c.end && c.days[weekday];
}
