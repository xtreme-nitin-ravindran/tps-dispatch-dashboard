import { updateDisruptions } from "../src/disruptions/source.js";
import { readFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fetchTpsSource } from '../src/tps/source.js';
import { runTfsEtl } from './tfs-etl.js';

export function needsUpdate(snapshot, now = new Date()) {
  const nowMs = now.getTime();
  const timestampNeedsUpdate = value => {
    const timestamp = Date.parse(value);
    return !Number.isFinite(timestamp) || timestamp > nowMs || nowMs - timestamp >= 600000;
  };
  if (timestampNeedsUpdate(snapshot?.fetchedAt)) return true;
  if (!snapshot?.feeds) return false;
  return ['TFS', 'TPS'].some(source => {
    const feed = snapshot.feeds[source];
    return feed?.status !== 'ok' || timestampNeedsUpdate(feed.fetchedAt);
  });
}
export async function runFallback({ outputPath = 'data/current.json', now = new Date(), etl = options => runTfsEtl({...options, fetchPolice:fetchTpsSource, fetchTravel:updateDisruptions}) } = {}) {
  let snapshot;
  try { snapshot = JSON.parse(await readFile(outputPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!needsUpdate(snapshot, now)) return false;
  await etl({ outputPath, now, updatedBy: 'github-actions' });
  return true;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const updated = await runFallback();
  console.log(updated ? 'Updated stale snapshot via GitHub Actions' : 'Snapshot and incident feeds are under 10 minutes old; skipped');
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `updated=${updated}\n`);
}
