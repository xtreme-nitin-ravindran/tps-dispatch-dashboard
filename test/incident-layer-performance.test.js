import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { incidentGroupKey, reconcileIncidentLayers } from '../src/incident-layer-diff.js';
import { clusterPoints } from '../src/map-clusters.js';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const item = (id, coordinates) => ({call:{id,timestamp:1},coordinates});

test('unchanged incident representations are retained without additions or removals', () => {
  const current = new Map([['marker:a:v1',{}],['cluster:b|c:v1',{}]]);
  assert.deepEqual(reconcileIncidentLayers(current,['marker:a:v1','cluster:b|c:v1']),{
    remove:[],add:[],keep:['marker:a:v1','cluster:b|c:v1']
  });
});

test('filters remove stale incidents and add newly visible incidents', () => {
  const current = new Map([['marker:a:v1',{}],['marker:b:v1',{}]]);
  assert.deepEqual(reconcileIncidentLayers(current,['marker:b:v1','marker:c:v1']),{
    remove:['marker:a:v1'],add:['marker:c:v1'],keep:['marker:b:v1']
  });
});

test('changed marker state replaces only that incident representation', () => {
  const current = new Map([['marker:a:normal',{}],['marker:b:normal',{}]]);
  const changes = reconcileIncidentLayers(current,['marker:a:normal','marker:b:selected']);
  assert.deepEqual(changes.remove,['marker:b:normal']);
  assert.deepEqual(changes.add,['marker:b:selected']);
  assert.deepEqual(changes.keep,['marker:a:normal']);
});

test('zoom grouping changes reconcile without duplicate representations', () => {
  const incidents=[item('a',[1,1]),item('b',[1.01,1.01])];
  const wide=clusterPoints(incidents,()=>({x:1,y:1}));
  const close=clusterPoints(incidents,([lat,lng])=>({x:lat*10000,y:lng*10000}));
  const wideKeys=wide.map(group=>incidentGroupKey(group));
  const closeKeys=close.map(group=>incidentGroupKey(group));
  const changes=reconcileIncidentLayers(new Map(wideKeys.map(key=>[key,{}])),closeKeys);
  assert.equal(new Set(closeKeys).size,closeKeys.length);
  assert.equal(changes.remove.length,1);
  assert.equal(changes.add.length,2);
  assert.equal(incidentGroupKey(incidents,true),'expanded:a|b:');
});

test('map rendering is incremental, selection-targeted, and zoom-coalesced', () => {
  assert.doesNotMatch(app,/callLayer\.clearLayers\(\)/);
  assert.match(app,/reconcileIncidentLayers\(renderedIncidentLayers, desiredKeys\)/);
  assert.match(app,/renderedIncidentLayers\.get\(key\)\.layers\.forEach\(layer => callLayer\.removeLayer\(layer\)\)/);
  assert.match(app,/if \(retained\) \{[\s\S]*?mapMarkers\.set\(id, marker\)[\s\S]*?continue;/);
  assert.match(app,/if \(previouslyFocusedCallId !== callId\) updateMarkerAppearance\(previouslyFocusedCallId\);[\s\S]*?updateMarkerAppearance\(callId\)/);
  assert.match(app,/if \(scheduledMarkerRender !== null\) return;[\s\S]*?requestAnimationFrame/);
  assert.match(app,/dispatchMap\.on\("zoomend",[\s\S]*?scheduleMapMarkerRender\(\)/);
});

test('popup clicks and unaffected overlays retain their established paths', () => {
  assert.match(app,/bindPopup\(createIncidentCard\(call,[\s\S]*?selectCall\(call\.id, \{ pan: false, revealRow: true \}\)/);
  assert.match(app,/renderDisruptions\(state\.disruptions/);
  assert.match(app,/nearbyOriginLayer\?\.clearLayers\(\)/);
  assert.match(app,/savedLocationForContext\(state\)/);
  assert.match(app,/markerIcon\(call, selected, sirenMatch, now\)/);
});
