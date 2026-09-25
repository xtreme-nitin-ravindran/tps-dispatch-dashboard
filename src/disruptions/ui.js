import { currentDisruptions, roadDistance } from './view.js';
import { ROAD_LINK } from './source.js';
import { sourceStatus, sourceStatusText } from '../source-status.js?v=source-states-1';
let roadLayer;
let previousRender;
const definitions = {
  roads: {subject:'Road restriction', empty:'No road restrictions currently reported.'},
  transit: {subject:'TTC alert', empty:'No TTC service alerts currently reported.'}
};
const element = (tag, text, className) => {
  const node=document.createElement(tag); if (text) node.textContent=text; if (className) node.className=className; return node;
};
export function disruptionPresentation(kind, feed, items, baseItems, hasOrigin, now = Date.now()) {
  const definition=definitions[kind];
  const info=sourceStatus(definition.subject,feed,now);
  const tooOld=info.lastSuccessfulAt !== null && now-info.lastSuccessfulAt>3600000;
  let empty=definition.empty;
  if (baseItems.length && hasOrigin) empty='No mapped road restrictions within this radius.';
  else if (info.status === 'unavailable') empty=sourceStatusText(definition.subject,feed,now);
  else if (info.status === 'not loaded') empty=`${definition.subject} data could not be checked yet.`;
  else if (tooOld) empty=`${definition.subject} data is too old to show.`;
  const count=items.length || info.status === 'ok'
    ? String(items.length)
    : info.status === 'stale' ? 'Stale' : 'Unavailable';
  return {count,empty,freshness:sourceStatusText(definition.subject,feed,now),status:info.status};
}
export function renderDisruptions(data, origin, radius, map) {
  const container=document.querySelector('#disruptions');
  if (!container) return;
  const showMap=document.querySelector('#roadOverlay').checked;
  const signature=JSON.stringify([data,origin,radius,showMap,Math.floor(Date.now()/60000),Boolean(map)]);
  if (signature === previousRender) return;
  previousRender=signature;
  const now=Date.now();
  const allRoads=currentDisruptions(data?.roads,'roads',now);
  let roads=allRoads;
  if (origin) roads=roads.filter(r => roadDistance(r,origin) <= radius).sort((a,b)=>roadDistance(a,origin)-roadDistance(b,origin));
  const transit=currentDisruptions(data?.transit,'transit',now);
  const presentations={
    roads:disruptionPresentation('roads',data?.roads,roads,allRoads,Boolean(origin),now),
    transit:disruptionPresentation('transit',data?.transit,transit,transit,false,now)
  };
  document.querySelector('#roadScope').textContent=origin ? `Road restrictions within ${radius} km` : 'Road restrictions · citywide';
  document.querySelector('#roadsFreshness').textContent=presentations.roads.freshness;
  document.querySelector('#transitFreshness').textContent=presentations.transit.freshness;
  document.querySelector('#roadCount').textContent=presentations.roads.count;
  document.querySelector('#transitCount').textContent=presentations.transit.count;
  for (const [kind,items] of [['roads',roads],['transit',transit]]) {
    const list=document.querySelector(`#${kind}List`); list.replaceChildren();
    if (!items.length) {
      list.append(element('p',presentations[kind].empty,`disruption-note source-state source-state-${presentations[kind].status}`));
    }
    for (const item of items) {
      const article=element('article',null,'disruption-item');
      article.append(element('h4',item.title));
      const meta=kind==='roads' ? [item.type,item.impact && `Reported impact: ${item.impact}`,origin && `About ${roadDistance(item,origin).toFixed(1)} km away`] : [item.effect,item.routes.length && `Routes: ${item.routes.join(', ')}`];
      article.append(element('p',meta.filter(Boolean).join(' · '),'disruption-note'));
      if (item.description) article.append(element('p',item.description));
      if (item.schedule) article.append(element('p',`Schedule (Toronto time): ${item.schedule}`,'disruption-note'));
      if (kind==='roads' && item.end) article.append(element('p',`Scheduled end: ${new Intl.DateTimeFormat('en-CA',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Toronto'}).format(item.end)} Toronto`,'disruption-note'));
      list.append(article);
    }
  }
  if (roadLayer) {roadLayer.remove();roadLayer=null;}
  if (map && showMap) {
    roadLayer=L.layerGroup();
    for (const item of roads) {
      const popup=element('div'); popup.append(element('strong',item.title),element('p',item.type));
      const link=element('a','Official road restrictions');link.href=ROAD_LINK;link.target='_blank';link.rel='noopener noreferrer';popup.append(link);
      const layer=item.line?.length>1 ? L.polyline(item.line,{className:'road-restriction',weight:5,opacity:1,dashArray:'8 6'}) : item.coordinates ? L.circleMarker(item.coordinates,{className:'road-restriction',fillOpacity:.8,radius:6}) : null;
      layer?.bindPopup(popup).addTo(roadLayer);
    }
    roadLayer.addTo(map);
  }
}
