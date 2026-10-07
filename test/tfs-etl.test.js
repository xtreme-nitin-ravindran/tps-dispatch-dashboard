import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTfsEtl } from '../scripts/tfs-etl.js';

const now = new Date('2026-09-16T12:00:00Z');
const source = { updatedAt: now.toISOString(), incidents: [] };
async function workspace(t) {
    const dir = await mkdtemp(join(tmpdir(), 'tfs-etl-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    return dir;
}

test('ETL bootstraps, persists and merges fetched incidents across runs', async t => {
    const outputPath = join(await workspace(t), 'data/current.json');
    const fetchSource = async () => ({ ...source, incidents: [
        { event_id: 'F1', time: '2026-09-16T11:00:00Z', cad: 1 }
    ] });
    await runTfsEtl({ outputPath, fetchSource, now });
    const snapshot = await runTfsEtl({ outputPath, fetchSource: async () => source, now });
    assert.equal(snapshot.retentionHours, 168);
    assert.equal(snapshot.incidents.length, 1);
    assert.equal(snapshot.incidents[0].isOngoing, false);
    assert.deepEqual(JSON.parse(await readFile(outputPath, 'utf8')), snapshot);
});

test('Concourse XML input merges separate history without modifying input', async t => {
    const dir = await workspace(t);
    const previousPath = join(dir, 'previous.json');
    const xmlPath = join(dir, 'feed.xml');
    const outputPath = join(dir, 'output/current.json');
    const previous = JSON.stringify({ source: 'TFS', retentionHours: 48, incidents: [
        { id: 'week', timestamp: '2026-09-09T12:00:00Z', isOngoing: true },
        { id: 'expired', timestamp: '2026-09-09T11:59:59Z' }
    ] });
    await writeFile(previousPath, previous);
    await writeFile(xmlPath, '<tfs_active_incidents><update_from_db_time>2026-09-16T12:00:00Z</update_from_db_time><event><event_num>F2</event_num><dispatch_time>2026-09-16T11:59:00Z</dispatch_time><event_type>Fire</event_type></event></tfs_active_incidents>');
    const result = await runTfsEtl({ previousPath, xmlPath, outputPath, now,
        fetchSource: assert.fail });
    assert.deepEqual(result.incidents.map(i => i.id), ['F2', 'week']);
    assert.equal(result.incidents[1].isOngoing, false);
    assert.equal(await readFile(previousPath, 'utf8'), previous);
    assert.deepEqual(JSON.parse(await readFile(outputPath, 'utf8')), result);
});

test('failed fetch, malformed XML, stale feed and malformed history preserve published output', async t => {
    const dir = await workspace(t);
    const outputPath = join(dir, 'current.json');
    const xmlPath = join(dir, 'bad.xml');
    const malformedPath = join(dir, 'malformed.json');
    const original = JSON.stringify({ source: 'TFS', sourceUpdatedAt: now.toISOString(), incidents: [] });
    await writeFile(outputPath, original);
    await writeFile(xmlPath, '<error>Unavailable</error>');
    // A present-but-malformed history object (for example a stray R2 object) must
    // fail clearly rather than crash later on an undefined `incidents` array.
    await writeFile(malformedPath, '{"smoke":2}');
    for (const options of [
        { fetchSource: async () => { throw new Error('network failed'); } },
        { xmlPath },
        { fetchSource: async () => ({ ...source, updatedAt: '2026-09-15T12:00:00Z' }) },
        { previousPath: malformedPath }
    ]) {
        await assert.rejects(runTfsEtl({ outputPath, now, ...options }));
        assert.equal(await readFile(outputPath, 'utf8'), original);
    }
    await writeFile(outputPath, 'broken JSON');
    await assert.rejects(runTfsEtl({ outputPath, now, fetchSource: assert.fail }));
    assert.equal(await readFile(outputPath, 'utf8'), 'broken JSON');
});

test('a missing explicit history file starts a fresh snapshot', async t => {
    // The Concourse task seeds TFS_PREVIOUS from R2; an absent object must start
    // fresh, exactly as an empty git checkout did, rather than fail the run.
    const dir = await workspace(t);
    const outputPath = join(dir, 'current.json');
    const result = await runTfsEtl({
        outputPath, previousPath: join(dir, 'missing.json'), now,
        fetchSource: async () => ({ ...source, incidents: [{ event_id: 'F1', time: now.toISOString() }] })
    });
    assert.deepEqual(result.incidents.map(i => i.id), ['F1']);
    assert.deepEqual(JSON.parse(await readFile(outputPath, 'utf8')), result);
});

test('combined updater keeps each feed when the other fails and preserves output if both fail', async t => {
    const outputPath = join(await workspace(t), 'current.json');
    const police = {id:'TPS-test',source:'TPS',timestamp:now.toISOString(),description:'HAZARD',location:'A - B',geography:{division:'Division 33',coordinates:[43.7,-79.4],approximate:true}};
    const fetchSource = async () => ({...source,incidents:[{event_id:'F1',time:now.toISOString(),location:'M5A'}]});
    const first = await runTfsEtl({outputPath,now,fetchSource,fetchPolice:async()=>[police]});
    assert.equal(first.incidents.length,2);
    const fail = async()=>{throw new Error('offline');};
    const second = await runTfsEtl({outputPath,now,fetchSource:fail,fetchPolice:async()=>[police]});
    assert.equal(second.feeds.TFS.status,'unavailable');
    assert.equal(second.incidents.length,2);
    const third = await runTfsEtl({outputPath,now,fetchSource,fetchPolice:fail});
    assert.equal(third.feeds.TPS.status,'unavailable');
    assert.equal(third.incidents.filter(r=>r.source==='TPS').length,1);
    const saved = await readFile(outputPath,'utf8');
    await assert.rejects(runTfsEtl({outputPath,now,fetchSource:fail,fetchPolice:fail}));
    assert.equal(await readFile(outputPath,'utf8'),saved);
});

test('disruption snapshots are separate from incidents and receive previous cache', async t => {
    const outputPath = join(await workspace(t), 'current.json');
    const disruptions = {roads:{items:[],status:'ok'},transit:{items:[],status:'unavailable'}};
    await runTfsEtl({outputPath,now,fetchSource:async()=>source,fetchTravel:async()=>disruptions});
    const result=await runTfsEtl({outputPath,now,fetchSource:async()=>source,fetchTravel:async previous=>{
        assert.deepEqual(previous,disruptions);return disruptions;
    }});
    assert.deepEqual(result.disruptions,disruptions);
    assert.equal(result.incidents.length,0);
    assert.deepEqual(JSON.parse(await readFile(outputPath,'utf8')).disruptions,disruptions);
});

test('ETL validates updater identity and fills unavailable-feed defaults without history', async t => {
    const outputPath = join(await workspace(t), 'current.json');
    await assert.rejects(runTfsEtl({outputPath, updatedBy:'other'}), /Invalid updater identity/);
    const fail = async () => { throw new Error('offline'); };
    const result = await runTfsEtl({outputPath, now, fetchSource:fail, fetchPolice:async()=>[]});
    assert.deepEqual(result.incidents, []);
    assert.deepEqual(result.feeds.TFS, {fetchedAt:null,sourceUpdatedAt:null,status:'unavailable'});
    assert.equal(result.feeds.TPS.status, 'ok');
});

test('ETL carries prior disruptions and legacy feed timestamps through failures', async t => {
    const outputPath = join(await workspace(t), 'current.json');
    const fetchedAt = '2026-09-16T11:00:00.000Z';
    const previous = {schemaVersion:1,source:'TFS',fetchedAt,sourceUpdatedAt:fetchedAt,
        incidents:[],disruptions:{roads:{items:[]}},feeds:{TPS:{fetchedAt}}};
    await writeFile(outputPath, JSON.stringify(previous));
    const fail = async () => { throw new Error('offline'); };
    const result = await runTfsEtl({outputPath, now, fetchSource:async()=>source, fetchPolice:fail});
    assert.deepEqual(result.disruptions, previous.disruptions);
    assert.equal(result.feeds.TPS.fetchedAt, fetchedAt);
    const noHistoryPath = join(await workspace(t), 'no-history.json');
    const withoutHistory = await runTfsEtl({outputPath:noHistoryPath, now, fetchSource:async()=>source, fetchPolice:fail});
    assert.equal(withoutHistory.feeds.TPS.fetchedAt, null);
});

test('CLI entry points honor environment paths and fallback writes GitHub output', async t => {
 const {execFileSync}=await import('node:child_process');
 const dir=await workspace(t), outputPath=join(dir,'data/current.json'), xmlPath=join(dir,'source.xml'), preload=join(dir,'fetch.mjs');
 const current=new Date().toISOString();
 await writeFile(xmlPath,`<tfs_active_incidents><update_from_db_time>${current}</update_from_db_time></tfs_active_incidents>`);
 await writeFile(preload,`globalThis.fetch=async url=>({ok:true,json:async()=>String(url).includes('returnIdsOnly')?{objectIds:[]}:{Closure:[]},text:async()=>String(url).includes('livecad.xml')?'<tfs_active_incidents><update_from_db_time>'+new Date().toISOString()+'</update_from_db_time></tfs_active_incidents>':'header { gtfs_realtime_version: "2.0" timestamp: '+Math.floor(Date.now()/1000)+' }'});`);
 for(const script of ['tfs-etl.js','update-tfs.js']) {
  const stdout=execFileSync(process.execPath,['--import',preload,new URL('../scripts/'+script,import.meta.url).pathname],{env:{...process.env,TFS_OUTPUT:outputPath,TFS_XML:xmlPath,TFS_UPDATED_BY:'manual'},encoding:'utf8'});
  assert.match(stdout,/Wrote 0 incidents/);
  const saved=JSON.parse(await readFile(outputPath,'utf8'));
  assert.equal(saved.updatedBy,'manual');assert.equal(saved.feeds.TPS.status,'ok');assert.equal(saved.disruptions.transit.status,'ok');
 }
 const githubOutput=join(dir,'github-output');
 const stdout=execFileSync(process.execPath,[new URL('../scripts/tfs-fallback.js',import.meta.url).pathname],{cwd:dir,env:{...process.env,GITHUB_OUTPUT:githubOutput},encoding:'utf8'});
 assert.match(stdout,/skipped/);assert.equal(await readFile(githubOutput,'utf8'),'updated=false\n');
 const defaultDir=await workspace(t);
 const defaultStdout=execFileSync(process.execPath,['--import',preload,new URL('../scripts/tfs-etl.js',import.meta.url).pathname],{cwd:defaultDir,env:{...process.env,TFS_OUTPUT:'',TFS_XML:'',TFS_UPDATED_BY:'',TFS_PREVIOUS:''},encoding:'utf8'});
 assert.match(defaultStdout,/Wrote 0 incidents to data\/current.json/);
 await rm(join(defaultDir,'data/current.json'));
 const fallbackStdout=execFileSync(process.execPath,['--import',preload,new URL('../scripts/tfs-fallback.js',import.meta.url).pathname],{cwd:defaultDir,env:{...process.env,GITHUB_OUTPUT:''},encoding:'utf8'});
 assert.match(fallbackStdout,/Updated stale snapshot/);
});

test('TTC artifact survives optional source failure and uses the shared atomic snapshot', async t => {
    const {updateTtcAlerts} = await import('../src/ttc/alerts.js');
    const outputPath = join(await workspace(t), 'current.json');
    const old = await updateTtcAlerts(null,now,async () => ({schemaVersion:1,items:[],sourceUpdatedAt:null}),() => {});
    await runTfsEtl({outputPath,now,fetchSource:async () => source,fetchTtc:async () => old});
    const result = await runTfsEtl({outputPath,now,fetchSource:async () => source,
        fetchTtc:(previous,date) => updateTtcAlerts(previous,date,async () => {throw new Error('offline');},() => {})});
    assert.equal(result.ttcAlerts.status,'unavailable');
    assert.deepEqual(result.ttcAlerts.items,old.items);
    assert.deepEqual(JSON.parse(await readFile(outputPath,'utf8')).ttcAlerts,result.ttcAlerts);
});

test('protobuf to lifecycle to published JSON reader; invalid TTC cannot replace output', async t => {
    const {default:bindings} = await import('gtfs-realtime-bindings');
    const {parseTtcAlerts,updateTtcAlerts} = await import('../src/ttc/alerts.js');
    const outputPath = join(await workspace(t),'current.json');
    const bytes = bindings.transit_realtime.FeedMessage.encode({header:{gtfsRealtimeVersion:'2.0'},entity:[{id:'detour',alert:{effect:4,informedEntity:[{routeId:'0501',stopId:'001'}]}}]}).finish();
    const fetchTtc = (previous,date) => updateTtcAlerts(previous,date,async () => parseTtcAlerts(bytes,date),() => {});
    await runTfsEtl({outputPath,now,fetchSource:async () => source,fetchTtc});
    const saved = JSON.parse(await readFile(outputPath,'utf8'));
    assert.equal(saved.ttcAlerts.items[0].state,'active');
    assert.deepEqual(saved.ttcAlerts.items[0].routes,['0501']);
    assert.deepEqual(saved.ttcAlerts.changes.new,['detour']);
    const original = await readFile(outputPath,'utf8');
    await assert.rejects(runTfsEtl({outputPath,now,fetchSource:async () => source,fetchTtc:async () => ({items:[]})}));
    assert.equal(await readFile(outputPath,'utf8'),original);
});
