import { readFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runTfsEtl } from './tfs-etl.js';

export function needsUpdate(snapshot, now = new Date()) {
  const timestamp = Date.parse(snapshot?.fetchedAt);
  return !Number.isFinite(timestamp) || timestamp > now.getTime() || now.getTime() - timestamp >= 600000;
}
export async function runFallback({ outputPath = 'data/current.json', now = new Date(), etl = runTfsEtl } = {}) {
  let snapshot;
  try { snapshot = JSON.parse(await readFile(outputPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!needsUpdate(snapshot, now)) return false;
  await etl({ outputPath, now, updatedBy: 'github-actions' });
  return true;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const updated = await runFallback();
  console.log(updated ? 'Updated stale snapshot via GitHub Actions' : 'Snapshot is under 10 minutes old; skipped');
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `updated=${updated}\n`);
}
