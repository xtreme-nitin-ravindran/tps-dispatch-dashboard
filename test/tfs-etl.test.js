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
        fetchSource: () => { throw new Error('must use supplied XML'); } });
    assert.deepEqual(result.incidents.map(i => i.id), ['F2', 'week']);
    assert.equal(result.incidents[1].isOngoing, false);
    assert.equal(await readFile(previousPath, 'utf8'), previous);
    assert.deepEqual(JSON.parse(await readFile(outputPath, 'utf8')), result);
});

test('failed fetch, malformed XML, stale feed and invalid history preserve published output', async t => {
    const dir = await workspace(t);
    const outputPath = join(dir, 'current.json');
    const xmlPath = join(dir, 'bad.xml');
    const original = JSON.stringify({ source: 'TFS', sourceUpdatedAt: now.toISOString(), incidents: [] });
    await writeFile(outputPath, original);
    await writeFile(xmlPath, '<error>Unavailable</error>');
    for (const options of [
        { fetchSource: async () => { throw new Error('network failed'); } },
        { xmlPath },
        { fetchSource: async () => ({ ...source, updatedAt: '2026-09-15T12:00:00Z' }) },
        { previousPath: join(dir, 'missing.json') }
    ]) {
        await assert.rejects(runTfsEtl({ outputPath, now, ...options }));
        assert.equal(await readFile(outputPath, 'utf8'), original);
    }
    await writeFile(outputPath, 'broken JSON');
    await assert.rejects(runTfsEtl({ outputPath, now, fetchSource: async () => source }));
    assert.equal(await readFile(outputPath, 'utf8'), 'broken JSON');
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
