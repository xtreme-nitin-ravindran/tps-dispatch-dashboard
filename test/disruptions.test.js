import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeRoads,normalizeTransit,parseTextProto,updateDisruptions,fetchDisruptionSource,repairIllegalJsonEscapes} from '../src/disruptions/source.js';
import {currentDisruptions,roadDistance,transitGeographicMatch} from '../src/disruptions/view.js';
import {disruptionPresentation,nearbyTransitPresentation,renderDisruptions} from '../src/disruptions/ui.js';
import {referenceCoordinates} from '../src/saved-locations.js';
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

test('TTC normalization preserves affected entities and resolves only structured stop data',()=>{
 const header=proto.split('entity')[0];
 const text=header+'entity {id:"geo" alert {header_text {translation {text:"Delay"}} informed_entity {route_id:"1" stop_id:"100"} informed_entity {route_id:"1" stop_id:"missing"} informed_entity {route_id:"2"}}}';
 const [alert]=normalizeTransit(text,now,{'100':{coordinates:[43.65,-79.38],name:'Structured station'}}).items;
 assert.deepEqual(alert.routes,['1','2']);
 assert.deepEqual(alert.stopIds,['100','missing']);
 assert.deepEqual(alert.affectedEntities,[
  {routeId:'1',stopId:'100',coordinates:[43.65,-79.38],name:'Structured station'},
  {routeId:'1',stopId:'missing'},
  {routeId:'2',stopId:null}
 ]);
 const [withoutLookup]=normalizeTransit(text,now,{}).items;
 assert.equal(withoutLookup.affectedEntities.some(entity => 'coordinates' in entity),false);
 const [official]=normalizeTransit(header+'entity {id:"official" alert {header_text {translation {text:"Delay"}} informed_entity {stop_id:"662"}}}',now).items;
 assert.deepEqual(official.affectedEntities[0],{routeId:null,stopId:'662',coordinates:[43.714379,-79.260939],name:'Danforth Rd at Kennedy Rd'});
});

test('TTC geographic matching handles radius boundaries, closest stops and unknown geography',()=>{
 const origin=[43.65,-79.38];
 const boundary=[43.65+1/111.195,-79.38];
 const alert={affectedEntities:[
  {routeId:'1',stopId:'far',coordinates:[43.7,-79.38],name:'Far stop'},
  {routeId:'1',stopId:'edge',coordinates:boundary,name:'Boundary stop'}
 ]};
 const edgeDistance=transitGeographicMatch(alert,origin,Infinity).nearestDistanceKm;
 const inside=transitGeographicMatch(alert,origin,edgeDistance);
 assert.equal(inside.geographicStatus,'nearby');
 assert.equal(inside.relevant,true);
 assert.equal(inside.matchedEntity.stopId,'edge');
 assert.equal(transitGeographicMatch(alert,origin,edgeDistance-Number.EPSILON).geographicStatus,'outside');
 const unknown=transitGeographicMatch({affectedEntities:[{routeId:'1',stopId:null}]},origin,5);
 assert.deepEqual(unknown,{relevant:false,geographicStatus:'unknown',nearestDistanceKm:null,matchedEntity:null});
 const partial=transitGeographicMatch({affectedEntities:[
  {routeId:'1',stopId:'far',coordinates:[43.7,-79.38]}, {routeId:'1',stopId:'missing'}
 ]},origin,0.5);
 assert.equal(partial.geographicStatus,'unknown');
 assert.equal(partial.relevant,false);
 assert.deepEqual(transitGeographicMatch(null,origin,5),{relevant:false,geographicStatus:'unknown',nearestDistanceKm:null,matchedEntity:null});
 assert.equal(transitGeographicMatch({affectedEntities:[null,{stopId:'bad',coordinates:['x','y']}]},origin,5).geographicStatus,'unknown');
});

test('TTC matching uses the same current and saved-location reference and Toronto-wide retains alerts',()=>{
 const coordinates=[43.65,-79.38];
 const alert={affectedEntities:[{routeId:'1',stopId:'100',coordinates}]};
 const live=referenceCoordinates({locationContext:{type:'current'},locations:[]},coordinates);
 const saved=referenceCoordinates({locationContext:{type:'saved',id:'home'},locations:[{id:'home',label:'Home',latitude:coordinates[0],longitude:coordinates[1]}]},null);
 assert.deepEqual(transitGeographicMatch(alert,live,0.5),transitGeographicMatch(alert,saved,0.5));
 assert.equal(transitGeographicMatch(alert,[0,0],null).relevant,true);
 assert.equal(transitGeographicMatch(alert,[0,0],null).geographicStatus,'toronto-wide');
 const unknownCitywide=transitGeographicMatch({affectedEntities:[]},null,null);
 assert.equal(unknownCitywide.relevant,true);
 assert.equal(unknownCitywide.geographicStatus,'unknown');
});

test('inactive TTC alerts remain excluded before geographic matching',()=>{
 const active={periods:[{start:now-1,end:now+1}],affectedEntities:[{stopId:'100',coordinates:[43.65,-79.38]}]};
 const inactive={periods:[{start:now+1,end:null}],affectedEntities:[{stopId:'100',coordinates:[43.65,-79.38]}]};
 const current=currentDisruptions(feed([active,inactive]),'transit',now);
 assert.deepEqual(current,[active]);
 assert.equal(transitGeographicMatch(current[0],[43.65,-79.38],0.5).relevant,true);
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
 await updateDisruptions(previous,new Date(now+1000),assert.fail);assert.equal(calls,0);
 const updated=await updateDisruptions(previous,new Date(now+300000),async kind=>{calls++;if(kind==='roads') throw Error('down');return {items:[]};});
 assert.equal(calls,2);assert.equal(updated.roads.status,'unavailable');assert.equal(updated.roads.fetchedAt,previous.roads.fetchedAt);
 assert.equal(updated.transit.status,'ok');assert.deepEqual(updated.transit.items,[]);
 await assert.rejects(fetchDisruptionSource('roads',async()=>({ok:false,status:503}),now));
 const roads=await fetchDisruptionSource('roads',async()=>({ok:true,text:async()=>JSON.stringify({Closure:[]})}),now);
 assert.deepEqual(roads.items,[]);
 const transit=await fetchDisruptionSource('transit',async()=>({ok:true,text:async()=>proto.split('entity')[0]}),now);
 assert.deepEqual(transit.items,[]);
});

test('transit refresh logs bounded rejection diagnostics and preserves unavailable retention',async()=>{
 const header=proto.split('entity')[0];
 const malformed=header+'entity { id: "77559" alert { effect: NO_SERVICE } } entity { id: "ok" alert { header_text {translation {text:"Valid sibling"}} } }';
 const logs=[];
 const updated=await updateDisruptions({},new Date(now),async(kind)=>kind==='transit'?normalizeTransit(malformed,now):{items:[]},entry=>logs.push(entry));
 assert.equal(updated.transit.status,'ok');
 assert.deepEqual(updated.transit.items.map(item=>item.id),['ok']);
 assert.equal(updated.transit.rejected,1);
 assert.deepEqual(logs,[{source:'ttc-transit',status:'ok',count:1,rejected:1,rejectedReasons:{missing_id:0,missing_title:1,invalid_active_period:0}}]);
 // A healthy feed with no rejections emits no diagnostic log.
 const quiet=[];
 await updateDisruptions({},new Date(now),async(kind)=>kind==='transit'?normalizeTransit(header,now):{items:[]},entry=>quiet.push(entry));
 assert.deepEqual(quiet,[]);
 // The default logger writes a bounded JSON line to stdout when entities are rejected.
 const originalLog=console.log;
 const printed=[];
 console.log=entry=>printed.push(entry);
 try {
  await updateDisruptions({},new Date(now),async(kind)=>kind==='transit'?normalizeTransit(malformed,now):{items:[]});
 } finally { console.log=originalLog; }
 assert.deepEqual(printed,[JSON.stringify({source:'ttc-transit',status:'ok',count:1,rejected:1,rejectedReasons:{missing_id:0,missing_title:1,invalid_active_period:0}})]);
 // A thrown source still marks the source unavailable and retains prior valid items.
 const previous={transit:{items:[{id:'kept'}],sourceUpdatedAt:null,fetchedAt:new Date(now).toISOString(),checkedAt:new Date(now).toISOString(),status:'ok'}};
 const failed=await updateDisruptions(previous,new Date(now+300000),async()=>{throw Error('down');},()=>{});
 assert.equal(failed.transit.status,'unavailable');
 assert.deepEqual(failed.transit.items,[{id:'kept'}]);
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

test('TTC validates headers and rejects malformed feed-level input',()=>{
 const header=proto.split('entity')[0];
 for(const text of ['',header.replace(String(now/1000),String(now/1000+301))]) assert.throws(()=>normalizeTransit(text,now));
 assert.deepEqual(normalizeTransit(header+'entity {id:"gone" is_deleted:true alert {}} entity {id:"no-alert"}',now).items,[]);
 const [item]=normalizeTransit(header+'entity {id:"x" alert {header_text {translation {text:"Titre" language:"fr"} translation {text:"Title" language:"en"}} informed_entity {} active_period {end:123}}}',now).items;
 assert.equal(item.title,'Title');assert.deepEqual(item.routes,[]);assert.deepEqual(item.periods,[{start:null,end:123000}]);
 const mixed={id:'q',alert:{headerText:{translation:[{text:'Quoted "text" \\ path {x}'}]}}};
 assert.equal(normalizeTransit(header+'entity '+JSON.stringify(mixed),now).items[0].title,'Quoted "text" \\ path {x}');
 assert.deepEqual(normalizeTransit(header,now).items,[]);
});

test('TTC skips spec-violating entities with bounded reasons and retains valid siblings',()=>{
 const header=proto.split('entity')[0];
 // GTFS-Realtime marks header_text Required; a missing title is skipped, never synthesized.
 const missingTitle=normalizeTransit(header+'entity { id: "77559" alert { effect: NO_SERVICE informed_entity {route_id:"2"} } }',now);
 assert.deepEqual(missingTitle.items,[]);
 assert.equal(missingTitle.rejected,1);
 assert.deepEqual(missingTitle.rejectedReasons,{missing_id:0,missing_title:1,invalid_active_period:0});
 // A missing entity id is skipped with its own reason.
 const missingId=normalizeTransit(header+'entity { alert { header_text {translation {text:"Title"}}} }',now);
 assert.deepEqual(missingId.items,[]);
 assert.equal(missingId.rejected,1);
 assert.equal(missingId.rejectedReasons.missing_id,1);
 // An invalid active period is skipped with its own reason.
 const badPeriod=normalizeTransit(header+'entity {id:"x" alert {header_text {translation {text:"Title"}} active_period {start:"bad"}}}',now);
 assert.deepEqual(badPeriod.items,[]);
 assert.equal(badPeriod.rejectedReasons.invalid_active_period,1);
 // Valid siblings survive alongside a malformed entity, and ordering is preserved.
 const mixed=normalizeTransit(header+'entity { id: "77559" alert { effect: NO_SERVICE } } entity { id: "ok" alert { header_text {translation {text:"Valid sibling"}} } }',now);
 assert.deepEqual(mixed.items.map(item=>item.id),['ok']);
 assert.equal(mixed.rejected,1);
 // All entities malformed yields a healthy-empty result, not a thrown error.
 const allBad=normalizeTransit(header+'entity { id: "a" alert {} } entity { id: "b" alert {} }',now);
 assert.deepEqual(allBad.items,[]);
 assert.equal(allBad.rejected,2);
 assert.equal(allBad.rejectedReasons.missing_title,2);
 // A healthy-empty feed reports zero rejections.
 const healthy=normalizeTransit(header,now);
 assert.deepEqual(healthy.items,[]);
 assert.equal(healthy.rejected,0);
 assert.deepEqual(healthy.rejectedReasons,{missing_id:0,missing_title:0,invalid_active_period:0});
});

test('roads skip malformed identities and dates with bounded reasons and discard invalid geometry',()=>{
 // A malformed record is skipped, never synthesized, and never discards valid siblings.
 const skipped=normalizeRoads({Closure:[{name:'x'},{id:'x'},{...road,startTime:'bad'},{...road,endTime:'bad'}]});
 assert.deepEqual(skipped.items,[]);
 assert.equal(skipped.rejected,4);
 assert.deepEqual(skipped.rejectedReasons,{missing_id:1,missing_name:1,invalid_dates:2});
 // A feed-level failure (not an array) still throws rather than reporting healthy-empty.
 assert.throws(()=>normalizeRoads({error:'bad'}));
 const [item]=normalizeRoads({Closure:[{id:'x',road:'Fallback name',geoPolyline:'[200,100]',expired:1}]}).items;
 assert.equal(item.title,'Fallback name');assert.deepEqual(item.line,[]);assert.equal(item.coordinates,null);assert.equal(item.start,null);assert.equal(item.expired,true);
 assert.deepEqual(normalizeRoads({Closure:[{...road,geoPolyline:''}]}).items[0].line,[]);
});

test('roads isolate malformed records, retain valid siblings in order, and report bounded reasons',()=>{
 const rows=[{...road,id:'a'},{name:'no id'},{id:'b'},{...road,id:'c',startTime:'bad'},{...road,id:'d',endTime:'bad'},{...road,id:'e'}];
 const result=normalizeRoads({Closure:rows});
 // Valid siblings survive in deterministic source order; malformed records are skipped.
 assert.deepEqual(result.items.map(item=>item.id),['a','e']);
 assert.equal(result.rejected,4);
 assert.deepEqual(result.rejectedReasons,{missing_id:1,missing_name:1,invalid_dates:2});
 // A healthy feed reports zero rejections and no reason keys are fabricated.
 const healthy=normalizeRoads({Closure:[road]});
 assert.equal(healthy.rejected,0);
 assert.deepEqual(healthy.rejectedReasons,{missing_id:0,missing_name:0,invalid_dates:0});
 // A healthy-empty feed is distinct from a feed-level failure.
 const empty=normalizeRoads({Closure:[]});
 assert.deepEqual(empty.items,[]);
 assert.equal(empty.rejected,0);
 // All-malformed input yields a healthy-empty result, not a thrown error.
 const allBad=normalizeRoads({Closure:[{name:'x'},{id:'y'}]});
 assert.deepEqual(allBad.items,[]);
 assert.equal(allBad.rejected,2);
 // A non-array envelope is a feed-level failure and still throws.
 assert.throws(()=>normalizeRoads({error:'bad'}));
 assert.throws(()=>normalizeRoads(null));
 // A non-object row (null or a primitive) is skipped with the missing-id reason
 // and never discards a valid sibling.
 const nonObjects=normalizeRoads({Closure:[null,'row',42,{...road,id:'kept'}]});
 assert.deepEqual(nonObjects.items.map(item=>item.id),['kept']);
 assert.equal(nonObjects.rejected,3);
 assert.deepEqual(nonObjects.rejectedReasons,{missing_id:3,missing_name:0,invalid_dates:0});
});

test('roads refresh logs bounded rejection diagnostics and preserves unavailable retention',async()=>{
 const logs=[];
 const updated=await updateDisruptions({},new Date(now),async(kind)=>kind==='roads'?normalizeRoads({Closure:[road,{name:'no id'}]}):{items:[]},entry=>logs.push(entry));
 assert.equal(updated.roads.status,'ok');
 assert.deepEqual(updated.roads.items.map(item=>item.id),['r']);
 assert.equal(updated.roads.rejected,1);
 assert.deepEqual(logs,[{source:'toronto-roads',status:'ok',count:1,rejected:1,rejectedReasons:{missing_id:1,missing_name:0,invalid_dates:0}}]);
 // A healthy feed with no rejections emits no diagnostic log.
 const quiet=[];
 await updateDisruptions({},new Date(now),async(kind)=>kind==='roads'?normalizeRoads({Closure:[road]}):{items:[]},entry=>quiet.push(entry));
 assert.deepEqual(quiet,[]);
 // A thrown source still marks the source unavailable and retains prior valid items.
 const previous={roads:{items:[{id:'kept'}],sourceUpdatedAt:null,fetchedAt:new Date(now).toISOString(),checkedAt:new Date(now).toISOString(),status:'ok'}};
 const failed=await updateDisruptions(previous,new Date(now+300000),async()=>{throw Error('down');},()=>{});
 assert.equal(failed.roads.status,'unavailable');
 assert.deepEqual(failed.roads.items,[{id:'kept'}]);
});

test('failed initial disruption refresh publishes unavailable empty sources and future cache is retried',async()=>{
 const result=await updateDisruptions(undefined,new Date(now),async()=>{throw Error('offline');});
 for(const source of Object.values(result)) {assert.equal(source.status,'unavailable');assert.deepEqual(source.items,[]);assert.equal(source.fetchedAt,null);}
 let calls=0;
 await updateDisruptions({roads:{checkedAt:new Date(now+1).toISOString()}},new Date(now),async()=>{calls++;return {items:[]};});
 assert.equal(calls,2);
});

test('disruption presentation distinguishes empty, unavailable, stale and filtered cached data',()=>{
 const fresh={fetchedAt:new Date(now).toISOString(),status:'ok'};
 assert.deepEqual(disruptionPresentation('roads',fresh,[],[],false,now),{
  count:'0',empty:'No road restrictions currently reported.',freshness:'Last successfully updated just now.',status:'ok',repaired:0
 });
 const unavailable={fetchedAt:new Date(now-18*60000).toISOString(),status:'unavailable'};
 const failed=disruptionPresentation('roads',unavailable,[],[],false,now);
 assert.equal(failed.count,'Unavailable');
 assert.equal(failed.empty,'Road restriction data is temporarily unavailable. Last successfully updated 18 min ago.');
 assert.match(failed.freshness,/temporarily unavailable/);
 const stale=disruptionPresentation('transit',{fetchedAt:new Date(now-20*60000).toISOString(),status:'ok'},[],[],false,now);
 assert.equal(stale.count,'Stale');
 assert.equal(stale.empty,'No TTC service alerts currently reported.');
 assert.equal(stale.freshness,'Last successfully updated 20 min ago. Data may be stale.');
 assert.equal(disruptionPresentation('roads',{fetchedAt:new Date(now-2*3600000).toISOString(),status:'ok'},[],[],false,now).empty,'Road restriction data is too old to show.');
 assert.equal(disruptionPresentation('roads',unavailable,[],[{id:'road'}],true,now).empty,'No mapped road restrictions within this radius.');
 assert.equal(nearbyTransitPresentation(fresh,[],now).empty,'No TTC disruptions found in this area.');
 assert.equal(nearbyTransitPresentation(fresh,[],now).count,'0');
 assert.match(nearbyTransitPresentation(unavailable,[],now).empty,/temporarily unavailable/);
 assert.equal(nearbyTransitPresentation(unavailable,[],now).count,'Unavailable');
 assert.equal(nearbyTransitPresentation({fetchedAt:new Date(now-20*60000).toISOString(),status:'ok'},[],now).freshness,'Last successfully updated 20 min ago. Data may be stale.');
 assert.equal(nearbyTransitPresentation(null,[],now).empty,'TTC alert data could not be checked yet.');
 assert.equal(nearbyTransitPresentation({fetchedAt:new Date(now-2*3600000).toISOString(),status:'ok'},[],now).empty,'TTC alert data is too old to show.');
 assert.equal(nearbyTransitPresentation({fetchedAt:new Date(now-20*60000).toISOString(),status:'stale'},[],now).count,'Stale');
 assert.equal(nearbyTransitPresentation(unavailable,[{id:'cached'}],now).count,'1');
 assert.equal(nearbyTransitPresentation({fetchedAt:new Date().toISOString(),status:'ok'},[]).status,'ok');
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

test('disruption renderer updates lists and optional map layers',()=>{
 const originalDocument=globalThis.document;
 const originalLeaflet=globalThis.L;
 const nodes=new Map();
 const layerGroups=[];
 class FakeElement {
  constructor(tag='div') {this.tag=tag;this.children=[];this.checked=false;this.textContent='';this.className='';}
  append(...children) {this.children.push(...children);}
  replaceChildren(...children) {this.children=children;}
 }
 const node=id=>{const value=new FakeElement();nodes.set(id,value);return value;};
 const document={
  createElement:tag=>new FakeElement(tag),
  querySelector:selector=>nodes.get(selector) || null
 };
 globalThis.document=document;
 globalThis.L={
  layerGroup:()=>{const group={items:[],removed:false,addTo(map){this.map=map;return this;},remove(){this.removed=true;}};layerGroups.push(group);return group;},
  polyline:(coordinates,options)=>layer('line',coordinates,options),
  marker:(coordinates,options)=>layer('point',coordinates,options),
  divIcon:options=>options,
 };
 function layer(kind,coordinates,options) {
  return {kind,coordinates,options,addTo(group){group.items.push(this);return this;}};
 }
 try {
  renderDisruptions({},null,null,null);
  for(const selector of ['#disruptions','#roadOverlay','#roadScope','#roadsFreshness','#transitFreshness','#roadCount','#transitCount','#roadsList','#transitList']) node(selector);
  renderDisruptions({},null,null,null);
  for(const selector of ['#nearbyTransit','#nearbyTransitScope','#nearbyTransitCount','#nearbyTransitFreshness','#nearbyTransitList']) node(selector);
  const timestamp=Date.now();
  const roadBase={expired:false,start:null,impact:'High',title:'Road work',type:'Closure',description:'Use another street',schedule:'Monday',end:timestamp+60000};
  const roads=[
   {...roadBase,id:'line',line:[[43.7,-79.4],[43.701,-79.4]],coordinates:[43.7,-79.4]},
   {...roadBase,id:'point',line:[],coordinates:[43.702,-79.4],description:'',schedule:'',end:null},
   {...roadBase,id:'missing',line:[],coordinates:null,description:'',schedule:'',end:null}
  ];
  const transit=[
   {id:'near',title:'Line 1 service affected',effect:'Delay',routes:['1'],description:'Allow extra time',periods:[],affectedEntities:[
    {stopId:'farther-near',name:'College Station',coordinates:[43.705,-79.4]},
    {stopId:'near',name:'Wellesley Station',coordinates:[43.701,-79.4]}
   ]},
   {id:'unnamed',title:'Affected stop without a published name',effect:'',routes:[],description:'',periods:[],affectedEntities:[{stopId:'unnamed',coordinates:[43.706,-79.4]}]},
   {id:'same-title',title:'Named Stop',effect:'Information',routes:[],description:'',periods:[],affectedEntities:[{stopId:'same-title',name:'Named Stop',coordinates:[43.707,-79.4]}]},
   {id:'stop-only',title:'',effect:'Information',routes:[],description:'',periods:[],affectedEntities:[{stopId:'stop-only',name:'Stop-only label',coordinates:[43.708,-79.4]}]},
   {id:'far',title:'Distant delay',effect:'Delay',routes:['2'],description:'',periods:[],affectedEntities:[{stopId:'far',name:'Far Station',coordinates:[43.8,-79.4]}]},
   {id:'unknown',title:'Citywide notice',effect:'Information',routes:[],description:'',periods:[],affectedEntities:[]}
  ];
  const data={
   roads:{items:roads,fetchedAt:new Date(timestamp).toISOString(),status:'ok'},
   transit:{items:transit,fetchedAt:new Date(timestamp).toISOString(),status:'ok'}
  };
  renderDisruptions(data,[43.7,-79.4],10,null);
  assert.equal(nodes.get('#roadScope').textContent,'Road restrictions within 10 km');
  assert.equal(nodes.get('#roadsList').children.length,2);
  assert.equal(nodes.get('#transitList').children.length,2);
  assert.equal(nodes.get('#nearbyTransitList').children.length,4);
  assert.equal(nodes.get('#nearbyTransitList').children[0].children[1].textContent,'Wellesley Station');
  assert.match(nodes.get('#nearbyTransitList').children[0].children[2].textContent,/0\.1 km away/);
  assert.equal(nodes.get('#nearbyTransitCount').textContent,'4');
  assert.equal(nodes.get('#nearbyTransitFreshness').textContent,'Last successfully updated just now.');
  data.ttcAlerts={status:'ok',fetchedAt:new Date(timestamp).toISOString(),items:[{id:'near',activePeriods:[]}]};
  renderDisruptions(data,[43.7,-79.4],10,null);
  assert.equal(nodes.get('#nearbyTransitList').children.length,3);
  delete data.ttcAlerts;
  renderDisruptions(data,[43.7,-79.4],0.05,null);
  assert.equal(nodes.get('#nearbyTransitList').children[0].textContent,'No TTC disruptions found in this area.');
  renderDisruptions(data,[43.8,-79.4],0.5,null);
  assert.equal(nodes.get('#nearbyTransitList').children[0].children[1].textContent,'Far Station');
  renderDisruptions(data,null,null,null);
  assert.equal(nodes.get('#nearbyTransit').hidden,true);
  assert.equal(nodes.get('#transitList').children.length,6);
  renderDisruptions(data,[43.7,-79.4],10,null);
  renderDisruptions(data,[43.7,-79.4],10,null);

  nodes.get('#roadOverlay').checked=true;
  const map={id:'map',panes:{},getZoom:()=>12,project:point=>({x:point[1]*100,y:point[0]*100}),on(){},off(){},getPane(name){return this.panes[name];},createPane(name){return this.panes[name]={style:{}};}};
  renderDisruptions(data,null,10,map);
  assert.deepEqual(layerGroups[0].items.map(item=>item.kind),['line','point','point']);
  assert.equal(layerGroups[0].map,map);
  nodes.get('#roadOverlay').checked=false;
  renderDisruptions(data,null,null,map);
  assert.equal(layerGroups[0].removed,true);

  renderDisruptions(undefined,null,2,null);
  assert.equal(nodes.get('#roadScope').textContent,'Road restrictions · citywide');
  assert.equal(nodes.get('#roadsList').children[0].tag,'p');
  assert.equal(nodes.get('#transitList').children[0].tag,'p');
 } finally {
  globalThis.document=originalDocument;
  globalThis.L=originalLeaflet;
 }
});

test('illegal JSON escapes are repaired only where needed and source text is preserved verbatim',()=>{
 // A raw backslash-space is not a legal JSON escape; the frozen live case.
 const frozen='{"Closure":[{"id":"r","name":"Road A","description":"Toronto-TMC: Water \\ Sewer"}]}';
 assert.throws(()=>JSON.parse(frozen));
 const repaired=repairIllegalJsonEscapes(frozen);
 assert.equal(repaired.repaired,1);
 const parsed=JSON.parse(repaired.text);
 assert.equal(parsed.Closure[0].description,'Toronto-TMC: Water \\ Sewer');
 // Valid escapes and every other byte are untouched.
 const valid='{"a":"line\\nbreak","b":"quote\\"x","c":"slash\\/y","d":"tab\\t","e":"uni\\u00e9","f":"back\\\\slash"}';
 const untouched=repairIllegalJsonEscapes(valid);
 assert.equal(untouched.repaired,0);
 assert.equal(untouched.text,valid);
 assert.deepEqual(JSON.parse(untouched.text),JSON.parse(valid));
 // A malformed \u (not four hex digits) is repaired; a valid one is not.
 assert.equal(repairIllegalJsonEscapes('{"a":"\\uZZZZ"}').repaired,1);
 assert.equal(repairIllegalJsonEscapes('{"a":"\\u00e9"}').repaired,0);
 // Bounded count: multiple illegal escapes are each counted, never raw text.
 assert.equal(repairIllegalJsonEscapes('{"a":"x \\ y \\ z"}').repaired,2);
 assert.equal(repairIllegalJsonEscapes('').repaired,0);
 assert.equal(repairIllegalJsonEscapes(null).repaired,0);
});

test('a malformed record among valid siblings loads with a bounded repair count',async()=>{
 const body='{"Closure":[{"id":"ok","name":"Road A","latitude":"43.7","longitude":"-79.4"},{"id":"bad","name":"Road B","description":"Water \\ Sewer","latitude":"43.8","longitude":"-79.5"}]}';
 const result=await fetchDisruptionSource('roads',async()=>({ok:true,text:async()=>body}),now);
 assert.equal(result.repaired,1);
 assert.deepEqual(result.items.map(item=>item.id),['ok','bad']);
 assert.equal(result.items[1].description,'Water \\ Sewer');
});

test('a zero-repair payload reports no repair signal',async()=>{
 const body=JSON.stringify({Closure:[{id:'ok',name:'Road A',latitude:'43.7',longitude:'-79.4'}]});
 const result=await fetchDisruptionSource('roads',async()=>({ok:true,text:async()=>body}),now);
 assert.equal(result.repaired,0);
 assert.deepEqual(result.items.map(item=>item.id),['ok']);
});

test('a fully unparseable feed stays unavailable and retains the previous snapshot',async()=>{
 const previous={roads:{items:[{id:'kept'}],sourceUpdatedAt:null,fetchedAt:new Date(now).toISOString(),checkedAt:new Date(now).toISOString(),status:'ok'}};
 const logs=[];
 const updated=await updateDisruptions(previous,new Date(now+300000),async(kind)=>kind==='roads'
   ? fetchDisruptionSource('roads',async()=>({ok:true,text:async()=>'{"Closure":[{"id":"x","name":"y"}'}),now)
   : {items:[]},entry=>logs.push(entry));
 assert.equal(updated.roads.status,'unavailable');
 assert.deepEqual(updated.roads.items,[{id:'kept'}]);
 assert.deepEqual(logs,[]);
});

test('a repaired roads refresh logs a bounded repair diagnostic',async()=>{
 const logs=[];
 const body='{"Closure":[{"id":"ok","name":"Road A","description":"Water \\ Sewer","latitude":"43.7","longitude":"-79.4"}]}';
 const updated=await updateDisruptions({},new Date(now),async(kind)=>kind==='roads'
   ? fetchDisruptionSource('roads',async()=>({ok:true,text:async()=>body}),now)
   : {items:[]},entry=>logs.push(entry));
 assert.equal(updated.roads.status,'ok');
 assert.equal(updated.roads.repaired,1);
 assert.deepEqual(logs,[{source:'toronto-roads',status:'ok',count:1,repaired:1}]);
});

test('the disruptions freshness line and map-layer status disclose a SirenTO repair',()=>{
 const repairedFeed={items:[road],fetchedAt:new Date(now).toISOString(),status:'ok',repaired:2};
 const presentation=disruptionPresentation('roads',repairedFeed,[road],[road],false,now);
 assert.match(presentation.freshness,/source JSON was malformed; SirenTO repaired the encoding \(2 records\)\./);
 assert.equal(presentation.repaired,2);
 const single=disruptionPresentation('roads',{...repairedFeed,repaired:1},[road],[road],false,now);
 assert.match(single.freshness,/\(1 record\)\./);
 const clean=disruptionPresentation('roads',{items:[road],fetchedAt:new Date(now).toISOString(),status:'ok'},[road],[road],false,now);
 assert.doesNotMatch(clean.freshness,/repaired/);
 assert.equal(clean.repaired,0);
});
