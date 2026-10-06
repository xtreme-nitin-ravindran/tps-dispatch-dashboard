import test from 'node:test';
import assert from 'node:assert/strict';
import { frontendFixture } from './fixtures/ttc-diversions/frontend.js';
import { ttcPresentation, mergeTtcDisruptions } from '../src/ttc/presentation.js';
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

// ---------------------------------------------------------------------------
// Story 51D — Unified UI Presentation.
//
// An active official Service Change that a confirmed observed path claims through
// `relatedAdvisoryRefs` must be presented once, with its geometry, even when the
// GTFS-RT alert set is healthy-empty. Unmatched advisories stay in the citywide
// list. The official text stays TTC-provided; the path stays SirenTO-observed.
// ---------------------------------------------------------------------------
import { baselineSnapshot, baselineStaticIndex, observedEastboundDiversion, BASELINE_EPOCH } from './fixtures/ttc-official-advisory/baseline.js';
import { officialAdvisories } from '../src/ttc/official-advisories.js';
import { publicTtcGeometry } from '../scripts/publish-ttc-geometry.js';
import { claimedAdvisoryIds, activeOfficialAdvisories } from '../src/ttc/presentation.js';
import { advisoryRef } from '../src/ttc/official-advisories.js';

// Build the production-shaped route 94 case: official advisory + healthy-empty
// GTFS-RT alerts + confirmed observed geometry that claims the advisory.
function officialAdvisoryCase() {
  const snapshot = baselineSnapshot();
  const advisories = officialAdvisories(snapshot.disruptions);
  const observed = observedEastboundDiversion(baselineStaticIndex(), advisories);
  return {
    advisories,
    transit: snapshot.disruptions.transit,
    ttcAlerts: snapshot.ttcAlerts,
    ttcDiversions: publicTtcGeometry(observed.output),
    now: BASELINE_EPOCH
  };
}

test('51D: the presentation ref prefix matches the official-advisory contract', () => {
  // The browser keeps a local prefix to avoid importing the Node contract module;
  // this guards against drift.
  assert.equal(advisoryRef('102'), 'ttc-service-change:102');
  const claimed = claimedAdvisoryIds({ status: 'ok', checkedAt: new Date(BASELINE_EPOCH).toISOString(), diversions: [{ status: 'confirmed', geometrySource: 'sirento-observed', lastObservedAt: new Date(BASELINE_EPOCH).toISOString(), geometry: [[-79.38, 43.66], [-79.39, 43.66]], relatedAdvisoryRefs: ['ttc-service-change:102'] }] }, null, BASELINE_EPOCH);
  assert.deepEqual([...claimed], ['102']);
});

test('51D: a claimed official Service Change renders once with its observed geometry', () => {
  const c = officialAdvisoryCase();
  const model = ttcPresentation(c.ttcAlerts, c.ttcDiversions, c.now, { advisories: c.transit });
  assert.equal(model.items.length, 1);
  const [item] = model.items;
  // The item is keyed by the official advisory id, not a GTFS-RT id.
  assert.equal(item.id, '102');
  assert.equal(item.title, '94 Wellesley – Temporary route change due to Wellesley Street project');
  assert.deepEqual(item.routes, [{ id: '94', label: '94' }]);
  // The observed path is attached and explicitly SirenTO-observed.
  assert.equal(item.diversions.length, 1);
  assert.equal(item.diversions[0].label, 'Observed by SirenTO');
  assert.equal(item.diversions[0].source, 'sirento-observed');
  // Route-only official advisories carry no structured stops or scheduled segment.
  assert.deepEqual(item.stops, []);
  assert.deepEqual(item.scheduled, []);
  // The official text is preserved verbatim and no raw fleet evidence leaks.
  assert.match(item.description, /south on Jarvis Street/);
  assert.doesNotMatch(JSON.stringify(item), /vehicleId|tripId|shapeId|trajectoryCount|rawEvidence/);
});

test('51D: the official advisory is claimed by the observed path and deduped from the citywide list', () => {
  const c = officialAdvisoryCase();
  const claimed = claimedAdvisoryIds(c.ttcDiversions, c.transit, c.now);
  assert.deepEqual([...claimed], ['102']);
  // The citywide list excludes the claimed advisory so it is never shown twice.
  const citywide = activeOfficialAdvisories(c.transit, c.now).filter(item => !claimed.has(item.id));
  assert.deepEqual(citywide, []);
});

test('51D: an unmatched official advisory stays visible in the citywide list with no path', () => {
  const c = officialAdvisoryCase();
  // No observed geometry claims the advisory.
  const model = ttcPresentation(c.ttcAlerts, { status: 'ok', checkedAt: new Date(c.now).toISOString(), diversions: [] }, c.now, { advisories: c.transit });
  assert.equal(model.items.length, 0);
  const claimed = claimedAdvisoryIds({ status: 'ok', checkedAt: new Date(c.now).toISOString(), diversions: [] }, c.transit, c.now);
  assert.equal(claimed.size, 0);
  // The advisory remains in the citywide list, unchanged and without geometry.
  const citywide = activeOfficialAdvisories(c.transit, c.now).filter(item => !claimed.has(item.id));
  assert.equal(citywide.length, 1);
  assert.equal(citywide[0].id, '102');
  assert.equal(citywide[0].geometry, undefined);
});

test('51D: a stale or unconfirmed observed path never claims an official advisory', () => {
  const c = officialAdvisoryCase();
  for (const mutate of [
    d => { d.diversions[0].status = 'likely'; },
    d => { d.diversions[0].lastObservedAt = new Date(c.now - 1800001).toISOString(); },
    d => { d.diversions[0].expiresAt = new Date(c.now).toISOString(); },
    d => { d.diversions[0].geometry = [[Infinity, 43], [-79, 43]]; },
    d => { d.status = 'unavailable'; }
  ]) {
    const observed = structuredClone(c.ttcDiversions);
    mutate(observed);
    assert.equal(claimedAdvisoryIds(observed, c.transit, c.now).size, 0);
    assert.equal(ttcPresentation(c.ttcAlerts, observed, c.now, { advisories: c.transit }).items.length, 0);
  }
});

test('51D: an expired official advisory is never presented even when a path claims it', () => {
  const c = officialAdvisoryCase();
  const transit = structuredClone(c.transit);
  transit.items[0].periods = [{ start: c.now - 10000000, end: c.now - 1000 }];
  const model = ttcPresentation(c.ttcAlerts, c.ttcDiversions, c.now, { advisories: transit });
  assert.equal(model.items.length, 0);
});

test('51D: a GTFS-RT alert and an official advisory with the same id never collide', () => {
  const c = officialAdvisoryCase();
  // A GTFS-RT alert whose id equals the official advisory id must not be
  // overwritten by the official-advisory item (and vice versa).
  const alert = {
    id: '102', header: 'GTFS-RT detour', description: '', routes: ['94'], stops: [], activePeriods: [],
    informedEntities: [], source: 'ttc-gtfs-rt', fetchedAt: new Date(c.now).toISOString(),
    correlation: { status: 'unmatched', routes: [], stops: [], trips: [], routeResults: [], candidates: [] }
  };
  const feed = { ...c.ttcAlerts, items: [alert] };
  const model = ttcPresentation(feed, c.ttcDiversions, c.now, { advisories: c.transit });
  // The GTFS-RT item wins the id; the official advisory is not duplicated.
  assert.equal(model.items.length, 1);
  assert.equal(model.items[0].title, 'GTFS-RT detour');
});

test('51D: nearby context uses the observed geometry for a claimed official advisory', () => {
  const c = officialAdvisoryCase();
  const model = ttcPresentation(c.ttcAlerts, c.ttcDiversions, c.now, { advisories: c.transit, origin: [43.665, -79.38], radius: 1 });
  assert.equal(model.items.length, 1);
  assert.match(model.items[0].geography, /Within selected radius/);
  assert.ok(Number.isFinite(model.items[0].nearestDistance));
});

test('51D: mergeTtcDisruptions applies an optional transit override without mutating the input', () => {
  const data = { roads: { items: [] } };
  const transit = { items: [{ id: '102' }] };
  const result = mergeTtcDisruptions(data, { items: [] }, { diversions: [] }, transit);
  assert.equal(result.transit, transit);
  assert.equal(result.ttcAlerts.items.length, 0);
  assert.deepEqual(data, { roads: { items: [] } });
  // Without an override the original transit feed is preserved.
  const preserved = mergeTtcDisruptions({ transit: { items: [{ id: 'x' }] } }, { items: [] }, { diversions: [] });
  assert.equal(preserved.transit.items[0].id, 'x');
});

test('51D: the official-advisory browser fixture renders the Service Change once with observed geometry', async () => {
  const { readFile } = await import('node:fs/promises');
  const fixture = JSON.parse(await readFile(new URL('./fixtures/ttc-official-advisory/frontend.json', import.meta.url), 'utf8'));
  const fetch = async () => ({ ok: true, json: async () => structuredClone(fixture) });
  const loaded = await loadTtcUiFixture({ hostname: 'localhost', search: '?ttcFixture=official-advisory' }, fetch, fixture.now);
  // The fixture carries the official transit feed, healthy-empty alerts, and geometry.
  assert.equal(loaded.transit.items.length, 1);
  assert.equal(loaded.ttcAlerts.items.length, 0);
  assert.equal(loaded.ttcDiversions.diversions.length, 1);
  assert.deepEqual(loaded.ttcDiversions.diversions[0].relatedAdvisoryRefs, ['ttc-service-change:102']);
  const model = ttcPresentation(loaded.ttcAlerts, loaded.ttcDiversions, fixture.now, { advisories: loaded.transit });
  assert.equal(model.items.length, 1);
  assert.equal(model.items[0].id, '102');
  assert.equal(model.items[0].diversions.length, 1);
  assert.equal(model.items[0].diversions[0].label, 'Observed by SirenTO');
  // The claimed advisory is deduped from the citywide list.
  assert.equal(claimedAdvisoryIds(loaded.ttcDiversions, loaded.transit, fixture.now).has('102'), true);
});

test('51D: the official-advisory fixture mode fails clearly when the fixture is missing', async () => {
  const fetch = async () => ({ ok: false });
  await assert.rejects(
    loadTtcUiFixture({ hostname: 'localhost', search: '?ttcFixture=official-advisory' }, fetch, BASELINE_EPOCH),
    /Generate the TTC UI fixture first/
  );
});

test('51D: activeOfficialAdvisories accepts ISO-string periods and rejects a stale feed', () => {
  // ISO-string period bounds exercise the Date.parse fallback in periodBound.
  const isoFeed = { fetchedAt: new Date(BASELINE_EPOCH).toISOString(), items: [{ id: 'iso', periods: [{ start: new Date(BASELINE_EPOCH - 1000).toISOString(), end: new Date(BASELINE_EPOCH + 1000).toISOString() }] }] };
  assert.deepEqual(activeOfficialAdvisories(isoFeed, BASELINE_EPOCH).map(a => a.id), ['iso']);
  // A stale feed yields no active advisories.
  const stale = { fetchedAt: new Date(BASELINE_EPOCH - 3600001).toISOString(), items: [{ id: 'x', periods: [] }] };
  assert.deepEqual(activeOfficialAdvisories(stale, BASELINE_EPOCH), []);
  // A missing feed is empty, not an error.
  assert.deepEqual(activeOfficialAdvisories(undefined, BASELINE_EPOCH), []);
});

test('51D: claimedAdvisoryIds ignores non-string and foreign-namespace refs', () => {
  const observed = {
    status: 'ok', checkedAt: new Date(BASELINE_EPOCH).toISOString(),
    diversions: [{ status: 'confirmed', geometrySource: 'sirento-observed', lastObservedAt: new Date(BASELINE_EPOCH).toISOString(), geometry: [[-79.38, 43.66], [-79.39, 43.66]], relatedAdvisoryRefs: [42, 'ttc-gtfs-rt:9', 'ttc-service-change:102'] }]
  };
  assert.deepEqual([...claimedAdvisoryIds(observed, null, BASELINE_EPOCH)], ['102']);
  // A diversion with no refs contributes nothing.
  const noRefs = { ...observed, diversions: [{ ...observed.diversions[0], relatedAdvisoryRefs: undefined }] };
  assert.equal(claimedAdvisoryIds(noRefs, null, BASELINE_EPOCH).size, 0);
});

test('51D: a claimed advisory with no matching diversion is not presented', () => {
  const c = officialAdvisoryCase();
  // The advisory is claimed by a ref, but the diversion does not carry that ref.
  const observed = structuredClone(c.ttcDiversions);
  observed.diversions[0].relatedAdvisoryRefs = ['ttc-service-change:999'];
  const model = ttcPresentation(c.ttcAlerts, observed, c.now, { advisories: c.transit });
  assert.equal(model.items.length, 0);
});

test('51D: an advisory with missing title, description, effect and non-finite periods falls back safely', () => {
  const c = officialAdvisoryCase();
  const transit = structuredClone(c.transit);
  transit.items[0].title = '';
  transit.items[0].description = '';
  transit.items[0].effect = '';
  transit.items[0].periods = [{ start: null, end: null }];
  const model = ttcPresentation(c.ttcAlerts, c.ttcDiversions, c.now, { advisories: transit });
  assert.equal(model.items.length, 1);
  assert.equal(model.items[0].title, 'TTC service disruption');
  assert.equal(model.items[0].description, '');
  assert.equal(model.items[0].cause, '');
  assert.deepEqual(model.items[0].periods, [{ start: null, end: null }]);
});

test('51D: a claimed advisory with an unmapped origin reports citywide geography', () => {
  const c = officialAdvisoryCase();
  // An origin far from the path yields a finite distance; a null origin yields citywide.
  const citywide = ttcPresentation(c.ttcAlerts, c.ttcDiversions, c.now, { advisories: c.transit });
  assert.equal(citywide.items[0].geography, 'Citywide TTC disruption');
  assert.equal(citywide.items[0].nearestDistance, null);
});

test('51D: sparse advisory and feed shapes fall back without throwing', () => {
  const c = officialAdvisoryCase();
  // A feed with no items array yields no active advisories.
  assert.deepEqual(activeOfficialAdvisories({ fetchedAt: new Date(c.now).toISOString() }, c.now), []);
  // An advisory with no routes and no periods still renders with safe defaults.
  const transit = { fetchedAt: new Date(c.now).toISOString(), items: [{ id: '102', title: 'Sparse advisory', description: '', effect: 'DETOUR' }] };
  const observed = { status: 'ok', checkedAt: new Date(c.now).toISOString(), diversions: c.ttcDiversions.diversions };
  const model = ttcPresentation(c.ttcAlerts, observed, c.now, { advisories: transit });
  assert.equal(model.items.length, 1);
  assert.deepEqual(model.items[0].routes, []);
  assert.deepEqual(model.items[0].periods, []);
  // An observed artifact with no diversions array claims nothing and renders nothing.
  const emptyObserved = { status: 'ok', checkedAt: new Date(c.now).toISOString() };
  assert.equal(claimedAdvisoryIds(emptyObserved, transit, c.now).size, 0);
  assert.equal(ttcPresentation(c.ttcAlerts, emptyObserved, c.now, { advisories: transit }).items.length, 0);
});
