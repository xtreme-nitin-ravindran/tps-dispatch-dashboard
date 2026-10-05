import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Regression: the README previously told contributors to copy a long multi-command
// "Run all required checks" block by hand, which could drift from the real checks.
// `npm run verify` is now the single, versioned entry point. These tests parse the
// script and package.json structurally (no shell execution) so the orchestration
// cannot silently lose, reorder, or weaken a required check.
//
// `npm run verify:fast` is a deliberately reduced inner-loop mode. These tests also
// pin its contract: it must build the image, run full lint and the browser syntax
// checks, run offline unit tests under TZ=UTC, and omit the LA suite, Python tests,
// live integration suite, coverage gate, and Git publication/snapshot checks.

const root = new URL("../", import.meta.url);
const [script, pkg] = await Promise.all([
  readFile(new URL("scripts/verify.sh", root), "utf8"),
  readFile(new URL("package.json", root), "utf8")
]);

const manifest = JSON.parse(pkg);

// The required full-verification checks, in the order the README documents them.
// Each entry is a substring that must appear in the script.
const requiredChecks = [
  "docker build -f Dockerfile.test -t",
  "npm run lint",
  "node --input-type=module --check < app.js",
  'find src scripts -name "*.js" -exec node --check {} +',
  "-e TZ=UTC",
  "-e TZ=America/Los_Angeles",
  "npm run test:python",
  "npm run test:integration",
  "npm run test:coverage",
  "git diff --check",
  "git diff --cached --check",
  "git diff --exit-code origin/main...HEAD -- data/current.json",
  "git diff --exit-code HEAD -- data/current.json"
];

test("package.json exposes a verify script that runs scripts/verify.sh", () => {
  assert.equal(manifest.scripts.verify, "sh scripts/verify.sh");
});

test("package.json exposes a verify:fast script that runs scripts/verify.sh --fast", () => {
  assert.equal(manifest.scripts["verify:fast"], "sh scripts/verify.sh --fast");
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

test("the verify script does not use eval", () => {
  assert.doesNotMatch(scriptCode, /\beval\b/, "verify.sh must not use eval");
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

// --- Fast mode -------------------------------------------------------------

// The fast-mode branch is the block that runs after the shared build/lint/syntax
// steps and exits before the full-mode checks. Isolate it so fast-mode assertions
// cannot accidentally match full-mode content.
const fastBranchStart = script.indexOf('if [ "$FAST" -eq 1 ]; then');
const fastBranchEnd = script.indexOf("echo \"==> Running unit tests (TZ=UTC)\"");
const fastBranch = script.slice(fastBranchStart, fastBranchEnd);

test("the verify script parses a leading --fast flag", () => {
  assert.match(script, /if \[ "\$\{1:-\}" = "--fast" \]; then/);
  assert.match(script, /FAST=1/);
});

test("fast mode builds the image, lints, and checks browser syntax", () => {
  // These shared steps run before the fast-mode branch and therefore apply to both modes.
  const buildIndex = script.indexOf("docker build -f Dockerfile.test -t");
  const lintIndex = script.indexOf("npm run lint");
  const syntaxIndex = script.indexOf("node --input-type=module --check < app.js");
  assert.ok(buildIndex !== -1 && lintIndex !== -1 && syntaxIndex !== -1);
  assert.ok(buildIndex < fastBranchStart, "fast mode must build the image");
  assert.ok(lintIndex < fastBranchStart, "fast mode must run full lint");
  assert.ok(syntaxIndex < fastBranchStart, "fast mode must run browser syntax checks");
});

test("fast mode with no file arguments runs the canonical offline unit suite", () => {
  assert.match(fastBranch, /docker run --rm -e TZ=UTC "\$IMAGE" npm test/);
});

test("fast mode with explicit files runs exactly those files in order", () => {
  assert.match(fastBranch, /docker run --rm -e TZ=UTC "\$IMAGE" node --test "\$@"/);
});

test("fast mode exits before the full-mode checks", () => {
  assert.match(fastBranch, /exit 0/);
  assert.ok(
    fastBranchStart < script.indexOf("npm run test:coverage"),
    "the fast branch must precede the coverage gate"
  );
});

test("fast mode omits the LA suite, Python, integration, coverage, and snapshot checks", () => {
  assert.doesNotMatch(fastBranch, /TZ=America\/Los_Angeles/);
  assert.doesNotMatch(fastBranch, /npm run test:python/);
  assert.doesNotMatch(fastBranch, /npm run test:integration/);
  assert.doesNotMatch(fastBranch, /npm run test:coverage/);
  assert.doesNotMatch(fastBranch, /git diff/);
});

test("fast mode never claims to satisfy final, pre-push, or promotion verification", () => {
  assert.match(fastBranch, /not final, pre-push, or promotion verification/);
});

test("fast mode validates explicit file arguments before Docker execution", () => {
  const validationIndex = script.indexOf("Validate explicit fast-mode test file arguments");
  const buildIndex = script.indexOf("docker build -f Dockerfile.test -t");
  assert.ok(validationIndex !== -1, "fast mode must validate arguments");
  assert.ok(validationIndex < buildIndex, "validation must precede the Docker build");
});

test("fast mode rejects invalid file arguments with a nonzero exit", () => {
  // Each rejection path must print a diagnostic and exit nonzero.
  const rejections = [
    /empty test file argument/,
    /option-like argument not allowed/,
    /absolute paths are not allowed/,
    /path traversal is not allowed/,
    /test file must end in \.test\.js/,
    /test file must be under test\//,
    /live integration tests are not allowed/,
    /test file not found/
  ];
  for (const rejection of rejections) {
    assert.match(script, rejection, `verify.sh must reject: ${rejection}`);
  }
  assert.match(script, /exit 2/, "invalid input must exit nonzero");
});

test("fast mode accepts only repository-relative test/*.test.js files", () => {
  assert.match(script, /test\/\*\.test\.js\)/);
  assert.match(script, /if \[ ! -f "\$arg" \]; then/);
});
