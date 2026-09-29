import { validateCorrelation } from './correlation.js';
import { alertContentHash, reconcileAlerts } from './lifecycle.js';
import bindings from 'gtfs-realtime-bindings';

export const TTC_ALERTS_URL = 'https://bustime.ttc.ca/gtfsrt/alerts';
import { decodeRealtime, realtimeInstant as instant } from './realtime.js';
const { Alert } = bindings.transit_realtime;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const unique = values => [...new Set(values.filter(value => value !== undefined && value !== ''))].sort(compare);
const enumName = (type, value) => value === undefined ? undefined : Object.keys(type).find(key => type[key] === value) || `UNKNOWN_${value}`;
const translations = value => (value?.translation || []).map(t => ({text:t.text, ...(t.language ? {language:t.language} : {})})).sort((a,b) => compare(a.language || '', b.language || '') || compare(a.text,b.text));
const text = values => (values.find(t => /^en(?:-|$)/i.test(t.language || '')) || values.find(t => !t.language) || values[0])?.text;
/** Schema v1: snapshot.ttcAlerts contains status, fetchedAt, checkedAt, sourceUpdatedAt,
 * and items. Each item preserves selectors and translations as well as route/stop indexes.
 * Unknown enums are represented as UNKNOWN_<number>; missing fields remain absent.
 */
export function parseTtcAlerts(bytes, now = new Date()) {
  const feed = decodeRealtime(bytes);
  const sourceUpdatedAt = instant(feed.header.timestamp);
  if (sourceUpdatedAt && (Date.parse(sourceUpdatedAt) > now.getTime() + 300000 || now.getTime() - Date.parse(sourceUpdatedAt) > 3600000)) throw new Error('Stale TTC feed');
  const ids = new Map();
  const items = [];
  for (const entity of feed.entity || []) {
    if (entity.isDeleted || !entity.alert) continue;
    const a = entity.alert;
    const cause = enumName(Alert.Cause,a.cause), effect = enumName(Alert.Effect,a.effect);
    const headerTranslations = translations(a.headerText), descriptionTranslations = translations(a.descriptionText), urlTranslations = translations(a.url);
    const header = text(headerTranslations), description = text(descriptionTranslations), url = text(urlTranslations);
    const informedEntities = (a.informedEntity || []).sort((a,b) => compare(JSON.stringify(a),JSON.stringify(b)));
    // Explicit non-surface selectors exclude subway-only alerts; unknown mode remains usable.
    if (informedEntities.length && informedEntities.every(e => e.routeType !== undefined && ![0,3,11].includes(e.routeType))) continue;
    const structured = cause === 'CONSTRUCTION' || effect === 'DETOUR';
    const fallback = (a.cause === undefined || a.effect === undefined) && /\b(detour|diversion|construction)\b/i.test([header,description].join('\n'));
    if (!structured && !fallback) continue;
    const activePeriods = (a.activePeriod || []).map(p => {
      const start = instant(p.start), end = instant(p.end);
      if (start && end && start > end) throw new Error('Reversed TTC active period');
      return {...(start ? {start} : {}), ...(end ? {end} : {})};
    }).sort((a,b) => compare(a.start || '',b.start || '') || compare(a.end || '',b.end || ''));
    const item = {id:entity.id,cause,effect,severity:enumName(Alert.SeverityLevel,a.severityLevel),activePeriods,
      routes:unique(informedEntities.flatMap(e => [e.routeId,e.trip?.routeId])), stops:unique(informedEntities.map(e => e.stopId)),
      informedEntities,header,description,url,headerTranslations,descriptionTranslations,urlTranslations,
      source:'ttc-gtfs-rt',fetchedAt:now.toISOString()};
    const hash = alertContentHash(item);
    item.id = entity.id?.trim() ? entity.id : `fallback:${hash}`;
    if (ids.has(item.id)) {
      if (ids.get(item.id) !== hash) throw new Error('Conflicting duplicate TTC alert ID');
      continue;
    }
    ids.set(item.id,hash);
    items.push(item);
  }
  const result = {schemaVersion:1,items:items.sort((a,b) => compare(a.id,b.id)),sourceUpdatedAt:sourceUpdatedAt || null};
  validateTtcAlerts(result);
  return result;
}

export async function fetchTtcAlerts(now = new Date(), fetchImpl = fetch) {
  const response = await fetchImpl(TTC_ALERTS_URL,{signal:AbortSignal.timeout(12000)});
  if (!response.ok) throw new Error(`TTC alerts HTTP ${response.status}`);
  return parseTtcAlerts(new Uint8Array(await response.arrayBuffer()),now);
}

export async function updateTtcAlerts(previous, now = new Date(), fetchSource = fetchTtcAlerts, log = entry => console.log(JSON.stringify(entry))) {
  if (previous) validateTtcAlerts(previous);
  let result;
  try {
    result = await fetchSource(now);
    validateTtcAlerts(result);
  } catch (error) {
    log({source:'ttc-gtfs-rt',status:'unavailable',retainedCount:previous?.items.length || 0,error:error.message});
    return {...(previous || {schemaVersion:1,items:[],sourceUpdatedAt:null,fetchedAt:null}),
      checkedAt:now.toISOString(),status:'unavailable'};
  }
  const state = {...reconcileAlerts(result,previous,now),status:'ok',fetchedAt:now.toISOString(),checkedAt:now.toISOString()};
  validateTtcAlerts(state);
  log({source:'ttc-gtfs-rt',status:'ok',count:state.items.length,
    new:state.changes.new.length,updated:state.changes.updated.length,unchanged:state.changes.unchanged.length,
    removed:state.changes.removed.length,expired:state.items.filter(item => item.state === 'expired').length});
  return state;
}

/** Validate the owned JSON payload before publication (also used by live smoke). */
export function validateTtcAlerts(value, { published = false } = {}) {
  const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (value?.schemaVersion !== 1 || !Array.isArray(value.items) ||
      (value.sourceUpdatedAt !== null && !date(value.sourceUpdatedAt))) throw new Error('Invalid TTC artifact');
  if (published && !Object.hasOwn(value,'status')) throw new Error('Missing TTC source state');
  if ('status' in value && (!['ok','unavailable'].includes(value.status) || !date(value.checkedAt) ||
      !(date(value.fetchedAt) || (value.status === 'unavailable' && value.fetchedAt === null && !value.items.length)))) throw new Error('Invalid TTC source state');
  if (value.lifecycleVersion !== undefined && value.lifecycleVersion !== 1) throw new Error('Invalid TTC lifecycle version');
  if (value.lifecycleVersion === 1) {
    if (!value.status || !value.changes || !['new','updated','unchanged','removed'].every(key => Array.isArray(value.changes[key]))) throw new Error('Invalid TTC changes');
    const current = new Set(value.items.map(item => item.id));
    const changed = [...value.changes.new,...value.changes.updated,...value.changes.unchanged];
    if (new Set(value.changes.removed.map(item => item?.id)).size !== value.changes.removed.length || new Set(changed).size !== changed.length || changed.length !== current.size || changed.some(id => !current.has(id)) ||
      value.changes.removed.some(item => !item || typeof item.id !== 'string' || !item.id || current.has(item.id) || !['expired','removed'].includes(item.state) || !/^[a-f0-9]{64}$/.test(item.contentHash))) throw new Error('Invalid TTC reconciliation');
  }
  const ids = new Set();
  for (const item of value.items) {
    if (!object(item) || typeof item.id !== 'string' || !item.id || ids.has(item.id) || item.source !== 'ttc-gtfs-rt' || !date(item.fetchedAt) ||
        !['routes','stops'].every(key => Array.isArray(item[key]) && item[key].every(v => typeof v === 'string' && v.length > 0) && new Set(item[key]).size === item[key].length) ||
        !Array.isArray(item.activePeriods) || !item.activePeriods.every(p => object(p) && (p.start === undefined || date(p.start)) && (p.end === undefined || date(p.end))) ||
        !Array.isArray(item.informedEntities) ||
        !['headerTranslations','descriptionTranslations','urlTranslations'].every(key => Array.isArray(item[key]) && item[key].every(t => object(t) && typeof t.text === 'string'))) throw new Error('Invalid TTC alert record');
    if (!['cause','effect','severity','header','description','url'].every(key => item[key] === undefined || typeof item[key] === 'string') ||
      item.activePeriods.some(p => p.start && p.end && p.start > p.end) ||
      !item.informedEntities.every(e => object(e) &&
        ['agencyId','routeId','stopId'].every(key => e[key] === undefined || typeof e[key] === 'string') &&
        ['routeType','directionId'].every(key => e[key] === undefined || Number.isInteger(e[key])) &&
        (e.trip === undefined || (object(e.trip) && ['tripId','routeId','startTime','startDate'].every(key => e.trip[key] === undefined || typeof e.trip[key] === 'string')))) ||
      !['headerTranslations','descriptionTranslations','urlTranslations'].every(key => item[key].every(t => t.language === undefined || typeof t.language === 'string'))) throw new Error('Invalid TTC optional fields');
    if (value.lifecycleVersion === 1 && (!['active','scheduled','expired'].includes(item.state) || !date(item.firstSeenAt) || !date(item.updatedAt) || item.contentHash !== alertContentHash(item) || item.firstSeenAt > item.updatedAt || item.updatedAt > item.fetchedAt)) throw new Error('Invalid TTC lifecycle record');
    ids.add(item.id);
  }
  validateCorrelation(value);
  return value;
}
