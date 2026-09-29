import { readFile, writeFile, mkdir, rename, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { loadStaticGtfs } from '../src/ttc/static-source.js';
import { buildStaticIndex } from '../src/ttc/static-gtfs.js';
import { updateTtcAlerts } from '../src/ttc/alerts.js';
import { correlateState } from '../src/ttc/correlation.js';
import { refreshVehicles, deviationOutput, validateVehicleState, VEHICLE_POLICY } from '../src/ttc/vehicle-detector.js';
import { inferDiversions, validateDiversionState, diversionOutput, diversionGeoJson, DIVERSION_POLICY } from '../src/ttc/diversion-inference.js';
import { parseTtcVehicles } from '../src/ttc/vehicle-feed.js';

async function atomicJson(path,value) {
  await mkdir(dirname(path),{recursive:true});
  await writeFile(`${path}.tmp`,`${JSON.stringify(value)}\n`);
  await rename(`${path}.tmp`,path);
}
export async function runVehiclePolling({polls=1,intervalMs=30000,statePath='.cache/ttc/vehicle-state.json',outputPath='.cache/ttc/deviations.json',
  inferenceStatePath=resolve(dirname(statePath),'diversion-state.json'),inferenceOutputPath=resolve(dirname(outputPath),'diversions.json'),geoJsonPath,inferOnly=false,freshState=false,
  loadStatic=loadStaticGtfs,refresh=refreshVehicles,updateAlerts=updateTtcAlerts,clock=()=>new Date(),wait=sleep,log=entry=>console.log(JSON.stringify(entry)),fixture}={}) {
  if (!Number.isInteger(polls)||polls<1||polls>20||!Number.isInteger(intervalMs)||intervalMs<15000||intervalMs>60000) throw new Error('Use 1–20 polls and 15000–60000 ms intervals');
  let previous;
  try {
    if ((await stat(statePath)).size>VEHICLE_POLICY.maxArtifactBytes) throw new Error('Vehicle cache too large');
    previous=JSON.parse(await readFile(statePath,'utf8')); validateVehicleState(previous);
  } catch (error) { if (error.code!=='ENOENT') log({source:'ttc-vehicles',status:'cache-rejected',error:error.message}); previous=undefined; }
  let inference;
  try {
    if ((await stat(inferenceStatePath)).size>DIVERSION_POLICY.maxArtifactBytes) throw new Error('Diversion cache too large');
    inference=JSON.parse(await readFile(inferenceStatePath,'utf8'));validateDiversionState(inference);
  } catch (error) { if (error.code!=='ENOENT') log({source:'ttc-diversions',status:'cache-rejected',error:error.message});inference=undefined; }
  if (freshState) { previous=undefined;inference=undefined; }
  let loaded;
  try { loaded=await loadStatic({now:clock(),log}); }
  catch (error) {
    // No trustworthy index: erase evidence, and replace yesterday's output visibly.
    const state={schemaVersion:1,staticVersion:previous?.staticVersion||'unavailable',status:'unavailable',reason:'static-unavailable',checkedAt:clock().toISOString(),fetchedAt:null,sourceUpdatedAt:null,tracks:[]};
    await atomicJson(statePath,state); await atomicJson(outputPath,deviationOutput(state));
    const empty={schemaVersion:1,staticVersion:state.staticVersion,status:'unavailable',checkedAt:state.checkedAt,episodes:[],records:[]};
    await atomicJson(inferenceStatePath,empty);await atomicJson(inferenceOutputPath,diversionOutput(empty));
    if (geoJsonPath) await atomicJson(geoJsonPath,{type:'FeatureCollection',features:[]});
    log({source:'ttc-vehicles',status:'unavailable',reason:'static-unavailable',error:error.message}); return state;
  }
  log({source:'ttc-vehicle-static',...loaded.metrics,staticVersion:loaded.index.version,status:loaded.metadata?.status});
  if (inferOnly) {
    if (!previous) throw new Error('A valid Story 30D vehicle-state file is required for --infer-only');
    const now=clock();
    // No alert refresh in offline diagnostics: unavailable context cannot boost confidence.
    const current={...previous,checkedAt:now.toISOString(),status:Date.parse(previous.checkedAt)+120000>=+now?previous.status:'unavailable'};
    const result=inferDiversions(inference,current,loaded.index,now);
    await atomicJson(inferenceStatePath,result.state);await atomicJson(inferenceOutputPath,result.output);
    if (geoJsonPath) await atomicJson(geoJsonPath,diversionGeoJson(result.state,loaded.index));
    log({source:'ttc-diversions',status:result.state.status,...result.report});return previous;
  }
  const geometryCache=new Map();
  let alerts;
  for (let i=0;i<polls;i++) {
    if (i) await wait(intervalMs);
    const now=fixture?new Date(fixture[i].now):clock();
    // Alert failures affect only supporting context, never vehicle detection.
    alerts=fixture?fixture[i].alerts:await updateAlerts(alerts,now,undefined,log);
    if (alerts) alerts=correlateState(alerts,loaded.index,now);
    const fetchSource=fixture?async()=>parseTtcVehicles(Buffer.from(fixture[i].protobufBase64,'base64'),now):undefined;
    const result=await refresh(previous,loaded.index,now,alerts,{geometryCache,fetchSource,log});
    previous=result.state;
    const inferred=inferDiversions(inference,previous,loaded.index,now,alerts);
    inference=inferred.state;
    await atomicJson(inferenceStatePath,inference);await atomicJson(inferenceOutputPath,inferred.output);
    if (geoJsonPath) await atomicJson(geoJsonPath,diversionGeoJson(inference,loaded.index));
    log({source:'ttc-diversions',status:inference.status,...inferred.report,artifactBytes:Buffer.byteLength(JSON.stringify(inferred.output))});
    await atomicJson(statePath,previous); await atomicJson(outputPath,deviationOutput(previous));
  }
  return previous;
}
if (process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const option=(name,fallback)=>{const at=process.argv.indexOf(name);return at<0?fallback:process.argv[at+1];};
  const fixturePath=option('--fixture',null), staticPath=option('--static-fixture',null);
  const fixture=fixturePath?JSON.parse(await readFile(fixturePath,'utf8')):undefined;
  let loadStatic;
  if (staticPath) {
    const tables=new Map();
    for (const name of ['routes','stops','trips','stop_times','shapes','calendar','calendar_dates']) {
      try { tables.set(`${name}.txt`,await readFile(`${staticPath}/${name}.txt`)); }
      catch (error) { if (error.code!=='ENOENT') throw error; }
    }
    loadStatic=async()=>({index:buildStaticIndex(name=>tables.get(name))});
  }
  await runVehiclePolling({polls:fixture?.length??Number(option('--polls','1')),intervalMs:Number(option('--interval-ms','30000')),
    inferOnly:process.argv.includes('--infer-only'),inferenceStatePath:process.env.TTC_DIVERSION_STATE,inferenceOutputPath:process.env.TTC_DIVERSION_OUTPUT,geoJsonPath:option('--geojson',undefined),
    statePath:process.env.TTC_VEHICLE_STATE,outputPath:process.env.TTC_VEHICLE_OUTPUT,loadStatic,fixture,wait:fixture?async()=>{}:undefined});
}
