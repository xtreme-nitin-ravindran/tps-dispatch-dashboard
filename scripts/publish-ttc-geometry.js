import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateDiversionOutput } from '../src/ttc/diversion-inference.js';
// Allow-list the browser artifact: diagnostic boundaries contain raw observations.
export function publicTtcGeometry(output) {
  validateDiversionOutput(output);
  return {schemaVersion:1,status:output.status,checkedAt:output.checkedAt,diversions:output.diversions.filter(d=>d.status==='confirmed').map(d=>({
    id:d.id,routeId:d.routeId,directionId:d.directionId,status:d.status,geometrySource:d.geometrySource,
    geometry:d.geometry,relatedAlertIds:d.relatedAlertIds,relatedAdvisoryRefs:d.relatedAdvisoryRefs,lastObservedAt:d.lastObservedAt,
    expiresAt:d.expiresAt || new Date(Date.parse(d.lastObservedAt)+1800000).toISOString()
  }))};
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const result=publicTtcGeometry(JSON.parse(await readFile(process.argv[2],'utf8')));
  await mkdir(dirname(process.argv[3]),{recursive:true});
  await writeFile(process.argv[3],JSON.stringify(result)+'\n');
}
