import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { needsUpdate, runFallback } from '../scripts/tfs-fallback.js';
import { runTfsEtl } from '../scripts/tfs-etl.js';
const now = new Date('2026-09-18T16:00:00Z');
const fixturePath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/fresh-snapshot-stale-feed.json');
test('freshness uses fetch time, including exact cutoff and invalid clocks', () => {
  assert.equal(needsUpdate({fetchedAt:'2026-09-18T15:50:00.001Z'},now),false);
  assert.equal(needsUpdate({fetchedAt:'2026-09-18T15:50:00Z'},now),true);
  for (const fetchedAt of [undefined,'invalid','2026-09-19T00:00:00Z']) assert.equal(needsUpdate({fetchedAt},now),true);
});
test('fresh snapshot envelope does not hide stale or unavailable incident feeds', async () => {
  const snapshot = JSON.parse(await readFile(fixturePath, 'utf8'));
  assert.equal(needsUpdate(snapshot, now), true);
  snapshot.feeds.TFS.fetchedAt = snapshot.fetchedAt;
  assert.equal(needsUpdate(snapshot, now), false);
  snapshot.feeds.TPS.status = 'unavailable';
  assert.equal(needsUpdate(snapshot, now), true);
  delete snapshot.feeds.TPS;
  assert.equal(needsUpdate(snapshot, now), true);
});
test('fresh snapshot is untouched; stale snapshot records GitHub updater; corrupt history fails', async t => {
  const dir = await mkdtemp(join(tmpdir(),'tfs-fallback-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const outputPath=join(dir,'current.json');
  const source={updatedAt:now.toISOString(),incidents:[]};
  await runTfsEtl({outputPath,now,updatedBy:'concourse',fetchSource:async()=>source});
  const original=await readFile(outputPath,'utf8');
  assert.equal(JSON.parse(original).updatedBy,'concourse');
  assert.equal(await runFallback({outputPath,now,etl:assert.fail}),false);
  assert.equal(await readFile(outputPath,'utf8'),original);
  assert.equal(await runFallback({outputPath,now:new Date(now.getTime()+600000),etl:options=>runTfsEtl({...options,fetchSource:async()=>source})}),true);
  assert.equal(JSON.parse(await readFile(outputPath,'utf8')).updatedBy,'github-actions');
  await writeFile(outputPath,'broken');
  await assert.rejects(runFallback({outputPath,now}));
  assert.equal(await readFile(outputPath,'utf8'),'broken');
});

test('missing snapshots run the injected updater', async t => {
  const dir = await mkdtemp(join(tmpdir(),'tfs-fallback-missing-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const outputPath=join(dir,'current.json');
  let received;
  assert.equal(await runFallback({outputPath,now,etl:async options=>{received=options;}}),true);
  assert.deepEqual(received,{outputPath,now,updatedBy:'github-actions'});
});

test('default fallback updater fetches all sources for a missing snapshot', async t => {
  const dir = await mkdtemp(join(tmpdir(),'tfs-fallback-default-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const outputPath=join(dir,'current.json');
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async url=>({
    ok:true,
    json:async()=>String(url).includes('returnIdsOnly')?{objectIds:[]}:{Closure:[]},
    text:async()=>String(url).includes('livecad.xml')
      ? `<tfs_active_incidents><update_from_db_time>${now.toISOString()}</update_from_db_time></tfs_active_incidents>`
      : `header { gtfs_realtime_version: "2.0" timestamp: ${now.getTime()/1000} }`
  });
  try {
    assert.equal(await runFallback({outputPath,now}),true);
  } finally {
    globalThis.fetch=originalFetch;
  }
  assert.equal(JSON.parse(await readFile(outputPath,'utf8')).updatedBy,'github-actions');
});
