// Browser contract: no vehicle histories, trip matching, or confidence calculation.
import { roadDistance } from '../disruptions/view.js';
import { sourceStatusText, sourceStatus } from '../source-status.js?v=source-states-1';
const fresh = (at, now, max) => Number.isFinite(Date.parse(at)) && now-Date.parse(at) >= -300000 && now-Date.parse(at) <= max;
export const validLine = line => Array.isArray(line) && line.length >= 2 && line.length <= 10000 && line.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90);
const active = (periods, now) => !periods?.length || periods.some(p => (!p.start || Date.parse(p.start) <= now) && (!p.end || Date.parse(p.end) > now));
export function activeTtcAlerts(feed,now=Date.now()) {
  return fresh(feed?.fetchedAt,now,3600000) ? (feed.items || []).filter(alert=>active(alert.activePeriods,now) && alert.state !== 'expired') : [];
}
// Story 51D: official Service Changes use their own source-qualified namespace so
// they can never collide with GTFS-RT alert ids. Kept in sync with `advisoryRef`
// in `src/ttc/official-advisories.js` (asserted by tests).
const ADVISORY_REF_PREFIX='ttc-service-change:';
const advisoryRef=id=>`${ADVISORY_REF_PREFIX}${id}`;
// A confirmed observed path is usable only when it is fresh, unexpired, and a
// valid line. This mirrors the GTFS-RT attachment filter exactly.
const usableDiversion=(d,now)=>d.status === 'confirmed' && ['sirento-observed','ttc-official'].includes(d.geometrySource) && fresh(d.lastObservedAt,now,1800000) && (!d.expiresAt || Date.parse(d.expiresAt)>now) && validLine(d.geometry);
const diversionPart=d=>({id:d.id,routeId:d.routeId,geometry:d.geometry,kind:'diversion',observedAt:d.lastObservedAt,source:d.geometrySource,label:d.geometrySource === 'ttc-official' ? 'TTC-published diversion' : 'Observed by SirenTO'});
// Shared geography wording for both GTFS-RT alerts and official advisories.
const geographyFor=(nearest,origin,radius)=>!origin ? 'Citywide TTC disruption' : !Number.isFinite(nearest) ? 'Location not mapped · citywide alert' : `${radius !== null && nearest <= radius ? 'Within selected radius' : 'Citywide alert'} · ${nearest.toFixed(1)} km from selected area`;
// Normalized transit periods are epoch milliseconds; GTFS-RT periods are ISO.
const advisoryPeriods=periods=>(periods || []).map(period=>({start:Number.isFinite(period?.start) ? new Date(period.start).toISOString() : null,end:Number.isFinite(period?.end) ? new Date(period.end).toISOString() : null}));
// Official Service Changes that are active in the normalized `disruptions.transit`
// feed. Route-only advisories carry no structured stop coordinates. Unlike GTFS-RT
// `activePeriods` (ISO strings), normalized transit periods are epoch milliseconds.
const periodBound=value=>Number.isFinite(value) ? value : Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const activePeriods=(periods,now)=>!periods?.length || periods.some(p=>{const start=periodBound(p?.start),end=periodBound(p?.end);return (start===null||start<=now)&&(end===null||end>now);});
export function activeOfficialAdvisories(feed,now=Date.now()) {
  return fresh(feed?.fetchedAt,now,3600000) ? (feed.items || []).filter(item=>activePeriods(item.periods,now)) : [];
}
// The set of official advisory ids that a confirmed observed path claims through
// `relatedAdvisoryRefs`. The general transit list uses this to avoid rendering an
// advisory twice: once in the Story 30 presentation and once in the citywide list.
export function claimedAdvisoryIds(observed,advisories,now=Date.now()) {
  const observedUsable=observed?.status === 'ok' && fresh(observed.checkedAt,now,120000);
  if (!observedUsable) return new Set();
  const claimed=new Set();
  for (const d of observed.diversions || []) {
    if (!usableDiversion(d,now)) continue;
    for (const ref of d.relatedAdvisoryRefs || []) if (typeof ref === 'string' && ref.startsWith(ADVISORY_REF_PREFIX)) claimed.add(ref.slice(ADVISORY_REF_PREFIX.length));
  }
  return claimed;
}
export function ttcPresentation(feed, observed, now = Date.now(), {origin=null,radius=null,advisories=null} = {}) {
  const observedUsable = observed?.status === 'ok' && fresh(observed.checkedAt,now,120000);
  const patterns = feed?.staticCorrelation?.patterns || {};
  const items = new Map();
  for (const alert of activeTtcAlerts(feed,now)) {
    const correlation = alert.correlation || {};
    const routes = (correlation.routes?.length ? correlation.routes : (alert.routes || []).map(routeId => ({routeId}))).map(r => ({id:r.routeId,label:[r.routeShortName || r.routeId,r.routeLongName].filter(Boolean).join(' ')}));
    const stops = (correlation.stops || []).filter(s => s.matched).map(s => ({id:s.stopId,name:s.stopName || s.stopId,coordinates:[s.latitude,s.longitude]}));
    const scheduled = [];
    for (const candidate of correlation.candidates || []) {
      const pattern = patterns[candidate.patternId];
      // Ambiguous route correlation is not a reliable affected route section.
      if (!pattern || !correlation.routeResults?.some(r => r.routeId === pattern.routeId && r.status === 'exact')) continue;
      if (candidate.affectedSegment?.geometryStatus !== 'projected' || !validLine(candidate.affectedSegment.geometry)) continue;
      scheduled.push({id:candidate.patternId,routeId:pattern.routeId,geometry:candidate.affectedSegment.geometry,kind:'scheduled'});
    }
    const diversions = (observedUsable ? observed.diversions || [] : []).filter(d => usableDiversion(d,now) && d.relatedAlertIds?.includes(alert.id)).map(diversionPart);
    const nearest=origin ? Math.min(...stops.map(stop=>roadDistance({coordinates:stop.coordinates},origin)),...[...scheduled,...diversions].map(part=>roadDistance({line:part.geometry.map(([lng,lat])=>[lat,lng])},origin))) : Infinity;
    const geography=geographyFor(nearest,origin,radius);
    items.set(alert.id,{id:alert.id,title:alert.header || 'TTC service disruption',description:alert.description || '',routes,stops,scheduled,diversions,
      geography,nearestDistance:Number.isFinite(nearest)?nearest:null,cause:[alert.effect,alert.cause].filter(Boolean).map(s => s.replaceAll('_',' ').toLowerCase()).join(' · '),periods:alert.activePeriods || [],
      freshness:sourceStatusText('TTC disruption',feed,now),observedUnavailable:!observedUsable});
  }
  // Story 51D: an active official Service Change that a confirmed observed path
  // claims through `relatedAdvisoryRefs` is presented here, with its geometry,
  // even when the GTFS-RT alert set is healthy-empty. The official text stays
  // TTC-provided; the path stays explicitly SirenTO-observed.
  const claimed=claimedAdvisoryIds(observed,advisories,now);
  for (const advisory of activeOfficialAdvisories(advisories,now)) {
    if (!claimed.has(advisory.id) || items.has(advisory.id)) continue;
    const routes=(advisory.routes || []).map(routeId=>({id:routeId,label:routeId}));
    // The loop only runs for a claimed advisory, which requires observed.diversions.
    const diversions=observed.diversions.filter(d => usableDiversion(d,now) && d.relatedAdvisoryRefs?.includes(advisoryRef(advisory.id))).map(diversionPart);
    const nearest=origin ? Math.min(...diversions.map(part=>roadDistance({line:part.geometry.map(([lng,lat])=>[lat,lng])},origin))) : Infinity;
    items.set(advisory.id,{id:advisory.id,title:advisory.title || 'TTC service disruption',description:advisory.description || '',routes,stops:[],scheduled:[],diversions,
      geography:geographyFor(nearest,origin,radius),nearestDistance:Number.isFinite(nearest)?nearest:null,cause:advisory.effect ? advisory.effect.replaceAll('_',' ').toLowerCase() : '',periods:advisoryPeriods(advisory.periods),
      freshness:sourceStatusText('TTC disruption',advisories,now),observedUnavailable:!observedUsable});
  }
  return {items:[...items.values()].sort((a,b)=>(a.nearestDistance ?? Infinity)-(b.nearestDistance ?? Infinity)),status:sourceStatus('TTC disruption',feed,now).status,freshness:sourceStatusText('TTC disruption',feed,now)};
}
export function mergeTtcDisruptions(data, feed, observed, transit) {
  return {...data,...(transit ? {transit} : {}),ttcAlerts:feed,ttcDiversions:observed};
}
