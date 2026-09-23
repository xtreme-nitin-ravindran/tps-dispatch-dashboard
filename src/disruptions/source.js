export const ROAD_FEED = 'https://secure.toronto.ca/opendata/cart/road_restrictions/v3?format=json';
export const TTC_FEED = 'https://gtfsrt.ttc.ca/alerts/all?format=text';
export const ROAD_LINK = 'https://www.toronto.ca/services-payments/streets-parking-transportation/road-restrictions-closures/restrictions-map/';
export const TTC_LINK = 'https://www.ttc.ca/service-advisories/all-service-alerts';
const clean = value => String(value ?? '').trim();
const number = value => value == null || value === '' ? null : Number(value);
const point = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180;

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
export function normalizeTransit(text, now = Date.now()) {
  const feed = parseTextProto(text);
  const header = first(feed,'header');
  const timestamp = Number(first(header,'timestamp')) * 1000;
  if (!first(header,'gtfs_realtime_version') || !Number.isFinite(timestamp) || timestamp > now + 300000 || now - timestamp > 3600000 || first(header,'incrementality') === 'DIFFERENTIAL') throw new Error('Invalid or stale TTC feed');
  const items = feed.entity.flatMap(entity => {
    const alert = first(entity,'alert');
    if (!alert || first(entity,'is_deleted') === 'true') return [];
    const title = translated(first(alert,'header_text'));
    const id = clean(first(entity,'id'));
    if (!title || !id) throw new Error('Invalid TTC alert');
    const periods = (alert.active_period || []).map(p => ({start: number(first(p,'start')) === null ? null : number(first(p,'start')) * 1000, end:number(first(p,'end')) === null ? null : number(first(p,'end')) * 1000}));
    if (periods.some(p => [p.start,p.end].some(v => v !== null && !Number.isFinite(v)))) throw new Error('Invalid TTC active period');
    return [{id, title, description:translated(first(alert,'description_text')), effect:clean(first(alert,'effect')).replaceAll('_',' '), routes:[...new Set((alert.informed_entity || []).map(e => clean(first(e,'route_id'))).filter(Boolean))], periods, url:TTC_LINK}];
  });
  return {items, sourceUpdatedAt:new Date(timestamp).toISOString()};
}
export function normalizeRoads(payload) {
  if (!Array.isArray(payload?.Closure)) throw new Error('Invalid road restriction feed');
  const items = payload.Closure.map(row => {
    if (!row.id || !(row.name || row.road)) throw new Error('Invalid road restriction');
    if ([row.startTime,row.endTime].some(v => number(v) !== null && !Number.isFinite(number(v)))) throw new Error('Invalid road dates');
    let line = [];
    try { line = JSON.parse(`[${row.geoPolyline || ''}]`).map(p => [p[1],p[0]]); } catch { /* Some restrictions have no segment geometry. */ }
    if (!line.every(point)) line = [];
    const coordinates = [number(row.latitude),number(row.longitude)];
    const schedules = ['Everyday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].filter(day => row[`schedule${day}`]).map(day => `${day}: ${row[`schedule${day}`]}`).join('; ');
    return {id:clean(row.id),title:clean(row.name || row.road),description:clean(row.description),type:clean(row.type).replaceAll('_',' '),impact:clean(row.currImpact),start:number(row.startTime),end:number(row.endTime),expired:Number(row.expired) === 1,coordinates:point(coordinates) ? coordinates : null,line,schedule:schedules,url:ROAD_LINK};
  });
  return {items};
}
export async function fetchDisruptionSource(kind, fetchImpl = fetch, now = Date.now()) {
  const response = await fetchImpl(kind === 'roads' ? ROAD_FEED : TTC_FEED, {signal:AbortSignal.timeout(12000)});
  if (!response.ok) throw new Error(`Disruption feed HTTP ${response.status}`);
  return kind === 'roads' ? normalizeRoads(await response.json()) : normalizeTransit(await response.text(), now);
}
export async function updateDisruptions(previous = {}, now = new Date(), fetchSource = fetchDisruptionSource) {
  const entries = await Promise.all(['roads','transit'].map(async kind => {
    const old = previous?.[kind];
    const age = now.getTime() - Date.parse(old?.checkedAt);
    if (age >= 0 && age < 300000) return [kind,old];
    try {
      const result = await fetchSource(kind, undefined, now.getTime());
      return [kind,{...result,status:'ok',checkedAt:now.toISOString(),fetchedAt:now.toISOString()}];
    } catch {
      return [kind,{items:old?.items || [],sourceUpdatedAt:old?.sourceUpdatedAt || null,fetchedAt:old?.fetchedAt || null,checkedAt:now.toISOString(),status:'unavailable'}];
    }
  }));
  return Object.fromEntries(entries);
}
