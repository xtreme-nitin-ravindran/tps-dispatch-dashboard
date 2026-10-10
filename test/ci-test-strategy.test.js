import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

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
