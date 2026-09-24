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
 const merged=mergePolice([a],[a,{...a,source:'TFS',id:'F1'}],now);
 assert.equal(merged.length,1);
 assert.equal(merged[0].firstSeenAt,a.timestamp);
 assert.equal(merged[0].lastMeaningfulUpdateAt,undefined);
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
 const { distanceKm, distanceLabel, withinGeographicScope } = await import('../src/nearby.js');
 assert.equal(distanceKm([43.7,-79.4],[43.7,-79.4]),0);
 assert.ok(Math.abs(distanceKm([0,0],[0,1])-111.195)<0.01);
 assert.equal(distanceKm([43.7,-79.4],null),Infinity);
 assert.equal(distanceKm([43.7,-79.4],[NaN,0]),Infinity);
 assert.equal(distanceLabel(0.555),'0.6 km away');
 assert.equal(distanceLabel(Infinity),'');
 assert.equal(withinGeographicScope(null,null,null),true);
 assert.equal(withinGeographicScope([43.7,-79.4],1,[43.7,-79.4]),true);
 assert.equal(withinGeographicScope([43.7,-79.4],1,[43.8,-79.4]),false);
 assert.equal(withinGeographicScope([43.7,-79.4],1,null),false);
});

test('TPS normalization rejects invalid records and preserves unpublished-field fallbacks', () => {
 for (const value of [undefined, {}, {...row,OCCURRENCE_TIME_AGOL:'123'}, {...row,OCCURRENCE_TIME_AGOL:NaN}, {...row,CALL_TYPE:''}]) assert.throws(()=>normalizeTps(value), /Invalid TPS record/);
 const result=normalizeTps({...row,CROSS_STREETS:null,DIVISION:null,CALL_TYPE_CODE:null});
 assert.equal(result.location,'Location not published');
 assert.equal(result.division,'Unknown');
 assert.equal(result.callTypeCode,'');
 assert.equal(normalizeTps({...row,DIVISION:'TAC8'}).division,'TAC8');
 for (const coords of [[null,-79.4],[43.7,null],[43,-79.4],[44,-79.4],[43.7,-80],[43.7,-79]]) {
  assert.equal(normalizeTps({...row,LATITUDE:coords[0],LONGITUDE:coords[1]}).geography.coordinates,null);
 }
 assert.deepEqual(normalizeTps(row).geography.coordinates,[43.7,-79.4]);
});

test('TPS fetch handles empty feeds and paginates beyond 100 records', async () => {
 const ids=Array.from({length:101},(_,i)=>i+1), batches=[];
 const calls=await fetchTpsSource({fetchImpl:async url=>{
  const params=new URL(url).searchParams;
  if(params.has('returnIdsOnly')) return {ok:true,json:async()=>({objectIds:ids})};
  const batch=params.get('objectIds').split(','); batches.push(batch.length);
  return {ok:true,json:async()=>({features:batch.map(id=>({attributes:{...row,OCCURRENCE_TIME_AGOL:row.OCCURRENCE_TIME_AGOL+Number(id)}}))})};
 }});
 assert.equal(calls.length,101);
 assert.deepEqual(batches,[100,1]);
 assert.deepEqual(await fetchTpsSource({fetchImpl:async()=>({ok:true,json:async()=>({objectIds:[]})})}),[]);
});

test('TPS fetch rejects HTTP failures, missing IDs and incomplete pages', async () => {
 await assert.rejects(fetchTpsSource({fetchImpl:async()=>({ok:false,status:503})}), /TPS HTTP 503/);
 await assert.rejects(fetchTpsSource({fetchImpl:async()=>({ok:true,json:async()=>({})})}), /missing object IDs/);
 for(const page of [{}, {features:[],exceededTransferLimit:true}, {features:[]}]) {
  await assert.rejects(fetchTpsSource({fetchImpl:async url=>({ok:true,json:async()=>url.includes('returnIdsOnly')?{objectIds:[1]}:page})}), /Incomplete TPS response|TPS changed during fetch/);
 }
});

test('police retention includes the seven-day boundary and replaces refreshed records', () => {
 const now=new Date(row.OCCURRENCE_TIME_AGOL), a=normalizeTps(row);
 const at=delta=>({...a,id:String(delta),timestamp:new Date(now.getTime()+delta).toISOString()});
 const week=168*3600000;
 const result=mergePolice([{...a,description:'Updated'}],[a,at(-week),at(-week-1),at(1)],now);
 assert.deepEqual(result.map(r=>r.id),[a.id,String(-week)]);
 assert.equal(result[0].description,'Updated');
 assert.equal(result[0].lastMeaningfulUpdateAt,now.toISOString());
});
