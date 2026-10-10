import { relativeUpdateAge } from '../source-status.js?v=source-states-1';
import { ttcPresentation } from './presentation.js';
import { mobileMapSheetOverlap } from '../mobile-bottom-sheet.js';
import { createTtcLayer } from './map-layer.js';
const node = (tag,text,className) => { const el=document.createElement(tag); el.textContent=text || ''; if(className) el.className=className; return el; };
let controller, currentMap, selected=null, currentItems=[], lastSignature, expiryTimer;
let latest, selectedSignature;
const itemSignature=item=>JSON.stringify({...item,freshness:undefined});
function summarySelection(details,item) { details.querySelector('summary').addEventListener('click',()=>{if(!details.open) {currentMap?.fire('ttcfocus');selected=item.id;controller?.select(item.id);} else if(selected===item.id) {clearTtcSelection();currentMap?.fire('ttcselectionexpired');}}); }
export function createTtcDetail(item) {
  const article=node('article',null,'disruption-item ttc-detail');
  article.dataset.ttcId=item.id;
  article.append(node('span',item.source === 'sirento-observed' ? 'SIRENTO OBSERVED DIVERSION' : 'OFFICIAL TTC DISRUPTION','section-kicker'),node('h4',item.routes.map(r=>r.label).join(' · ') || 'TTC'),node('p',item.title));
  article.append(node('p',item.geography,'disruption-note'));
  if(item.cause) article.append(node('p',item.cause,'disruption-note'));
  if(item.description) article.append(node('p',item.description));
  for(const period of item.periods) {
    const format=value=>Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('en-CA',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Toronto'}).format(new Date(value)) : null;
    const start=format(period.start),end=format(period.end);
    if(start || end) article.append(node('p',[start && `From ${start}`,end && `Until ${end}`].filter(Boolean).join(' · ')+' (Toronto time)','disruption-note'));
  }
  if(item.stops.length) {
    const details=node('details'),summary=node('summary',`${item.stops.length} affected stops`),list=node('ul');
    for(const stop of item.stops) list.append(node('li',stop.name));
    details.append(summary,list);article.append(details);
  }
  if(item.scheduled.length) article.append(node('p','Dashed line: affected section of the normal scheduled route.','ttc-scheduled-note'));
  if(item.diversions.length) for(const [index,part] of item.diversions.entries()) {
    const route=item.routes.find(r=>r.id===part.routeId)?.label;
    article.append(node('h5',[part.source === 'sirento-observed' ? 'Observed diversion · Observed by SirenTO' : part.label,item.diversions.length>1 && `Path ${index+1}`,route].filter(Boolean).join(' · ')),node('p',part.source === 'sirento-observed' ? 'Based on repeated TTC vehicle movements. This is not an official TTC-published route.' : 'Temporary route published by TTC.'));
    if(part.retained) article.append(node('p',part.sourceUnavailable ? 'Vehicle feed unavailable · Retained evidence' : 'Retained evidence','disruption-note ttc-evidence-status'));
    if(part.expiresAt) article.append(node('p',`Evidence expires ${new Intl.DateTimeFormat('en-CA',{hour:'2-digit',minute:'2-digit',timeZone:'America/Toronto'}).format(new Date(part.expiresAt))} (Toronto time).`,'disruption-note'));
    if(part.observedAt) article.append(node('p',`Last observed ${relativeUpdateAge(Date.parse(part.observedAt))}.`,'disruption-note'));
  } else article.append(node('p','No observed diversion route available yet.','disruption-note'));
  const freshness=node('p',item.freshness,'disruption-note');freshness.dataset.ttcFreshness=item.id;article.append(freshness);
  const link=node('a','Official TTC service alerts ↗');link.href='https://www.ttc.ca/service-advisories/all-service-alerts';link.target='_blank';link.rel='noopener noreferrer';article.append(link);
  return article;
}
export function clearTtcSelection() { selected=null; selectedSignature=null; controller?.select(null); }
export function selectTtc(item, layer, reveal=false) {
  selected=item.id;selectedSignature=itemSignature(item);controller?.select(selected);

  for(const detail of document.querySelectorAll('.ttc-disruption')) {
    if(detail.dataset.ttcId===item.id) detail.open=true;
  }
  currentMap?.fire('ttcselect',{item,layer});
  if(reveal) requestAnimationFrame(()=>requestAnimationFrame(()=>{
    if(selected!==item.id) return;
    const container=currentMap?.getContainer();
    const sheet=document.querySelector('#mobileBottomSheet');
    const mobile=Boolean(sheet?.getClientRects().length) && document.documentElement.dataset.mobileView==='map';
    if(mobile) container?.scrollIntoView({block:'center',behavior:'instant'});
    const overlap=mobileMapSheetOverlap(container?.getBoundingClientRect(),sheet?.getBoundingClientRect(),mobile);
    controller?.reveal(selected,{paddingTopLeft:[24,80],paddingBottomRight:[24,overlap+24]});
  }));
}
export function renderTtc(data,map=currentMap,context=latest?.context || {}) {
  latest={data,map,context};
  clearTimeout(expiryTimer);
  // Expiry still runs if incident fetches fail or the tab remains idle.
  expiryTimer=setTimeout(()=>renderTtc(latest.data,latest.map),30000);
  const model=ttcPresentation(data?.ttcAlerts,data?.ttcDiversions,Date.now(),{...context,advisories:data?.transit});
  if(map !== currentMap) {controller?.destroy();controller=null;currentMap=map;lastSignature=null;}
  if(map && !controller) controller=createTtcLayer(map,globalThis.L,(item,layer)=>selectTtc(item,layer,true));
  currentItems=model.items;
  controller?.update(currentItems);
  const toggle=document.querySelector('#ttcOverlay');
  controller?.visibility(toggle?.checked !== false);
  const hasGeometry=currentItems.some(i=>i.scheduled.length || i.diversions.length);
  const controls=document.querySelector('#ttcLayerControl');if(controls) controls.hidden=!hasGeometry;
  for(const kind of ['scheduled','diversion']) {
    const legend=document.querySelector(`#ttcLegend-${kind}`);
    if(legend) legend.hidden=toggle?.checked === false || !currentItems.some(i=>(kind==='scheduled'?i.scheduled:i.diversions).length);
  }
  const diversionLegend=document.querySelector('#ttcLegend-diversion');
  const sources=new Set(currentItems.flatMap(item=>item.diversions.map(part=>part.source)));
  if(diversionLegend?.lastChild) diversionLegend.lastChild.textContent=sources.has('ttc-official') ? sources.has('sirento-observed') ? 'TTC diversions · source in details' : 'TTC-published diversion' : 'Observed TTC diversion';
  if(selected) {
    const item=currentItems.find(i=>i.id===selected);
    if(!item) {clearTtcSelection();map?.fire('ttcselectionexpired');}
    else if(itemSignature(item)!==selectedSignature) {selectedSignature=itemSignature(item);map?.fire('ttcselectionupdated',{item});}
  }
  const list=document.querySelector('#ttcDisruptionList');if(!list) return;
  const status=document.querySelector('#ttcDisruptionStatus');
  if(status) {status.hidden=model.status === 'ok' && !currentItems.length;status.textContent=model.freshness;}
  for(const el of document.querySelectorAll('[data-ttc-freshness]')) {
    const item=currentItems.find(i=>i.id===el.dataset.ttcFreshness);if(item) el.textContent=item.freshness;
  }
  const signature=JSON.stringify({...model,freshness:undefined,items:model.items.map(item=>({...item,freshness:undefined}))});
  if(signature === lastSignature) return;
  lastSignature=signature;
  const focusId=list.contains(document.activeElement) ? document.activeElement?.closest('.ttc-disruption')?.dataset?.ttcId : null;
  list.replaceChildren();
  for(const item of currentItems) {
    const details=node('details',null,'ttc-disruption');details.open=item.id===selected;
    const summary=node('summary',`${item.routes.map(r=>r.label).join(' · ') || 'TTC'} — ${item.title}`);
    details.dataset.ttcId=item.id;
    details.append(summary,createTtcDetail(item));summarySelection(details,item);
    if(item.scheduled.length || item.diversions.length) {
      const button=node('button','Show affected route on map','ttc-show-map');button.type='button';button.dataset.ttcSelect=item.id;
      button.addEventListener('click',()=>{if(toggle) toggle.checked=true;controller?.visibility(true);selectTtc(item,null,true);});details.append(button);
    }
    list.append(details);
  }
  if(focusId) [...list.querySelectorAll('.ttc-disruption')].find(el=>el.dataset.ttcId===focusId)?.querySelector('summary')?.focus({preventScroll:true});
}
export function setTtcVisibility(visible) { controller?.visibility(visible);if(!visible) {clearTtcSelection();currentMap?.fire('ttcselectionexpired');} if(latest) renderTtc(latest.data,latest.map); }
export function captureTtcRenderState() { return controller?.diagnostics() || {parts:0,layers:0,selected:null,visible:false}; }
