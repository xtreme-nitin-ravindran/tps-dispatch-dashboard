import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Regression: the README previously told contributors to copy a long multi-command
// "Run all required checks" block by hand, which could drift from the real checks.
// `npm run verify` is now the single, versioned entry point. These tests parse the
// script and package.json structurally (no shell execution) so the orchestration
// cannot silently lose, reorder, or weaken a required check.
//
// Full mode runs its independent checks concurrently with bounded concurrency
// (VERIFY_JOBS, default 4, maximum 8). These tests pin that contract: every
// required check still runs exactly once, preparation and the final Git/snapshot
// checks stay sequential, VERIFY_JOBS=1 is a fully sequential mode, and the
// scheduler stops launching queued jobs after a failure.
//
// `npm run verify:fast` is a deliberately reduced inner-loop mode. These tests also
// pin its contract: it must ensure the image, run full lint and the browser syntax
// checks, run offline unit tests under TZ=UTC, and omit the LA suite, Python tests,
// live integration suite, coverage gate, and Git publication/snapshot checks.
//
// Both modes run every container command through scripts/docker-test.sh, which
// mounts the current working tree read-only over the image's /workspace. The image
// is only rebuilt when its dependency/tooling fingerprint changes, so these tests
// assert the wrapper is used instead of a per-run `docker build`.

const root = new URL("../", import.meta.url);
const [script, pkg] = await Promise.all([
  readFile(new URL("scripts/verify.sh", root), "utf8"),
  readFile(new URL("package.json", root), "utf8")
]);

const manifest = JSON.parse(pkg);

// The required full-verification checks, in the order the README documents them.
// Each entry is a substring that must appear in the script.
const requiredChecks = [
  "scripts/docker-test.sh\" --ensure-image",
  "npm run lint",
  "node --check src/app/app.js",
  'find src scripts -name "*.js" -exec node --check {} +',
  "env TZ=UTC",
  "env TZ=America/Los_Angeles",
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

test("the verify script does not use bash-only `wait -n`", () => {
  assert.doesNotMatch(scriptCode, /wait\s+-n/, "verify.sh must not use bash-only `wait -n`");
});

test("the verify script runs every required check", () => {
  for (const check of requiredChecks) {
    assert.ok(script.includes(check), `verify.sh must run: ${check}`);
  }
});

test("the verify script runs the required checks in the documented order", () => {
  // The full-mode job commands live in the FULL_JOBS table, so assert their
  // order there. Preparation (image ensure) must precede the full-mode stage,
  // and the Git/snapshot checks must follow it.
  const jobOrder = [
    "npm run lint",
    "node --check src/app/app.js",
    'find src scripts -name "*.js" -exec node --check {} +',
    "env TZ=America/Los_Angeles",
    "npm run test:python",
    "npm run test:integration",
    "env TZ=UTC NODE_V8_COVERAGE=/tmp/coverage npm run test:coverage"
  ];
  const positions = jobOrder.map(check => {
    const index = script.indexOf(check);
    assert.notEqual(index, -1, `verify.sh must run: ${check}`);
    return index;
  });
  const sorted = [...positions].sort((a, b) => a - b);
  assert.deepEqual(positions, sorted, "verify.sh must run the checks in order");

  // Preparation precedes the full-mode stage; the Git checks follow it.
  const ensureIndex = script.indexOf("scripts/docker-test.sh\" --ensure-image");
  const fullModeIndex = script.indexOf("# --- Full mode: parallel or sequential independent jobs");
  const gitIndex = script.indexOf("git diff --check");
  assert.ok(ensureIndex < fullModeIndex, "the image must be ensured before the full-mode stage");
  assert.ok(fullModeIndex < gitIndex, "the Git checks must follow the full-mode stage");
});

test("the verify script ensures the image before running any container check", () => {
  const ensureIndex = script.indexOf("scripts/docker-test.sh\" --ensure-image");
  const firstRunIndex = script.indexOf("scripts/docker-test.sh\" npm run lint");
  assert.ok(ensureIndex !== -1 && firstRunIndex !== -1);
  assert.ok(ensureIndex < firstRunIndex, "the image must be ensured before it is used");
});

test("the verify script runs every container command through the wrapper", () => {
  // No bare `docker run`/`docker build` may remain: all container work must go
  // through scripts/docker-test.sh so the working tree is mounted.
  assert.doesNotMatch(scriptCode, /\bdocker run\b/, "verify.sh must not call docker run directly");
  assert.doesNotMatch(scriptCode, /\bdocker build\b/, "verify.sh must not call docker build directly");
  assert.match(script, /scripts\/docker-test\.sh/);
});

test("the verify script runs the coverage gate with the CI coverage environment", () => {
  assert.match(script, /env TZ=UTC NODE_V8_COVERAGE=\/tmp\/coverage/);
});

// --- Full-mode parallel scheduler -----------------------------------------

// The full-mode job table is the single source of truth for which checks run.
// Parse it so the scheduler tests can assert the exact job set and commands.
const jobsBlockMatch = script.match(/FULL_JOBS='([\s\S]*?)'/);
assert.ok(jobsBlockMatch, "verify.sh must define a FULL_JOBS job table");
const fullJobs = jobsBlockMatch[1]
  .split("\n")
  .filter(Boolean)
  .map(line => {
    const sep = line.indexOf("|");
    return { name: line.slice(0, sep), args: line.slice(sep + 1) };
  });

test("the full-mode job table contains every required check exactly once", () => {
  const names = fullJobs.map(job => job.name);
  assert.deepEqual(names, [
    "lint",
    "javascript-syntax",
    "unit-los-angeles",
    "python",
    "integration",
    "coverage"
  ]);
  assert.equal(new Set(names).size, names.length, "job names must be unique");
});

test("each full-mode job runs through the Docker wrapper with the expected command", () => {
  const byName = Object.fromEntries(fullJobs.map(job => [job.name, job.args]));
  assert.equal(byName.lint, "npm run lint");
  assert.equal(byName["javascript-syntax"], 'sh -c node --check src/app/app.js && find src scripts -name "*.js" -exec node --check {} +');
  assert.equal(byName["unit-los-angeles"], "env TZ=America/Los_Angeles npm test");
  assert.equal(byName.python, "npm run test:python");
  assert.equal(byName.integration, "npm run test:integration");
  assert.equal(byName.coverage, "env TZ=UTC NODE_V8_COVERAGE=/tmp/coverage npm run test:coverage");
});

test("the scheduler launches every job through the wrapper", () => {
  // launch_job must invoke the wrapper, never a bare command.
  assert.match(script, /launch_job\(\)/);
  assert.match(script, /sh "\$ROOT\/scripts\/docker-test\.sh" "\$@"/);
});

test("the scheduler bounds concurrency with VERIFY_JOBS and a hard maximum", () => {
  assert.match(script, /DEFAULT_JOBS=4/);
  assert.match(script, /MAX_JOBS=8/);
  assert.match(script, /VERIFY_JOBS/);
  // The launch loop must compare the running count against the bound.
  assert.match(script, /running_count\)" -lt "\$JOBS"/);
});

test("the scheduler validates VERIFY_JOBS before any Docker work", () => {
  const resolveIndex = script.indexOf("resolve_jobs()");
  const ensureIndex = script.indexOf("scripts/docker-test.sh\" --ensure-image");
  assert.ok(resolveIndex !== -1, "verify.sh must define resolve_jobs");
  assert.ok(ensureIndex !== -1);
  // The dispatch call to resolve_jobs must precede the ensure step so a bad
  // VERIFY_JOBS value fails before any Docker work.
  const dispatchIndex = script.indexOf("\nresolve_jobs\n");
  assert.ok(dispatchIndex !== -1, "verify.sh must call resolve_jobs before dispatch");
  assert.ok(dispatchIndex < ensureIndex, "VERIFY_JOBS must be validated before Docker work");
});

test("the scheduler rejects invalid VERIFY_JOBS values with a nonzero exit", () => {
  assert.match(script, /VERIFY_JOBS must be a positive integer/);
  assert.match(script, /VERIFY_JOBS must be at least 1/);
  assert.match(script, /VERIFY_JOBS must be at most \$MAX_JOBS/);
  assert.match(script, /VERIFY_JOBS must be a positive integer \(got: empty\)/);
});

test("VERIFY_JOBS=1 selects a fully sequential runner", () => {
  assert.match(script, /run_full_sequential\(\)/);
  assert.match(script, /if \[ "\$JOBS" -eq 1 \]; then/);
  assert.match(script, /run_full_sequential/);
  assert.match(script, /run_full_parallel/);
});

test("the sequential runner runs the same job table in order", () => {
  const seqStart = script.indexOf("run_full_sequential()");
  const seqEnd = script.indexOf("# --- Preparation");
  const seq = script.slice(seqStart, seqEnd);
  assert.match(seq, /queue=\$FULL_JOBS/);
  assert.match(seq, /sh "\$ROOT\/scripts\/docker-test\.sh" \$args/);
});

test("the scheduler stops launching queued jobs after a failure", () => {
  // The launch loop is guarded by `failed -eq 0`, and the outer loop breaks once
  // a failure is known and no sibling is still running.
  assert.match(script, /while \[ "\$failed" -eq 0 \]/);
  assert.match(script, /if \[ "\$failed" -ne 0 \] && \[ -z "\$RUNNING_PIDS" \]; then/);
  assert.match(script, /break/);
});

test("the scheduler reports the failing job and exits nonzero", () => {
  assert.match(script, /FAILED \(exit \$JOB_STATUS\)/);
  assert.match(script, /full verification failed; failing job\(s\)/);
  assert.match(script, /exit 1/);
});

test("the scheduler captures each job's output to its own log", () => {
  assert.match(script, /LOG_DIR=\$\(mktemp -d/);
  assert.match(script, /log="\$LOG_DIR\/\$name\.log"/);
  assert.match(script, /print_job_output/);
});

test("the scheduler reaps every child and removes its log directory", () => {
  assert.match(script, /cleanup\(\)/);
  assert.match(script, /wait "\$pid"/);
  assert.match(script, /rm -rf "\$LOG_DIR"/);
});

test("the scheduler terminates a job's whole process tree on cleanup", () => {
  // Descendants are collected and killed so no grandchild (for example a
  // `docker run` client) is orphaned.
  assert.match(script, /descendants_of\(\)/);
  assert.match(script, /ps -A -o pid=,ppid=/);
  assert.match(script, /kill "\$child"/);
});

test("the scheduler traps INT, TERM, and HUP and exits 130 on interruption", () => {
  assert.match(script, /trap 'on_signal' INT TERM HUP/);
  assert.match(script, /exit 130/);
  assert.match(script, /interrupted; terminating running jobs/);
});

test("the final Git/snapshot checks stay sequential after the parallel stage", () => {
  const parallelCall = script.indexOf("run_full_parallel");
  const gitCheck = script.indexOf("git diff --check");
  assert.ok(parallelCall !== -1 && gitCheck !== -1);
  assert.ok(parallelCall < gitCheck, "Git checks must run after the parallel stage");
});

// --- Fast mode -------------------------------------------------------------

// The fast-mode branch is the block that runs after the shared build/lint/syntax
// steps and exits before the full-mode checks. Isolate it so fast-mode assertions
// cannot accidentally match full-mode content.
const fastBranchStart = script.indexOf('if [ "$FAST" -eq 1 ]; then');
const fastBranchEnd = script.indexOf("# --- Full mode: parallel or sequential independent jobs");
const fastBranch = script.slice(fastBranchStart, fastBranchEnd);

test("the verify script parses a leading --fast flag", () => {
  assert.match(script, /if \[ "\$\{1:-\}" = "--fast" \]; then/);
  assert.match(script, /FAST=1/);
});

test("fast mode ensures the image, lints, and checks browser syntax", () => {
  // These shared steps run before the fast-mode branch and therefore apply to both modes.
  const ensureIndex = script.indexOf("scripts/docker-test.sh\" --ensure-image");
  const lintIndex = script.indexOf("npm run lint");
  const syntaxIndex = script.indexOf("node --check src/app/app.js");
  assert.ok(ensureIndex !== -1 && lintIndex !== -1 && syntaxIndex !== -1);
  assert.ok(ensureIndex < fastBranchStart, "fast mode must ensure the image");
  assert.ok(lintIndex < fastBranchStart, "fast mode must run full lint");
  assert.ok(syntaxIndex < fastBranchStart, "fast mode must run browser syntax checks");
});

test("fast mode with no file arguments runs the canonical offline unit suite", () => {
  assert.match(fastBranch, /scripts\/docker-test\.sh" env TZ=UTC npm test/);
});

test("fast mode with explicit files runs exactly those files in order", () => {
  assert.match(fastBranch, /scripts\/docker-test\.sh" env TZ=UTC node --test "\$@"/);
});

test("fast mode exits before the full-mode checks", () => {
  assert.match(fastBranch, /exit 0/);
  // The fast branch must end before the full-mode dispatch, so fast mode never
  // reaches the parallel/sequential runners or the coverage gate.
  const fullModeIndex = script.indexOf("# --- Full mode: parallel or sequential independent jobs");
  assert.ok(fullModeIndex !== -1);
  assert.ok(
    fastBranchStart < fullModeIndex,
    "the fast branch must precede the full-mode stage"
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
  const ensureIndex = script.indexOf("scripts/docker-test.sh\" --ensure-image");
  assert.ok(validationIndex !== -1, "fast mode must validate arguments");
  assert.ok(validationIndex < ensureIndex, "validation must precede the Docker image work");
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
