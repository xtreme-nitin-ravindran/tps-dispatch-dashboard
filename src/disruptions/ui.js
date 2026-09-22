import { currentDisruptions, roadDistance } from './view.js';
import { ROAD_LINK } from './source.js';
let roadLayer;
let previousRender;
const element = (tag, text, className) => {
  const node=document.createElement(tag); if (text) node.textContent=text; if (className) node.className=className; return node;
};
function freshness(feed) {
  const time=Date.parse(feed?.fetchedAt);
  if (!Number.isFinite(time)) return 'Not available yet';
  const age=Math.max(0,Math.floor((Date.now()-time)/60000));
  return `${feed.status === 'unavailable' ? 'Source unavailable · last successful check' : 'Checked'} ${age} minutes ago${age >= 60 ? ' · too old to display' : age >= 10 ? ' · saved data may be outdated' : ''}`;
}
export function renderDisruptions(data, origin, radius, map) {
  const container=document.querySelector('#disruptions');
  if (!container) return;
  const showMap=document.querySelector('#roadOverlay').checked;
  const signature=JSON.stringify([data,origin,radius,showMap,Math.floor(Date.now()/60000),Boolean(map)]);
  if (signature === previousRender) return;
  previousRender=signature;
  let roads=currentDisruptions(data?.roads,'roads');
  if (origin) roads=roads.filter(r => roadDistance(r,origin) <= radius).sort((a,b)=>roadDistance(a,origin)-roadDistance(b,origin));
  const transit=currentDisruptions(data?.transit,'transit');
  document.querySelector('#roadScope').textContent=origin ? `Road restrictions within ${radius} km` : 'Road restrictions · citywide';
  document.querySelector('#roadsFreshness').textContent=freshness(data?.roads);
  document.querySelector('#transitFreshness').textContent=freshness(data?.transit);
  document.querySelector('#roadCount').textContent=roads.length;
  document.querySelector('#transitCount').textContent=transit.length;
  for (const [kind,items] of [['roads',roads],['transit',transit]]) {
    const list=document.querySelector(`#${kind}List`); list.replaceChildren();
    if (!items.length) {
      list.append(element('p',currentDisruptions(data?.[kind],kind).length && origin ? 'No mapped road restrictions within this radius.' : !data?.[kind]?.fetchedAt || Date.now()-Date.parse(data[kind].fetchedAt)>3600000 ? 'Current data is unavailable. Check the official source below.' : 'No current disruptions reported in this view.','disruption-note'));
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
      const layer=item.line?.length>1 ? L.polyline(item.line,{color:'#b388ff',weight:5,opacity:1,dashArray:'8 6'}) : item.coordinates ? L.circleMarker(item.coordinates,{color:'#b388ff',fillColor:'#b388ff',fillOpacity:.8,radius:6}) : null;
      layer?.bindPopup(popup).addTo(roadLayer);
    }
    roadLayer.addTo(map);
  }
}
