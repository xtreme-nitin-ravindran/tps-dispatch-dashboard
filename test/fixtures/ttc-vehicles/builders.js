import { readFileSync } from 'node:fs';
import bindings from 'gtfs-realtime-bindings';
import { buildStaticIndex } from '../../../src/ttc/static-gtfs.js';
export const epoch = Date.parse('2026-09-28T16:00:00.000Z');
export const at = seconds => new Date(epoch+seconds*1000);
export function staticIndex() {
  return buildStaticIndex(name=>{
    // Extend the straight fixture shape to exercise movement outside terminal buffers.
    if (name==='shapes.txt') return 'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\ns1,43.65,-79.41,1\ns1,43.65,-79.38,2\ns2,43.652,-79.41,1\ns2,43.652,-79.38,2\n';
    return readFileSync(new URL(`../ttc-static/${name}`,import.meta.url));
  });
}
export function vehicle(seconds=0,overrides={}) {
  return {vehicle:{id:'001'},trip:{tripId:'t1',routeId:'0504',directionId:0,startDate:'20260928',startTime:'12:00:00'},position:{latitude:43.6512,longitude:-79.4+seconds/30000},timestamp:Math.floor(+at(seconds)/1000),...overrides};
}
export function protobuf(vehicles,seconds=0) {
  return bindings.transit_realtime.FeedMessage.encode({header:{gtfsRealtimeVersion:'2.0',timestamp:Math.floor(+at(seconds)/1000)},entity:vehicles.map((v,i)=>({id:String(i),vehicle:v}))}).finish();
}
