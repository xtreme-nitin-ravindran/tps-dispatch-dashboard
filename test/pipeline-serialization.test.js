import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Regression: `update-sirento` and `detect-ttc-vehicle-deviations` previously both
// published to the same `snapshots` (data) branch. They ran in parallel, so whichever
// finished second failed its fast-forward push because it was based on an older
// version of the branch. The incident ETL and the bounded TTC vehicle burst are now
// sequential steps in a single `update-sirento` job, and the incident snapshot is
// published (phase 1) before the TTC vehicle work, with the geometry published
// afterwards (phase 2). Both phases publish to Cloudflare R2 through the shared
// publication sink, each to a different key, so the two datasets cannot conflict and
// no lock or serial group is needed. This test parses the pipeline structurally (no
// YAML dependency) and fails if the pipeline reintroduces a shared-resource writer
// race or drops the incident-before-TTC ordering.

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

test('the parser reads job names, serial groups, and published resources', () => {
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

test('the parser ignores jobs that publish nothing', () => {
  const parsed = parseJobs([
    'jobs:',
    '  - name: reader',
    '    plan:',
    '      - get: shared'
  ].join('\n'));
  assert.deepEqual(parsed, [{ name: 'reader', groups: [], writes: [] }]);
});

test('the parser returns no jobs when the source has no jobs block', () => {
  assert.deepEqual(parseJobs('resources:\n  - name: refresh\n'), []);
});

test('concurrent writers are reported only when a shared resource has no shared group', () => {
  const conflicts = concurrentWriters([
    { name: 'a', groups: ['lock'], writes: ['shared'] },
    { name: 'b', groups: ['lock'], writes: ['shared'] },
    { name: 'c', groups: ['other'], writes: ['shared'] },
    { name: 'd', groups: [], writes: ['unrelated'] }
  ]);
  assert.deepEqual(conflicts, [['a', 'c', ['shared']], ['b', 'c', ['shared']]]);
});

test('the pipeline defines a single job that publishes the data', () => {
  const writers = jobs.filter(job => job.writes.length > 0);
  assert.equal(writers.length, 0, 'R2 publication uses no git `put`, so no job writes a git resource');
  assert.equal(jobs.length, 1, 'exactly one job may publish the data');
  assert.equal(jobs[0].name, 'update-sirento', 'update-sirento must be the data publisher');
});

test('no two jobs can publish the same resource concurrently', () => {
  assert.deepEqual(concurrentWriters(jobs), []);
});

test('the data publisher publishes incidents before TTC vehicle work', () => {
  // The incident phase must precede the TTC vehicle task, and the geometry phase
  // must follow it, so a slow or failed TTC stage cannot block the incident update.
  const incidentPublish = pipeline.indexOf('node /workspace/scripts/publish-incidents.js');
  const observe = pipeline.indexOf('task: observe-vehicles');
  const geometryPublish = pipeline.indexOf('node scripts/publish-ttc-phase.js');
  assert.ok(incidentPublish !== -1 && observe !== -1 && geometryPublish !== -1, 'all phases must be present');
  assert.ok(incidentPublish < observe, 'incident publication must precede TTC vehicle work');
  assert.ok(observe < geometryPublish, 'TTC geometry publication must follow TTC vehicle work');
});

test('both publication phases publish to R2 through the shared sink', () => {
  // Each phase runs its shared script with the R2 credentials in the environment,
  // so the sink uploads directly and no scheduler push step is needed.
  assert.doesNotMatch(pipeline, /- put:/, 'no git `put` step may remain');
  assert.doesNotMatch(pipeline, /snapshots-(?:incidents|ttc)/, 'the scoped git resources must be gone');
  assert.doesNotMatch(pipeline, /rebase: true/, 'no git rebase push may remain');
  const r2Params = [...pipeline.matchAll(/R2_ENDPOINT: \(\(r2_endpoint\)\)/g)];
  assert.equal(r2Params.length, 2, 'both phases must receive the R2 endpoint');
  for (const name of ['R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) {
    const matches = [...pipeline.matchAll(new RegExp(`${name}: \\(\\(${name.toLowerCase()}\\)\\)`, 'g'))];
    assert.equal(matches.length, 2, `both phases must receive ${name}`);
  }
});

test('the incident phase seeds its history input from the published snapshot', () => {
  // The ETL history input must come from R2, not a git checkout, and a missing
  // object must be tolerated so the ETL can start fresh.
  assert.match(pipeline, /node \/workspace\/scripts\/r2-fetch\.js data\/current\.json/);
  assert.match(pipeline, /TFS_PREVIOUS=\/tmp\/history\/current\.json/);
});

test('the pipeline needs no serial group because the datasets use different keys', () => {
  // R2 is last-writer-wins per key and the two phases write different keys, so a
  // shared lock is unnecessary. The single job is serialized by max_in_flight.
  assert.doesNotMatch(pipeline, /serial_groups:/);
  assert.match(pipeline, /max_in_flight: 1/);
});

// ---------------------------------------------------------------------------
// Story 55C — GitHub Actions R2 Writer.
//
// The GitHub Actions fallback previously published to the `data` branch through
// the git sink. It now mirrors Concourse: both publication phases run their
// shared scripts with the R2 credentials in the environment, so the sink uploads
// directly and there is no data-branch push. The advisory-context ordering is
// preserved: the incident phase writes data/current.json before the vehicle step
// reads it as --advisory.
// ---------------------------------------------------------------------------

const workflow = await readFile(new URL('../.github/workflows/update-sirento.yml', import.meta.url), 'utf8');

test('the GitHub workflow publishes both phases to R2 through the shared sink', () => {
  // Both phases run their shared script with the R2 credentials in the environment.
  assert.match(workflow, /node scripts\/publish-incidents\.js/);
  assert.match(workflow, /node scripts\/publish-ttc-phase\.js/);
  const endpoints = [...workflow.matchAll(/R2_ENDPOINT: \$\{\{ secrets\.R2_ENDPOINT \}\}/g)];
  assert.equal(endpoints.length, 2, 'both phases must receive the R2 endpoint');
  for (const name of ['R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) {
    const matches = [...workflow.matchAll(new RegExp(`${name}: \\$\\{\\{ secrets\\.${name} \\}\\}`, 'g'))];
    assert.equal(matches.length, 2, `both phases must receive ${name} from repository secrets`);
  }
});

test('the GitHub workflow no longer writes the data branch', () => {
  // The data-branch checkout, the fast-forward rebase push, and the git sink
  // environment are all gone; R2 is the only publication target.
  assert.doesNotMatch(workflow, /ref: data/, 'the data-branch checkout must be gone');
  assert.doesNotMatch(workflow, /snapshot-data/, 'the snapshot-data checkout must be gone');
  assert.doesNotMatch(workflow, /git push origin HEAD:data/, 'no data-branch push may remain');
  assert.doesNotMatch(workflow, /git pull --rebase origin data/, 'no data-branch rebase may remain');
  assert.doesNotMatch(workflow, /DATA_REPO_DIR/, 'the git sink repo dir must be gone');
  assert.doesNotMatch(workflow, /GIT_AUTHOR_NAME/, 'the git sink author must be gone');
});

test('the GitHub workflow preserves the advisory-context ordering', () => {
  // The incident phase writes data/current.json before the vehicle step reads it,
  // so the advisory input is the already-updated snapshot.
  const incidentIndex = workflow.indexOf('node scripts/publish-incidents.js');
  const vehicleIndex = workflow.indexOf('--advisory data/current.json');
  assert.ok(incidentIndex >= 0 && vehicleIndex > incidentIndex, 'snapshot must be published before the vehicle step');
});

test('the GitHub workflow keeps its triggers, permissions, and concurrency', () => {
  assert.match(workflow, /cron: "2-59\/5 \* \* \* \*"/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.match(workflow, /group: sirento-data-writer/);
  assert.match(workflow, /cancel-in-progress: false/);
});
