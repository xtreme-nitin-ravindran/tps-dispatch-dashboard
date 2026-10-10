import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// GitHub Actions and Concourse must exercise the same test image and gates.
// These structural checks prevent the scheduled Concourse updater from quietly
// falling behind the protected dev-branch workflow as the test strategy evolves.

const root = new URL("../", import.meta.url);
const [github, concourse] = await Promise.all([
  readFile(new URL(".github/workflows/tests.yml", root), "utf8"),
  readFile(new URL("concourse/pipeline.yml", root), "utf8")
]);

test("GitHub Actions and Concourse build the shared Docker test image", () => {
  assert.match(github, /docker build -f docker\/Dockerfile\.test -t toronto-dispatch-tests \./);
  assert.match(concourse, /repository: concourse\/oci-build-task/);
  assert.match(concourse, /DOCKERFILE: repo\/docker\/Dockerfile\.test/);
  assert.match(concourse, /UNPACK_ROOTFS: "true"/);
  assert.match(concourse, /image: test-image/);
});

test("GitHub Actions and Concourse enforce the same test gates", () => {
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
    assert.ok(concourse.includes(command), `Concourse must run ${command}`);
  }
  assert.match(github, /TZ=America\/Los_Angeles/);
  assert.match(concourse, /TZ=America\/Los_Angeles/);
  assert.match(github, /TZ=UTC[^\n]*NODE_V8_COVERAGE=\/tmp\/coverage/);
  assert.match(concourse, /TZ=UTC NODE_V8_COVERAGE=\/tmp\/coverage/);
});
