import test from 'node:test';
import assert from 'node:assert/strict';
import { frontendFixture } from './fixtures/ttc-diversions/frontend.js';
import { ttcPresentation } from '../src/ttc/presentation.js';
import { createTtcLayer } from '../src/ttc/map-layer.js';
import { loadTtcUiFixture } from '../src/ttc/fixture.js';
const fixture=await frontendFixture();
const present=(alerts=fixture.ttcAlerts,geometry=fixture.ttcDiversions,now=fixture.now)=>ttcPresentation(alerts,geometry,now);
test('30E two-vehicle fixture becomes human-readable alert, stops, scheduled segment and observed path',()=>{
  const [item]=present().items;
  assert.equal(item.routes[0].label,'504 King');assert.equal(item.stops.length,2);
  assert.equal(item.scheduled.length,1);assert.equal(item.diversions.length,1);
  assert.equal(item.diversions[0].label,'Observed by SirenTO');
  assert.doesNotMatch(JSON.stringify(item),/vehicleId|tripId|shapeId|trajectoryCount|rawEvidence/);
  assert.doesNotMatch(JSON.stringify(fixture.ttcDiversions),/rawEvidence|vehicleId|tripId|shapeId|trajectoryCount|departure|confidence/);
});
test('alert-only remains useful; candidate, likely, stale, unavailable and expired geometry is suppressed independently',()=>{
  for(const status of ['candidate','likely']) {
    const output=structuredClone(fixture.ttcDiversions);output.diversions[0].status=status;
    assert.equal(present(undefined,output).items[0].diversions.length,0);
  }
  for(const geometry of [undefined,{status:'unavailable'},{...fixture.ttcDiversions,checkedAt:new Date(fixture.now-120001).toISOString()},{...fixture.ttcDiversions,diversions:fixture.ttcDiversions.diversions.map(d=>({...d,expiresAt:new Date(fixture.now).toISOString()}))}]) {
    const [item]=ttcPresentation(fixture.ttcAlerts,geometry,fixture.now).items;
    assert.equal(item.diversions.length,0);assert.equal(item.scheduled.length,1);assert.ok(item.title);
  }
});
test('unavailable alerts retain bounded cached official information, old alerts expire and zero stays empty',()=>{
  const result=present({...fixture.ttcAlerts,status:'unavailable'});assert.match(result.freshness,/unavailable/);assert.equal(result.items.length,1);
  assert.equal(present(undefined,undefined,fixture.now+3600001).items.length,0);
  assert.equal(present({...fixture.ttcAlerts,items:[]}).items.length,0);
  const alert=structuredClone(fixture.ttcAlerts);alert.items[0].activePeriods=[{end:new Date(fixture.now).toISOString()}];assert.equal(present(alert).items.length,0);
});
test('multiple routes, directions, disruptions and stable identities never overwrite',()=>{
  const alerts=structuredClone(fixture.ttcAlerts),output=structuredClone(fixture.ttcDiversions);
  alerts.items[0].correlation.routes.push({routeId:'501',routeShortName:'501',routeLongName:'Queen'});
  const copy=structuredClone(alerts.items[0]);copy.id='second';alerts.items.push(copy,copy);
  const d=output.diversions[0];output.diversions.push({...d,id:'other-direction',directionId:1},{...d,id:'other-alert',relatedAlertIds:['second']});
  const result=present(alerts,output);assert.equal(result.items.length,2);assert.equal(result.items[0].routes.length,2);assert.equal(result.items[0].diversions.length,2);assert.equal(result.items[1].diversions.length,1);
});
test('ambiguous scheduled correlation and malformed geometry never draw',()=>{
  const alerts=structuredClone(fixture.ttcAlerts);alerts.items[0].correlation.routeResults[0].status='ambiguous';
  assert.equal(present(alerts).items[0].scheduled.length,0);
  const output=structuredClone(fixture.ttcDiversions);output.diversions[0].geometry=[[Infinity,43],[-79,43]];assert.equal(present(undefined,output).items[0].diversions.length,0);
});
function harness() {
  const members=new Set(),map={panes:{},getPane(id){return this.panes[id];},createPane(id){return this.panes[id]={style:{}};},fitBounds(points){this.bounds=points;}};
  let created=0,updated=0,selected;
  const L={layerGroup(){return {addTo(){return this;},remove(){},clearLayers(){members.clear();},removeLayer(l){members.delete(l);}};},polyline(points,options){created++;return {points,options,handlers:{},addTo(){members.add(this);return this;},on(k,fn){this.handlers[k]=fn;},off(){this.handlers={};},setStyle(s){Object.assign(this.options,s);},setLatLngs(p){this.points=p;updated++;}};}};
  const layer=createTtcLayer(map,L,item=>{selected=item.id;layer.select(item.id);});
  return {layer,members,map,counts:()=>({created,updated}),selection:()=>selected};
}
test('100 refresh/theme/view/visibility/selection cycles retain the same Leaflet objects; expiry removes only its part',()=>{
  const h=harness(),items=present().items;h.layer.update(items);const initial=[...h.members];
  for(let i=0;i<100;i++) {h.layer.update(structuredClone(items));h.layer.select(i%2?items[0].id:null);h.layer.visibility(i%2===0);}
  assert.deepEqual([...h.members],initial);assert.deepEqual(h.counts(),{created:4,updated:0});
  const hit=initial.find(l=>l.options.weight===24);hit.handlers.click();assert.equal(h.selection(),items[0].id);assert.equal(h.layer.diagnostics().selected,items[0].id);
  h.layer.reveal(items[0].id);assert.ok(h.map.bounds.length>2);
  h.layer.update([{...items[0],diversions:[]}]);assert.equal(h.members.size,2);assert.equal(h.layer.diagnostics().selected,items[0].id);
  h.layer.update([]);assert.equal(h.members.size,0);assert.equal(h.layer.diagnostics().selected,null);h.layer.destroy();assert.equal(h.members.size,0);
});
test('geometry updates mutate existing line pairs instead of allocating new layers',()=>{
  const h=harness(),items=present().items;h.layer.update(items);items[0].diversions[0].geometry=items[0].diversions[0].geometry.map(([x,y])=>[x+.0001,y]);h.layer.update(items);
  assert.deepEqual(h.counts(),{created:4,updated:2});
});
test('developer fixture is loopback-only and rebases freshness without raw histories',async()=>{
  const fetch=async()=>({ok:true,json:async()=>structuredClone(fixture)});
  assert.equal(await loadTtcUiFixture({hostname:'sirento.ca',search:'?ttcFixture=confirmed'},fetch),null);
  const f=await loadTtcUiFixture({hostname:'localhost',search:'?ttcFixture=confirmed'},fetch,fixture.now+100000);
  assert.equal(ttcPresentation(f.ttcAlerts,f.ttcDiversions,fixture.now+100000).items[0].diversions.length,1);
});
test('nearby context uses backend geometry and names without hiding unresolved citywide alerts',()=>{
  const model=ttcPresentation(fixture.ttcAlerts,fixture.ttcDiversions,fixture.now,{origin:[43.65,-79.4],radius:1});
  assert.match(model.items[0].geography,/Within selected radius/);
  const alerts=structuredClone(fixture.ttcAlerts);delete alerts.items[0].correlation;
  const unknown=ttcPresentation(alerts,undefined,fixture.now,{origin:[43.65,-79.4],radius:1});
  assert.match(unknown.items[0].geography,/Location not mapped/);assert.equal(unknown.items.length,1);
});
test('fixture modes preserve alert-only, unavailable and multi-disruption semantics and reject failed loads',async()=>{
  const fetch=async()=>({ok:true,json:async()=>structuredClone(fixture)});
  for(const mode of ['alert-only','expired','unavailable','empty','multiple']) {
    const f=await loadTtcUiFixture({hostname:'localhost',search:`?ttcFixture=${mode}`},fetch,fixture.now);
    const model=ttcPresentation(f.ttcAlerts,f.ttcDiversions,fixture.now);
    assert.equal(model.items.length,mode==='empty'?0:mode==='multiple'?2:1);
    if(['alert-only','expired','unavailable'].includes(mode)) assert.equal(model.items[0].diversions.length,0);
  }
  assert.equal(await loadTtcUiFixture({hostname:'localhost'},fetch),null);
  assert.equal(await loadTtcUiFixture(null,fetch),null);
  await assert.rejects(loadTtcUiFixture({hostname:'localhost',search:'?ttcFixture=confirmed'},async()=>({ok:false})),/Generate/);
});
test('missing metadata, active windows and future provenance remain conservative',()=>{
  const alerts=structuredClone(fixture.ttcAlerts);delete alerts.items[0].correlation;delete alerts.items[0].header;delete alerts.items[0].description;delete alerts.items[0].cause;delete alerts.items[0].effect;
  assert.equal(present(alerts).items[0].routes[0].label,'0504');
  assert.equal(present(alerts).items[0].title,'TTC service disruption');
  alerts.items[0].activePeriods=[{start:new Date(fixture.now+1).toISOString()}];assert.equal(present(alerts).items.length,0);
  alerts.items[0].activePeriods=[{start:new Date(fixture.now-1).toISOString(),end:new Date(fixture.now+1).toISOString()}];assert.equal(present(alerts).items.length,1);
  alerts.items[0].state='expired';assert.equal(present(alerts).items.length,0);
  const output=structuredClone(fixture.ttcDiversions);output.diversions[0].geometrySource='ttc-official';assert.equal(present(undefined,output).items[0].diversions[0].label,'TTC-published diversion');
  output.diversions[0].geometrySource='unknown';assert.equal(present(undefined,output).items[0].diversions.length,0);
  assert.equal(ttcPresentation(undefined,undefined,fixture.now).items.length,0);
});

test('sparse metadata preserves official notices, rejects invalid segments and supports outside-radius context',()=>{
  const alerts=structuredClone(fixture.ttcAlerts),a=alerts.items[0];
  a.correlation.stops[0].stopName='';
  a.correlation.candidates[0].affectedSegment.geometryStatus='missing';
  delete a.activePeriods;
  const model=ttcPresentation(alerts,{status:'ok',checkedAt:new Date(fixture.now).toISOString()},fixture.now,{origin:[44,-80],radius:1});
  assert.equal(model.items[0].stops[0].name,a.correlation.stops[0].stopId);
  assert.equal(model.items[0].scheduled.length,0);assert.equal(model.items[0].diversions.length,0);
  assert.match(model.items[0].geography,/Citywide alert/);assert.deepEqual(model.items[0].periods,[]);
  delete a.correlation;delete a.routes;
  assert.deepEqual(present(alerts).items[0].routes,[]);
  delete alerts.items;assert.deepEqual(present(alerts).items,[]);
});
test('snapshot composition preserves unrelated disruption sources',async()=>{
  const {mergeTtcDisruptions}=await import('../src/ttc/presentation.js');
  const roads={items:[{id:'road'}]},data={roads};
  const result=mergeTtcDisruptions(data,fixture.ttcAlerts,fixture.ttcDiversions);
  assert.equal(result.roads,roads);assert.equal(result.ttcAlerts,fixture.ttcAlerts);assert.equal(result.ttcDiversions,fixture.ttcDiversions);
  assert.deepEqual(data,{roads});
});
test('map replacement removes live paths and listeners; unknown selection cannot frame an arbitrary route',()=>{
  const h=harness();h.layer.update(present().items);const lines=[...h.members];
  h.layer.reveal('missing');assert.equal(h.map.bounds,undefined);
  h.layer.destroy();assert.equal(h.members.size,0);assert.ok(lines.every(l=>Object.keys(l.handlers).length===0));
  const replacement=createTtcLayer(h.map,{layerGroup:()=>({addTo(){return this;},clearLayers(){},remove(){}})},assert.fail);
  assert.equal(replacement.diagnostics().parts,0);replacement.destroy();
});
