import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeRoads,normalizeTransit,parseTextProto,updateDisruptions,fetchDisruptionSource} from '../src/disruptions/source.js';
import {currentDisruptions,roadDistance} from '../src/disruptions/view.js';
const now=Date.UTC(2026,8,22);
const proto=`header { gtfs_realtime_version: "2.0" incrementality: FULL_DATASET timestamp: ${now/1000} }
entity { id: "a" alert { active_period {start: ${now/1000-60} end: ${now/1000+60}} informed_entity {route_id: "1"} header_text {translation {text: "No service between A and B" language: "en"}} effect: NO_SERVICE }}
entity { id: "b" alert { active_period {start: ${now/1000+60}} header_text {translation {text: "Future alert" language: "en"}} }} `;
const road={id:'r',name:'Road A',startTime:String(now-1000),endTime:String(now+1000),latitude:'43.7',longitude:'-79.4',geoPolyline:'[-79.5,43.7],[-79.3,43.7]',currImpact:'High',type:'ROAD_CLOSED',scheduleMonday:'22:00-05:00'};
const feed=items=>({items,fetchedAt:new Date(now).toISOString(),status:'ok'});
test('road geometry flips longitude/latitude and retains schedules and closure type',()=>{
 const [r]=normalizeRoads({Closure:[road]}).items;
 assert.deepEqual(r.line,[[43.7,-79.5],[43.7,-79.3]]);
 assert.equal(r.type,'ROAD CLOSED');assert.match(r.schedule,/Monday: 22:00-05:00/);
 assert.equal(normalizeRoads({Closure:[{...road,latitude:null,longitude:null,geoPolyline:'bad'}]}).items[0].coordinates,null);
 assert.throws(()=>normalizeRoads({error:'bad'}));
});
test('TTC parses repeated fields, active windows and rejects incomplete or stale snapshots',()=>{
 const result=normalizeTransit(proto,now);
 assert.deepEqual(result.items[0].routes,['1']);
 assert.equal(currentDisruptions(feed(result.items),'transit',now).length,1);
 assert.throws(()=>parseTextProto('entity { id: "x"'));
 assert.throws(()=>normalizeTransit(proto,now+3600001));
 assert.throws(()=>normalizeTransit(proto.replace('FULL_DATASET','DIFFERENTIAL'),now));
 assert.equal(normalizeTransit(proto.split('entity')[0],now).items.length,0);
});
test('road filters exclude expired, future and no-impact entries; stale data expires',()=>{
 const r=normalizeRoads({Closure:[road]}).items[0];
 const items=[r,{...r,expired:true},{...r,start:now+1},{...r,end:now},{...r,impact:'None'}];
 assert.deepEqual(currentDisruptions(feed(items),'roads',now),[r]);
 assert.deepEqual(currentDisruptions(feed(items),'roads',now+3600001),[]);
 assert.deepEqual(currentDisruptions({},'roads',now),[]);
});
test('nearby road filtering uses segments even when endpoints are outside radius',()=>{
 const r=normalizeRoads({Closure:[road]}).items[0];
 r.coordinates=null;
 assert.ok(roadDistance(r,[43.7,-79.4])<0.01);
 assert.ok(roadDistance(r,[43.8,-79.4])>10);
 assert.equal(roadDistance({line:[],coordinates:null},[43.7,-79.4]),Infinity);
});
test('sources refresh independently, cache five minutes, and preserve successful timestamps on failure',async()=>{
 let calls=0;
 const previous={roads:{...feed([road]),checkedAt:new Date(now).toISOString()},transit:{...feed([]),checkedAt:new Date(now).toISOString()}};
 await updateDisruptions(previous,new Date(now+1000),async()=>{calls++;});assert.equal(calls,0);
 const updated=await updateDisruptions(previous,new Date(now+300000),async kind=>{calls++;if(kind==='roads') throw Error('down');return {items:[]};});
 assert.equal(calls,2);assert.equal(updated.roads.status,'unavailable');assert.equal(updated.roads.fetchedAt,previous.roads.fetchedAt);
 assert.equal(updated.transit.status,'ok');assert.deepEqual(updated.transit.items,[]);
 await assert.rejects(fetchDisruptionSource('roads',async()=>({ok:false,status:503}),now));
 const roads=await fetchDisruptionSource('roads',async()=>({ok:true,json:async()=>({Closure:[]})}),now);
 assert.deepEqual(roads.items,[]);
 const transit=await fetchDisruptionSource('transit',async()=>({ok:true,text:async()=>proto.split('entity')[0]}),now);
 assert.deepEqual(transit.items,[]);
});

test('TTC mixed JSON entities use camelCase and numeric string timestamps',()=>{
 const jsonEntity={id:'mixed',alert:{activePeriod:[{start:String(now/1000-60)}],informedEntity:[{routeId:'5'}],headerText:{translation:[{text:'Line 5 delay',language:'en'}]}}};
 const result=normalizeTransit(proto+'entity '+JSON.stringify(jsonEntity),now);
 assert.equal(result.items.length,3);
 assert.equal(result.items[2].title,'Line 5 delay');
 assert.deepEqual(result.items[2].routes,['5']);
 assert.equal(currentDisruptions(feed(result.items),'transit',now).length,2);
});

test('textproto rejects malformed fields, values, separators and excessive nesting',()=>{
 for(const text of ['@','1: 2','field:','field: }','field value','}','a {'.repeat(22)+'}'.repeat(22)]) assert.throws(()=>parseTextProto(text));
 assert.deepEqual({...parseTextProto('# comment\nvalue: -1.5')},{value:[-1.5],entity:[]});
});

test('TTC validates headers, alert identities and active periods, while tolerating optional fields',()=>{
 const header=proto.split('entity')[0];
 for(const text of ['',header.replace(String(now/1000),String(now/1000+301)),header+'entity { id: "x" alert {} }',header+'entity { alert { header_text {translation {text:"Title"}}} }',header+'entity {id:"x" alert {header_text {translation {text:"Title"}} active_period {start:"bad"}}}']) assert.throws(()=>normalizeTransit(text,now));
 assert.deepEqual(normalizeTransit(header+'entity {id:"gone" is_deleted:true alert {}} entity {id:"no-alert"}',now).items,[]);
 const [item]=normalizeTransit(header+'entity {id:"x" alert {header_text {translation {text:"Titre" language:"fr"} translation {text:"Title" language:"en"}} informed_entity {} active_period {end:123}}}',now).items;
 assert.equal(item.title,'Title');assert.deepEqual(item.routes,[]);assert.deepEqual(item.periods,[{start:null,end:123000}]);
 const mixed={id:'q',alert:{headerText:{translation:[{text:'Quoted "text" \\ path {x}'}]}}};
 assert.equal(normalizeTransit(header+'entity '+JSON.stringify(mixed),now).items[0].title,'Quoted "text" \\ path {x}');
 assert.deepEqual(normalizeTransit(header,now).items,[]);
});

test('roads reject malformed identities and dates, and discard invalid geometry',()=>{
 for(const row of [{name:'x'},{id:'x'},{...road,startTime:'bad'},{...road,endTime:'bad'}]) assert.throws(()=>normalizeRoads({Closure:[row]}));
 const [item]=normalizeRoads({Closure:[{id:'x',road:'Fallback name',geoPolyline:'[200,100]',expired:1}]}).items;
 assert.equal(item.title,'Fallback name');assert.deepEqual(item.line,[]);assert.equal(item.coordinates,null);assert.equal(item.start,null);assert.equal(item.expired,true);
 assert.deepEqual(normalizeRoads({Closure:[{...road,geoPolyline:''}]}).items[0].line,[]);
});

test('failed initial disruption refresh publishes unavailable empty sources and future cache is retried',async()=>{
 const result=await updateDisruptions(undefined,new Date(now),async()=>{throw Error('offline');});
 for(const source of Object.values(result)) {assert.equal(source.status,'unavailable');assert.deepEqual(source.items,[]);assert.equal(source.fetchedAt,null);}
 let calls=0;
 await updateDisruptions({roads:{checkedAt:new Date(now+1).toISOString()}},new Date(now),async()=>{calls++;return {items:[]};});
 assert.equal(calls,2);
});

test('disruption filters support open-ended periods and reject future fetch timestamps',()=>{
 const r={expired:false,start:null,end:null,impact:'High'};
 assert.deepEqual(currentDisruptions(feed([r]),'roads',now),[r]);
 assert.deepEqual(currentDisruptions({fetchedAt:new Date(now).toISOString()},'roads',now),[]);
 assert.deepEqual(currentDisruptions({fetchedAt:new Date(now+300001).toISOString(),items:[r]},'roads',now),[]);
 const alerts=[{periods:[]},{periods:[{start:null,end:null}]},{periods:[{start:null,end:now}]}];
 assert.deepEqual(currentDisruptions(feed(alerts),'transit',now),alerts.slice(0,2));
 assert.equal(roadDistance({},null),Infinity);
 assert.equal(roadDistance({coordinates:[43.7,-79.4]},[43.7,-79.4]),0);
 assert.equal(roadDistance({line:[[43.7,-79.4],[43.7,-79.4]]},[43.7,-79.4]),0);
});
