// Browser contract: no vehicle histories, trip matching, or confidence calculation.
import { roadDistance } from '../disruptions/view.js';
import { sourceStatusText, sourceStatus } from '../source-status.js?v=source-states-1';
const fresh = (at, now, max) => Number.isFinite(Date.parse(at)) && now-Date.parse(at) >= -300000 && now-Date.parse(at) <= max;
export const validLine = line => Array.isArray(line) && line.length >= 2 && line.length <= 10000 && line.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90);
const active = (periods, now) => !periods?.length || periods.some(p => (!p.start || Date.parse(p.start) <= now) && (!p.end || Date.parse(p.end) > now));
export function activeTtcAlerts(feed,now=Date.now()) {
  return fresh(feed?.fetchedAt,now,3600000) ? (feed.items || []).filter(alert=>active(alert.activePeriods,now) && alert.state !== 'expired') : [];
}
export function ttcPresentation(feed, observed, now = Date.now(), {origin=null,radius=null} = {}) {
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
    const diversions = (observedUsable ? observed.diversions || [] : []).filter(d => d.status === 'confirmed' && d.relatedAlertIds?.includes(alert.id) && ['sirento-observed','ttc-official'].includes(d.geometrySource) && fresh(d.lastObservedAt,now,1800000) && (!d.expiresAt || Date.parse(d.expiresAt)>now) && validLine(d.geometry)).map(d => ({id:d.id,routeId:d.routeId,geometry:d.geometry,kind:'diversion',observedAt:d.lastObservedAt,source:d.geometrySource,label:d.geometrySource === 'ttc-official' ? 'TTC-published diversion' : 'Observed by SirenTO'}));
    const nearest=origin ? Math.min(...stops.map(stop=>roadDistance({coordinates:stop.coordinates},origin)),...[...scheduled,...diversions].map(part=>roadDistance({line:part.geometry.map(([lng,lat])=>[lat,lng])},origin))) : Infinity;
    const geography=!origin ? 'Citywide TTC disruption' : !Number.isFinite(nearest) ? 'Location not mapped · citywide alert' : `${radius !== null && nearest <= radius ? 'Within selected radius' : 'Citywide alert'} · ${nearest.toFixed(1)} km from selected area`;
    items.set(alert.id,{id:alert.id,title:alert.header || 'TTC service disruption',description:alert.description || '',routes,stops,scheduled,diversions,
      geography,nearestDistance:Number.isFinite(nearest)?nearest:null,cause:[alert.effect,alert.cause].filter(Boolean).map(s => s.replaceAll('_',' ').toLowerCase()).join(' · '),periods:alert.activePeriods || [],
      freshness:sourceStatusText('TTC disruption',feed,now),observedUnavailable:!observedUsable});
  }
  return {items:[...items.values()].sort((a,b)=>(a.nearestDistance ?? Infinity)-(b.nearestDistance ?? Infinity)),status:sourceStatus('TTC disruption',feed,now).status,freshness:sourceStatusText('TTC disruption',feed,now)};
}
export function mergeTtcDisruptions(data, feed, observed) {
  return {...data,ttcAlerts:feed,ttcDiversions:observed};
}
