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
import { loadOfficialAdvisories, officialAdvisories } from '../src/ttc/official-advisories.js';

async function atomicJson(path,value) {
  await mkdir(dirname(path),{recursive:true});
  await writeFile(`${path}.tmp`,`${JSON.stringify(value)}\n`);
  await rename(`${path}.tmp`,path);
}
// One-line end-of-run verdict so Concourse task output alone shows whether any
// diversion evidence was found and whether anything is publishable.
export function diversionSummary(state) {
  const records=state?.records||[];
  const confirmed=records.filter(r=>r.status==='confirmed').length;
  const likely=records.filter(r=>r.status==='likely').length;
  const candidate=records.filter(r=>r.status==='candidate').length;
  return {source:'ttc-diversions-summary',status:state?.status||'unavailable',
    found:records.length>0,publishable:confirmed>0,confirmed,likely,candidate,
    advisorySupported:records.filter(r=>r.confidence?.advisorySupported).length,
    routes:[...new Set(records.map(r=>r.routeId))].sort(),
    message:confirmed>0?`${confirmed} confirmed diversion(s) published`
      :records.length>0?`${records.length} diversion candidate(s) observed, none confirmed yet`
      :'No diversion evidence observed'};
}
// Bounded, privacy-safe summary of the official advisory context handed to
// inference. It reports only counts and route IDs, never raw advisory text.
export function advisorySummary(advisories) {
  const items=advisories?.advisories||[];
  return {source:'ttc-official-advisories',status:advisories?.status||'not-loaded',count:items.length,
    routes:[...new Set(items.flatMap(a=>a.routeIds))].sort()};
}
// Fixed, documented cache-disposition keys. `restored` means the cache was read
// and validated; `missing` means no cache existed; `rejected` means the cache was
// malformed or oversized; `incompatible` means the cache was valid but its static
// version does not match the current static index, so it cannot be reused.
export const CACHE_DISPOSITIONS=Object.freeze(['restored','missing','rejected','incompatible']);
// Bounded cache-disposition diagnostic. It reports only the disposition, the
// static version, and the loaded track/episode counts, never raw cache contents.
export function cacheSummary(source,disposition,{staticVersion=null,loaded=0}={}) {
  return {source,status:disposition,staticVersion,loaded};
}
// Bounded, deterministically-ordered end-of-run continuity diagnostic. It answers
// "why was no path produced?" from counts and fixed reason keys only, never raw
// vehicle history, cache contents, episode collections, or advisory text.
export function continuitySummary({vehicleState,vehicleReport,vehicleCache,inferenceCache,inferenceReport,advisories,state}={}) {
  const v=vehicleReport||{},i=inferenceReport||{};
  const records=state?.records||[];
  const confirmed=records.filter(r=>r.status==='confirmed').length;
  return {source:'ttc-continuity',
    vehicleCache:vehicleCache?.status||'missing',inferenceCache:inferenceCache?.status||'missing',
    vehicleStaticVersion:vehicleCache?.staticVersion??null,inferenceStaticVersion:inferenceCache?.staticVersion??null,
    vehicleSource:vehicleState?.status||'unavailable',advisorySource:advisories?.status||'not-loaded',
    tracksLoaded:v.tracksLoaded||0,tracksCreated:v.tracksCreated||0,tracksRetained:v.tracksRetained||0,tracksReset:v.resets||0,tracksExpired:v.expired||0,
    graceStarted:v.graceStarted||0,graceContinued:v.graceContinued||0,graceCleared:v.graceCleared||0,graceExpired:v.graceExpired||0,
    graceRefusedAbsent:v.graceRefusedAbsent||0,graceRefusedConflict:v.graceRefusedConflict||0,graceRefusedStale:v.graceRefusedStale||0,graceRefusedIncompatible:v.graceRefusedIncompatible||0,
    episodesLoaded:i.episodesLoaded||0,episodesCreated:i.episodesCreated||0,episodesRetained:i.episodesRetained||0,episodesClosed:i.episodesClosed||0,episodesExpired:i.episodesExpired||0,
    advisoryCount:advisories?.advisories?.length||0,advisoryAssociated:i.advisoryAssociated||0,advisoryAmbiguous:i.advisoryAmbiguous||0,
    candidate:i.candidate||0,likely:i.likely||0,confirmed:i.confirmed||0,published:confirmed};
}
export async function runVehiclePolling({polls=1,intervalMs=30000,statePath='.cache/ttc/vehicle-state.json',outputPath='.cache/ttc/deviations.json',
  inferenceStatePath=resolve(dirname(statePath),'diversion-state.json'),inferenceOutputPath=resolve(dirname(outputPath),'diversions.json'),geoJsonPath,inferOnly=false,freshState=false,
  advisoryPath,loadAdvisories=loadOfficialAdvisories,
  loadStatic=loadStaticGtfs,refresh=refreshVehicles,updateAlerts=updateTtcAlerts,clock=()=>new Date(),wait=sleep,log=entry=>console.log(JSON.stringify(entry)),fixture}={}) {
  if (!Number.isInteger(polls)||polls<1||polls>20||!Number.isInteger(intervalMs)||intervalMs<15000||intervalMs>60000) throw new Error('Use 1–20 polls and 15000–60000 ms intervals');
  // Official advisory context is derived from the already-normalized snapshot; it
  // is never fetched again here. A missing input is a `not-loaded` contract.
  let advisories;
  try { advisories=await loadAdvisories(advisoryPath,{readFile}); }
  catch (error) { log({source:'ttc-official-advisories',status:'rejected',error:error.message}); advisories=officialAdvisories(undefined); }
  log(advisorySummary(advisories));
  let previous,vehicleCache;
  try {
    if ((await stat(statePath)).size>VEHICLE_POLICY.maxArtifactBytes) throw new Error('Vehicle cache too large');
    previous=JSON.parse(await readFile(statePath,'utf8')); validateVehicleState(previous);
    vehicleCache=cacheSummary('ttc-vehicles-cache','restored',{staticVersion:previous.staticVersion,loaded:previous.tracks.length});
  } catch (error) {
    if (error.code==='ENOENT') vehicleCache=cacheSummary('ttc-vehicles-cache','missing');
    else { vehicleCache=cacheSummary('ttc-vehicles-cache','rejected'); log({source:'ttc-vehicles',status:'cache-rejected',error:error.message}); }
    previous=undefined;
  }
  let inference,inferenceCache;
  try {
    if ((await stat(inferenceStatePath)).size>DIVERSION_POLICY.maxArtifactBytes) throw new Error('Diversion cache too large');
    inference=JSON.parse(await readFile(inferenceStatePath,'utf8'));validateDiversionState(inference);
    inferenceCache=cacheSummary('ttc-diversions-cache','restored',{staticVersion:inference.staticVersion,loaded:inference.episodes.length});
  } catch (error) {
    if (error.code==='ENOENT') inferenceCache=cacheSummary('ttc-diversions-cache','missing');
    else { inferenceCache=cacheSummary('ttc-diversions-cache','rejected'); log({source:'ttc-diversions',status:'cache-rejected',error:error.message}); }
    inference=undefined;
  }
  if (freshState) { previous=undefined;inference=undefined;vehicleCache=cacheSummary('ttc-vehicles-cache','missing');inferenceCache=cacheSummary('ttc-diversions-cache','missing'); }
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
  // A restored cache whose static version differs from the current index cannot be
  // reused; report it as `incompatible` rather than silently discarding it.
  if (vehicleCache.status==='restored'&&vehicleCache.staticVersion!==loaded.index.version) vehicleCache=cacheSummary('ttc-vehicles-cache','incompatible',{staticVersion:vehicleCache.staticVersion,loaded:vehicleCache.loaded});
  if (inferenceCache.status==='restored'&&inferenceCache.staticVersion!==loaded.index.version) inferenceCache=cacheSummary('ttc-diversions-cache','incompatible',{staticVersion:inferenceCache.staticVersion,loaded:inferenceCache.loaded});
  log(vehicleCache);log(inferenceCache);
  if (inferOnly) {
    if (!previous) throw new Error('A valid Story 30D vehicle-state file is required for --infer-only');
    const now=clock();
    // No alert refresh in offline diagnostics: unavailable context cannot boost confidence.
    const current={...previous,checkedAt:now.toISOString(),status:Date.parse(previous.checkedAt)+120000>=+now?previous.status:'unavailable'};
    const result=inferDiversions(inference,current,loaded.index,now,undefined,{advisories});
    await atomicJson(inferenceStatePath,result.state);await atomicJson(inferenceOutputPath,result.output);
    if (geoJsonPath) await atomicJson(geoJsonPath,diversionGeoJson(result.state,loaded.index));
    log({source:'ttc-diversions',status:result.state.status,...result.report});
    log(diversionSummary(result.state));
    log(continuitySummary({vehicleState:current,vehicleCache,inferenceCache,inferenceReport:result.report,advisories,state:result.state}));
    return previous;
  }
  const geometryCache=new Map();
  let alerts,vehicleReport,inferenceReport;
  for (let i=0;i<polls;i++) {
    if (i) await wait(intervalMs);
    const now=fixture?new Date(fixture[i].now):clock();
    // Alert failures affect only supporting context, never vehicle detection.
    alerts=fixture?fixture[i].alerts:await updateAlerts(alerts,now,undefined,log);
    if (alerts) alerts=correlateState(alerts,loaded.index,now);
    const fetchSource=fixture?async()=>parseTtcVehicles(Buffer.from(fixture[i].protobufBase64,'base64'),now):undefined;
    const result=await refresh(previous,loaded.index,now,alerts,{geometryCache,fetchSource,log});
    previous=result.state;vehicleReport=result.report;
    const inferred=inferDiversions(inference,previous,loaded.index,now,alerts,{advisories});
    inference=inferred.state;inferenceReport=inferred.report;
    await atomicJson(inferenceStatePath,inference);await atomicJson(inferenceOutputPath,inferred.output);
    if (geoJsonPath) await atomicJson(geoJsonPath,diversionGeoJson(inference,loaded.index));
    log({source:'ttc-diversions',status:inference.status,...inferred.report,artifactBytes:Buffer.byteLength(JSON.stringify(inferred.output))});
    await atomicJson(statePath,previous); await atomicJson(outputPath,deviationOutput(previous));
  }
  log(diversionSummary(inference));
  log(continuitySummary({vehicleState:previous,vehicleReport,vehicleCache,inferenceCache,inferenceReport,advisories,state:inference}));
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
    advisoryPath:option('--advisory',process.env.TTC_ADVISORY_SNAPSHOT),
    statePath:process.env.TTC_VEHICLE_STATE,outputPath:process.env.TTC_VEHICLE_OUTPUT,loadStatic,fixture,wait:fixture?async()=>{}:undefined});
}
