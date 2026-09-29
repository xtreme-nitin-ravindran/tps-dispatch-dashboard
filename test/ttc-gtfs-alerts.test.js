import test from 'node:test';
import assert from 'node:assert/strict';
import bindings from 'gtfs-realtime-bindings';
import { parseTtcAlerts, fetchTtcAlerts, updateTtcAlerts } from '../src/ttc/alerts.js';
const {FeedMessage} = bindings.transit_realtime;
const now = new Date('2026-09-28T12:00:00Z');
const seconds = now.getTime()/1000;
const string = (text, language) => ({text,...(language ? {language} : {})});
// Small real protobuf messages built from readable fixtures; no live network in unit tests.
const encode = (alerts = [], header = {}) => FeedMessage.encode(FeedMessage.create({header:{gtfsRealtimeVersion:'2.0',timestamp:seconds,...header},entity:alerts.map((alert,i) => ({id:`alert-${i}`,alert}))})).finish();
const relevant = {cause:bindings.transit_realtime.Alert.Cause.CONSTRUCTION,effect:bindings.transit_realtime.Alert.Effect.DETOUR,headerText:{translation:[string('Construction detour','en')]}};

test('construction/detour preserves selectors, exact IDs, unique routes/stops and periods', () => {
  const a = {...relevant,informedEntity:[{routeId:'0501',stopId:'001',routeType:0},{routeId:'0501',stopId:'002'},{routeId:'0501',stopId:'001'},{trip:{routeId:'29',tripId:'trip'}}],activePeriod:[{start:seconds-100,end:seconds+100},{start:seconds+500}]};
  const result = parseTtcAlerts(encode([a]),now).items[0];
  assert.equal(result.cause,'CONSTRUCTION'); assert.equal(result.effect,'DETOUR');
  assert.deepEqual(result.routes,['0501','29']); assert.deepEqual(result.stops,['001','002']);
  assert.equal(result.informedEntities.length,4); assert.equal(result.activePeriods.length,2);
  assert.equal(result.activePeriods[0].start,new Date((seconds-100)*1000).toISOString());
  assert.equal(result.source,'ttc-gtfs-rt'); assert.equal(result.id,'alert-0');
});
test('missing optional fields and text fallback; English, unlabeled and other translations retained', () => {
  const a = {headerText:{translation:[string('Déviation','fr'),string(' Detour original text ','en-CA'),string('Detour')]}};
  const item = parseTtcAlerts(encode([a]),now).items[0];
  assert.equal(item.header,' Detour original text '); assert.equal(item.headerTranslations.length,3);
  assert.equal(item.cause,undefined); assert.equal(item.url,undefined); assert.deepEqual(item.stops,[]);
  assert.equal(parseTtcAlerts(encode([{headerText:{translation:[string('Detour')]}}]),now).items[0].header,'Detour');
  assert.equal(parseTtcAlerts(encode([{...relevant,headerText:{translation:[string('Déviation','fr')]}}]),now).items[0].header,'Déviation');
});
test('unknown enums survive without defaults or crashes', () => {
  const item = parseTtcAlerts(encode([{...relevant,cause:999,severityLevel:888}]),now).items[0];
  assert.equal(item.cause,'UNKNOWN_999'); assert.equal(item.severity,'UNKNOWN_888');
});
test('irrelevant and subway-only excluded; timed alerts retained; empty feed valid', () => {
  const alerts = [{effect:3},{...relevant,informedEntity:[{routeType:1}]},{...relevant,activePeriod:[{end:seconds}]},{...relevant,activePeriod:[{start:seconds+1}]}];
  assert.equal(parseTtcAlerts(encode(alerts),now).items.length,2);
  assert.deepEqual(parseTtcAlerts(encode(),now).items,[]);
});
test('malformed, empty bytes, differential, stale and invalid windows rejected', () => {
  for (const bytes of [new Uint8Array([255]),new Uint8Array(),encode([],{incrementality:1}),encode([],{timestamp:seconds-7200}),encode([{...relevant,activePeriod:[{start:seconds,end:seconds-1}]}])]) assert.throws(() => parseTtcAlerts(bytes,now));
});
test('ordering deterministic across selector and translation ordering', () => {
  const a = {...relevant,informedEntity:[{routeId:'2'},{routeId:'1'}]};
  assert.deepEqual(parseTtcAlerts(encode([a]),now),parseTtcAlerts(encode([{...a,informedEntity:[...a.informedEntity].reverse()}]),now));
});
test('network, HTTP and decode failures are controlled; last good result retained distinctly from empty success', async () => {
  const previous = {...parseTtcAlerts(encode([relevant]),now),fetchedAt:now.toISOString()};
  const logs = [];
  for (const fetchImpl of [async () => {throw new Error('offline');},async () => ({ok:false,status:503}),async () => ({ok:true,arrayBuffer:async () => new Uint8Array([255])})]) {
    const result = await updateTtcAlerts(previous,now,date => fetchTtcAlerts(date,fetchImpl),entry => logs.push(entry));
    assert.equal(result.status,'unavailable'); assert.deepEqual(result.items,previous.items); assert.equal(result.fetchedAt,previous.fetchedAt);
  }
  assert.equal(logs.length,3);
  const result = await updateTtcAlerts(previous,now,async () => parseTtcAlerts(encode(),now),() => {});
  assert.equal(result.status,'ok'); assert.deepEqual(result.items,[]);
});

test('optional headers, selectors, dates and deleted entities', () => {
  const raw = value => FeedMessage.encode(FeedMessage.create(value)).finish();
  assert.throws(() => parseTtcAlerts(raw({header:{gtfsRealtimeVersion:''}}),now));
  assert.throws(() => parseTtcAlerts(encode([],{timestamp:seconds+600}),now));
  assert.throws(() => parseTtcAlerts(encode([{...relevant,activePeriod:[{start:'9999999999999999'}]}]),now));
  assert.match(parseTtcAlerts(raw({header:{gtfsRealtimeVersion:'2.0'},entity:[{id:'',alert:relevant}]}),now).items[0].id,/^fallback:/);
  assert.equal(parseTtcAlerts(raw({header:{gtfsRealtimeVersion:'2.0'},entity:[{id:'a',alert:relevant},{id:'a',alert:relevant}]}),now).items.length,1);
  const result = parseTtcAlerts(raw({header:{gtfsRealtimeVersion:'2.0'},entity:[{id:'deleted',isDeleted:true,alert:relevant},{id:'vehicle'},{id:'a',alert:{cause:bindings.transit_realtime.Alert.Cause.CONSTRUCTION,activePeriod:[{}, {end:seconds+10},{start:seconds-10}],informedEntity:[{routeType:3}],url:{translation:[string('https://ttc.ca','en')]}}}]}),now);
  assert.equal(result.sourceUpdatedAt,null); assert.equal(result.items.length,1);
  assert.equal(result.items[0].url,'https://ttc.ca');
  assert.deepEqual(parseTtcAlerts(raw({header:{gtfsRealtimeVersion:'2.0'}})).items,[]);
});

test('default fetch, default logger, first failure and artifact validation', async t => {
  const {validateTtcAlerts} = await import('../src/ttc/alerts.js');
  t.mock.method(globalThis,'fetch',async () => ({ok:true,arrayBuffer:async () => encode([],{timestamp:Math.floor(Date.now()/1000)})}));
  t.mock.method(console,'log',() => {});
  assert.deepEqual((await fetchTtcAlerts()).items,[]);
  assert.equal((await updateTtcAlerts()).status,'ok');
  const failed = await updateTtcAlerts(undefined,now,async () => {throw new Error('failed');});
  assert.equal(failed.fetchedAt,null);
  const good = parseTtcAlerts(encode([relevant]),now);
  for (const value of [null,{}, {...good,items:null},{...good,sourceUpdatedAt:'bad'},
    ...[{id:''},{source:'other'},{fetchedAt:'bad'},{routes:null},{routes:[1]},{routes:['1','1']},{activePeriods:null},{activePeriods:[{start:'bad'}]},{activePeriods:[{end:'bad'}]},{informedEntities:null},{headerTranslations:null},{headerTranslations:[{text:1}]}].map(p => ({...good,items:[{...good.items[0],...p}]})),
    {...good,items:[good.items[0],good.items[0]]}]) assert.throws(() => validateTtcAlerts(value));
});

test('stable ties order texts, open periods, and multiple alert records', () => {
  const alert = {...relevant,headerText:{translation:[string('Z'),string('A'),string('B','en'),string('A','en')]},
    activePeriod:[{start:seconds-1,end:seconds+2},{start:seconds-1},{start:seconds-1,end:seconds+1}]};
  const result = parseTtcAlerts(encode([alert,relevant]),now);
  assert.deepEqual(result.items.map(a => a.id),['alert-0','alert-1']);
  assert.equal(result.items[0].header,'A');
});

test('lifecycle reconciles versions, additions, removal, empty, failure and recovery', async () => {
  const refresh = (prior, alerts, at = now) => updateTtcAlerts(prior,at,async () => parseTtcAlerts(encode(alerts),at),() => {});
  const first = await refresh(null,[relevant]);
  assert.deepEqual(first.changes.new,['alert-0']);
  const later = new Date(now.getTime()+1000);
  const same = await refresh(first,[relevant],later);
  assert.deepEqual(same.changes.unchanged,['alert-0']);
  assert.equal(same.items[0].contentHash,first.items[0].contentHash);
  assert.equal(same.items[0].updatedAt,first.items[0].updatedAt);
  const changed = await refresh(same,[{...relevant,descriptionText:{translation:[string('Updated')]}},relevant],later);
  assert.deepEqual(changed.changes.updated,['alert-0']);
  assert.deepEqual(changed.changes.new,['alert-1']);
  const failed = await updateTtcAlerts(changed,later,async () => {throw Error('offline');},() => {});
  assert.equal(failed.status,'unavailable'); assert.deepEqual(failed.items,changed.items);
  const empty = await refresh(failed,[],later);
  assert.equal(empty.status,'ok'); assert.deepEqual(empty.items,[]);
  assert.deepEqual(empty.changes.removed.map(i => i.id),['alert-0','alert-1']);
  const recovered = await refresh(empty,[relevant],later);
  assert.deepEqual(recovered.changes.new,['alert-0']);
});

test('period evaluation covers boundaries, open bounds, overlap, gaps and no periods', async () => {
  const {alertState,isAlertActive} = await import('../src/ttc/lifecycle.js');
  const start = now.toISOString(), end = new Date(now.getTime()+1000).toISOString();
  for (const [periods, at, expected] of [
    [[],now,'active'],[[{}],now,'active'],[[{start}],now,'active'],[[{end:start}],now,'expired'],
    [[{start:end}],now,'scheduled'],[[{start,end}],now,'active'],[[{start,end}],end,'expired'],
    [[{end:start},{start:end}],now,'scheduled'],[[{end:start},{start}],now,'active'],
    [[{start,end},{start}],end,'active']
  ]) {
    assert.equal(alertState({activePeriods:periods},at),expected);
    assert.equal(isAlertActive({activePeriods:periods},at),expected === 'active');
  }
});

test('fallback IDs ignore timestamps, distinct content differs, conflicting duplicate IDs rejected', () => {
  const raw = alerts => FeedMessage.encode(FeedMessage.create({header:{gtfsRealtimeVersion:'2.0'},entity:alerts})).finish();
  const bytes = raw([{id:'',alert:relevant}]);
  assert.equal(parseTtcAlerts(bytes,now).items[0].id,parseTtcAlerts(bytes,new Date(now.getTime()+1000)).items[0].id);
  assert.equal(parseTtcAlerts(raw([{id:'',alert:relevant},{id:'',alert:{...relevant,effect:1}}]),now).items.length,2);
  assert.throws(() => parseTtcAlerts(raw([{id:'a',alert:relevant},{id:'a',alert:{...relevant,effect:1}}]),now),/Conflicting/);
});

test('lifecycle schema rejects malformed state and content', async () => {
  const {validateTtcAlerts} = await import('../src/ttc/alerts.js');
  const good = await updateTtcAlerts(null,now,async () => parseTtcAlerts(encode([relevant]),now),() => {});
  for (const patch of [{status:'available'},{checkedAt:null},{fetchedAt:null},{changes:{}},{lifecycleVersion:2},
    ...[{state:'other'},{contentHash:'bad'},{firstSeenAt:null},{description:4},{activePeriods:[{start:now.toISOString(),end:'2020-01-01T00:00:00Z'}]}].map(p => ({items:[{...good.items[0],...p}]}))]) {
    assert.throws(() => validateTtcAlerts({...good,...patch}));
  }
});

test('content changes cover all persisted TTC fields; expiration and bounded removals', async () => {
  const {alertContentHash} = await import('../src/ttc/lifecycle.js');
  const {validateTtcAlerts} = await import('../src/ttc/alerts.js');
  const original = parseTtcAlerts(encode([relevant]),now);
  const hash = alertContentHash(original.items[0]);
  for (const patch of [{cause:'OTHER_CAUSE'},{effect:'OTHER_EFFECT'},{routes:['0501']},{stops:['001']},
    {url:'https://example.com'},{header:'changed'},{description:'changed'},{severity:'WARNING'},
    {activePeriods:[{end:now.toISOString()}]},{informedEntities:[{trip:{tripId:'trip'}}]},
    {descriptionTranslations:[{text:'Déviation',language:'fr'}]}]) {
    assert.notEqual(alertContentHash({...original.items[0],...patch}),hash);
  }
  assert.throws(() => validateTtcAlerts(original,{published:true}));
  for (const patch of [{activePeriods:['bad']},{routes:['']},{informedEntities:[{stopId:1}]},{fetchedAt:'2026'},{headerTranslations:[null]}]) {
    assert.throws(() => validateTtcAlerts({...original,items:[{...original.items[0],...patch}]}));
  }
  const ended = await updateTtcAlerts(null,now,async () => parseTtcAlerts(encode([{...relevant,activePeriod:[{end:seconds}]}]),now),() => {});
  assert.equal(ended.items[0].state,'expired');
  const removed = await updateTtcAlerts(ended,now,async () => parseTtcAlerts(encode(),now),() => {});
  assert.equal(removed.changes.removed[0].state,'expired');
  const next = await updateTtcAlerts(removed,now,async () => parseTtcAlerts(encode(),now),() => {});
  assert.deepEqual(next.changes.removed,[]);
});

test('lifecycle rejects invalid clocks and distinguishes future bounded periods from expired windows',async()=>{
  const {alertState,reconcileAlerts}=await import('../src/ttc/lifecycle.js');
  const now=new Date('2026-09-28T16:00:00Z');
  assert.throws(()=>alertState({activePeriods:[]},'bad'),/reference time/);
  assert.equal(alertState({activePeriods:[{start:'2026-09-29T16:00:00Z',end:'2026-09-30T16:00:00Z'}]},now),'scheduled');
  assert.equal(alertState({activePeriods:[{start:'2026-09-29T16:00:00Z',end:'2026-09-28T16:00:00Z'}]},now),'expired');
  const item={id:'legacy',activePeriods:[]};
  for(const old of [item,{...item,fetchedAt:'2026-09-28T15:00:00.000Z'}]) {
    const result=reconcileAlerts({items:[item]},{items:[old]},now);
    assert.equal(result.items[0].firstSeenAt,old.fetchedAt || now.toISOString());assert.equal(result.items[0].updatedAt,old.fetchedAt || now.toISOString());
  }
});
