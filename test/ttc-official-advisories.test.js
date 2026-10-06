// Story 51B — Shared Official-Advisory Contract & Pipeline Input.
//
// The official TTC Service Changes live in the snapshot under
// `disruptions.transit`. Story 30's vehicle inference runs in a separate process
// that never sees that snapshot. This suite pins the smallest source-qualified
// advisory contract derived from the already-normalized feed, its strict
// validation, and the local/GitHub/Concourse wiring that hands the same input to
// inference. It also proves the increment supplies advisory context only: no
// geometry association and no UI change.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  OFFICIAL_ADVISORY_SOURCE,
  OFFICIAL_ADVISORY_SCHEMA_VERSION,
  OFFICIAL_ADVISORY_POLICY,
  advisoryRef,
  officialAdvisories,
  validateOfficialAdvisories,
  loadOfficialAdvisories
} from '../src/ttc/official-advisories.js';
import { inferDiversions, validateDiversionOutput } from '../src/ttc/diversion-inference.js';
import { parseTtcVehicles } from '../src/ttc/vehicle-feed.js';
import { detectVehicles } from '../src/ttc/vehicle-detector.js';
import { runVehiclePolling, advisorySummary, cacheSummary, continuitySummary, CACHE_DISPOSITIONS } from '../scripts/ttc-vehicles.js';
import { at, vehicle, protobuf, staticIndex } from './fixtures/ttc-vehicles/builders.js';
import { officialServiceChangeFeed, emptyGtfsAlerts, BASELINE_EPOCH, baselineAt, baselineStaticIndex, observedEastboundDiversion, vehicle as baselineVehicle, protobuf as baselineProtobuf } from './fixtures/ttc-official-advisory/baseline.js';

const index = staticIndex();

// A minimal normalized `disruptions.transit` feed shaped like the snapshot.
function transitFeed(overrides = {}) {
  return {
    items: [{
      id: '102',
      title: '94 Wellesley – Temporary route change',
      description: 'eastbound via Jarvis',
      effect: 'MODIFIED SERVICE',
      routes: ['94'],
      stopIds: [],
      affectedEntities: [{ routeId: '94', stopId: null }],
      periods: [{ start: BASELINE_EPOCH - 1000000, end: BASELINE_EPOCH + 100000000 }],
      url: 'https://www.ttc.ca/service-advisories/all-service-alerts'
    }],
    status: 'ok',
    checkedAt: new Date(BASELINE_EPOCH).toISOString(),
    fetchedAt: new Date(BASELINE_EPOCH).toISOString(),
    sourceUpdatedAt: new Date(BASELINE_EPOCH).toISOString(),
    ...overrides
  };
}

test('advisory contract derives stable source-qualified identity and provenance', () => {
  const contract = officialAdvisories({ transit: transitFeed() });
  assert.equal(contract.schemaVersion, OFFICIAL_ADVISORY_SCHEMA_VERSION);
  assert.equal(contract.source, OFFICIAL_ADVISORY_SOURCE);
  assert.equal(contract.status, 'ok');
  assert.equal(contract.advisories.length, 1);
  const [advisory] = contract.advisories;
  // Stable, source-qualified reference keeps official ids distinct from GTFS-RT.
  assert.equal(advisory.ref, 'ttc-service-change:102');
  assert.equal(advisory.ref, advisoryRef('102'));
  assert.equal(advisory.source, OFFICIAL_ADVISORY_SOURCE);
  assert.equal(advisory.sourceId, '102');
  // TTC provenance, routes, title/effect/URL are preserved verbatim.
  assert.equal(advisory.title, '94 Wellesley – Temporary route change');
  assert.equal(advisory.effect, 'MODIFIED SERVICE');
  assert.equal(advisory.url, 'https://www.ttc.ca/service-advisories/all-service-alerts');
  assert.deepEqual(advisory.routeIds, ['94']);
  // Active periods are normalized to ISO half-open bounds.
  assert.equal(advisory.activePeriods.length, 1);
  assert.equal(advisory.activePeriods[0].start, new Date(BASELINE_EPOCH - 1000000).toISOString());
  assert.equal(advisory.activePeriods[0].end, new Date(BASELINE_EPOCH + 100000000).toISOString());
});

test('advisory contract never derives geometry or direction from prose', () => {
  const contract = officialAdvisories({ transit: transitFeed() });
  const [advisory] = contract.advisories;
  assert.equal(advisory.geometry, undefined);
  assert.equal(advisory.line, undefined);
  assert.equal(advisory.coordinates, undefined);
  assert.equal(advisory.directionId, undefined);
  // The free-form description is not carried into the contract at all.
  assert.equal(advisory.description, undefined);
});

test('successful empty feed is distinct from unavailable and not-loaded', () => {
  const empty = officialAdvisories({ transit: transitFeed({ items: [] }) });
  assert.equal(empty.status, 'ok');
  assert.deepEqual(empty.advisories, []);
  // Retained items with an unavailable source keep the items but flag the source.
  const unavailable = officialAdvisories({ transit: transitFeed({ status: 'unavailable' }) });
  assert.equal(unavailable.status, 'unavailable');
  assert.equal(unavailable.advisories.length, 1);
  // No feed at all is not-loaded, not an error.
  const missing = officialAdvisories(undefined);
  assert.equal(missing.status, 'not-loaded');
  assert.deepEqual(missing.advisories, []);
  assert.equal(missing.checkedAt, null);
});

test('advisories are sorted deterministically and drop records without an id', () => {
  const feed = transitFeed({
    items: [
      { id: 'b', title: 'B', effect: 'DETOUR', routes: ['2'], periods: [], url: null },
      { id: 'a', title: 'A', effect: 'DETOUR', routes: ['1'], periods: [], url: null },
      { title: 'no id', effect: 'DETOUR', routes: [], periods: [] }
    ]
  });
  const contract = officialAdvisories({ transit: feed });
  assert.deepEqual(contract.advisories.map(a => a.ref), ['ttc-service-change:a', 'ttc-service-change:b']);
});

test('partial and malformed advisory fields fall back safely without inventing data', () => {
  const feed = transitFeed({
    items: [
      // Missing periods, non-string title/effect, non-string url, invalid routes.
      { id: 'partial', title: 5, effect: null, url: 7, routes: ['94', '94'], periods: undefined },
      // Periods with non-finite bounds and equal starts exercise the sort fallback.
      { id: 'periods', title: 'P', effect: 'DETOUR', routes: ['1'], url: null, periods: [{ start: null, end: null }, { start: null, end: null }] }
    ]
  });
  const contract = officialAdvisories({ transit: feed });
  const partial = contract.advisories.find(a => a.sourceId === 'partial');
  assert.equal(partial.title, '');
  assert.equal(partial.effect, '');
  assert.equal(partial.url, null);
  assert.deepEqual(partial.routeIds, []);
  assert.deepEqual(partial.activePeriods, []);
  const periods = contract.advisories.find(a => a.sourceId === 'periods');
  assert.deepEqual(periods.activePeriods, [{ start: null, end: null }, { start: null, end: null }]);
});

test('advisory contract is deterministic across repeated construction', () => {
  const a = officialAdvisories({ transit: transitFeed() });
  const b = officialAdvisories({ transit: transitFeed() });
  assert.deepEqual(a, b);
});

test('validation accepts a well-formed contract and rejects malformed records', () => {
  const contract = officialAdvisories({ transit: transitFeed() });
  assert.equal(validateOfficialAdvisories(contract), contract);
  const mutations = [
    c => { c.schemaVersion = 2; },
    c => { c.source = 'other'; },
    c => { c.status = 'weird'; },
    c => { c.checkedAt = 'today'; },
    c => { c.advisories = 'nope'; },
    c => { c.advisories[0].ref = 'ttc-service-change:999'; },
    c => { c.advisories[0].source = 'ttc-gtfs-rt'; },
    c => { c.advisories[0].sourceId = ''; },
    c => { c.advisories[0].title = 5; },
    c => { c.advisories[0].effect = 5; },
    c => { c.advisories[0].url = 5; },
    c => { c.advisories[0].routeIds = ['94', '94']; },
    c => { c.advisories[0].activePeriods = [{ start: 'bad', end: null }]; },
    c => { c.advisories[0].activePeriods = [{ start: '2026-10-05T20:00:00.000Z', end: '2026-10-05T19:00:00.000Z' }]; },
    c => { c.advisories.push({ ...c.advisories[0] }); }
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(contract);
    mutate(copy);
    assert.throws(() => validateOfficialAdvisories(copy), /official advisory/);
  }
});

test('validation rejects an oversized advisory artifact', () => {
  const contract = officialAdvisories({ transit: transitFeed() });
  contract.advisories[0].title = 'x'.repeat(OFFICIAL_ADVISORY_POLICY.maxArtifactBytes + 1);
  assert.throws(() => validateOfficialAdvisories(contract), /official advisory/);
});

test('loadOfficialAdvisories reads a snapshot path and treats a missing file as not-loaded', async () => {
  const dir = await mkdtemp(`${tmpdir()}/ttc-advisory-`);
  try {
    const path = `${dir}/current.json`;
    await writeFile(path, JSON.stringify({ disruptions: { transit: transitFeed() } }));
    const loaded = await loadOfficialAdvisories(path, { readFile });
    assert.equal(loaded.status, 'ok');
    assert.equal(loaded.advisories[0].ref, 'ttc-service-change:102');
    // A missing file is a not-loaded contract, never an error.
    const missing = await loadOfficialAdvisories(`${dir}/absent.json`, { readFile });
    assert.equal(missing.status, 'not-loaded');
    // No path at all is also not-loaded.
    assert.equal((await loadOfficialAdvisories(undefined, { readFile })).status, 'not-loaded');
    // A malformed snapshot surfaces the parse error rather than fabricating data.
    await writeFile(`${dir}/bad.json`, 'not json');
    await assert.rejects(loadOfficialAdvisories(`${dir}/bad.json`, { readFile }), SyntaxError);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('advisorySummary reports bounded counts and routes without raw text', () => {
  const contract = officialAdvisories({ transit: transitFeed() });
  const summary = advisorySummary(contract);
  assert.equal(summary.source, 'ttc-official-advisories');
  assert.equal(summary.status, 'ok');
  assert.equal(summary.count, 1);
  assert.deepEqual(summary.routes, ['94']);
  assert.doesNotMatch(JSON.stringify(summary), /Wellesley|Jarvis/);
  // A missing contract falls back safely.
  const missing = advisorySummary(undefined);
  assert.equal(missing.status, 'not-loaded');
  assert.equal(missing.count, 0);
  assert.deepEqual(missing.routes, []);
});

test('inferDiversions accepts and validates advisory context without associating geometry', () => {
  const contract = officialAdvisories({ transit: transitFeed() });
  // Build a real, schema-valid vehicle state through the detector.
  let vehicles;
  for (const seconds of [0, 30, 60]) {
    const feed = parseTtcVehicles(protobuf([vehicle(seconds)], seconds), at(seconds));
    vehicles = detectVehicles(vehicles, feed, index, at(seconds)).state;
  }
  const result = inferDiversions(undefined, vehicles, index, at(60), undefined, { advisories: contract });
  assert.equal(result.report.officialAdvisories, 1);
  // Advisory context is counted but never attached to a record in this increment.
  for (const record of result.state.records) assert.equal(record.relatedAlertIds.includes('ttc-service-change:102'), false);
});

test('inferDiversions rejects a malformed advisory contract', () => {
  const bad = { schemaVersion: 1, source: 'ttc-service-change', status: 'ok', checkedAt: null, sourceUpdatedAt: null, fetchedAt: null, advisories: [{ ref: 'x' }] };
  assert.throws(() => inferDiversions(undefined, { schemaVersion: 1, staticVersion: index.version, status: 'ok', checkedAt: at(0).toISOString(), fetchedAt: at(0).toISOString(), sourceUpdatedAt: null, tracks: [] }, index, at(0), undefined, { advisories: bad }), /official advisory/);
});

test('runVehiclePolling loads advisory context from a snapshot path and logs a bounded summary', async () => {
  const dir = await mkdtemp(`${tmpdir()}/ttc-advisory-poll-`);
  try {
    const snapshotPath = `${dir}/current.json`;
    await writeFile(snapshotPath, JSON.stringify({ disruptions: { transit: transitFeed() } }));
    const logs = [];
    const fixture = [0, 30, 60].map(s => ({ now: at(s).toISOString(), protobufBase64: Buffer.from(protobuf([vehicle(s)], s)).toString('base64') }));
    await runVehiclePolling({
      polls: 3, fixture, loadStatic: async () => ({ index }), clock: () => at(0), wait: async () => { },
      log: entry => logs.push(entry), advisoryPath: snapshotPath,
      statePath: `${dir}/state.json`, outputPath: `${dir}/output.json`
    });
    const summary = logs.find(entry => entry.source === 'ttc-official-advisories');
    assert.ok(summary, 'advisory summary must be logged');
    assert.equal(summary.status, 'ok');
    assert.equal(summary.count, 1);
    assert.deepEqual(summary.routes, ['94']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runVehiclePolling tolerates a missing advisory input and a rejected contract', async () => {
  const dir = await mkdtemp(`${tmpdir()}/ttc-advisory-missing-`);
  try {
    const logs = [];
    const fixture = [0, 30, 60].map(s => ({ now: at(s).toISOString(), protobufBase64: Buffer.from(protobuf([vehicle(s)], s)).toString('base64') }));
    // Missing path: not-loaded, no error.
    await runVehiclePolling({
      polls: 3, fixture, loadStatic: async () => ({ index }), clock: () => at(0), wait: async () => { },
      log: entry => logs.push(entry), advisoryPath: `${dir}/absent.json`,
      statePath: `${dir}/state.json`, outputPath: `${dir}/output.json`,
      inferenceStatePath: `${dir}/inference.json`, inferenceOutputPath: `${dir}/diversions.json`
    });
    assert.equal(logs.find(entry => entry.source === 'ttc-official-advisories').status, 'not-loaded');
    // A loader that throws is logged as rejected and falls back to not-loaded.
    const rejected = [];
    await runVehiclePolling({
      polls: 3, fixture, loadStatic: async () => ({ index }), clock: () => at(0), wait: async () => { },
      log: entry => rejected.push(entry), advisoryPath: `${dir}/absent.json`,
      loadAdvisories: async () => { throw new Error('boom'); },
      statePath: `${dir}/state2.json`, outputPath: `${dir}/output2.json`,
      inferenceStatePath: `${dir}/inference2.json`, inferenceOutputPath: `${dir}/diversions2.json`
    });
    assert.ok(rejected.some(entry => entry.source === 'ttc-official-advisories' && entry.status === 'rejected'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runVehiclePolling passes advisory context into infer-only inference', async () => {
  const dir = await mkdtemp(`${tmpdir()}/ttc-advisory-infer-`);
  try {
    const snapshotPath = `${dir}/current.json`;
    await writeFile(snapshotPath, JSON.stringify({ disruptions: { transit: transitFeed() } }));
    const saved = { schemaVersion: 1, staticVersion: index.version, status: 'ok', checkedAt: at(0).toISOString(), fetchedAt: at(0).toISOString(), sourceUpdatedAt: null, tracks: [] };
    await writeFile(`${dir}/vehicle.json`, JSON.stringify(saved));
    const logs = [];
    await runVehiclePolling({
      inferOnly: true, loadStatic: async () => ({ index }), clock: () => at(0), log: entry => logs.push(entry),
      advisoryPath: snapshotPath, statePath: `${dir}/vehicle.json`, outputPath: `${dir}/output.json`,
      inferenceStatePath: `${dir}/inference.json`, inferenceOutputPath: `${dir}/diversions.json`
    });
    assert.equal(logs.find(entry => entry.source === 'ttc-official-advisories').count, 1);
    const inferenceLog = logs.find(entry => entry.source === 'ttc-diversions');
    assert.equal(inferenceLog.officialAdvisories, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Story 51E — Cache/Continuity Diagnostics & Evidence-Based Hardening.
//
// These tests pin the bounded, privacy-safe diagnostics that explain "why was no
// path produced?" from counts and fixed reason keys only, never raw fleet history,
// cache contents, episode collections, or advisory text.
// ---------------------------------------------------------------------------

test('cacheSummary reports a fixed disposition and bounded counts only', () => {
  assert.deepEqual(CACHE_DISPOSITIONS, ['restored', 'missing', 'rejected', 'incompatible']);
  assert.deepEqual(cacheSummary('ttc-vehicles-cache', 'restored', { staticVersion: 'v1', loaded: 3 }),
    { source: 'ttc-vehicles-cache', status: 'restored', staticVersion: 'v1', loaded: 3 });
  // Defaults are bounded and never leak cache contents.
  assert.deepEqual(cacheSummary('ttc-diversions-cache', 'missing'),
    { source: 'ttc-diversions-cache', status: 'missing', staticVersion: null, loaded: 0 });
});

test('continuitySummary reports bounded lifecycle counts and fixed reason keys', () => {
  const summary = continuitySummary({
    vehicleState: { status: 'ok' },
    vehicleReport: { tracksLoaded: 2, tracksCreated: 1, tracksRetained: 3, resets: 1, expired: 0, graceStarted: 1, graceContinued: 2, graceCleared: 1, graceExpired: 0, graceRefusedAbsent: 0, graceRefusedConflict: 1, graceRefusedStale: 0, graceRefusedIncompatible: 1 },
    vehicleCache: { status: 'restored', staticVersion: 'v1' },
    inferenceCache: { status: 'incompatible', staticVersion: 'v0' },
    inferenceReport: { episodesLoaded: 2, episodesCreated: 1, episodesRetained: 3, episodesClosed: 1, episodesExpired: 0, advisoryAssociated: 1, advisoryAmbiguous: 0, candidate: 1, likely: 1, confirmed: 1 },
    advisories: { status: 'ok', advisories: [{ routeIds: ['94'] }] },
    state: { records: [{ status: 'confirmed' }, { status: 'candidate' }] }
  });
  assert.equal(summary.source, 'ttc-continuity');
  assert.equal(summary.vehicleSource, 'ok');
  assert.equal(continuitySummary({ vehicleState: { status: 'unavailable' }, vehicleReport: { status: 'ok' } }).vehicleSource, 'unavailable');
  assert.equal(summary.vehicleCache, 'restored');
  assert.equal(summary.inferenceCache, 'incompatible');
  assert.equal(summary.vehicleStaticVersion, 'v1');
  assert.equal(summary.inferenceStaticVersion, 'v0');
  assert.equal(summary.tracksLoaded, 2);
  assert.equal(summary.tracksRetained, 3);
  assert.equal(summary.graceRefusedConflict, 1);
  assert.equal(summary.graceRefusedIncompatible, 1);
  assert.equal(summary.episodesRetained, 3);
  assert.equal(summary.advisoryCount, 1);
  assert.equal(summary.advisoryAssociated, 1);
  assert.equal(summary.published, 1);
  // A missing report and missing caches fall back to bounded defaults.
  const empty = continuitySummary({});
  assert.equal(empty.vehicleSource, 'unavailable');
  assert.equal(empty.vehicleCache, 'missing');
  assert.equal(empty.inferenceCache, 'missing');
  assert.equal(empty.tracksLoaded, 0);
  assert.equal(empty.published, 0);
  assert.equal(empty.advisorySource, 'not-loaded');
});

test('runVehiclePolling logs cache disposition and a continuity summary without raw evidence', async () => {
  const dir = await mkdtemp(`${tmpdir()}/ttc-continuity-`);
  try {
    const fixture = [0, 30, 60].map(s => ({ now: at(s).toISOString(), protobufBase64: Buffer.from(protobuf([vehicle(s)], s)).toString('base64') }));
    const options = { polls: 3, fixture, loadStatic: async () => ({ index }), clock: () => at(0), wait: async () => { },
      statePath: `${dir}/state.json`, outputPath: `${dir}/output.json`, inferenceStatePath: `${dir}/inf.json`, inferenceOutputPath: `${dir}/div.json` };
    // First run: no cache exists, so both caches are reported missing.
    const first = [];
    await runVehiclePolling({ ...options, log: entry => first.push(entry) });
    assert.equal(first.find(e => e.source === 'ttc-vehicles-cache').status, 'missing');
    assert.equal(first.find(e => e.source === 'ttc-diversions-cache').status, 'missing');
    const continuity = first.find(e => e.source === 'ttc-continuity');
    assert.ok(continuity, 'continuity summary must be logged');
    assert.equal(continuity.vehicleSource, 'ok');
    assert.equal(continuity.vehicleCache, 'missing');
    assert.equal(continuity.tracksRetained, 1);
    // The summary never leaks raw fleet history, cache contents, or advisory text.
    assert.doesNotMatch(JSON.stringify(continuity), /vehicleId|history|latitude|longitude|Wellesley|Jarvis/);
    // Second run restores both caches; advance the clock so cached evidence stays fresh.
    const second = [];
    const later = [90, 120, 150].map(s => ({ now: at(s).toISOString(), protobufBase64: Buffer.from(protobuf([vehicle(s)], s)).toString('base64') }));
    await runVehiclePolling({ ...options, fixture: later, clock: () => at(90), log: entry => second.push(entry) });
    assert.equal(second.find(e => e.source === 'ttc-vehicles-cache').status, 'restored');
    assert.equal(second.find(e => e.source === 'ttc-diversions-cache').status, 'restored');
    assert.equal(second.find(e => e.source === 'ttc-continuity').vehicleCache, 'restored');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runVehiclePolling reports an incompatible cache when the static version changes', async () => {
  const dir = await mkdtemp(`${tmpdir()}/ttc-incompatible-`);
  try {
    const fixture = [0, 30, 60].map(s => ({ now: at(s).toISOString(), protobufBase64: Buffer.from(protobuf([vehicle(s)], s)).toString('base64') }));
    const options = { polls: 3, fixture, loadStatic: async () => ({ index }), clock: () => at(0), wait: async () => { },
      statePath: `${dir}/state.json`, outputPath: `${dir}/output.json`, inferenceStatePath: `${dir}/inf.json`, inferenceOutputPath: `${dir}/div.json` };
    await runVehiclePolling({ ...options, log: () => { } });
    // Corrupt both persisted static versions so neither restored cache can be reused.
    const state = JSON.parse(await readFile(`${dir}/state.json`, 'utf8'));
    state.staticVersion = 'stale-version';
    await writeFile(`${dir}/state.json`, JSON.stringify(state));
    const inference = JSON.parse(await readFile(`${dir}/inf.json`, 'utf8'));
    inference.staticVersion = 'stale-version';
    await writeFile(`${dir}/inf.json`, JSON.stringify(inference));
    const logs = [];
    const later = [90, 120, 150].map(s => ({ now: at(s).toISOString(), protobufBase64: Buffer.from(protobuf([vehicle(s)], s)).toString('base64') }));
    await runVehiclePolling({ ...options, fixture: later, clock: () => at(90), log: entry => logs.push(entry) });
    assert.equal(logs.find(e => e.source === 'ttc-vehicles-cache').status, 'incompatible');
    assert.equal(logs.find(e => e.source === 'ttc-diversions-cache').status, 'incompatible');
    assert.equal(logs.find(e => e.source === 'ttc-continuity').vehicleCache, 'incompatible');
    assert.equal(logs.find(e => e.source === 'ttc-continuity').inferenceCache, 'incompatible');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runVehiclePolling reports a rejected cache without crashing', async () => {
  const dir = await mkdtemp(`${tmpdir()}/ttc-rejected-`);
  try {
    const fixture = [0, 30, 60].map(s => ({ now: at(s).toISOString(), protobufBase64: Buffer.from(protobuf([vehicle(s)], s)).toString('base64') }));
    await writeFile(`${dir}/state.json`, 'not json');
    await writeFile(`${dir}/inf.json`, 'not json');
    const logs = [];
    await runVehiclePolling({ polls: 3, fixture, loadStatic: async () => ({ index }), clock: () => at(0), wait: async () => { },
      log: entry => logs.push(entry), statePath: `${dir}/state.json`, outputPath: `${dir}/output.json`,
      inferenceStatePath: `${dir}/inf.json`, inferenceOutputPath: `${dir}/div.json` });
    assert.equal(logs.find(e => e.source === 'ttc-vehicles-cache').status, 'rejected');
    assert.equal(logs.find(e => e.source === 'ttc-diversions-cache').status, 'rejected');
    assert.ok(logs.some(e => e.source === 'ttc-vehicles' && e.status === 'cache-rejected'));
    assert.ok(logs.some(e => e.source === 'ttc-diversions' && e.status === 'cache-rejected'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the GitHub workflow reuses the updated snapshot as advisory context and drops the stale comment', async () => {
  const workflow = await readFile(new URL('../.github/workflows/update-sirento.yml', import.meta.url), 'utf8');
  assert.match(workflow, /--advisory data\/current\.json/);
  assert.doesNotMatch(workflow, /Fresh state per run/);
  // The snapshot is copied into place before the vehicle step, so the advisory
  // input is the already-updated data/current.json.
  const copyIndex = workflow.indexOf('cp snapshot-data/data/current.json data/current.json');
  const vehicleIndex = workflow.indexOf('--advisory data/current.json');
  assert.ok(copyIndex >= 0 && vehicleIndex > copyIndex, 'snapshot must be copied before the vehicle step');
});

test('the Concourse vehicle task receives the preceding incident snapshot as advisory input', async () => {
  const task = await readFile(new URL('../concourse/ttc-vehicles.yml', import.meta.url), 'utf8');
  assert.match(task, /- name: incident-repo/);
  assert.match(task, /--advisory incident-repo\/data\/current\.json/);
  const pipeline = await readFile(new URL('../concourse/pipeline.yml', import.meta.url), 'utf8');
  // The preceding task produces incident-repo, which the vehicle task consumes.
  assert.match(pipeline, /outputs:\s*\n\s*- name: incident-repo/);
  assert.match(pipeline, /- task: observe-vehicles/);
});

test('the advisory contract is derived from the Story 51A baseline snapshot without inventing geometry', () => {
  const snapshot = { disruptions: { transit: officialServiceChangeFeed() } };
  const contract = officialAdvisories(snapshot.disruptions);
  assert.equal(contract.status, 'ok');
  assert.equal(contract.advisories.length, 1);
  const [advisory] = contract.advisories;
  assert.equal(advisory.ref, 'ttc-service-change:102');
  assert.deepEqual(advisory.routeIds, ['94']);
  assert.equal(advisory.effect, 'MODIFIED SERVICE');
  // The GTFS-RT alert set stays in its own namespace and is untouched.
  assert.equal(emptyGtfsAlerts().items.length, 0);
  assert.notEqual(advisory.ref, '102');
});


// ---------------------------------------------------------------------------
// Story 51C — Direction-Safe Advisory/Trajectory Association.
//
// These tests exercise the association contract: an independently observed
// trajectory is matched to an active, route-compatible official Service Change
// using structured route/time evidence only. The observed pattern and GTFS
// directionId remain the authority for the path direction; prose is never mapped
// to a direction id and never generates geometry. Ambiguous same-route matches
// claim no relationship.
// ---------------------------------------------------------------------------

// Build a confirmed route 94 eastbound diversion through the real pipeline and
// return the inference result with the supplied advisory context.
function inferWithAdvisories(advisories) {
  const observed = observedEastboundDiversion(baselineStaticIndex(), advisories);
  return { index: baselineStaticIndex(), result: { state: observed.state, output: observed.output, report: observed.report } };
}

// A minimal advisory contract with one route 94 detour advisory.
function advisoryContract(overrides = {}) {
  return officialAdvisories({ transit: transitFeed(overrides) });
}

test('an active route-compatible official advisory is associated with the observed path', () => {
  const { result } = inferWithAdvisories(advisoryContract());
  assert.equal(result.output.diversions.length, 1);
  const [diversion] = result.output.diversions;
  assert.equal(diversion.status, 'confirmed');
  // The association is source-qualified and never reuses the GTFS-RT namespace.
  assert.deepEqual(diversion.relatedAdvisoryRefs, ['ttc-service-change:102']);
  assert.equal(diversion.confidence.advisorySupported, true);
  // The GTFS-RT association stays empty and distinct.
  assert.deepEqual(diversion.relatedAlertIds, []);
  assert.equal(diversion.confidence.alertSupported, false);
  // The path direction is the observed GTFS direction, not the prose "eastbound".
  assert.equal(diversion.directionId, 0);
  assert.equal(result.report.relatedAdvisoryCount, 1);
});

test('advisory association never lowers the confirmation threshold', () => {
  // A single incomplete vehicle with an advisory present must remain unconfirmed.
  const index = baselineStaticIndex();
  const advisories = advisoryContract();
  const path = [[43.665, -79.376], [43.665, -79.379], [43.663, -79.381], [43.661, -79.384], [43.661, -79.386], [43.663, -79.388], [43.665, -79.389], [43.665, -79.389], [43.665, -79.389]];
  let vehicles, inferred;
  for (const [i, [latitude, longitude]] of path.entries()) {
    const seconds = i * 30;
    const feed = parseTtcVehicles(baselineProtobuf([baselineVehicle(seconds, { vehicle: { id: 'solo' }, position: { latitude, longitude } })], seconds), baselineAt(seconds));
    vehicles = detectVehicles(vehicles, feed, index, baselineAt(seconds)).state;
    inferred = inferDiversions(inferred?.state, vehicles, index, baselineAt(seconds), undefined, { advisories });
  }
  const [diversion] = inferred.output.diversions;
  // A single vehicle cannot confirm a diversion even with an advisory present.
  assert.notEqual(diversion.status, 'confirmed');
  // The advisory may still be associated, but it cannot promote the status.
  assert.deepEqual(diversion.relatedAdvisoryRefs, ['ttc-service-change:102']);
});

test('an unrelated-route advisory is never associated', () => {
  const advisories = officialAdvisories({ transit: transitFeed({ items: [{ id: '501', title: '501 detour', effect: 'DETOUR', routes: ['501'], periods: [], url: null }] }) });
  const { result } = inferWithAdvisories(advisories);
  const [diversion] = result.output.diversions;
  assert.deepEqual(diversion.relatedAdvisoryRefs, []);
  assert.equal(diversion.confidence.advisorySupported, false);
});

test('a non-detour effect is never associated', () => {
  const advisories = officialAdvisories({ transit: transitFeed({ items: [{ id: '102', title: '94 reduced', effect: 'REDUCED SERVICE', routes: ['94'], periods: [], url: null }] }) });
  const { result } = inferWithAdvisories(advisories);
  assert.deepEqual(result.output.diversions[0].relatedAdvisoryRefs, []);
});

test('an expired advisory is never associated', () => {
  const advisories = officialAdvisories({ transit: transitFeed({ items: [{ id: '102', title: '94 detour', effect: 'DETOUR', routes: ['94'], periods: [{ start: BASELINE_EPOCH - 10000000, end: BASELINE_EPOCH - 1000 }], url: null }] }) });
  const { result } = inferWithAdvisories(advisories);
  assert.deepEqual(result.output.diversions[0].relatedAdvisoryRefs, []);
});

test('an advisory with an open-ended active period is associated', () => {
  const advisories = officialAdvisories({ transit: transitFeed({ items: [{ id: '102', title: '94 detour', effect: 'DETOUR', routes: ['94'], periods: [{ start: BASELINE_EPOCH - 1000, end: null }], url: null }] }) });
  const { result } = inferWithAdvisories(advisories);
  assert.deepEqual(result.output.diversions[0].relatedAdvisoryRefs, ['ttc-service-change:102']);
});

test('an advisory with no active periods is treated as active', () => {
  const advisories = officialAdvisories({ transit: transitFeed({ items: [{ id: '102', title: '94 detour', effect: 'DETOUR', routes: ['94'], periods: [], url: null }] }) });
  const { result } = inferWithAdvisories(advisories);
  assert.deepEqual(result.output.diversions[0].relatedAdvisoryRefs, ['ttc-service-change:102']);
});

test('two indistinguishable same-route advisories claim no relationship', () => {
  const advisories = officialAdvisories({ transit: transitFeed({ items: [
    { id: '102', title: '94 detour A', effect: 'DETOUR', routes: ['94'], periods: [], url: null },
    { id: '103', title: '94 detour B', effect: 'MODIFIED SERVICE', routes: ['94'], periods: [], url: null }
  ] }) });
  const { result } = inferWithAdvisories(advisories);
  const [diversion] = result.output.diversions;
  // The geometry is retained as observed, but no specific advisory is claimed.
  assert.equal(diversion.status, 'confirmed');
  assert.deepEqual(diversion.relatedAdvisoryRefs, []);
  assert.equal(diversion.confidence.advisorySupported, false);
  assert.equal(result.report.advisoryAmbiguousCount, 1);
});

test('an unavailable advisory source never associates', () => {
  const advisories = { ...advisoryContract(), status: 'unavailable' };
  const { result } = inferWithAdvisories(advisories);
  assert.deepEqual(result.output.diversions[0].relatedAdvisoryRefs, []);
});

test('a not-loaded advisory context never associates', () => {
  const { result } = inferWithAdvisories(officialAdvisories(undefined));
  assert.deepEqual(result.output.diversions[0].relatedAdvisoryRefs, []);
});

test('advisory association is deterministic across repeated inference', () => {
  const a = inferWithAdvisories(advisoryContract()).result.output.diversions[0];
  const b = inferWithAdvisories(advisoryContract()).result.output.diversions[0];
  assert.deepEqual(a.relatedAdvisoryRefs, b.relatedAdvisoryRefs);
  assert.equal(a.confidence.advisorySupported, b.confidence.advisorySupported);
});

test('the published output carries advisory refs but never raw advisory text', () => {
  const { result } = inferWithAdvisories(advisoryContract());
  const serialized = JSON.stringify(result.output);
  assert.match(serialized, /ttc-service-change:102/);
  assert.doesNotMatch(serialized, /Wellesley|Jarvis|eastbound/i);
});

test('validation rejects a forged advisory association', () => {
  const { result } = inferWithAdvisories(advisoryContract());
  const output = structuredClone(result.output);
  // A ref that does not match the confidence flag is rejected.
  output.diversions[0].confidence.advisorySupported = false;
  assert.throws(() => validateDiversionOutput(output), /diversion output/);
  const output2 = structuredClone(result.output);
  output2.diversions[0].relatedAdvisoryRefs = ['ttc-service-change:102', 'ttc-service-change:102'];
  assert.throws(() => validateDiversionOutput(output2), /diversion output/);
});

// ---------------------------------------------------------------------------
// Story 51D — Publication Contract & Unified UI Presentation.
//
// The public geometry artifact must carry the source-qualified advisory refs so
// the browser can attach an observed path to an official Service Change, while
// still never leaking raw advisory text or fleet evidence. The presentation
// contract must render a claimed official advisory exactly once, with its
// geometry, and leave unmatched advisories in the citywide list.
// ---------------------------------------------------------------------------

test('the public geometry artifact carries advisory refs but never raw advisory text', async () => {
  const { publicTtcGeometry } = await import('../scripts/publish-ttc-geometry.js');
  const { result } = inferWithAdvisories(advisoryContract());
  const published = publicTtcGeometry(result.output);
  assert.equal(published.diversions.length, 1);
  // The source-qualified ref survives the allow-list so the browser can attach it.
  assert.deepEqual(published.diversions[0].relatedAdvisoryRefs, ['ttc-service-change:102']);
  assert.deepEqual(published.diversions[0].relatedAlertIds, []);
  // No raw advisory text, fleet evidence, or confidence internals leak.
  const serialized = JSON.stringify(published);
  assert.doesNotMatch(serialized, /Wellesley|Jarvis|eastbound/i);
  assert.doesNotMatch(serialized, /vehicleId|episodeIds|rawEvidence|confidence|identityAnchor/);
});

test('the public geometry artifact omits advisory refs when none are claimed', async () => {
  const { publicTtcGeometry } = await import('../scripts/publish-ttc-geometry.js');
  const { result } = inferWithAdvisories(officialAdvisories(undefined));
  const published = publicTtcGeometry(result.output);
  assert.deepEqual(published.diversions[0].relatedAdvisoryRefs, []);
});
