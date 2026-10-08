import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { FRESHNESS_THRESHOLD_MS, needsUpdate } from '../scripts/lib/data-publication.js';
import { publishIncidents } from '../scripts/publish-incidents.js';
import { publishTtcPhase, isDirectInvocation, runTtcPhaseCli } from '../scripts/publish-ttc-phase.js';
import { createLocalSink } from '../scripts/lib/publication-sink.js';
import { at, vehicle, protobuf, staticIndex } from './fixtures/ttc-vehicles/builders.js';
import { parseTtcVehicles } from '../src/ttc/vehicle-feed.js';
import { detectVehicles } from '../src/ttc/vehicle-detector.js';
import { inferDiversions } from '../src/ttc/diversion-inference.js';

const now = new Date('2026-10-06T12:00:00Z');

// The publication phases publish to Cloudflare R2 (the git `data` branch was
// retired in Story 55E). The in-process phase tests inject a deterministic local
// sink so they never touch the network; the CLI tests stub `globalThis.fetch`
// with a minimal in-memory R2 stand-in.

// Build a valid confirmed diversion output by running the real inference over a
// deterministic two-vehicle fixture, so the TTC phase tests exercise the same
// artifact shape production publishes.
function confirmedDiversionOutput() {
  const index = staticIndex();
  const path = [[43.65, -79.404], [43.652, -79.403], [43.652, -79.402], [43.652, -79.400], [43.65, -79.398], [43.65, -79.397], [43.65, -79.396]];
  let state, vehicles, result;
  for (let i = 0; i < path.length; i++) {
    const seconds = i * 30;
    const rows = [0, 1].map(j => vehicle(seconds, { vehicle: { id: String(j) }, position: { latitude: path[i][0], longitude: path[i][1] } }));
    const feed = parseTtcVehicles(protobuf(rows, seconds), at(seconds));
    vehicles = detectVehicles(vehicles, feed, index, at(seconds)).state;
    result = inferDiversions(state, vehicles, index, at(seconds));
    state = result.state;
  }
  assert.equal(result.output.diversions.length, 1);
  assert.equal(result.output.diversions[0].status, 'confirmed');
  return result.output;
}

// --- Shared freshness/skip policy -------------------------------------------

test('the shared freshness threshold keeps data under the ten-minute UI stale window', () => {
  // The schedule runs every five minutes and the browser marks a feed stale after
  // ten minutes, so the threshold must be at most five minutes.
  assert.equal(FRESHNESS_THRESHOLD_MS, 300000);
  assert.ok(FRESHNESS_THRESHOLD_MS <= 600000);
});

test('freshness uses fetch time, including the exact cutoff and invalid clocks', () => {
  assert.equal(needsUpdate({ fetchedAt: '2026-10-06T11:55:00.001Z' }, now), false);
  assert.equal(needsUpdate({ fetchedAt: '2026-10-06T11:55:00Z' }, now), true);
  for (const fetchedAt of [undefined, 'invalid', '2026-10-06T13:00:00Z']) {
    assert.equal(needsUpdate({ fetchedAt }, now), true);
  }
});

test('freshness defaults the clock and threshold when called with no arguments', () => {
  // Exercises the default `now` and `thresholdMs` parameters.
  assert.equal(needsUpdate(), true);
  assert.equal(needsUpdate({ fetchedAt: new Date(Date.now() - 1000).toISOString() }), false);
});

test('freshness evaluates each timestamp predicate independently', () => {
  // Future-dated: the `timestamp > nowMs` operand decides.
  assert.equal(needsUpdate({ fetchedAt: '2026-10-06T12:00:00.001Z' }, now), true);
  // Stale: the `nowMs - timestamp >= thresholdMs` operand decides.
  assert.equal(needsUpdate({ fetchedAt: '2026-10-06T11:54:59.999Z' }, now), true);
  // A custom threshold is honored.
  assert.equal(needsUpdate({ fetchedAt: '2026-10-06T11:59:00.001Z' }, now, 60000), false);
});

test('freshness inspects each incident feed when the envelope is fresh', () => {
  // The envelope is fresh, so the decision comes from the per-feed `.some()`.
  const fresh = now.toISOString();
  const base = { fetchedAt: fresh, feeds: { TFS: { status: 'ok', fetchedAt: fresh }, TPS: { status: 'ok', fetchedAt: fresh } } };
  assert.equal(needsUpdate(base, now), false);
  assert.equal(needsUpdate({ ...base, feeds: { ...base.feeds, TFS: { status: 'unavailable', fetchedAt: fresh } } }, now), true);
  assert.equal(needsUpdate({ ...base, feeds: { ...base.feeds, TPS: { status: 'ok', fetchedAt: '2026-10-06T11:00:00Z' } } }, now), true);
});

test('a fresh envelope does not hide a stale or unavailable incident feed', () => {
  const snapshot = {
    fetchedAt: now.toISOString(),
    feeds: { TFS: { status: 'ok', fetchedAt: now.toISOString() }, TPS: { status: 'ok', fetchedAt: now.toISOString() } }
  };
  assert.equal(needsUpdate(snapshot, now), false);
  snapshot.feeds.TPS.status = 'unavailable';
  assert.equal(needsUpdate(snapshot, now), true);
  snapshot.feeds.TPS = { status: 'ok', fetchedAt: '2026-10-06T11:00:00Z' };
  assert.equal(needsUpdate(snapshot, now), true);
  delete snapshot.feeds;
  assert.equal(needsUpdate(snapshot, now), false);
});

// --- Incident publication phase ---------------------------------------------

test('the incident phase skips a fresh snapshot without running the ETL', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'incident-phase-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const outputPath = join(dir, 'current.json');
  await writeFile(outputPath, JSON.stringify({
    fetchedAt: now.toISOString(),
    feeds: { TFS: { status: 'ok', fetchedAt: now.toISOString() }, TPS: { status: 'ok', fetchedAt: now.toISOString() } }
  }));
  const result = await publishIncidents({
    outputPath, now,
    etl: assert.fail, sink: assert.fail, log: () => { }
  });
  assert.deepEqual(result, { updated: false, committed: false });
});

test('the incident phase runs the ETL and publishes a stale snapshot', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'incident-phase-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const outputPath = join(dir, 'current.json');
  await writeFile(outputPath, JSON.stringify({ fetchedAt: '2026-10-06T11:00:00Z' }));
  const calls = [];
  const result = await publishIncidents({
    outputPath, now, updatedBy: 'concourse',
    etl: async options => { calls.push(['etl', options.updatedBy]); },
    sink: async ({ key, body }) => { calls.push(['publish', key, body]); return { changed: true }; },
    log: () => { }
  });
  assert.deepEqual(result, { updated: true, committed: true });
  assert.deepEqual(calls, [['etl', 'concourse'], ['publish', 'data/current.json', '{"fetchedAt":"2026-10-06T11:00:00Z"}']]);
});

test('the incident phase reports an unchanged snapshot without a write', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'incident-phase-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const outputPath = join(dir, 'current.json');
  await writeFile(outputPath, JSON.stringify({ fetchedAt: '2026-10-06T11:00:00Z' }));
  const result = await publishIncidents({
    outputPath, now,
    etl: async () => { }, sink: async () => ({ changed: false }), log: () => { }
  });
  assert.deepEqual(result, { updated: true, committed: false });
});

test('the incident phase treats a missing snapshot as needing an update', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'incident-phase-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const outputPath = join(dir, 'missing.json');
  let ran = false;
  const result = await publishIncidents({
    outputPath, now,
    // The real ETL writes the snapshot; the stub must too, because the phase
    // reads the produced bytes and hands them to the sink.
    etl: async () => { ran = true; await writeFile(outputPath, '{"fetchedAt":"2026-10-06T12:00:00Z"}'); },
    sink: async () => ({ changed: true }), log: () => { }
  });
  assert.equal(ran, true);
  assert.equal(result.updated, true);
});

test('the incident phase defaults every option when called with no arguments', async t => {
  // Exercises the default output path, updater identity, clock, and logger. A
  // fresh default snapshot returns early, so the default R2 sink is never built.
  const dir = await mkdtemp(join(tmpdir(), 'incident-defaults-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'data'), { recursive: true });
  const live = new Date().toISOString();
  await writeFile(join(dir, 'data/current.json'), JSON.stringify({
    fetchedAt: live,
    feeds: { TFS: { status: 'ok', fetchedAt: live }, TPS: { status: 'ok', fetchedAt: live } }
  }));
  const previous = process.cwd();
  process.chdir(dir);
  try {
    const result = await publishIncidents();
    assert.deepEqual(result, { updated: false, committed: false });
  } finally {
    process.chdir(previous);
  }
});

test('the incident phase surfaces a non-missing read error', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'incident-phase-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  // A directory at the output path makes readFile fail with EISDIR, not ENOENT.
  const outputPath = join(dir, 'current.json');
  await mkdir(outputPath);
  await assert.rejects(publishIncidents({ outputPath, now, log: () => { } }));
});

// --- TTC geometry publication phase -----------------------------------------

test('the TTC phase publishes changed geometry through the sink', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ttc-phase-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const sourcePath = join(dir, 'diversions.json');
  await writeFile(sourcePath, JSON.stringify(confirmedDiversionOutput()));
  const sink = createLocalSink({ dir });
  const result = await publishTtcPhase({ sourcePath, sink, log: () => { } });
  assert.deepEqual(result, { committed: true });
  const written = JSON.parse(await readFile(join(dir, 'data/ttc-diversions.json'), 'utf8'));
  assert.equal(written.diversions.length, 1);
  assert.equal(written.diversions[0].status, 'confirmed');
  assert.equal(written.diversions[0].geometrySource, 'sirento-observed');
});

test('the TTC phase reports no change when the geometry is unchanged', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ttc-phase-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const sourcePath = join(dir, 'diversions.json');
  await writeFile(sourcePath, JSON.stringify({ schemaVersion: 1, staticVersion: staticIndex().version, status: 'ok', checkedAt: now.toISOString(), diversions: [] }));
  const sink = createLocalSink({ dir });
  // Seed the identical published artifact so the second write is unchanged.
  await sink({ key: 'data/ttc-diversions.json', body: `${JSON.stringify({ schemaVersion: 1, status: 'ok', checkedAt: now.toISOString(), diversions: [] })}\n` });
  const result = await publishTtcPhase({ sourcePath, sink, log: () => { } });
  assert.deepEqual(result, { committed: false });
});

test('the TTC phase builds the default R2 sink from the environment', async t => {
  // No injected sink: the phase must build the R2 sink from the environment. Stub
  // the global fetch with an in-memory R2 stand-in so no network is touched.
  const dir = await mkdtemp(join(tmpdir(), 'ttc-r2-default-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const sourcePath = join(dir, 'diversions.json');
  await writeFile(sourcePath, JSON.stringify({ schemaVersion: 1, staticVersion: staticIndex().version, status: 'ok', checkedAt: now.toISOString(), diversions: [] }));
  const store = new Map();
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    const { pathname } = new URL(url);
    if (method === 'GET') {
      if (!store.has(pathname)) return { ok: false, status: 404, async text() { return ''; } };
      return { ok: true, status: 200, async text() { return store.get(pathname); } };
    }
    store.set(pathname, options.body);
    return { ok: true, status: 200, async text() { return ''; } };
  };
  const saved = {};
  for (const [key, value] of Object.entries(r2Env)) { saved[key] = process.env[key]; process.env[key] = value; }
  try {
    const result = await publishTtcPhase({ sourcePath, log: () => { } });
    assert.deepEqual(result, { committed: true });
    assert.ok(store.has('/sirento/data/ttc-diversions.json'));
  } finally {
    globalThis.fetch = original;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('the TTC phase defaults its source path when called with no arguments', async t => {
  // No TTC_DIVERSION_OUTPUT: the phase falls back to the cache path. The sink is
  // injected so the default R2 sink is never built.
  const dir = await mkdtemp(join(tmpdir(), 'ttc-defaults-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, '.cache/ttc'), { recursive: true });
  await writeFile(join(dir, '.cache/ttc/diversions.json'), JSON.stringify({ schemaVersion: 1, staticVersion: staticIndex().version, status: 'ok', checkedAt: now.toISOString(), diversions: [] }));
  const previous = process.cwd();
  process.chdir(dir);
  try {
    const result = await publishTtcPhase({ sink: createLocalSink({ dir }), log: () => { } });
    assert.deepEqual(result, { committed: true });
  } finally {
    process.chdir(previous);
  }
});

test('isDirectInvocation detects the process entry point', () => {
  const moduleUrl = 'file:///workspace/scripts/publish-ttc-phase.js';
  assert.equal(isDirectInvocation({ argv1: '/workspace/scripts/publish-ttc-phase.js', moduleUrl }), true);
  assert.equal(isDirectInvocation({ argv1: '/workspace/scripts/other.js', moduleUrl }), false);
  assert.equal(isDirectInvocation({ argv1: '', moduleUrl }), false);
  assert.equal(isDirectInvocation({ argv1: undefined, moduleUrl }), false);
});

test('runTtcPhaseCli prints the committed and no-change verdicts', async () => {
  const lines = [];
  const log = line => lines.push(line);
  assert.deepEqual(await runTtcPhaseCli({ publish: async () => ({ committed: true }), log }), { committed: true });
  assert.deepEqual(await runTtcPhaseCli({ publish: async () => ({ committed: false }), log }), { committed: false });
  assert.deepEqual(lines, ['TTC geometry committed', 'No TTC geometry changes to commit']);
});

// --- CLI entry points -------------------------------------------------------

// Stub the network so the real ETL runs against deterministic empty sources and
// the R2 sink talks to an in-memory stand-in. Each upstream feed needs a shape
// its parser accepts: valid TFS XML, the TPS ArcGIS id/feature pages, the
// road-restriction JSON envelope, and a fresh TTC text-proto header. The R2
// stand-in answers GET with 404 (so the first write is always "changed") and PUT
// with 200.
const fetchPreload = `const store = new Map();
globalThis.fetch = async (url, options = {}) => {
  const method = options.method || 'GET';
  if (url.includes('r2.cloudflarestorage.com')) {
    const { pathname } = new URL(url);
    if (method === 'GET') {
      if (!store.has(pathname)) return { ok: false, status: 404, async text() { return ''; } };
      return { ok: true, status: 200, async text() { return store.get(pathname); } };
    }
    store.set(pathname, options.body);
    return { ok: true, status: 200, async text() { return ''; } };
  }
  const now = Math.floor(Date.now() / 1000);
  const body = {
    xml: '<tfs_active_incidents><update_from_db_time></update_from_db_time></tfs_active_incidents>',
    tps: JSON.stringify(url.includes('returnIdsOnly') ? { objectIds: [] } : { features: [] }),
    roads: JSON.stringify({ Closure: [] }),
    ttc: 'header { gtfs_realtime_version: "2.0" timestamp: ' + now + ' incrementality: FULL_DATASET }'
  };
  const text = url.includes('livecad.xml') ? body.xml
    : url.includes('arcgis') ? body.tps
    : url.includes('road_restrictions') ? body.roads
    : body.ttc;
  return { ok: true, status: 200, async text() { return text; }, async json() { return JSON.parse(text); } };
};`;

const r2Env = {
  R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
  R2_BUCKET: 'sirento',
  R2_ACCESS_KEY_ID: 'AKIDEXAMPLE',
  R2_SECRET_ACCESS_KEY: 'secret'
};

test('the incident CLI reports a fresh skip', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'incident-cli-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'data'), { recursive: true });
  const live = new Date().toISOString();
  await writeFile(join(dir, 'data/current.json'), JSON.stringify({
    fetchedAt: live,
    feeds: { TFS: { status: 'ok', fetchedAt: live }, TPS: { status: 'ok', fetchedAt: live } }
  }));
  const script = join(process.cwd(), 'scripts/publish-incidents.js');
  const env = { ...process.env, ...r2Env, TFS_OUTPUT: join(dir, 'data/current.json') };
  const out = execFileSync(process.execPath, [script], { cwd: dir, encoding: 'utf8', env });
  assert.match(out, /fresh; skipped/);
});

test('the incident CLI uses default paths and reports a fresh skip', async t => {
  // No TFS_OUTPUT: the CLI falls back to data/current.json and cwd.
  const dir = await mkdtemp(join(tmpdir(), 'incident-cli-default-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'data'), { recursive: true });
  const live = new Date().toISOString();
  await writeFile(join(dir, 'data/current.json'), JSON.stringify({
    fetchedAt: live,
    feeds: { TFS: { status: 'ok', fetchedAt: live }, TPS: { status: 'ok', fetchedAt: live } }
  }));
  const script = join(process.cwd(), 'scripts/publish-incidents.js');
  const env = { ...process.env, ...r2Env };
  delete env.TFS_OUTPUT;
  const out = execFileSync(process.execPath, [script], { cwd: dir, encoding: 'utf8', env });
  assert.match(out, /fresh; skipped/);
});

test('the incident CLI publishes a stale snapshot to R2 and reports it', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'incident-cli-commit-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'data'), { recursive: true });
  await writeFile(join(dir, 'data/current.json'), JSON.stringify({ fetchedAt: '2026-10-06T11:00:00Z', incidents: [] }));
  const preload = join(dir, 'fetch.mjs');
  await writeFile(preload, fetchPreload);
  const script = join(process.cwd(), 'scripts/publish-incidents.js');
  const env = { ...process.env, ...r2Env, TFS_OUTPUT: join(dir, 'data/current.json'), TFS_UPDATED_BY: 'concourse' };
  const out = execFileSync(process.execPath, ['--import', preload, script], { cwd: dir, encoding: 'utf8', env });
  assert.match(out, /Incident snapshot updated/);
});

test('the incident CLI fails loudly without R2 credentials', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'incident-cli-nocreds-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'data'), { recursive: true });
  await writeFile(join(dir, 'data/current.json'), JSON.stringify({ fetchedAt: '2026-10-06T11:00:00Z', incidents: [] }));
  const script = join(process.cwd(), 'scripts/publish-incidents.js');
  const env = { ...process.env, TFS_OUTPUT: join(dir, 'data/current.json') };
  for (const key of Object.keys(r2Env)) delete env[key];
  assert.throws(
    () => execFileSync(process.execPath, [script], { cwd: dir, encoding: 'utf8', env, stdio: 'pipe' }),
    /R2 publication requires/
  );
});

test('the TTC CLI publishes changed geometry to R2 and reports it', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ttc-cli-commit-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const sourcePath = join(dir, 'diversions.json');
  await writeFile(sourcePath, JSON.stringify(confirmedDiversionOutput()));
  const preload = join(dir, 'fetch.mjs');
  await writeFile(preload, fetchPreload);
  const script = join(process.cwd(), 'scripts/publish-ttc-phase.js');
  const env = { ...process.env, ...r2Env, TTC_DIVERSION_OUTPUT: sourcePath };
  const out = execFileSync(process.execPath, ['--import', preload, script], { cwd: dir, encoding: 'utf8', env });
  assert.match(out, /TTC geometry committed/);
});

test('the TTC CLI uses the default source path and publishes to R2', async t => {
  // No TTC_DIVERSION_OUTPUT: the CLI falls back to the cache path. The R2
  // stand-in is a fresh process, so the first write is always "changed".
  const dir = await mkdtemp(join(tmpdir(), 'ttc-cli-default-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, '.cache/ttc'), { recursive: true });
  await writeFile(join(dir, '.cache/ttc/diversions.json'), JSON.stringify({ schemaVersion: 1, staticVersion: staticIndex().version, status: 'ok', checkedAt: now.toISOString(), diversions: [] }));
  const preload = join(dir, 'fetch.mjs');
  await writeFile(preload, fetchPreload);
  const script = join(process.cwd(), 'scripts/publish-ttc-phase.js');
  const env = { ...process.env, ...r2Env };
  delete env.TTC_DIVERSION_OUTPUT;
  const out = execFileSync(process.execPath, ['--import', preload, script], { cwd: dir, encoding: 'utf8', env });
  assert.match(out, /TTC geometry committed/);
});
