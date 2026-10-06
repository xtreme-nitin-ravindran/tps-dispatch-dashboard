import { updateTtcBackend } from '../src/ttc/backend.js';
import { updateDisruptions } from "../src/disruptions/source.js";
import { readFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fetchTpsSource } from '../src/tps/source.js';
import { runTfsEtl } from './tfs-etl.js';
import { needsUpdate } from './lib/data-publication.js';

// The freshness/skip policy is shared with Concourse so both schedulers decide
// identically whether a snapshot needs an update. Re-exported here to preserve
// the existing public API of this module.
export { needsUpdate };
export async function runFallback({ outputPath = 'data/current.json', now = new Date(), etl = options => runTfsEtl({...options, fetchPolice:fetchTpsSource, fetchTravel:updateDisruptions, fetchTtc:updateTtcBackend}) } = {}) {
  let snapshot;
  try { snapshot = JSON.parse(await readFile(outputPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!needsUpdate(snapshot, now)) return false;
  await etl({ outputPath, now, updatedBy: 'github-actions' });
  return true;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const updated = await runFallback();
  console.log(updated ? 'Updated stale snapshot via GitHub Actions' : 'Snapshot and incident feeds are under 5 minutes old; skipped');
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `updated=${updated}\n`);
}
