import { relativeUpdateAge } from '../source-status.js?v=source-states-1';
import { ttcPresentation } from './presentation.js';
import { mobileMapSheetOverlap } from '../mobile-bottom-sheet.js';
import { createTtcLayer } from './map-layer.js';
const node = (tag,text,className) => { const el=document.createElement(tag); el.textContent=text || ''; if(className) el.className=className; return el; };
let controller, currentMap, selected=null, currentItems=[], lastSignature, expiryTimer;
let latest, selectedSignature;
const itemSignature=item=>JSON.stringify({...item,freshness:undefined});
const routeLabel=item=>item.routes.map(r=>r.label).join(' · ') || 'TTC';
const scopeLabel=(context,count)=>{
  const radius=context?.radius;
  const origin=context?.origin;
  const scope=origin && radius !== null && radius !== undefined
    ? `TTC disruptions · map within ${radius === 0.5 ? '500 m' : `${radius} km`}`
    : 'TTC disruptions · map · citywide';
  return `${scope} (${count})`;
};
// Story 57: the retained-evidence cue must stay visible in the rendered card,
// not only inside the collapsed "More details" disclosure. Returns the cue
// element when any diversion part is retained, otherwise null.
function retainedEvidenceCue(item) {
  const part=item.diversions.find(candidate=>candidate.retained);
  if(!part) return null;
  return node('p',part.sourceUnavailable ? 'Vehicle feed unavailable · Retained evidence' : 'Retained evidence','disruption-note ttc-evidence-status');
}
// The diversion card mirrors the Calls card: a single clickable row that selects
// and reveals the affected route, with a "More details" disclosure for the
// evidence and provenance that must not be inferred from the map alone.
// `variant: 'detail'` renders the shared chrome of the mobile sheet and both
// bubbles (closure-detail article, red kicker, title scale — Story 74) and
// carries the retained-evidence cue inline. The default 'card' variant is the
// plain list/disclosure body, whose caller renders the retained-evidence cue
// on the always-visible card body (desktop list) so it is not duplicated
// inside the disclosure (Story 57).
export function createTtcDetail(item,{variant='card'}={}) {
  const detail=variant === 'detail';
  const article=node('article',null,detail ? 'disruption-item ttc-detail closure-detail' : 'disruption-item ttc-detail');
  article.dataset.ttcId=item.id;
  article.append(node('span',item.source === 'sirento-observed' ? 'SIRENTO OBSERVED DIVERSION' : 'OFFICIAL TTC DISRUPTION',detail ? 'closure-detail-kicker' : 'section-kicker'),node('h4',routeLabel(item)),node('p',item.title));
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
  if(item.affected?.length) article.append(node('p','Dashed line: affected section declared by TTC affected stops.','ttc-scheduled-note'));
  if(item.diversions.length) for(const [index,part] of item.diversions.entries()) {
    const route=item.routes.find(r=>r.id===part.routeId)?.label;
    article.append(node('h5',[part.source === 'sirento-observed' ? 'Observed diversion · Observed by SirenTO' : part.label,item.diversions.length>1 && `Path ${index+1}`,route].filter(Boolean).join(' · ')),node('p',part.source === 'sirento-observed' ? 'Based on repeated TTC vehicle movements. This is not an official TTC-published route.' : 'Temporary route published by TTC.'));
    if(part.retained && variant === 'detail') article.append(node('p',part.sourceUnavailable ? 'Vehicle feed unavailable · Retained evidence' : 'Retained evidence','disruption-note ttc-evidence-status'));
    if(part.expiresAt) article.append(node('p',`Evidence expires ${new Intl.DateTimeFormat('en-CA',{hour:'2-digit',minute:'2-digit',timeZone:'America/Toronto'}).format(new Date(part.expiresAt))} (Toronto time).`,'disruption-note'));
    if(part.observedAt) article.append(node('p',`Last observed ${relativeUpdateAge(Date.parse(part.observedAt))}.`,'disruption-note'));
  } else if(!item.affected?.length) article.append(node('p','No observed diversion route available yet.','disruption-note'));
  const freshness=node('p',item.freshness,'disruption-note');freshness.dataset.ttcFreshness=item.id;article.append(freshness);
  const link=node('a','Official TTC service alerts ↗');link.href='https://www.ttc.ca/service-advisories/all-service-alerts';link.target='_blank';link.rel='noopener noreferrer';article.append(link);
  return article;
}
// A diversion card is only actionable when it carries map geometry. Cards without
// geometry stay readable but are not focusable, matching the Calls card contract.
function createDiversionCard(item) {
  const hasGeometry=Boolean(item.scheduled.length || item.diversions.length || item.affected?.length);
  const row=node('article',null,'incident-card call-row incident-card--list');
  row.dataset.ttcId=item.id;
  row.classList.toggle('selected',item.id===selected);
  if(hasGeometry) {
    row.tabIndex=0;
    row.setAttribute('role','button');
    row.setAttribute('aria-pressed',String(item.id===selected));
    row.setAttribute('aria-label',`Show on map: ${routeLabel(item)} — ${item.title}`);
  }
  const main=node('div',null,'call-main');
  const titleRow=node('div',null,'call-title-row');
  const titleWrap=node('div',null,'call-title-with-glossary');
  titleWrap.append(node('h4',routeLabel(item),'call-title'));
  titleRow.append(titleWrap);
  const badges=node('div',null,'incident-badges');
  badges.append(node('span',item.source === 'sirento-observed' ? 'OBSERVED' : 'TTC','incident-status'));
  titleRow.append(badges);
  main.append(titleRow);
  main.append(node('p',item.title,'call-location'));
  const recency=node('p',null,'call-recency');
  const observedAt=item.diversions.find(part=>part.observedAt)?.observedAt;
  const timeAgo=node('strong',observedAt ? relativeUpdateAge(Date.parse(observedAt)) : '', 'time-ago');
  recency.append(timeAgo);
  main.append(recency);
  const meta=node('p',null,'call-meta');
  meta.append(node('span',item.geography,'incident-source'));
  main.append(meta);
  // Story 57: keep the retained-evidence cue visible on the card itself; the
  // disclosure below carries the remaining evidence and provenance.
  const cue=retainedEvidenceCue(item);
  if(cue) main.append(cue);
  const details=node('details',null,'call-details');
  details.append(node('summary','More details'));
  const body=node('div',null,'call-details-body');
  body.append(createTtcDetail(item));
  details.append(body);
  main.append(details);
  const actions=node('div',null,'incident-actions');
  if(hasGeometry) {
    const hint=node('a','Show on map ↑','show-map-hint');
    hint.href='#dispatchMap';
    actions.append(hint);
  }
  main.append(actions);
  row.append(main);
  return row;
}
export function clearTtcSelection() { selected=null; selectedSignature=null; controller?.select(null); }
export function selectTtc(item, layer, reveal=false) {
  selected=item.id;selectedSignature=itemSignature(item);controller?.select(selected);
  for(const card of document.querySelectorAll('#observedDiversionsList .incident-card')) {
    const isSelected=card.dataset.ttcId===item.id;
    card.classList.toggle('selected',isSelected);
    if(card.hasAttribute('role')) card.setAttribute('aria-pressed',String(isSelected));
  }
  currentMap?.fire('ttcselect',{item,layer});
  if(reveal) requestAnimationFrame(()=>requestAnimationFrame(()=>{
    if(selected!==item.id) return;
    const container=currentMap?.getContainer();
    const sheet=document.querySelector('#mobileBottomSheet');
    const mobile=Boolean(sheet?.getClientRects().length) && document.documentElement.dataset.mobileView==='map';
    container?.scrollIntoView({block:'center',behavior:'instant'});
    const overlap=mobileMapSheetOverlap(container?.getBoundingClientRect(),sheet?.getBoundingClientRect(),mobile);
    controller?.reveal(selected,{paddingTopLeft:[24,80],paddingBottomRight:[24,overlap+24]});
  }));
}
function handleDiversionListClick(event) {
  if(event.target.closest('summary, a, button')) return;
  const row=event.target.closest('.incident-card--list');
  if(!row) return;
  const item=currentItems.find(candidate=>candidate.id===row.dataset.ttcId);
  if(!item) return;
  const toggle=document.querySelector('#ttcOverlay');
  if(toggle) toggle.checked=true;
  controller?.visibility(true);
  selectTtc(item,null,true);
}
function handleDiversionListKeydown(event) {
  if(event.target.closest('summary, a, button')) return;
  if(event.key !== 'Enter' && event.key !== ' ') return;
  const row=event.target.closest('.incident-card--list');
  if(!row) return;
  event.preventDefault();
  const item=currentItems.find(candidate=>candidate.id===row.dataset.ttcId);
  if(!item) return;
  const toggle=document.querySelector('#ttcOverlay');
  if(toggle) toggle.checked=true;
  controller?.visibility(true);
  selectTtc(item,null,true);
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
  const hasGeometry=currentItems.some(i=>i.scheduled.length || i.diversions.length || i.affected?.length);
  const controls=document.querySelector('#ttcLayerControl');if(controls) controls.hidden=!hasGeometry;
  for(const kind of ['scheduled','diversion']) {
    const legend=document.querySelector(`#ttcLegend-${kind}`);
    if(legend) legend.hidden=toggle?.checked === false || !currentItems.some(i=>kind==='scheduled' ? (i.scheduled.length || i.affected?.length) : i.diversions.length);
  }
  const diversionLegend=document.querySelector('#ttcLegend-diversion');
  const sources=new Set(currentItems.flatMap(item=>item.diversions.map(part=>part.source)));
  if(diversionLegend?.lastChild) diversionLegend.lastChild.textContent=sources.has('ttc-official') ? sources.has('sirento-observed') ? 'TTC diversions · source in details' : 'TTC-published diversion' : 'Observed TTC diversion';
  if(selected) {
    const item=currentItems.find(i=>i.id===selected);
    if(!item) {clearTtcSelection();map?.fire('ttcselectionexpired');}
    else if(itemSignature(item)!==selectedSignature) {selectedSignature=itemSignature(item);map?.fire('ttcselectionupdated',{item});}
  }
  const list=document.querySelector('#observedDiversionsList');if(!list) return;
  const section=document.querySelector('#observedDiversions');
  if(section) section.hidden=!currentItems.length;
  const scope=document.querySelector('#observedDiversionsScope');
  const count=document.querySelector('#observedDiversionsCount');
  const freshness=document.querySelector('#observedDiversionsFreshness');
  if(scope) scope.textContent=scopeLabel(context,currentItems.length).replace(/ \(\d+\)$/,'');
  if(count) count.textContent=String(currentItems.length);
  if(freshness) freshness.textContent=model.freshness;
  for(const el of document.querySelectorAll('[data-ttc-freshness]')) {
    const item=currentItems.find(i=>i.id===el.dataset.ttcFreshness);if(item) el.textContent=item.freshness;
  }
  const signature=JSON.stringify({...model,freshness:undefined,items:model.items.map(item=>({...item,freshness:undefined}))});
  if(signature === lastSignature) return;
  lastSignature=signature;
  const focusId=list.contains(document.activeElement) ? document.activeElement?.closest('.incident-card')?.dataset?.ttcId : null;
  list.replaceChildren();
  for(const item of currentItems) list.append(createDiversionCard(item));
  if(focusId) [...list.querySelectorAll('.incident-card')].find(el=>el.dataset.ttcId===focusId)?.focus({preventScroll:true});
}
export function setTtcVisibility(visible) { controller?.visibility(visible);if(!visible) {clearTtcSelection();currentMap?.fire('ttcselectionexpired');} if(latest) renderTtc(latest.data,latest.map); }
export function captureTtcRenderState() { return controller?.diagnostics() || {parts:0,layers:0,markers:0,selected:null,visible:false}; }
export function bindTtcListInteractions() {
  const list=document.querySelector('#observedDiversionsList');
  if(!list || list.dataset.ttcBound==='true') return;
  list.dataset.ttcBound='true';
  list.addEventListener('click',handleDiversionListClick);
  list.addEventListener('keydown',handleDiversionListKeydown);
}
