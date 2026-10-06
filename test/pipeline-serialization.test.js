import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Regression: `update-sirento` and `detect-ttc-vehicle-deviations` previously both
// published to the same `snapshots` (data) branch. They ran in parallel, so whichever
// finished second failed its fast-forward push because it was based on an older
// version of the branch. The incident ETL and the bounded TTC vehicle burst are now
// sequential steps in a single `update-sirento` job, and the incident snapshot is
// committed (phase 1) before the TTC vehicle work, with the geometry committed
// afterwards (phase 2). Each phase writes only its own file through a scoped git
// resource (`paths`/`sparse_paths`), and both `put` steps use `rebase: true`, which
// retries a rejected push by rebasing onto the latest tip, so a cross-scheduler
// conflict preserves both datasets without a lock. This test parses the pipeline
// structurally (no YAML dependency) and fails if any two jobs that write the same
// resource can run concurrently.

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

test('the pipeline defines a single job that writes the data branch', () => {
  const writers = jobs.filter(job => job.writes.some(resource => resource.startsWith('snapshots')));
  assert.equal(writers.length, 1, 'exactly one job may publish the data branch');
  assert.equal(writers[0].name, 'update-sirento', 'update-sirento must be the data-branch writer');
});

test('no two jobs can publish the same resource concurrently', () => {
  assert.deepEqual(concurrentWriters(jobs), []);
});

test('the data-branch writer publishes incidents before TTC vehicle work', () => {
  const update = jobs.find(job => job.name === 'update-sirento');
  // Two publication phases: incidents first, then TTC geometry.
  assert.deepEqual(update.writes, ['snapshots-incidents', 'snapshots-ttc'],
    'update-sirento must publish the incident and TTC resources in order');
  // The incident phase must precede the TTC vehicle task, and the geometry phase
  // must follow it, so a slow or failed TTC stage cannot block the incident update.
  const incidentPut = pipeline.indexOf('repository: incident-repo');
  const observe = pipeline.indexOf('task: observe-vehicles');
  const geometryPut = pipeline.indexOf('repository: updated-repo');
  assert.ok(incidentPut !== -1 && observe !== -1 && geometryPut !== -1, 'all phases must be present');
  assert.ok(incidentPut < observe, 'incident publication must precede TTC vehicle work');
  assert.ok(observe < geometryPut, 'TTC geometry publication must follow TTC vehicle work');
});

test('each dataset is scoped to its own file through a dedicated resource', () => {
  // `paths` limits which commits yield new versions from `check`, so an
  // incident-only commit does not re-trigger the TTC resource and vice versa.
  // `sparse_paths` checks out only the file each phase owns.
  const incidents = /- name: snapshots-incidents\n([\s\S]*?)(?=\n {2}- name: |\njobs:)/.exec(pipeline);
  const ttc = /- name: snapshots-ttc\n([\s\S]*?)(?=\n {2}- name: |\njobs:)/.exec(pipeline);
  assert.ok(incidents && ttc, 'both scoped resources must exist');
  assert.match(incidents[1], /paths:\n\s*- data\/current\.json/);
  assert.match(incidents[1], /sparse_paths:\n\s*- data\/current\.json/);
  assert.match(ttc[1], /paths:\n\s*- data\/ttc-diversions\.json/);
  assert.match(ttc[1], /sparse_paths:\n\s*- data\/ttc-diversions\.json/);
});

test('both publication phases push fast-forward only', () => {
  // The git resource `rebase: true` retries a rejected push by rebasing onto the
  // latest tip; without it a cross-scheduler conflict would fail the build. No
  // phase may force-push.
  const puts = [...pipeline.matchAll(/- put: snapshots-(?:incidents|ttc)\n([\s\S]*?)(?=\n {6}- |\n {4}- |\n\S|$)/g)];
  assert.equal(puts.length, 2, 'exactly two snapshot puts');
  for (const [, body] of puts) {
    assert.match(body, /rebase: true/, 'each snapshot put must rebase');
    assert.doesNotMatch(body, /force: true/, 'no snapshot put may force-push');
  }
});
