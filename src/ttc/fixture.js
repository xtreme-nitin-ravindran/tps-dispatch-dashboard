export async function loadTtcUiFixture(locationLike=globalThis.location,fetchImpl=fetch,now=Date.now()) {
  if(!['localhost','127.0.0.1','::1'].includes(locationLike?.hostname)) return null;
  const mode=new URLSearchParams(locationLike.search).get('ttcFixture');
  if(!['confirmed','alert-only','multiple','unavailable','expired','empty','official-advisory','affected','detours'].includes(mode)) return null;
  // Story 51D: the official-advisory scenario uses the route 94 baseline fixture
  // where an active official Service Change receives confirmed observed geometry.
  if(mode==='official-advisory') {
    const response=await fetchImpl('./test/fixtures/ttc-official-advisory/frontend.json');
    if(!response.ok) throw new Error('Generate the TTC UI fixture first');
    const fixture=await response.json(),shift=now-fixture.now;
    // Official active periods use epoch milliseconds; shift them along with ISO times.
    const rebase=(value,field)=>Array.isArray(value)?value.map(v=>rebase(v)):value && typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,rebase(v,k)])):Number.isFinite(value)&&['start','end'].includes(field)?value+shift:typeof value==='string' && /^2026-\d\d-\d\dT/.test(value)?new Date(Date.parse(value)+shift).toISOString():value;
    return rebase(fixture);
  }
  const response=await fetchImpl('./test/fixtures/ttc-diversions/frontend.json');
  if(!response.ok) throw new Error('Generate the TTC UI fixture first');
  const fixture=await response.json(),shift=now-fixture.now;
  const rebase=value=>Array.isArray(value)?value.map(rebase):value && typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,rebase(v)])):typeof value==='string' && /^2026-\d\d-\d\dT/.test(value)?new Date(Date.parse(value)+shift).toISOString():value;
  const result=rebase(fixture);
  // Story 74 P1: a subway-style advisory whose ordered affected stops include
  // same-station platform pairs, so the deduped dashed affected section can be
  // asserted in the rendered browser.
  if(mode==='affected') {
    result.transit={status:'ok',fetchedAt:new Date(now).toISOString(),items:[{
      id:'mobile-audit-subway',title:'TEST — Line 2 Bloor-Danforth: no subway service between Kipling and Jane stations',
      description:'Deterministic affected-section fixture; not a real TTC advisory.',effect:'NO SERVICE',routes:['2'],stopIds:['k-eb','k-sub','i-eb','j-eb'],periods:[],
      affectedEntities:[
        {routeId:'2',stopId:'k-eb',name:'Kipling Station - Eastbound Platform',coordinates:[43.637648,-79.535694]},
        {routeId:'2',stopId:'k-sub',name:'Kipling Station - Subway Platform',coordinates:[43.637392,-79.535892]},
        {routeId:'2',stopId:'i-eb',name:'Islington Station - Eastbound Platform',coordinates:[43.645548,-79.523293]},
        {routeId:'2',stopId:'j-eb',name:'Jane Station - Eastbound Platform',coordinates:[43.650149,-79.482892]}
      ],url:'https://www.ttc.ca/service-advisories/all-service-alerts'}]
    };
  }
  // Story 76: TTC-published detour shapes (GTFS-RT TripModifications) render as
  // solid lines with the TTC-published diversion label. The mode clears every
  // other TTC source so the two published shapes are the only cards/lines.
  if(mode==='detours') {
    result.ttcAlerts.items=[];result.ttcDiversions.diversions=[];
    result.ttcDetours={schemaVersion:1,status:'ok',fetchedAt:new Date(now).toISOString(),checkedAt:new Date(now).toISOString(),detours:[
      {id:'detour-75-fixture',shapeId:'detour-75-shape',routeId:'75',routeLabel:'75 Sherbourne',directionId:1,serviceDates:[],tripCount:4,startStopSequence:10,endStopSequence:11,geometry:[[-79.3722,43.655],[-79.3727,43.66],[-79.3724,43.665],[-79.3728,43.67]]},
      {id:'detour-504-fixture',shapeId:'detour-504-shape',routeId:'504',routeLabel:'504 King',directionId:0,serviceDates:[],tripCount:7,startStopSequence:3,endStopSequence:6,geometry:[[-79.402,43.645],[-79.391,43.6453],[-79.38,43.6456]]}
    ]};
  }
  if(mode==='alert-only' || mode==='expired') result.ttcDiversions.diversions=[];
  if(mode==='unavailable') {result.ttcAlerts.status='unavailable';result.ttcDiversions.status='unavailable';}
  if(mode==='empty') {result.ttcAlerts.items=[];result.ttcDiversions.diversions=[];}
  if(mode==='multiple') {
    const copy=structuredClone(result.ttcAlerts.items[0]);copy.id+='-second';copy.header='TEST — Queen construction detour';
    copy.routes=['501'];copy.correlation.routes=[{routeId:'501',routeShortName:'501',routeLongName:'Queen'}];
    copy.correlation.routeResults=[{routeId:'501',status:'exact'}];
    const candidate=copy.correlation.candidates[0],oldId=candidate.patternId;
    candidate.patternId='fixture-queen';candidate.affectedSegment.geometry=candidate.affectedSegment.geometry.map(([x,y])=>[x,y+.003]);
    result.ttcAlerts.staticCorrelation.patterns[candidate.patternId]={...result.ttcAlerts.staticCorrelation.patterns[oldId],routeId:'501'};
    result.ttcAlerts.items.push(copy);
  }
  return result;
}
