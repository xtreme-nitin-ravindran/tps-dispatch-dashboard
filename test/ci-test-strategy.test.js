import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { at, vehicle, protobuf, staticIndex } from './fixtures/ttc-vehicles/builders.js';
import { parseTtcVehicles } from '../src/ttc/vehicle-feed.js';
import { detectVehicles } from '../src/ttc/vehicle-detector.js';
import { inferDiversions } from '../src/ttc/diversion-inference.js';
import { publicTtcGeometry } from '../scripts/publish-ttc-geometry.js';

// The protected GitHub promotion gate validates main before the scheduled
// Concourse updater consumes it. Concourse only needs the publication runtime.

const root = new URL("../", import.meta.url);
const [github, concourse] = await Promise.all([
  readFile(new URL(".github/workflows/tests.yml", root), "utf8"),
  readFile(new URL("concourse/pipeline.yml", root), "utf8")
]);

test("GitHub Actions builds the shared Docker test image while Concourse uses a runtime image", () => {
  assert.match(github, /docker build -f docker\/Dockerfile\.test -t toronto-dispatch-tests \./);
  assert.match(concourse, /task: update-and-publish/);
  assert.match(concourse, /repository: node, tag: 24-bookworm-slim/);
  assert.match(concourse, /npm ci --omit=dev/);
  assert.match(concourse, /branch: main/);
  assert.doesNotMatch(concourse, /build-test-image|test-update-and-publish|test-image|oci-build-task|privileged:/);
});

test("GitHub Actions enforces the promotion gates without repeating them in Concourse", () => {
  const required = [
    "npm test",
    "npm run test:python",
    "npm run lint",
    "node scripts/check-requirement-coverage.js",
    "node --check src/app/app.js",
    "find src scripts",
    "npm run test:coverage"
  ];
  for (const command of required) {
    assert.ok(github.includes(command), `GitHub Actions must run ${command}`);
    assert.ok(!concourse.includes(command), `Concourse must not repeat ${command}`);
  }
  assert.match(github, /TZ=America\/Los_Angeles/);
  assert.match(github, /TZ=UTC[^\n]*NODE_V8_COVERAGE=\/tmp\/coverage/);
});

test("the incident output stays rooted in the declared task output before changing directory", () => {
  const capture = concourse.indexOf('INCIDENT_OUTPUT="$PWD/incident-repo/data/current.json"');
  const changeDirectory = concourse.indexOf('cd repo', capture);
  assert.ok(capture >= 0 && changeDirectory > capture);
  assert.match(concourse, /TFS_OUTPUT="\$INCIDENT_OUTPUT"/);
  assert.match(concourse, /node scripts\/r2-fetch\.js data\/current\.json \/tmp\/history\/current\.json/);
  assert.match(concourse, /node scripts\/publish-incidents\.js/);
});

test("the scheduled vehicle burst captures an off-route confirmation and rejoin across three-minute ticks", async () => {
  const task = await readFile(new URL("concourse/ttc-vehicles.yml", root), "utf8");
  const polls = Number(task.match(/--polls (\d+)/)[1]);
  const intervalMs = Number(task.match(/--interval-ms (\d+)/)[1]);
  assert.equal(intervalMs, 30000);
  const refreshSeconds = Number(concourse.match(/interval: (\d+)m/)[1]) * 60;
  assert.equal(refreshSeconds, 180);
  assert.equal((polls - 1) * intervalMs, 150000);
  const index = staticIndex();
  const path = [
    [43.65, -79.404], [43.65, -79.404], [43.65, -79.404],
    [43.652, -79.403], [43.652, -79.402], [43.652, -79.400],
    [43.65, -79.398], [43.65, -79.397], [43.65, -79.396]
  ];
  const capture = (count, refresh = refreshSeconds) => {
    let vehicles, state, maximumPublished = 0;
    for (const start of [0, refresh]) {
      for (let i = 0; i < count; i++) {
        const seconds = start + i * intervalMs / 1000;
        const position = path[seconds / 30] || path.at(-1);
        const rows = ['a', 'b'].map(id => vehicle(seconds, {
          vehicle: { id }, position: { latitude: position[0], longitude: position[1] }
        }));
        const feed = parseTtcVehicles(protobuf(rows, seconds), at(seconds));
        vehicles = detectVehicles(vehicles, feed, index, at(seconds)).state;
        const result = inferDiversions(state, vehicles, index, at(seconds));
        state = result.state;
        if (i === count - 1) maximumPublished = Math.max(maximumPublished, publicTtcGeometry(result.output).diversions.length);
      }
    }
    return maximumPublished;
  };
  assert.equal(capture(4, 300), 0, "the old burst misses enough off-route samples to confirm");
  assert.equal(capture(polls), 1, "the configured burst observes both complete trajectories");
});
