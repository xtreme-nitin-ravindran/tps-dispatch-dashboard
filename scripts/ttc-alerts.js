import { updateTtcBackend } from '../src/ttc/backend.js';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fetchTtcAlerts, updateTtcAlerts } from '../src/ttc/alerts.js';

// Strict manual ingestion/smoke path: failures exit nonzero without replacing output.
const now = new Date();
const output = process.env.TTC_OUTPUT || 'data/ttc-alerts.json';
let previous;
if (!process.argv.includes('--smoke')) {
  try { previous = JSON.parse(await readFile(output,'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
// Fetch outside retention handling: this diagnostic command remains strict.
const parsed = await fetchTtcAlerts(now);
const reconcile = () => updateTtcAlerts(previous,now,async () => parsed);
const result = process.argv.includes('--smoke')
  ? await reconcile()
  : await updateTtcBackend(previous,now,{updateAlerts:reconcile});
if (!process.argv.includes('--smoke')) {
  await mkdir(dirname(output),{recursive:true});
  const temporary = `${output}.tmp`;
  try {
    await writeFile(temporary,`${JSON.stringify(result,null,2)}\n`);
    await rename(temporary,output);
  } finally { await rm(temporary,{force:true}); }
}
console.log(JSON.stringify({source:'ttc-gtfs-rt',status:'ok',count:result.items.length,sourceUpdatedAt:result.sourceUpdatedAt}));
