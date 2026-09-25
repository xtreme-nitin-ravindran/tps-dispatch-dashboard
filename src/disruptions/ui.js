import { currentDisruptions, roadDistance } from './view.js';
import { sourceStatus, sourceStatusText } from '../source-status.js?v=source-states-1';
let roadLayer;
let roadMap;
let roadItems=[];
let roadMapHandler;
let roadRenderFrame;
let renderedClosures=new Map();
let previousRender;
const ROAD_PANE='roadClosurePane';
const definitions = {
  roads: {subject:'Road restriction', empty:'No road restrictions currently reported.'},
  transit: {subject:'TTC alert', empty:'No TTC service alerts currently reported.'}
};
const element = (tag, text, className) => {
  const node=document.createElement(tag); if (text) node.textContent=text; if (className) node.className=className; return node;
};
const closureId = item => String(item.id ?? '');
const isClosure = item => /(?:ROAD )?CLOS(?:ED|URE)/i.test(item.restrictionType || item.type || '');
const project = (map,coordinate) => {
  const value=map.project ? map.project(coordinate,map.getZoom()) : map.latLngToLayerPoint(coordinate);
  return {x:value.x,y:value.y};
};
export function roadClosureSymbolSpacing(zoom) {
  if (zoom <= 11) return 180;
  if (zoom <= 13) return 130;
  if (zoom <= 15) return 90;
  return 64;
}
export function roadClosureDensityTier(zoom) {
  if (zoom <= 11) return 0;
  if (zoom <= 13) return 1;
  if (zoom <= 15) return 2;
  return 3;
}
export function closureSymbolPositions(line, map) {
  if (!map || !Array.isArray(line) || line.length < 2) return [];
  const segments=[]; let total=0;
  for (let i=1;i<line.length;i++) {
    const a=project(map,line[i-1]),b=project(map,line[i]);
    const length=Math.hypot(b.x-a.x,b.y-a.y);
    if (length) {segments.push({from:line[i-1],to:line[i],length,start:total});total+=length;}
  }
  if (!total) return [];
  const spacing=roadClosureSymbolSpacing(map.getZoom());
  const count=Math.min(24,Math.max(1,Math.floor(total/spacing)));
  return Array.from({length:count},(_,index) => {
    const distance=total*(index+1)/(count+1);
    const segment=segments.find(candidate => distance <= candidate.start+candidate.length);
    const ratio=Math.max(0,Math.min(1,(distance-segment.start)/segment.length));
    return [segment.from[0]+(segment.to[0]-segment.from[0])*ratio,segment.from[1]+(segment.to[1]-segment.from[1])*ratio];
  });
}
function visibleOnMap(item,map) {
  if (!map.getBounds || !globalThis.L?.latLngBounds) return true;
  const bounds=map.getBounds().pad?.(0.1) || map.getBounds();
  const coordinates=item.line?.length > 1 ? item.line : item.coordinates ? [item.coordinates] : [];
  return coordinates.length && L.latLngBounds(coordinates).intersects(bounds);
}
function selectable(layer,currentItem,map) {
  layer.closureId=closureId(currentItem());
  layer.on?.('click',event => map.fire?.('roadclosureselect',{closureId:layer.closureId,item:currentItem(),layer,originalEvent:event}));
  return layer;
}
const closureGeometryKey = item => JSON.stringify([item.geometryKind,item.line,item.coordinates]);
const closureTime = value => {
  const timestamp=Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
  return new Intl.DateTimeFormat('en-CA',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Toronto'}).format(timestamp)+' Toronto';
};
export function createClosureDetail(item) {
  const article=element('article',null,'closure-detail');
  article.dataset.closureId=closureId(item);
  article.append(element('span','ROAD CLOSURE','closure-detail-kicker'));
  article.append(element('h3',item.street || item.title || 'Road closure'));
  const fields=[
    ['Restriction',item.restrictionType || item.type],
    ['Start location',item.startLocation],
    ['End location',item.endLocation],
    ['Started / reported',closureTime(item.start || item.reportedAt)],
    ['Expected end',closureTime(item.end)],
    ['Status',item.status]
  ];
  const list=element('dl',null,'closure-detail-fields');
  for (const [label,value] of fields) {
    if (!value) continue;
    list.append(element('dt',label),element('dd',String(value)));
  }
  if (list.children.length) article.append(list);
  const source=item.source;
  if (source?.name && (source.url || item.url)) {
    const link=element('a',`${source.name} ↗`,'closure-source-link');
    link.href=source.url || item.url; link.target='_blank'; link.rel='noopener noreferrer';
    article.append(link);
  } else if (source?.name) article.append(element('p',source.name,'closure-source-link'));
  return article;
}
function closureIcon(item,pointOnly=false) {
  const id=closureId(item).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  return L.divIcon({className:`road-closure-symbol${pointOnly ? ' road-closure-symbol--point' : ''}`,html:`<span aria-hidden="true" data-closure-id="${id}">⛔</span>`,iconSize:[20,20],iconAnchor:[10,10]});
}
function removeClosureLayers(entry) {
  for (const layer of [entry.line,entry.point,...entry.symbols].filter(Boolean)) roadLayer?.removeLayer?.(layer);
}
function createClosureLayers(item,map,densityTier) {
  const options={pane:ROAD_PANE,closureId:closureId(item)};
  const entry={item,geometryKey:closureGeometryKey(item),densityTier,symbols:[]};
  if (item.geometryKind === 'line' || item.line?.length > 1) {
    entry.line=selectable(L.polyline(item.line,{...options,className:'road-closure-line',weight:6,opacity:.88,lineCap:'round'}),()=>entry.item,map).addTo(roadLayer);
    entry.symbols=closureSymbolPositions(item.line,map).map(position => selectable(L.marker(position,{...options,icon:closureIcon(item),keyboard:true,title:`Road closure: ${item.title}`}),()=>entry.item,map).addTo(roadLayer));
  } else if ((item.geometryKind === 'point' || !item.geometryKind) && item.coordinates) {
    entry.point=selectable(L.marker(item.coordinates,{...options,icon:closureIcon(item,true),keyboard:true,title:`Road closure: ${item.title}`}),()=>entry.item,map).addTo(roadLayer);
  }
  return entry;
}
function refreshClosureSymbols(entry,map,densityTier) {
  for (const symbol of entry.symbols) roadLayer.removeLayer?.(symbol);
  const options={pane:ROAD_PANE,closureId:closureId(entry.item)};
  entry.symbols=closureSymbolPositions(entry.item.line,map).map(position => selectable(L.marker(position,{...options,icon:closureIcon(entry.item),keyboard:true,title:`Road closure: ${entry.item.title}`}),()=>entry.item,map).addTo(roadLayer));
  entry.densityTier=densityTier;
}
function renderRoadLayer(map) {
  if (!map.getPane?.(ROAD_PANE)) {
    const pane=map.createPane?.(ROAD_PANE);
    if (pane) pane.style.zIndex='450';
  }
  if (!roadLayer) roadLayer=L.layerGroup().addTo(map);
  const densityTier=roadClosureDensityTier(map.getZoom());
  const visible=new Map(roadItems.filter(item => visibleOnMap(item,map)).map(item => [closureId(item),item]));
  for (const [id,entry] of renderedClosures) {
    if (!visible.has(id)) {removeClosureLayers(entry);renderedClosures.delete(id);}
  }
  for (const [id,item] of visible) {
    const entry=renderedClosures.get(id);
    const geometryKey=closureGeometryKey(item);
    if (!entry || entry.geometryKey !== geometryKey) {
      if (entry) removeClosureLayers(entry);
      renderedClosures.set(id,createClosureLayers(item,map,densityTier));
    } else if (entry.line && entry.densityTier !== densityTier) {
      entry.item=item;
      refreshClosureSymbols(entry,map,densityTier);
    } else entry.item=item;
  }
}
function scheduleRoadLayer(map) {
  if (roadRenderFrame !== undefined) return;
  const schedule=globalThis.requestAnimationFrame || (callback => setTimeout(callback,0));
  roadRenderFrame=schedule(()=>{roadRenderFrame=undefined;if (roadMap === map) renderRoadLayer(map);});
}
function clearRoadLayer() {
  if (roadLayer) roadLayer.remove();
  roadLayer=null;renderedClosures=new Map();
}
function detachRoadMap() {
  if (roadMap && roadMapHandler) roadMap.off?.('zoomend moveend',roadMapHandler);
  if (roadRenderFrame !== undefined) {
    const cancel=globalThis.cancelAnimationFrame || clearTimeout;
    cancel(roadRenderFrame);roadRenderFrame=undefined;
  }
  roadMap=null;roadMapHandler=null;
}
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
  if (signature === previousRender && map === roadMap) return;
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
  const overlayStatus=document.querySelector('#roadOverlayStatus');
  if (overlayStatus) {
    overlayStatus.textContent=presentations.roads.status === 'ok'
      ? `${presentations.roads.count} current`
      : `${presentations.roads.count} · ${presentations.roads.freshness}`;
    overlayStatus.className=`map-layer-status source-state-${presentations.roads.status}`;
  }
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
  if (roadMap !== map || !showMap) {clearRoadLayer();detachRoadMap();}
  if (map && showMap) {
    roadItems=roads.filter(isClosure);
    if (roadMap !== map) {
      roadMap=map;
      roadMapHandler=()=>scheduleRoadLayer(map);
      map.on?.('zoomend moveend',roadMapHandler);
    }
    renderRoadLayer(map);
  }
}
