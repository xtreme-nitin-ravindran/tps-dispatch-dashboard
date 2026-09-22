import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeTps,fetchTpsSource,mergePolice} from '../src/tps/source.js';
const row={OBJECTID:1,OCCURRENCE_TIME_AGOL:1789846662000,DIVISION:'D33',CALL_TYPE:'HAZARD',CALL_TYPE_CODE:'HAZ',CROSS_STREETS:'A - B',LATITUDE:43.7,LONGITUDE:-79.4};
test('TPS uses stable source-prefixed IDs, reported division and no invented ongoing status',()=>{
 const a=normalizeTps(row);
 assert.equal(a.id,normalizeTps({...row,OBJECTID:99}).id);
 assert.equal(a.geography.division,'Division 33');
 assert.equal(a.isOngoing,false);
 assert.notEqual(a.id,normalizeTps({...row,OCCURRENCE_TIME_AGOL:row.OCCURRENCE_TIME_AGOL+1000}).id);
 assert.equal(normalizeTps({...row,LATITUDE:null}).geography.coordinates,null);
});
test('TPS fetch checks IDs and rejects partial or error payloads',async()=>{
 const fetchImpl=async url=>({ok:true,json:async()=>url.includes('returnIdsOnly')?{objectIds:[1]}:{features:[{attributes:row}]}});
 assert.equal((await fetchTpsSource({fetchImpl})).length,1);
 await assert.rejects(fetchTpsSource({fetchImpl:async()=>({ok:true,json:async()=>({error:{code:500}})})}));
});
test('police retention preserves separate records without conflating TFS',()=>{
 const a=normalizeTps(row), now=new Date(row.OCCURRENCE_TIME_AGOL+1000);
 assert.equal(mergePolice([a],[a,{...a,source:'TFS',id:'F1'}],now).length,1);
});


test('unit labels handle numeric-leading codes without changing geographic divisions', async () => {
  const { policeUnitLabel } = await import('../src/tps/unit-label.js');
  for (const code of ['3GRP', '5GRP', 'SE1', 'TAC8', 'new-code', 'UNIT_9', 'X/Y', '123', 'New Unit', 'constructor']) {
    assert.equal(policeUnitLabel(code), `TPS code ${code} (meaning unconfirmed)`);
  }
  for (const label of ['Division 11', 'Possible divisions 33 / 41', 'Unknown']) {
    assert.equal(policeUnitLabel(label), label);
  }
  assert.equal(policeUnitLabel('HP'), 'Highway Patrol');
  assert.equal(policeUnitLabel(' hp '), 'Highway Patrol');
  assert.equal(policeUnitLabel('Highway Patrol'), 'Highway Patrol');
  for (const empty of [null, undefined, '', '  ']) assert.equal(policeUnitLabel(empty), 'Unknown');
});

test('nearby distances handle geographic distance and missing locations', async () => {
 const { distanceKm } = await import('../src/nearby.js');
 assert.equal(distanceKm([43.7,-79.4],[43.7,-79.4]),0);
 assert.ok(Math.abs(distanceKm([0,0],[0,1])-111.195)<0.01);
 assert.equal(distanceKm([43.7,-79.4],null),Infinity);
 assert.equal(distanceKm([43.7,-79.4],[NaN,0]),Infinity);
});
