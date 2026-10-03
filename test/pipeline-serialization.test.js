import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Regression: `update-sirento` and `detect-ttc-vehicle-deviations` previously both
// published to the same `snapshots` (data) branch. They ran in parallel, so whichever
// finished second failed its fast-forward push because it was based on an older
// version of the branch. The incident ETL and the bounded TTC vehicle burst are now
// sequential steps in a single `update-sirento` job with exactly one `put`, so no two
// writers can race. This test parses the pipeline structurally (no YAML dependency)
// and fails if any two jobs that write the same resource can run concurrently.

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

test('the pipeline defines a single snapshot writer', () => {
  const writers = jobs.filter(job => job.writes.includes('snapshots'));
  assert.equal(writers.length, 1, 'exactly one job may publish snapshots');
  assert.equal(writers[0].name, 'update-sirento', 'update-sirento must be the snapshot writer');
});

test('no two jobs can publish the same resource concurrently', () => {
  assert.deepEqual(concurrentWriters(jobs), []);
});

test('the snapshot writer publishes exactly once per build', () => {
  const update = jobs.find(job => job.name === 'update-sirento');
  assert.equal(update.writes.filter(resource => resource === 'snapshots').length, 1,
    'update-sirento must publish snapshots exactly once');
});

