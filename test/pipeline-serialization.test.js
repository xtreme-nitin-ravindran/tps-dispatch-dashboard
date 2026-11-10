import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Regression: `update-feed` previously published both the incident snapshot and
// the bounded TTC vehicle geometry. TTC geometry is now owned by the continuous
// capture stack (Story 64), so `update-feed` publishes only the incident ETL
// (data/current.json) directly to Cloudflare R2 through the shared sink. This test
// parses the pipeline structurally (no YAML dependency) and fails if the pipeline
// reintroduces a second writer or a shared-resource race.

// Minimal structural reader: split the `jobs:` block into per-job chunks at the
// two-space `- name:` list markers, then read the fields this invariant depends on.
export function parseJobs(source) {
  const jobsIndex = source.indexOf('jobs:');
  const jobsBlock = jobsIndex === -1 ? '' : source.slice(jobsIndex);
  const chunks = jobsBlock.split(/\n {2}- name: /).slice(1);
  return chunks.map(chunk => {
    const name = chunk.slice(0, chunk.indexOf('\n')).trim();
    const serialGroups = /^\s*serial_groups:\s*\[([^\]]*)\]/m.exec(chunk);
    const groups = serialGroups
      ? serialGroups[1].split(',').map(value => value.trim()).filter(Boolean)
      : [];
    // A job writes a resource when it has a `put:` step for it.
    const writes = [...chunk.matchAll(/^\s*- put:\s*(\S+)/gm)].map(match => match[1]);
    return { name, groups, writes };
  });
}

// Returns the pairs of jobs that write a shared resource but do not share a serial
// group, i.e. the writers that could still run concurrently.
export function concurrentWriters(jobs) {
  const writers = jobs.filter(job => job.writes.length > 0);
  const conflicts = [];
  for (let i = 0; i < writers.length; i++) {
    for (let j = i + 1; j < writers.length; j++) {
      const shared = writers[i].writes.filter(resource => writers[j].writes.includes(resource));
      if (shared.length === 0) continue;
      const overlap = writers[i].groups.filter(group => writers[j].groups.includes(group));
      if (overlap.length === 0) conflicts.push([writers[i].name, writers[j].name, shared]);
    }
  }
  return conflicts;
}

const pipeline = await readFile(new URL('../concourse/pipeline.yml', import.meta.url), 'utf8');
const jobs = parseJobs(pipeline);

test('[STORY-54] the parser reads job names, serial groups, and published resources', () => {
  const parsed = parseJobs([
    'jobs:',
    '  - name: alpha',
    '    serial_groups: [writers, extra]',
    '    plan:',
    '      - put: shared',
    '  - name: beta',
    '    plan:',
    '      - put: shared'
  ].join('\n'));
  assert.deepEqual(parsed, [
    { name: 'alpha', groups: ['writers', 'extra'], writes: ['shared'] },
    { name: 'beta', groups: [], writes: ['shared'] }
  ]);
});

test('[STORY-54] the parser ignores jobs that publish nothing', () => {
  const parsed = parseJobs([
    'jobs:',
    '  - name: reader',
    '    plan:',
    '      - get: shared'
  ].join('\n'));
  assert.deepEqual(parsed, [{ name: 'reader', groups: [], writes: [] }]);
});

test('[STORY-54] the parser returns no jobs when the source has no jobs block', () => {
  assert.deepEqual(parseJobs('resources:\n  - name: refresh\n'), []);
});

test('[STORY-54] concurrent writers are reported only when a shared resource has no shared group', () => {
  const conflicts = concurrentWriters([
    { name: 'a', groups: ['lock'], writes: ['shared'] },
    { name: 'b', groups: ['lock'], writes: ['shared'] },
    { name: 'c', groups: ['other'], writes: ['shared'] },
    { name: 'd', groups: [], writes: ['unrelated'] }
  ]);
  assert.deepEqual(conflicts, [['a', 'c', ['shared']], ['b', 'c', ['shared']]]);
});

test('[STORY-54] the pipeline defines a single job that publishes the data', () => {
  const writers = jobs.filter(job => job.writes.length > 0);
  assert.equal(writers.length, 0, 'R2 publication uses no git `put`, so no job writes a git resource');
  assert.equal(jobs.length, 1, 'exactly one job may publish the data');
  assert.equal(jobs[0].name, 'update-feed', 'update-feed must be the data publisher');
});

test('[STORY-54] no two jobs can publish the same resource concurrently', () => {
  assert.deepEqual(concurrentWriters(jobs), []);
});

test('[STORY-54] the data publisher publishes only the incident snapshot', () => {
  // TTC geometry is owned by the continuous capture stack, not this bounded job.
  assert.match(pipeline, /node scripts\/publish-incidents\.js/);
  assert.doesNotMatch(pipeline, /observe-vehicles/, 'no bounded TTC vehicle task may remain');
  assert.doesNotMatch(pipeline, /publish-ttc-phase/, 'no bounded TTC geometry publication may remain');
});

test('[STORY-55B] the incident phase publishes to R2 through the shared sink', () => {
  // The single incident phase runs its shared script with the R2 credentials in the
  // environment, so the sink uploads directly and no scheduler push step is needed.
  assert.doesNotMatch(pipeline, /- put:/, 'no git `put` step may remain');
  assert.doesNotMatch(pipeline, /snapshots-(?:incidents|ttc)/, 'the scoped git resources must be gone');
  assert.doesNotMatch(pipeline, /rebase: true/, 'no git rebase push may remain');
  const r2Params = [...pipeline.matchAll(/R2_ENDPOINT: \(\(r2_endpoint\)\)/g)];
  assert.equal(r2Params.length, 1, 'the incident phase must receive the R2 endpoint');
  for (const name of ['R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) {
    const key = name.toLowerCase();
    assert.ok(pipeline.includes(`${name}: ((${key}))`), `the incident phase must receive ${name}`);
  }
});

test('[STORY-55B] the incident phase seeds its history input from the published snapshot', () => {
  // The ETL history input must come from R2, not a git checkout, and a missing
  // object must be tolerated so the ETL can start fresh.
  assert.match(pipeline, /node scripts\/r2-fetch\.js data\/current\.json/);
  assert.match(pipeline, /TFS_PREVIOUS=\/tmp\/history\/current\.json/);
});

test('[STORY-54] the pipeline needs no serial group because the datasets use different keys', () => {
  // R2 is last-writer-wins per key and the two phases write different keys, so a
  // shared lock is unnecessary. The single job is serialized by max_in_flight.
  assert.doesNotMatch(pipeline, /serial_groups:/);
  assert.match(pipeline, /max_in_flight: 1/);
});
