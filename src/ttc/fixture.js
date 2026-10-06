export async function loadTtcUiFixture(locationLike=globalThis.location,fetchImpl=fetch,now=Date.now()) {
  if(!['localhost','127.0.0.1','::1'].includes(locationLike?.hostname)) return null;
  const mode=new URLSearchParams(locationLike.search).get('ttcFixture');
  if(!['confirmed','alert-only','multiple','unavailable','expired','empty','official-advisory'].includes(mode)) return null;
  // Story 51D: the official-advisory scenario uses the route 94 baseline fixture
  // where an active official Service Change receives confirmed observed geometry.
  if(mode==='official-advisory') {
    const response=await fetchImpl('./test/fixtures/ttc-official-advisory/frontend.json');
    if(!response.ok) throw new Error('Generate the TTC UI fixture first');
    const fixture=await response.json(),shift=now-fixture.now;
    const rebase=value=>Array.isArray(value)?value.map(rebase):value && typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,rebase(v)])):typeof value==='string' && /^2026-\d\d-\d\dT/.test(value)?new Date(Date.parse(value)+shift).toISOString():value;
    return rebase(fixture);
  }
  const response=await fetchImpl('./test/fixtures/ttc-diversions/frontend.json');
  if(!response.ok) throw new Error('Generate the TTC UI fixture first');
  const fixture=await response.json(),shift=now-fixture.now;
  const rebase=value=>Array.isArray(value)?value.map(rebase):value && typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,rebase(v)])):typeof value==='string' && /^2026-\d\d-\d\dT/.test(value)?new Date(Date.parse(value)+shift).toISOString():value;
  const result=rebase(fixture);
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
