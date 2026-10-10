import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {captureRoadClosureRenderState,createClosureDetail,closureSymbolPositions,renderDisruptions,roadClosureDensityTier,roadClosureSymbolSpacing,setRoadOverlayVisibility} from '../src/disruptions/ui.js';

const originalDocument=globalThis.document;
const originalLeaflet=globalThis.L;
const originalRequestAnimationFrame=globalThis.requestAnimationFrame;
const originalCancelAnimationFrame=globalThis.cancelAnimationFrame;

class FakeElement {
 constructor(tag='div') {this.tag=tag;this.children=[];this.checked=false;this.textContent='';this.className='';this.dataset={};}
 append(...children) {this.children.push(...children);}
 replaceChildren(...children) {this.children=children;}
}

function harness(zoom=12) {
 const nodes=new Map();
 for(const selector of ['#disruptions','#roadOverlay','#roadOverlayStatus','#roadOverlayLabel','#roadScope','#roadsFreshness','#transitFreshness','#roadCount','#transitCount','#roadsList','#transitList']) nodes.set(selector,new FakeElement());
 nodes.get('#roadOverlay').checked=true;
 globalThis.document={createElement:tag=>new FakeElement(tag),querySelector:selector=>nodes.get(selector) || null};
 const groups=[];const created=[];const frames=[];
 globalThis.requestAnimationFrame=callback=>{frames.push(callback);return frames.length;};
 globalThis.cancelAnimationFrame=id=>{frames[id-1]=null;};
 const makeLayer=(kind,coordinates,options)=>{const layer={kind,coordinates,options,_leaflet_id:created.length+10,events:{},listenerCount:0,addTo(group){group.items.push(this);return this;},on(name,handler){this.events[name]=handler;this.listenerCount++;return this;}};created.push(layer);return layer;};
 globalThis.L={
  layerGroup:()=>{const group={_leaflet_id:groups.length+1,items:[],removed:false,addTo(map){this.map=map;this.removed=false;return this;},removeLayer(layer){this.items=this.items.filter(item=>item!==layer);},remove(){this.removed=true;}};groups.push(group);return group;},
  polyline:(coordinates,options)=>makeLayer('line',coordinates,options),
  marker:(coordinates,options)=>makeLayer('symbol',coordinates,options),
  divIcon:options=>options,
  latLngBounds:coordinates=>({intersects:bounds=>coordinates.some(point=>bounds.contains(point))})
 };
 const handlers={}; const fired=[];
 const map={
  zoom,bounds:{contains:point=>point[0]>=40 && point[0]<=50 && point[1]>=-82 && point[1]<=-70,pad(){return this;}},panes:{},
  getZoom(){return this.zoom;},project(point){const scale=100*2**(this.zoom-10);return {x:point[1]*scale,y:point[0]*scale};},hasLayer(layer){return !layer.removed;},
  getBounds(){return this.bounds;},getPane(name){return this.panes[name];},createPane(name){return this.panes[name]={style:{}};},
  on(names,handler){for(const name of names.split(' ')) handlers[name]=handler;return this;},
  off(names,handler){for(const name of names.split(' ')) if(handlers[name]===handler) delete handlers[name];return this;},
  fire(name,payload){fired.push({name,payload});},trigger(name){handlers[name]?.();}
 };
 const flush=()=>{const pending=frames.splice(0);for(const callback of pending) callback?.();};
 return {nodes,groups,map,fired,created,flush};
}

const now=Date.now();
const base={expired:false,start:null,end:null,impact:'High',title:'Closed road',type:'ROAD CLOSED',restrictionType:'ROAD CLOSED'};
const data={roads:{status:'ok',fetchedAt:new Date(now).toISOString(),items:[
 {...base,id:'line-1',geometryKind:'line',line:[[43,-79],[43,-77]],coordinates:[43,-79]},
 {...base,id:'point-1',geometryKind:'point',line:[],coordinates:[44,-79]},
 {...base,id:'none-1',geometryKind:'none',line:[],coordinates:null}
]},transit:{status:'ok',fetchedAt:new Date(now).toISOString(),items:[]}};

test('road diagnostic is empty before the overlay is constructed',()=>{
 const capture=captureRoadClosureRenderState(null);
 assert.equal(capture.visible,false);assert.equal(capture.layerId,null);assert.equal(capture.paneTransform,null);
 assert.deepEqual(capture.lineLayerIds,[]);assert.deepEqual(capture.rendererIds,[]);assert.equal(capture.redrawScheduled,false);
});

test('line closures render below incident markers with repeated identifiable symbols',()=>{
 const {groups,map,fired}=harness();
 const incidentLayer={removed:false,items:[{id:'incident'}]};
 renderDisruptions(data,null,10,map);
 const overlay=groups.at(-1); const line=overlay.items.find(item=>item.kind==='line');
 const lineSymbols=overlay.items.filter(item=>item.kind==='symbol' && item.options.closureId==='line-1');
 assert.ok(line);assert.ok(lineSymbols.length>1);assert.equal(line.options.closureId,'line-1');assert.equal(line.closureId,'line-1');
 assert.equal(map.panes.roadClosurePane.style.zIndex,'450');assert.equal(incidentLayer.removed,false);assert.deepEqual(incidentLayer.items,[{id:'incident'}]);
 line.events.click({});const lineSelection=fired.find(event=>event.name==='roadclosureselect');assert.equal(lineSelection.payload.closureId,'line-1');
 lineSymbols[0].events.click({});
 const selections=fired.filter(event=>event.name==='roadclosureselect');assert.equal(selections[1].payload.closureId,'line-1');assert.equal(selections[1].payload.item,data.roads.items[0]);
});

test('symbol density increases with zoom and positions remain on the authoritative segment',()=>{
 const {map}=harness(10); const line=[[43,-79],[43,-77]];
 const low=closureSymbolPositions(line,map);map.zoom=16;const high=closureSymbolPositions(line,map);
 assert.ok(high.length>low.length);assert.ok(roadClosureSymbolSpacing(16)<roadClosureSymbolSpacing(10));
 assert.equal(roadClosureSymbolSpacing(12),130);assert.equal(roadClosureSymbolSpacing(14),90);
 assert.equal(roadClosureDensityTier(11),0);assert.equal(roadClosureDensityTier(12),1);assert.equal(roadClosureDensityTier(14),2);assert.equal(roadClosureDensityTier(16),3);
 for(const point of high) {assert.equal(point[0],43);assert.ok(point[1]>-79 && point[1]<-77);}
 assert.deepEqual(closureSymbolPositions(null,map),[]);
 assert.deepEqual(closureSymbolPositions([[43,-79]],map),[]);
 assert.deepEqual(closureSymbolPositions([[43,-79],[43,-79]],map),[]);
 const leafletMap={getZoom:()=>12,latLngToLayerPoint:point=>({x:point[1]*100,y:point[0]*100})};
 assert.ok(closureSymbolPositions(line,leafletMap).length>0);
});

test('point-only closures render one marker and select their normalized record',()=>{
 const {groups,map,fired}=harness();renderDisruptions(data,null,11,map);
 const overlay=groups.at(-1);
 assert.equal(overlay.items.filter(item=>item.options.closureId==='point-1').length,1);
 assert.equal(overlay.items.find(item=>item.options.closureId==='point-1').kind,'symbol');
 assert.equal(overlay.items.filter(item=>item.options.closureId==='none-1').length,0);
 overlay.items.find(item=>item.options.closureId==='point-1').events.click({});
 const selection=fired.find(event=>event.name==='roadclosureselect');assert.equal(selection.payload.closureId,'point-1');assert.equal(selection.payload.item,data.roads.items[1]);
});

test('road diagnostic reports layer ownership, renderer kind, and queued redraw state',()=>{
 const {groups,map}=harness();renderDisruptions(data,null,12,map);
 const overlay=groups.at(-1);const line=overlay.items.find(item=>item.kind==='line');
 map.panes.roadClosurePane.style.transform='translate3d(2px, 3px, 0)';
 line._renderer={_leaflet_id:71,_container:{tagName:'svg'}};
 let capture=captureRoadClosureRenderState(map);
 assert.equal(capture.visible,true);assert.equal(capture.layerId,overlay._leaflet_id);assert.equal(capture.pane,'roadClosurePane');assert.equal(capture.paneTransform,'translate3d(2px, 3px, 0)');
 assert.deepEqual(capture.lineLayerIds,[line._leaflet_id]);assert.deepEqual(capture.rendererIds,[71]);assert.deepEqual(capture.rendererKinds,['svg']);
 line._renderer={_leaflet_id:72,_ctx:{}};capture=captureRoadClosureRenderState(map);assert.deepEqual(capture.rendererKinds,['canvas']);
 line._renderer={_leaflet_id:null};capture=captureRoadClosureRenderState(map);assert.deepEqual(capture.rendererKinds,['unknown']);
 line._renderer=undefined;line._leaflet_id=null;overlay.removed=true;capture=captureRoadClosureRenderState(map);
 assert.equal(capture.visible,false);assert.deepEqual(capture.lineLayerIds,[null]);assert.deepEqual(capture.rendererIds,[]);assert.deepEqual(capture.rendererKinds,[]);assert.equal(capture.redrawScheduled,false);
});

test('toggle hides and restores every closure element without changing unrelated map state',()=>{
 const {nodes,groups,map,flush}=harness();
 map.center=[43.7,-79.4];map.filterState={service:'TPS'};map.selectedIncident='incident-7';
 renderDisruptions(data,null,10,map);
 const first=groups.at(-1);assert.ok(first.items.length>2);
 map.trigger('moveend');
 nodes.get('#roadOverlay').checked=false;renderDisruptions(data,null,10,map);
 flush();
 assert.equal(first.removed,true);
 nodes.get('#roadOverlay').checked=true;renderDisruptions(data,null,10,map);
 assert.ok(groups.at(-1).items.length>2);
 assert.deepEqual(map.center,[43.7,-79.4]);assert.deepEqual(map.filterState,{service:'TPS'});assert.equal(map.selectedIncident,'incident-7');assert.equal(map.zoom,12);
});

test('overlay-only toggles preserve rendered layers and defer first-time creation',()=>{
 const {groups,map,created,flush}=harness();
 renderDisruptions(data,null,10,map);
 const overlay=groups.at(-1);const layers=[...overlay.items];const createdCount=created.length;
 setRoadOverlayVisibility(map,false);
 assert.equal(overlay.removed,true);assert.deepEqual(overlay.items,layers);
 setRoadOverlayVisibility(map,true);
 assert.equal(overlay.removed,false);assert.deepEqual(overlay.items,layers);assert.equal(created.length,createdCount);
 flush();assert.deepEqual(overlay.items,layers);assert.equal(created.length,createdCount);
});

test('viewport scheduling falls back safely when requestAnimationFrame is unavailable',async()=>{
 const {groups,map}=harness();
 globalThis.requestAnimationFrame=undefined;
 renderDisruptions(data,null,10,map);
 const overlay=groups.at(-1);const initialLayers=[...overlay.items];
 map.trigger('moveend');
 await new Promise(resolve=>setTimeout(resolve,5));
 assert.deepEqual(overlay.items,initialLayers);
});

test('overlay status distinguishes a valid empty feed from an unavailable source',()=>{
 const {nodes,map}=harness();
 const empty={roads:{status:'ok',fetchedAt:new Date().toISOString(),items:[]},transit:data.transit};
 renderDisruptions(empty,null,10,map);
 assert.equal(nodes.get('#roadOverlayStatus').textContent,'0 current');
 assert.equal(nodes.get('#roadOverlayStatus').className,'map-layer-status source-state-ok');
 const unavailable={roads:{status:'unavailable',fetchedAt:new Date(Date.now()-60000).toISOString(),items:[]},transit:data.transit};
 renderDisruptions(unavailable,null,10,map);
 assert.match(nodes.get('#roadOverlayStatus').textContent,/Unavailable · Road restriction data is temporarily unavailable/);
 assert.equal(nodes.get('#roadOverlayStatus').className,'map-layer-status source-state-unavailable');
});

test('overlay status discloses a SirenTO encoding repair even when the source is healthy',()=>{
 const {nodes,map}=harness();
 const repaired={roads:{status:'ok',fetchedAt:new Date().toISOString(),items:[],repaired:2},transit:data.transit};
 renderDisruptions(repaired,null,10,map);
 assert.match(nodes.get('#roadOverlayStatus').textContent,/0 · Last successfully updated just now\. source JSON was malformed; SirenTO repaired the encoding \(2 records\)\./);
 assert.equal(nodes.get('#roadOverlayStatus').className,'map-layer-status source-state-ok');
});

test('the visible Road closures label discloses a SirenTO encoding repair and resets when clean',()=>{
 const {nodes,map}=harness();
 const repaired={roads:{status:'ok',fetchedAt:new Date().toISOString(),items:[],repaired:2},transit:data.transit};
 renderDisruptions(repaired,null,10,map);
 assert.equal(nodes.get('#roadOverlayLabel').textContent,'Road closures · source repaired');
 const clean={roads:{status:'ok',fetchedAt:new Date().toISOString(),items:[]},transit:data.transit};
 renderDisruptions(clean,null,10,map);
 assert.equal(nodes.get('#roadOverlayLabel').textContent,'Road closures');
});

test('closure detail includes available normalized fields and official attribution',()=>{
 const item={id:'road-1',street:'King St W',restrictionType:'ROAD CLOSED',startLocation:'Bathurst St',endLocation:'Spadina Ave',start:Date.UTC(2026,8,25,12),end:Date.UTC(2026,8,25,18),status:'Active',source:{name:'City of Toronto Road Restrictions',url:'https://example.test/official'}};
 const detail=createClosureDetail(item);
 const text=node=>[node.textContent,...node.children.flatMap(text)].filter(Boolean).join(' ');
 assert.match(text(detail),/King St W/);assert.match(text(detail),/ROAD CLOSED/);assert.match(text(detail),/Bathurst St/);assert.match(text(detail),/Spadina Ave/);assert.match(text(detail),/Expected end/);assert.match(text(detail),/Active/);
 const link=detail.children.find(child=>child.tag==='a');assert.equal(link.href,'https://example.test/official');assert.match(link.textContent,/City of Toronto Road Restrictions/);
});

test('closure detail omits unavailable optional fields without inventing values',()=>{
 const detail=createClosureDetail({id:'road-2',street:'Queen St',restrictionType:'Lane restriction',source:{name:'City of Toronto',url:'https://example.test'}});
 const text=node=>[node.textContent,...node.children.flatMap(text)].filter(Boolean).join(' ');
 assert.doesNotMatch(text(detail),/Start location|End location|Started \/ reported|Expected end|Status/);
 const named=createClosureDetail({title:'Named closure',type:'Closure',reportedAt:Date.now(),source:{name:'Official source'},url:'https://example.test/fallback'});
 assert.equal(named.children.find(child=>child.tag==='a').href,'https://example.test/fallback');
 const plain=createClosureDetail({source:{name:'Official source'}});
 assert.equal(plain.children.at(-1).tag,'p');
 assert.match(text(createClosureDetail({})),/Road closure/);
});

test('defensive map branches neither fabricate geometry nor require optional Leaflet methods',()=>{
 const {groups,map}=harness();
 assert.equal(globalThis.document.querySelector('#missing'),null);
 map.bounds={contains:()=>true};delete map.getPane;delete map.createPane;delete map.fire;delete map.off;
 const variants={roads:{status:'ok',fetchedAt:new Date().toISOString(),items:[
  {...base,id:null,restrictionType:'',type:'ROAD CLOSURE',geometryKind:'',line:[[43,-79],[43,-78]],coordinates:[43,-79]},
  {...base,id:'not-closure',restrictionType:'LANE RESTRICTION',line:[],coordinates:[43,-79]},
  {...base,id:'untyped',restrictionType:'',type:'',line:[],coordinates:[43,-79]}
 ]},transit:data.transit};
 renderDisruptions(variants,null,10,map);
 assert.ok(groups.at(-1).items.length>1);
 assert.equal(groups.at(-1).items.map(item=>item.options.closureId).includes('not-closure'),false);
 groups.at(-1).items[0].events.click({});
 map.trigger('zoomend');
 assert.equal(groups.at(-1).removed,false);
 delete map.getBounds;globalThis.L.latLngBounds=undefined;
 map.trigger('moveend');
 renderDisruptions(variants,null,10,null);
});

test('no-op viewport updates reuse closure layers and coalesce move and zoom events',()=>{
 const {groups,map,created,flush}=harness();renderDisruptions(data,null,12,map);
 const overlay=groups.at(-1);const initialLayers=[...overlay.items];const initialCreated=created.length;
 map.trigger('moveend');map.trigger('zoomend');
 assert.equal(created.length,initialCreated);flush();
 assert.equal(groups.length,1);assert.deepEqual(overlay.items,initialLayers);assert.equal(created.length,initialCreated);
 assert.ok(initialLayers.every(layer=>layer.listenerCount===1));
});

test('a stale scheduled viewport render is ignored after the map changes',()=>{
 const first=harness();renderDisruptions(data,null,12,first.map);first.map.trigger('moveend');
 const second=harness();renderDisruptions(data,null,12,second.map);
 first.flush();
 assert.equal(first.groups.length,1);assert.equal(second.groups.length,1);
});

test('viewport deltas remove departed closures and add newly visible closures without duplicates',()=>{
 const {groups,map,flush}=harness();renderDisruptions(data,null,12,map);
 const overlay=groups.at(-1);const retained=overlay.items.find(item=>item.options.closureId==='point-1');
 map.bounds={contains:point=>point[0]===44 || point[0]===46,pad(){return this;}};
 data.roads.items.push({...base,id:'point-2',geometryKind:'point',line:[],coordinates:[46,-79]});
 renderDisruptions(data,null,13,map);map.trigger('moveend');flush();
 assert.equal(overlay.items.includes(retained),true);
 assert.equal(overlay.items.some(item=>item.options.closureId==='line-1'),false);
 assert.equal(overlay.items.filter(item=>item.options.closureId==='point-2').length,1);
 data.roads.items.pop();
});

test('changed geometry replaces only the affected closure representation',()=>{
 const {groups,map}=harness();renderDisruptions(data,null,12,map);
 const overlay=groups.at(-1);const oldLine=overlay.items.find(item=>item.options.closureId==='line-1' && item.kind==='line');
 const changed={...data,roads:{...data.roads,items:data.roads.items.map(item=>item.id==='line-1' ? {...item,line:[[43,-79],[43,-76]]} : item)}};
 renderDisruptions(changed,null,12,map);
 const newLine=overlay.items.find(item=>item.options.closureId==='line-1' && item.kind==='line');
 assert.notEqual(newLine,oldLine);assert.equal(overlay.items.includes(oldLine),false);
 assert.equal(overlay.items.filter(item=>item.options.closureId==='point-1').length,1);
});

test('symbols regenerate only when zoom crosses a density tier',()=>{
 const {groups,map,created,flush}=harness(12);renderDisruptions(data,null,12,map);
 const overlay=groups.at(-1);const line=overlay.items.find(item=>item.kind==='line');const point=overlay.items.find(item=>item.options.closureId==='point-1');
 const initialCreated=created.length;map.zoom=13;map.trigger('zoomend');flush();
 assert.equal(created.length,initialCreated);assert.equal(overlay.items.find(item=>item.kind==='line'),line);
 map.zoom=14;map.trigger('moveend');map.trigger('zoomend');flush();
 assert.equal(overlay.items.find(item=>item.kind==='line'),line);assert.equal(overlay.items.find(item=>item.options.closureId==='point-1'),point);
 assert.ok(created.length>initialCreated);assert.equal(overlay.items.filter(item=>item.options.closureId==='line-1' && item.kind==='line').length,1);
});

test('closure styling uses theme variables defined for light and dark map modes',()=>{
 const css=readFileSync(new URL('../assets/css/styles.css',import.meta.url),'utf8');
 assert.match(css,/:root\s*{[\s\S]*?--road-marker:/);assert.match(css,/:root\[data-theme="light"\]\s*{[\s\S]*?--road-marker:/);
 assert.match(css,/\.road-closure-line\s*{[\s\S]*?stroke: var\(--road-marker\)/);
});

test('map control is mobile-accessible and closure selection stays separate from incident selection',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const app=readFileSync(new URL('../src/app/app.js',import.meta.url),'utf8');
 assert.match(html,/<div class="map-wrap">[\s\S]*?id="roadOverlay"[\s\S]*?Road closures/);
 assert.match(html,/id="mobileClosureDetail"/);
 assert.match(app,/roadclosureselect[\s\S]*?selectClosure/);
 assert.match(app,/function selectCall[\s\S]*?clearClosureSelection\(\)[\s\S]*?focusedCallId = callId/);
 assert.match(app,/callLayer = L\.layerGroup\(\)\.addTo\(dispatchMap\)/);
});

test('road-closure count is hidden beneath the label at every breakpoint',()=>{
 const css=readFileSync(new URL('../assets/css/styles.css',import.meta.url),'utf8');
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 // The count stays in the DOM for assistive technology and the disruptions panel.
 assert.match(html,/<small id="roadOverlayStatus" class="map-layer-status">/);
 assert.match(html,/<span id="roadOverlayLabel">Road closures<\/span>/);
 assert.match(html,/<span aria-hidden="true" class="road-key"><\/span>/);
 // The base (desktop) rule clips the count to a non-visible box.
 const baseStart=css.indexOf('.map-layer-toggle .map-layer-status {');
 const baseRule=css.slice(baseStart,css.indexOf('}',baseStart)+1);
 assert.match(baseRule,/position: absolute/);
 assert.match(baseRule,/width: 1px/);
 assert.match(baseRule,/height: 1px/);
 assert.match(baseRule,/overflow: hidden/);
 assert.match(baseRule,/clip-path: inset\(50%\)/);
 assert.match(baseRule,/white-space: nowrap/);
 // The count is not re-shown by any later rule (for example a mobile override).
 const laterRules=css.slice(baseStart+baseRule.length);
 assert.doesNotMatch(laterRules,/\.map-layer-toggle \.map-layer-status\s*\{[^}]*grid-column/);
});

test.after(()=>{globalThis.document=originalDocument;globalThis.L=originalLeaflet;globalThis.requestAnimationFrame=originalRequestAnimationFrame;globalThis.cancelAnimationFrame=originalCancelAnimationFrame;});
