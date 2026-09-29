// Same deterministic two-vehicle trajectory as Story 30E's run.js.
import bindings from 'gtfs-realtime-bindings';
import { at, vehicle, protobuf, staticIndex } from '../ttc-vehicles/builders.js';
import { parseTtcAlerts, updateTtcAlerts } from '../../../src/ttc/alerts.js';
import { correlateState } from '../../../src/ttc/correlation.js';
import { parseTtcVehicles } from '../../../src/ttc/vehicle-feed.js';
import { detectVehicles } from '../../../src/ttc/vehicle-detector.js';
import { inferDiversions } from '../../../src/ttc/diversion-inference.js';
import { publicTtcGeometry } from '../../../scripts/publish-ttc-geometry.js';
export async function frontendFixture() {
  const index=staticIndex();
  const bytes=bindings.transit_realtime.FeedMessage.encode({header:{gtfsRealtimeVersion:'2.0',timestamp:+at(0)/1000},entity:[{id:'fixture-detour',alert:{effect:4,cause:bindings.transit_realtime.Alert.Cause.CONSTRUCTION,
    headerText:{translation:[{text:'TEST — King construction detour',language:'en'}]},
    descriptionText:{translation:[{text:'Deterministic local fixture; not a real service advisory.',language:'en'}]},
    informedEntity:[{routeId:'0504',trip:{tripId:'t1'},stopId:'A'},{routeId:'0504',trip:{tripId:'t1'},stopId:'D'}]}}]}).finish();
  const alerts=correlateState(await updateTtcAlerts(undefined,at(0),async()=>parseTtcAlerts(bytes,at(0)),()=>{}),index,at(0));
  const path=[[43.65,-79.404],[43.652,-79.403],[43.652,-79.402],[43.652,-79.400],[43.65,-79.398],[43.65,-79.397],[43.65,-79.396]];
  let vehicles,inferred;
  for(const [i,[latitude,longitude]] of path.entries()) {
    const feed=parseTtcVehicles(protobuf([0,1].map(j=>vehicle(i*30,{vehicle:{id:`fixture-${j}`},position:{latitude,longitude}})),i*30),at(i*30));
    vehicles=detectVehicles(vehicles,feed,index,at(i*30),alerts).state;
    inferred=inferDiversions(inferred?.state,vehicles,index,at(i*30),alerts);
  }
  return {ttcAlerts:alerts,ttcDiversions:publicTtcGeometry(inferred.output),now:+at(180)};
}
