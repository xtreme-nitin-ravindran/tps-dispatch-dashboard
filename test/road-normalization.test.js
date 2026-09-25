import test from 'node:test';
import assert from 'node:assert/strict';
import {ROAD_FEED,ROAD_LINK,normalizeRoads,updateDisruptions} from '../src/disruptions/source.js';
import {currentDisruptions,roadDistance} from '../src/disruptions/view.js';

const now=Date.UTC(2026,8,25);
const base={id:'road-25',road:'King St W',name:'King St W from Bay St to Yonge St',type:'ROAD_CLOSED',fromRoad:'Bay St',toRoad:'Yonge St',createdTime:String(now-60000),startTime:String(now-30000),endTime:String(now+3600000),latitude:'43.6519',longitude:'-79.3817',currImpact:'High',expired:0,URL:ROAD_LINK};

test('valid authoritative line geometry and closure metadata are normalized',()=>{
 const [item]=normalizeRoads({Closure:[{...base,geoPolyline:'[-79.3817,43.6519],[-79.3792,43.6524]',status:'Active'}]}).items;
 assert.deepEqual(item.geometry,{type:'LineString',coordinates:[[-79.3817,43.6519],[-79.3792,43.6524]]});
 assert.equal(item.geometryKind,'line');
 assert.deepEqual(item.line,[[43.6519,-79.3817],[43.6524,-79.3792]]);
 assert.equal(item.id,'road-25');assert.equal(item.street,'King St W');assert.equal(item.restrictionType,'ROAD CLOSED');
 assert.equal(item.startLocation,'Bay St');assert.equal(item.endLocation,'Yonge St');
 assert.equal(item.start,now-30000);assert.equal(item.reportedAt,now-60000);assert.equal(item.end,now+3600000);assert.equal(item.status,'Active');
});

test('point-only closure remains a point and does not invent a line',()=>{
 const [item]=normalizeRoads({Closure:[{...base,geoPolyline:''}]}).items;
 assert.equal(item.geometryKind,'point');assert.deepEqual(item.geometry,{type:'Point',coordinates:[-79.3817,43.6519]});
 assert.deepEqual(item.coordinates,[43.6519,-79.3817]);assert.deepEqual(item.line,[]);
});

test('missing geometry remains absent',()=>{
 const [item]=normalizeRoads({Closure:[{...base,latitude:null,longitude:null,geoPolyline:''}]}).items;
 assert.equal(item.geometryKind,'none');assert.equal(item.geometry,null);assert.equal(item.coordinates,null);assert.deepEqual(item.line,[]);
});

test('missing expected end time remains unknown',()=>{
 assert.equal(normalizeRoads({Closure:[{...base,endTime:null}]}).items[0].end,null);
});

test('invalid line geometry is ignored safely while a valid source point survives',()=>{
 const [item]=normalizeRoads({Closure:[{...base,geoPolyline:'[-79.38,43.65],[999,43.66]'}]}).items;
 assert.equal(item.geometryKind,'point');assert.deepEqual(item.line,[]);assert.equal(item.geometry.type,'Point');
});

test('source attribution and URLs are preserved',()=>{
 const [item]=normalizeRoads({Closure:[base]}).items;
 assert.deepEqual(item.source,{name:'City of Toronto Road Restrictions',url:ROAD_LINK,feedUrl:ROAD_FEED});assert.equal(item.url,ROAD_LINK);
});

test('feed unavailable remains distinguishable from a successful empty feed',async()=>{
 const empty=await updateDisruptions({},new Date(now),async()=>({items:[]}));
 const unavailable=await updateDisruptions({},new Date(now),async()=>{throw Error('offline');});
 assert.equal(empty.roads.status,'ok');assert.deepEqual(empty.roads.items,[]);assert.ok(empty.roads.fetchedAt);
 assert.equal(unavailable.roads.status,'unavailable');assert.deepEqual(unavailable.roads.items,[]);assert.equal(unavailable.roads.fetchedAt,null);
});

test('existing road filtering and distance behavior accepts normalized records',()=>{
 const [item]=normalizeRoads({Closure:[{...base,geoPolyline:'[-79.3817,43.6519],[-79.3792,43.6524]'}]}).items;
 const feed={items:[item],fetchedAt:new Date(now).toISOString(),status:'ok'};
 assert.deepEqual(currentDisruptions(feed,'roads',now),[item]);assert.ok(Number.isFinite(roadDistance(item,[43.652,-79.38])));
});
