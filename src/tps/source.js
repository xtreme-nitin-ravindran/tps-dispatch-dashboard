import { createHash } from 'node:crypto';
export const TPS_ENDPOINT = 'https://services.arcgis.com/S9th0jAJ7bqgIRjw/arcgis/rest/services/C4S_Public_NoGO/FeatureServer/0';
export async function fetchTpsSource({ fetchImpl = fetch } = {}) {
  const query = async params => {
    const response = await fetchImpl(TPS_ENDPOINT + '/query?' + new URLSearchParams({f:'json',...params}), {signal:AbortSignal.timeout(15000)});
    if (!response.ok) throw new Error(`TPS HTTP ${response.status}`);
    const result = await response.json();
    if (result.error) throw new Error('TPS query failed');
    return result;
  };
  const {objectIds} = await query({where:'1=1',returnIdsOnly:'true'});
  if (!Array.isArray(objectIds)) throw new Error('TPS missing object IDs');
  const features = [];
  for (let offset=0; offset<objectIds.length; offset+=100) {
    const page = await query({objectIds:objectIds.slice(offset,offset+100).join(','),outFields:'*',returnGeometry:'false'});
    if (!Array.isArray(page.features) || page.exceededTransferLimit) throw new Error('Incomplete TPS response');
    features.push(...page.features);
  }
  if (features.length !== objectIds.length) throw new Error('TPS changed during fetch; retry next run');
  return features.map(feature => normalizeTps(feature.attributes));
}
export function normalizeTps(a) {
  const time = a?.OCCURRENCE_TIME_AGOL;
  if (!Number.isFinite(time) || !a.CALL_TYPE) throw new Error('Invalid TPS record');
  const timestamp = new Date(time).toISOString();
  const location = String(a.CROSS_STREETS || 'Location not published');
  // ArcGIS OBJECTIDs can be recycled on refresh; use public call attributes instead.
  const id = 'TPS-' + createHash('sha256').update(JSON.stringify([timestamp,a.CALL_TYPE_CODE,location,a.DIVISION,a.LATITUDE,a.LONGITUDE])).digest('hex').slice(0,24);
  const division = /^D\d+$/.test(a.DIVISION) ? `Division ${a.DIVISION.slice(1)}` : String(a.DIVISION || 'Unknown');
  const coordinates = Number.isFinite(a.LATITUDE) && Number.isFinite(a.LONGITUDE) &&
    a.LATITUDE>=43.58 && a.LATITUDE<=43.86 && a.LONGITUDE>=-79.65 && a.LONGITUDE<=-79.12 ? [a.LATITUDE,a.LONGITUDE] : null;
  return {id,source:'TPS',eventType:'police',description:String(a.CALL_TYPE),callTypeCode:String(a.CALL_TYPE_CODE || ''),
    timestamp,location,division,vehicles:[],isOngoing:false,
    geography:{text:location,coordinates,division,approximate:true}};
}
export function mergePolice(incoming, previous, now) {
  const records = new Map(previous.filter(r=>r.source==='TPS').map(r=>[r.id,r]));
  for (const row of incoming) records.set(row.id,row);
  return [...records.values()].filter(r=>Date.parse(r.timestamp)<=now.getTime() && Date.parse(r.timestamp)>=now.getTime()-168*3600000);
}
