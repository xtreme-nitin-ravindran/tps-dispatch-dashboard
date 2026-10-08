import { TTC_STOP_LOOKUP } from './ttc-stops.js';

export const ROAD_FEED = 'https://secure.toronto.ca/opendata/cart/road_restrictions/v3?format=json';
export const TTC_FEED = 'https://gtfsrt.ttc.ca/alerts/all?format=text';
export const ROAD_LINK = 'https://www.toronto.ca/services-payments/streets-parking-transportation/road-restrictions-closures/restrictions-map/';
export const TTC_LINK = 'https://www.ttc.ca/service-advisories/all-service-alerts';
const clean = value => String(value ?? '').trim();
const number = value => value == null || value === '' ? null : Number(value);
const point = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180;
const ROAD_SOURCE = Object.freeze({name:'City of Toronto Road Restrictions',url:ROAD_LINK,feedUrl:ROAD_FEED});

// Parse the documented TTC textproto endpoint; reject incomplete/unsupported input.
export function parseTextProto(text) {
  const jsonEntities = [];
  // TTC includes JSON-shaped entities for some services in its text feed.
  text = text.replace(/entity\s+(\{\s*")/g, 'entity $1');
  let match;
  while ((match = /entity (\{\s*")/.exec(text))) {
    const start = match.index + 7;
    let depth=0, quoted=false, escaped=false, end=start;
    for (; end<text.length; end++) {
      const c=text[end];
      if (quoted) { if (escaped) escaped=false; else if (c==='\\') escaped=true; else if(c==='"') quoted=false; }
      else if(c==='"') quoted=true;
      else if(c==='{') depth++;
      else if(c==='}' && --depth===0) {end++;break;}
    }
    const convert = object => {
      const result=Object.create(null);
      for (const [key,value] of Object.entries(object)) {
        const name=key.replace(/[A-Z]/g,c=>'_'+c.toLowerCase());
        result[name]=(Array.isArray(value)?value:[value]).map(v => v && typeof v==='object' ? convert(v) : v);
      }
      return result;
    };
    jsonEntities.push(convert(JSON.parse(text.slice(start,end))));
    text=text.slice(0,match.index)+text.slice(end);
  }
  const tokens = []; const regex = /\s+|#[^\n]*|"(?:[^"\\]|\\.)*"|[{}:]|[A-Za-z_][A-Za-z_0-9]*|-?\d+(?:\.\d+)?/gy;
  let at = 0;
  while (at < text.length) {
    regex.lastIndex = at; const match = regex.exec(text);
    if (!match) throw new Error('Invalid TTC textproto');
    at = regex.lastIndex;
    if (!/^\s|^#/.test(match[0])) tokens.push(match[0]);
  }
  let i = 0;
  function message(nested = false, depth = 0) {
    if (depth > 20) throw new Error('TTC nesting limit');
    const output = Object.create(null);
    while (i < tokens.length && tokens[i] !== '}') {
      const key = tokens[i++];
      if (!/^[A-Za-z_]\w*$/.test(key)) throw new Error('Invalid TTC field');
      let value;
      if (tokens[i] === ':') {
        i++; const token = tokens[i++];
        if (!token || ['{','}',':'].includes(token)) throw new Error('Missing TTC value');
        value = token.startsWith('"') ? JSON.parse(token) : /^-?\d/.test(token) ? Number(token) : token;
      } else if (tokens[i++] === '{') value = message(true, depth + 1);
      else throw new Error('Missing TTC field separator');
      (output[key] ||= []).push(value);
    }
    if (nested && tokens[i++] !== '}') throw new Error('Truncated TTC message');
    return output;
  }
  const result = message();
  if (i !== tokens.length) throw new Error('Unexpected TTC closing brace');
  result.entity = [...(result.entity || []), ...jsonEntities];
  return result;
}
const first = (object, key) => object?.[key]?.[0];
function translated(object) {
  const translations = object?.translation || [];
  return clean(first(translations.find(t => first(t,'language') === 'en') || translations[0], 'text'));
}
// Fixed reason keys for per-entity rejection; never derived from upstream text.
export const TTC_REJECTION_REASONS = Object.freeze(['missing_id','missing_title','invalid_active_period']);
export function normalizeTransit(text, now = Date.now(), stopLookup = TTC_STOP_LOOKUP) {
  const feed = parseTextProto(text);
  const header = first(feed,'header');
  const timestamp = Number(first(header,'timestamp')) * 1000;
  if (!first(header,'gtfs_realtime_version') || !Number.isFinite(timestamp) || timestamp > now + 300000 || now - timestamp > 3600000 || first(header,'incrementality') === 'DIFFERENTIAL') throw new Error('Invalid or stale TTC feed');
  const rejected = Object.fromEntries(TTC_REJECTION_REASONS.map(reason => [reason, 0]));
  const items = [];
  for (const entity of feed.entity) {
    const alert = first(entity,'alert');
    if (!alert || first(entity,'is_deleted') === 'true') continue;
    // GTFS-Realtime marks header_text Required; a spec-violating entity is skipped
    // with a bounded reason so valid siblings are never discarded. A title is never
    // synthesized from description, route ids, or any other free-form field.
    const id = clean(first(entity,'id'));
    if (!id) { rejected.missing_id++; continue; }
    const title = translated(first(alert,'header_text'));
    if (!title) { rejected.missing_title++; continue; }
    const periods = (alert.active_period || []).map(p => ({start: number(first(p,'start')) === null ? null : number(first(p,'start')) * 1000, end:number(first(p,'end')) === null ? null : number(first(p,'end')) * 1000}));
    if (periods.some(p => [p.start,p.end].some(v => v !== null && !Number.isFinite(v)))) { rejected.invalid_active_period++; continue; }
    const affectedEntities = (alert.informed_entity || []).map(entity => {
      const routeId = clean(first(entity,'route_id')) || null;
      const stopId = clean(first(entity,'stop_id')) || null;
      const stop = stopId ? stopLookup[stopId] : null;
      const coordinates = Array.isArray(stop) ? stop.slice(0,2) : stop?.coordinates;
      const name = Array.isArray(stop) ? clean(stop[2]) : clean(stop?.name);
      return {
        routeId, stopId,
        ...(point(coordinates) ? {coordinates:[...coordinates]} : {}),
        ...(name ? {name} : {})
      };
    });
    items.push({
      id, title, description:translated(first(alert,'description_text')), effect:clean(first(alert,'effect')).replaceAll('_',' '),
      routes:[...new Set(affectedEntities.map(entity => entity.routeId).filter(Boolean))],
      stopIds:[...new Set(affectedEntities.map(entity => entity.stopId).filter(Boolean))],
      affectedEntities, periods, url:TTC_LINK
    });
  }
  const rejectedCount = TTC_REJECTION_REASONS.reduce((total, reason) => total + rejected[reason], 0);
  return {items, sourceUpdatedAt:new Date(timestamp).toISOString(), rejected:rejectedCount, rejectedReasons:rejected};
}
// Fixed reason keys for per-record rejection; never derived from upstream text.
export const ROAD_REJECTION_REASONS = Object.freeze(['missing_id','missing_name','invalid_dates']);
export function normalizeRoads(payload) {
  if (!Array.isArray(payload?.Closure)) throw new Error('Invalid road restriction feed');
  const rejected = Object.fromEntries(ROAD_REJECTION_REASONS.map(reason => [reason, 0]));
  const items = [];
  for (const row of payload.Closure) {
    // A malformed record is skipped with a bounded reason so valid siblings are
    // never discarded. Missing identity, name, or dates are never synthesized.
    if (!row || typeof row !== 'object') { rejected.missing_id++; continue; }
    if (!row.id) { rejected.missing_id++; continue; }
    if (!(row.name || row.road)) { rejected.missing_name++; continue; }
    if ([row.startTime,row.endTime].some(v => number(v) !== null && !Number.isFinite(number(v)))) { rejected.invalid_dates++; continue; }
    let line = [];
    try { line = JSON.parse(`[${row.geoPolyline || ''}]`).map(p => [p[1],p[0]]); } catch { /* Some restrictions have no segment geometry. */ }
    if (line.length < 2 || !line.every(point)) line = [];
    const coordinates = [number(row.latitude),number(row.longitude)];
    const validCoordinates = point(coordinates) ? coordinates : null;
    const geometry = line.length
      ? {type:'LineString',coordinates:line.map(([latitude,longitude]) => [longitude,latitude])}
      : validCoordinates ? {type:'Point',coordinates:[validCoordinates[1],validCoordinates[0]]} : null;
    const schedules = ['Everyday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].filter(day => row[`schedule${day}`]).map(day => `${day}: ${row[`schedule${day}`]}`).join('; ');
    const url=clean(row.URL) || ROAD_LINK;
    items.push({
      id:clean(row.id), street:clean(row.road), title:clean(row.name || row.road), description:clean(row.description),
      restrictionType:clean(row.type).replaceAll('_',' '), type:clean(row.type).replaceAll('_',' '), impact:clean(row.currImpact),
      startLocation:clean(row.fromRoad || row.atRoad), endLocation:clean(row.toRoad),
      start:number(row.startTime), reportedAt:number(row.createdTime), end:number(row.endTime), status:clean(row.status) || null,
      expired:Number(row.expired) === 1, coordinates:validCoordinates, line, geometry,
      geometryKind:geometry?.type === 'LineString' ? 'line' : geometry?.type === 'Point' ? 'point' : 'none',
      schedule:schedules, source:{...ROAD_SOURCE,url}, url
    });
  }
  const rejectedCount = ROAD_REJECTION_REASONS.reduce((total, reason) => total + rejected[reason], 0);
  return {items, rejected:rejectedCount, rejectedReasons:rejected};
}
// A bounded pre-parse repair for the roads feed. The City feed can emit a raw
// backslash that is not a legal JSON escape (for example `\ ` inside a
// description), which makes the whole document fail JSON.parse before any
// per-record validation can run. This escapes only an illegal backslash so the
// document parses; valid escapes and every other byte are left untouched, and the
// decoded source text is preserved verbatim (no content is invented). Returns the
// repaired text and the bounded count of repaired escapes (never raw upstream text).
export function repairIllegalJsonEscapes(text) {
  const source = String(text ?? '');
  let repaired = 0;
  let output = '';
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char !== '\\') { output += char; continue; }
    const next = source[i + 1];
    if (next === 'u') {
      const hex = source.slice(i + 2, i + 6);
      if (/^[0-9a-fA-F]{4}$/.test(hex)) { output += `\\u${hex}`; i += 5; continue; }
    } else if (next !== undefined && '"\\/bfnrt'.includes(next)) {
      output += char + next; i++; continue;
    }
    // Illegal escape: escape the backslash itself so the document parses.
    output += '\\\\';
    repaired++;
  }
  return { text: output, repaired };
}
export async function fetchDisruptionSource(kind, fetchImpl = fetch, now = Date.now()) {
  const response = await fetchImpl(kind === 'roads' ? ROAD_FEED : TTC_FEED, {signal:AbortSignal.timeout(12000)});
  if (!response.ok) throw new Error(`Disruption feed HTTP ${response.status}`);
  if (kind !== 'roads') return normalizeTransit(await response.text(), now);
  const body = await response.text();
  try {
    return {...normalizeRoads(JSON.parse(body)), repaired:0};
  } catch {
    // The whole document failed to parse. Attempt the bounded illegal-escape
    // repair once; if it still fails, the source stays unavailable.
    const attempt = repairIllegalJsonEscapes(body);
    return {...normalizeRoads(JSON.parse(attempt.text)), repaired:attempt.repaired};
  }
}
export async function updateDisruptions(previous = {}, now = new Date(), fetchSource = fetchDisruptionSource, log = entry => console.log(JSON.stringify(entry))) {
  const entries = await Promise.all(['roads','transit'].map(async kind => {
    const old = previous?.[kind];
    const age = now.getTime() - Date.parse(old?.checkedAt);
    if (age >= 0 && age < 300000) return [kind,old];
    try {
      const result = await fetchSource(kind, undefined, now.getTime());
      // Bounded, privacy-safe diagnostics: counts and fixed reason keys only, never raw upstream text.
      if (result.rejected > 0) log({source:kind === 'roads' ? 'toronto-roads' : 'ttc-transit',status:'ok',count:result.items.length,rejected:result.rejected,rejectedReasons:result.rejectedReasons});
      if (result.repaired > 0) log({source:'toronto-roads',status:'ok',count:result.items.length,repaired:result.repaired});
      return [kind,{...result,status:'ok',checkedAt:now.toISOString(),fetchedAt:now.toISOString()}];
    } catch {
      return [kind,{items:old?.items || [],sourceUpdatedAt:old?.sourceUpdatedAt || null,fetchedAt:old?.fetchedAt || null,checkedAt:now.toISOString(),status:'unavailable'}];
    }
  }));
  return Object.fromEntries(entries);
}
