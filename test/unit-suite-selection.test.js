import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, writeFile, rm, chmod, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Deterministic regression coverage for the canonical offline unit-test runner
// (scripts/run-unit-tests.sh) and the package scripts that use it.
//
// The runner is the single source of truth for which offline JavaScript test
// files SirenTO runs. `npm test` and `npm run test:coverage` must resolve to the
// exact same file set; live-source integration tests must never enter either.
//
// These tests never execute the real suite. They place a stub `node` on PATH
// that records the arguments it receives, so the runner's selection can be
// asserted precisely without running any test file.

const root = fileURLToPath(new URL("../", import.meta.url)).replace(/\/$/, "");
const runnerPath = join(root, "scripts", "run-unit-tests.sh");

// A stub `node` that records every argument to $STUB_LOG, one per line, then
// exits 0. It never runs a real test.
const STUB_NODE = `#!/bin/sh
set -eu
: > "$STUB_LOG"
for a in "$@"; do
  printf '%s\\n' "$a" >> "$STUB_LOG"
done
exit 0
`;

async function makeStubEnv() {
  const dir = await mkdtemp(join(tmpdir(), "unit-suite-stub-"));
  const bin = join(dir, "bin");
  await mkdir(bin, { recursive: true });
  const node = join(bin, "node");
  await writeFile(node, STUB_NODE);
  await chmod(node, 0o755);
  const log = join(dir, "log");
  await writeFile(log, "");
  return { dir, bin, log };
}

function runRunner(args, { bin, log, cwd = root } = {}) {
  return spawnSync("sh", [runnerPath, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      STUB_LOG: log
    }
  });
}

async function readArgs(log) {
  const text = await readFile(log, "utf8");
  return text.split("\n").filter(Boolean);
}

// The repository's real offline unit files, computed independently of the
// runner so the test can detect drift in either direction.
async function realOfflineFiles() {
  const entries = await readdir(join(root, "test"));
  return entries
    .filter(name => name.endsWith(".test.js") && !name.endsWith(".integration.test.js"))
    .map(name => `test/${name}`)
    .sort();
}

async function realIntegrationFiles() {
  const entries = await readdir(join(root, "test"));
  return entries
    .filter(name => name.endsWith(".integration.test.js"))
    .map(name => `test/${name}`)
    .sort();
}

// Extract the test-file arguments from a stub-node invocation: everything after
// the `--test` flag, ignoring Node option flags.
function selectedFiles(args) {
  const testIndex = args.indexOf("--test");
  assert.notEqual(testIndex, -1, "the runner must invoke node with --test");
  return args.slice(testIndex + 1);
}

test("the runner is POSIX sh and does not use eval or bash-only features", async () => {
  const script = await readFile(runnerPath, "utf8");
  assert.match(script, /^#!\/bin\/sh$/m, "run-unit-tests.sh must use a POSIX sh shebang");
  assert.match(script, /^set -eu$/m, "run-unit-tests.sh must use `set -eu`");
  const code = script
    .split("\n")
    .filter(line => !line.trimStart().startsWith("#"))
    .join("\n");
  assert.doesNotMatch(code, /\beval\b/, "run-unit-tests.sh must not use eval");
  assert.doesNotMatch(code, /\bbash\b/, "run-unit-tests.sh must not require bash");
  assert.doesNotMatch(code, /\btimeout\b/, "run-unit-tests.sh must not rely on GNU timeout");
  assert.doesNotMatch(code, /wait\s+-n/, "run-unit-tests.sh must not use bash-only `wait -n`");
});

test("the runner selects every offline unit file exactly once", async () => {
  const stub = await makeStubEnv();
  try {
    const result = runRunner([], stub);
    assert.equal(result.status, 0, result.stderr);
    const files = selectedFiles(await readArgs(stub.log));
    const expected = await realOfflineFiles();
    assert.deepEqual(files, expected, "the runner must select exactly the offline unit files");
    assert.equal(new Set(files).size, files.length, "no file may be selected twice");
  } finally {
    await rm(stub.dir, { recursive: true, force: true });
  }
});

test("the runner never selects a live integration file", async () => {
  const stub = await makeStubEnv();
  try {
    const result = runRunner([], stub);
    assert.equal(result.status, 0, result.stderr);
    const files = selectedFiles(await readArgs(stub.log));
    const integration = await realIntegrationFiles();
    assert.ok(integration.length > 0, "the repository must have integration files to guard");
    for (const file of integration) {
      assert.ok(!files.includes(file), `integration file must not be selected: ${file}`);
    }
    assert.ok(
      !files.some(f => f.endsWith(".integration.test.js")),
      "no *.integration.test.js file may be selected"
    );
  } finally {
    await rm(stub.dir, { recursive: true, force: true });
  }
});

test("the runner selects files in deterministic sorted order", async () => {
  const stub = await makeStubEnv();
  try {
    const first = runRunner([], stub);
    assert.equal(first.status, 0, first.stderr);
    const filesA = selectedFiles(await readArgs(stub.log));

    const second = runRunner([], stub);
    assert.equal(second.status, 0, second.stderr);
    const filesB = selectedFiles(await readArgs(stub.log));

    assert.deepEqual(filesA, filesB, "selection must be deterministic across runs");
    const sorted = [...filesA].sort();
    assert.deepEqual(filesA, sorted, "selection must be sorted");
  } finally {
    await rm(stub.dir, { recursive: true, force: true });
  }
});

test("the runner resolves the repository root independent of the caller's cwd", async () => {
  const stub = await makeStubEnv();
  const elsewhere = await mkdtemp(join(tmpdir(), "unit-suite-cwd-"));
  try {
    const result = runRunner([], { ...stub, cwd: elsewhere });
    assert.equal(result.status, 0, result.stderr);
    const files = selectedFiles(await readArgs(stub.log));
    const expected = await realOfflineFiles();
    assert.deepEqual(files, expected, "selection must not depend on the caller's cwd");
  } finally {
    await rm(stub.dir, { recursive: true, force: true });
    await rm(elsewhere, { recursive: true, force: true });
  }
});

test("coverage mode selects the same files and adds the 100% coverage gate", async () => {
  const stub = await makeStubEnv();
  try {
    const plain = runRunner([], stub);
    assert.equal(plain.status, 0, plain.stderr);
    const plainArgs = await readArgs(stub.log);

    const cov = runRunner(["--coverage"], stub);
    assert.equal(cov.status, 0, cov.stderr);
    const covArgs = await readArgs(stub.log);

    // Same test-file set.
    assert.deepEqual(
      selectedFiles(covArgs),
      selectedFiles(plainArgs),
      "coverage must run the same offline files as the plain suite"
    );

    // Coverage adds the coverage flags and the exact 100/100/100 thresholds.
    assert.ok(covArgs.includes("--experimental-test-coverage"), "coverage must enable coverage");
    assert.ok(covArgs.includes("--test-coverage-lines=100"), "coverage must gate lines at 100");
    assert.ok(covArgs.includes("--test-coverage-branches=100"), "coverage must gate branches at 100");
    assert.ok(covArgs.includes("--test-coverage-functions=100"), "coverage must gate functions at 100");

    // The plain run must not enable coverage.
    assert.ok(!plainArgs.includes("--experimental-test-coverage"), "plain run must not enable coverage");
  } finally {
    await rm(stub.dir, { recursive: true, force: true });
  }
});

test("the runner fails clearly when no unit tests are selected", async () => {
  // Build a scratch repo with a test/ directory that has only an integration
  // file, so the offline selection is empty.
  const scratch = await mkdtemp(join(tmpdir(), "unit-suite-empty-"));
  try {
    await mkdir(join(scratch, "scripts"), { recursive: true });
    await mkdir(join(scratch, "test"), { recursive: true });
    await writeFile(
      join(scratch, "scripts", "run-unit-tests.sh"),
      await readFile(runnerPath, "utf8")
    );
    await writeFile(join(scratch, "test", "only-source.integration.test.js"), "// live\n");

    const result = spawnSync("sh", [join(scratch, "scripts", "run-unit-tests.sh")], {
      cwd: scratch,
      encoding: "utf8"
    });
    assert.notEqual(result.status, 0, "an empty selection must fail");
    assert.match(result.stderr, /no offline unit tests selected/i);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("the runner rejects unexpected arguments", async () => {
  const stub = await makeStubEnv();
  try {
    const result = runRunner(["test/theme.test.js"], stub);
    assert.notEqual(result.status, 0, "unexpected arguments must fail");
    assert.match(result.stderr, /unexpected argument/i);
  } finally {
    await rm(stub.dir, { recursive: true, force: true });
  }
});

test("a new offline test file automatically joins the canonical suite", async () => {
  // Copy the runner into a scratch repo with a controlled test/ directory and
  // confirm a newly added offline file is selected without editing the runner.
  const scratch = await mkdtemp(join(tmpdir(), "unit-suite-new-"));
  const stub = await makeStubEnv();
  try {
    await mkdir(join(scratch, "scripts"), { recursive: true });
    await mkdir(join(scratch, "test"), { recursive: true });
    await writeFile(
      join(scratch, "scripts", "run-unit-tests.sh"),
      await readFile(runnerPath, "utf8")
    );
    await writeFile(join(scratch, "test", "alpha.test.js"), "// a\n");
    await writeFile(join(scratch, "test", "beta.test.js"), "// b\n");
    await writeFile(join(scratch, "test", "gamma-source.integration.test.js"), "// live\n");

    const result = spawnSync("sh", [join(scratch, "scripts", "run-unit-tests.sh")], {
      cwd: scratch,
      encoding: "utf8",
      env: { ...process.env, PATH: `${stub.bin}:${process.env.PATH}`, STUB_LOG: stub.log }
    });
    assert.equal(result.status, 0, result.stderr);
    const files = selectedFiles(await readArgs(stub.log));
    assert.deepEqual(files, ["test/alpha.test.js", "test/beta.test.js"]);
  } finally {
    await rm(scratch, { recursive: true, force: true });
    await rm(stub.dir, { recursive: true, force: true });
  }
});

test("a simulated integration file cannot enter the offline suite", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "unit-suite-int-"));
  const stub = await makeStubEnv();
  try {
    await mkdir(join(scratch, "scripts"), { recursive: true });
    await mkdir(join(scratch, "test"), { recursive: true });
    await writeFile(
      join(scratch, "scripts", "run-unit-tests.sh"),
      await readFile(runnerPath, "utf8")
    );
    await writeFile(join(scratch, "test", "unit.test.js"), "// unit\n");
    await writeFile(join(scratch, "test", "tps-source.integration.test.js"), "// live\n");

    const result = spawnSync("sh", [join(scratch, "scripts", "run-unit-tests.sh")], {
      cwd: scratch,
      encoding: "utf8",
      env: { ...process.env, PATH: `${stub.bin}:${process.env.PATH}`, STUB_LOG: stub.log }
    });
    assert.equal(result.status, 0, result.stderr);
    const files = selectedFiles(await readArgs(stub.log));
    assert.deepEqual(files, ["test/unit.test.js"]);
  } finally {
    await rm(scratch, { recursive: true, force: true });
    await rm(stub.dir, { recursive: true, force: true });
  }
});

// --- package.json wiring ---------------------------------------------------

test("npm test and npm run test:coverage use the same canonical runner", async () => {
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.equal(pkg.scripts.test, "sh scripts/run-unit-tests.sh");
  assert.equal(pkg.scripts["test:coverage"], "sh scripts/run-unit-tests.sh --coverage");
});

test("npm test no longer carries a manually duplicated file list", async () => {
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.doesNotMatch(
    pkg.scripts.test,
    /\.test\.js/,
    "npm test must not embed an explicit test-file list"
  );
  assert.doesNotMatch(
    pkg.scripts["test:coverage"],
    /\.test\.js/,
    "test:coverage must not embed an explicit test-file list"
  );
});

test("npm run test:integration selects all and only the live integration files", async () => {
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const cmd = pkg.scripts["test:integration"];
  assert.match(cmd, /^node --test /, "test:integration must use node --test");
  // The glob must target integration files only.
  assert.match(cmd, /integration\.test\.js/, "test:integration must target integration files");
  assert.doesNotMatch(cmd, /test\/\*\.test\.js(?!\S)/, "test:integration must not use the broad glob");

  // Resolve the glob the same way the shell would and compare to the real set.
  const integration = await realIntegrationFiles();
  assert.ok(integration.length > 0, "the repository must have integration files");
  const glob = cmd.replace(/^node --test /, "").trim();
  assert.equal(glob, "test/*-source.integration.test.js");
  // Every integration file matches the glob pattern.
  for (const file of integration) {
    assert.match(file, /^test\/.*-source\.integration\.test\.js$/);
  }
});

test("the coverage and fast commands cannot run live integrations", async () => {
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  // The canonical runner excludes integration files by construction; assert the
  // runner source contains the exclusion and that neither command names a live
  // integration file.
  const runner = await readFile(runnerPath, "utf8");
  assert.match(runner, /\.integration\.test\.js/, "the runner must exclude integration files");
  assert.doesNotMatch(pkg.scripts.test, /integration/, "npm test must not reference integration");
  assert.doesNotMatch(
    pkg.scripts["test:coverage"],
    /integration/,
    "test:coverage must not reference integration"
  );
});
