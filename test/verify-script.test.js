import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Regression: the README previously told contributors to copy a long multi-command
// "Run all required checks" block by hand, which could drift from the real checks.
// `npm run verify` is now the single, versioned entry point. These tests parse the
// script and package.json structurally (no shell execution) so the orchestration
// cannot silently lose, reorder, or weaken a required check.

const root = new URL("../", import.meta.url);
const [script, pkg] = await Promise.all([
  readFile(new URL("scripts/verify.sh", root), "utf8"),
  readFile(new URL("package.json", root), "utf8")
]);

const manifest = JSON.parse(pkg);

// The required checks, in the order the README documents them. Each entry is a
// substring that must appear in the script.
const requiredChecks = [
  "docker build -f Dockerfile.test -t",
  "npm run lint",
  "-e TZ=UTC",
  "-e TZ=America/Los_Angeles",
  "npm run test:python",
  "npm run test:integration",
  "npm run test:coverage",
  "node --input-type=module --check < app.js",
  'find src scripts -name "*.js" -exec node --check {} +',
  "git diff --check",
  "git diff --cached --check",
  "git diff --exit-code origin/main...HEAD -- data/current.json",
  "git diff --exit-code HEAD -- data/current.json"
];

test("package.json exposes a verify script that runs scripts/verify.sh", () => {
  assert.equal(manifest.scripts.verify, "sh scripts/verify.sh");
});

test("the verify script fails fast on any error", () => {
  assert.match(script, /^set -eu$/m, "verify.sh must use `set -eu`");
});

// Strip comment lines so portability checks inspect executable content only.
const scriptCode = script
  .split("\n")
  .filter(line => !line.trimStart().startsWith("#"))
  .join("\n");

test("the verify script is POSIX sh and avoids GNU-only tools", () => {
  assert.match(script, /^#!\/bin\/sh$/m, "verify.sh must use a POSIX sh shebang");
  assert.doesNotMatch(scriptCode, /\btimeout\b/, "verify.sh must not rely on GNU `timeout`");
  assert.doesNotMatch(scriptCode, /\bbash\b/, "verify.sh must not require bash");
});

test("the verify script runs every required check", () => {
  for (const check of requiredChecks) {
    assert.ok(script.includes(check), `verify.sh must run: ${check}`);
  }
});

test("the verify script runs the required checks in the documented order", () => {
  const positions = requiredChecks.map(check => {
    const index = script.indexOf(check);
    assert.notEqual(index, -1, `verify.sh must run: ${check}`);
    return index;
  });
  const sorted = [...positions].sort((a, b) => a - b);
  assert.deepEqual(positions, sorted, "verify.sh must run the checks in order");
});

test("the verify script builds the image before running any container check", () => {
  const buildIndex = script.indexOf("docker build -f Dockerfile.test -t");
  const firstRunIndex = script.indexOf("docker run");
  assert.ok(buildIndex !== -1 && firstRunIndex !== -1);
  assert.ok(buildIndex < firstRunIndex, "the image must be built before it is run");
});

test("the verify script runs the coverage gate with the CI coverage environment", () => {
  assert.match(script, /-e NODE_V8_COVERAGE=\/tmp\/coverage/);
});
