// Developer-only end-to-end example; no production UI dependencies.
import bindings from 'gtfs-realtime-bindings';
import { at, vehicle, protobuf, staticIndex } from '../ttc-vehicles/builders.js';
import { parseTtcAlerts, updateTtcAlerts } from '../../../src/ttc/alerts.js';
import { runVehiclePolling } from '../../../scripts/ttc-vehicles.js';
const index=staticIndex();
const bytes=bindings.transit_realtime.FeedMessage.encode({header:{gtfsRealtimeVersion:'2.0',timestamp:+at(0)/1000},entity:[{id:'fixture-detour',alert:{effect:4,informedEntity:[{routeId:'0504',trip:{tripId:'t1'},stopId:'A'},{routeId:'0504',trip:{tripId:'t1'},stopId:'D'}]}}]}).finish();
const alerts=await updateTtcAlerts(undefined,at(0),async()=>parseTtcAlerts(bytes,at(0)),()=>{});
const path=[[43.65,-79.404],[43.652,-79.403],[43.652,-79.402],[43.652,-79.400],[43.65,-79.398],[43.65,-79.397],[43.65,-79.396]];
const fixture=path.map(([latitude,longitude],i)=>({now:at(i*30).toISOString(),alerts,
  protobufBase64:Buffer.from(protobuf([0,1].map(j=>vehicle(i*30,{vehicle:{id:`fixture-${j}`},position:{latitude,longitude}})),i*30)).toString('base64')}));
const directory=process.env.TTC_DIVERSION_FIXTURE_DIR||'.cache/ttc/diversion-fixture';
await runVehiclePolling({freshState:true,polls:fixture.length,fixture,loadStatic:async()=>({index}),clock:()=>at(0),wait:async()=>{},
  statePath:`${directory}/vehicle-state.json`,outputPath:`${directory}/deviations.json`,geoJsonPath:`${directory}/diversions.geojson`});
