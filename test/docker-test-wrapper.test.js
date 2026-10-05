import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, writeFile, rm, chmod, cp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Deterministic regression coverage for scripts/docker-test.sh.
//
// The wrapper must run validation against the CURRENT working tree while keeping
// the image-installed node_modules and pinned tools. These tests never invoke the
// real Docker daemon or the real verification suite: they place a stub `docker`
// executable on PATH that records its arguments and simulates image inspect/build/
// run, so the wrapper's mount design, fingerprint check, argument handling, and
// failure propagation can be asserted precisely.

const root = fileURLToPath(new URL("../", import.meta.url)).replace(/\/$/, "");
const wrapperPath = join(root, "scripts", "docker-test.sh");

// A stub `docker` that records every invocation to $STUB_LOG and behaves according
// to $STUB_MODE. It never touches a real daemon.
const STUB_DOCKER = `#!/bin/sh
set -eu
{
  printf 'ARGV'
  for a in "$@"; do printf '\\t%s' "$a"; done
  printf '\\n'
} >> "$STUB_LOG"

cmd="\${1:-}"
case "$cmd" in
  image)
    sub="\${2:-}"
    case "$sub" in
      inspect)
        # Emulate: exists unless STUB_IMAGE_MISSING=1; fingerprint from STUB_FP.
        if [ "\${STUB_IMAGE_MISSING:-0}" = "1" ]; then
          exit 1
        fi
        # Detect the --format fingerprint query.
        for a in "$@"; do
          case "$a" in
            *Config.Labels*)
              printf '%s\\n' "\${STUB_FP:-}"
              exit 0
              ;;
          esac
        done
        exit 0
        ;;
    esac
    exit 0
    ;;
  build)
    exit "\${STUB_BUILD_EXIT:-0}"
    ;;
  run)
    exit "\${STUB_RUN_EXIT:-0}"
    ;;
esac
exit 0
`;

async function makeStubEnv() {
  const dir = await mkdtemp(join(tmpdir(), "docker-test-stub-"));
  const bin = join(dir, "bin");
  await mkdir(bin, { recursive: true });
  const docker = join(bin, "docker");
  await writeFile(docker, STUB_DOCKER);
  await chmod(docker, 0o755);
  const log = join(dir, "log");
  await writeFile(log, "");
  return { dir, bin, log };
}

function runWrapper(args, { bin, log, env = {}, cwd = root } = {}) {
  const result = spawnSync("sh", [wrapperPath, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      STUB_LOG: log,
      ...env
    }
  });
  return result;
}

async function readLog(log) {
  const text = await readFile(log, "utf8");
  return text
    .split("\n")
    .filter(Boolean)
    .map(line => line.split("\t").slice(1));
}

// Compute the wrapper's fingerprint the same way it does, so tests can present a
// matching or mismatching image fingerprint.
async function currentFingerprint() {
  const { createHash } = await import("node:crypto");
  const hash = createHash("sha256");
  for (const f of ["Dockerfile.test", ".dockerignore", "package.json", "package-lock.json"]) {
    hash.update(f + "\n");
    hash.update(await readFile(join(root, f)));
  }
  return hash.digest("hex");
}

test("the wrapper is POSIX sh and does not use eval", async () => {
  const script = await readFile(wrapperPath, "utf8");
  assert.match(script, /^#!\/bin\/sh$/m, "docker-test.sh must use a POSIX sh shebang");
  assert.match(script, /^set -eu$/m, "docker-test.sh must use `set -eu`");
  const code = script
    .split("\n")
    .filter(line => !line.trimStart().startsWith("#"))
    .join("\n");
  assert.doesNotMatch(code, /\beval\b/, "docker-test.sh must not use eval");
  assert.doesNotMatch(code, /\bbash\b/, "docker-test.sh must not require bash");
  assert.doesNotMatch(code, /\btimeout\b/, "docker-test.sh must not rely on GNU timeout");
});

test("the wrapper preserves command arguments separately and in order", async () => {
  const stub = await makeStubEnv();
  try {
    const fp = await currentFingerprint();
    const result = runWrapper(["npm", "run", "lint", "--", "--max-warnings", "0"], {
      ...stub,
      env: { STUB_FP: fp }
    });
    assert.equal(result.status, 0, result.stderr);
    const calls = await readLog(stub.log);
    const run = calls.find(c => c[0] === "run");
    assert.ok(run, "the wrapper must invoke docker run");
    // Everything after the image name is the wrapped command, unchanged.
    const imageIndex = run.indexOf("toronto-dispatch-tests");
    assert.notEqual(imageIndex, -1);
    assert.deepEqual(run.slice(imageIndex + 1), [
      "npm",
      "run",
      "lint",
      "--",
      "--max-warnings",
      "0"
    ]);
  } finally {
    await rm(stub.dir, { recursive: true, force: true });
  }
});

test("the wrapper does not corrupt option-like command arguments", async () => {
  const stub = await makeStubEnv();
  try {
    const fp = await currentFingerprint();
    const result = runWrapper(["node", "--test", "-e", "TZ=UTC", "test/theme.test.js"], {
      ...stub,
      env: { STUB_FP: fp }
    });
    assert.equal(result.status, 0, result.stderr);
    const calls = await readLog(stub.log);
    const run = calls.find(c => c[0] === "run");
    const imageIndex = run.indexOf("toronto-dispatch-tests");
    assert.deepEqual(run.slice(imageIndex + 1), [
      "node",
      "--test",
      "-e",
      "TZ=UTC",
      "test/theme.test.js"
    ]);
  } finally {
    await rm(stub.dir, { recursive: true, force: true });
  }
});

test("the wrapper resolves the repository root independent of the caller's cwd", async () => {
  const stub = await makeStubEnv();
  const elsewhere = await mkdtemp(join(tmpdir(), "docker-test-cwd-"));
  try {
    const fp = await currentFingerprint();
    const result = runWrapper(["npm", "test"], {
      ...stub,
      cwd: elsewhere,
      env: { STUB_FP: fp }
    });
    assert.equal(result.status, 0, result.stderr);
    const calls = await readLog(stub.log);
    const run = calls.find(c => c[0] === "run");
    // Mounts must point at the real repository root, not the caller's cwd.
    const mounts = run.filter(a => a.startsWith(root + "/"));
    assert.ok(mounts.length > 0, "mounts must reference the repository root");
    assert.ok(
      mounts.every(m => !m.startsWith(elsewhere)),
      "mounts must not reference the caller's cwd"
    );
  } finally {
    await rm(stub.dir, { recursive: true, force: true });
    await rm(elsewhere, { recursive: true, force: true });
  }
});

test("the wrapper mounts working-tree paths read-only and never mounts node_modules", async () => {
  const stub = await makeStubEnv();
  try {
    const fp = await currentFingerprint();
    const result = runWrapper(["npm", "test"], { ...stub, env: { STUB_FP: fp } });
    assert.equal(result.status, 0, result.stderr);
    const calls = await readLog(stub.log);
    const run = calls.find(c => c[0] === "run");
    const mounts = run.filter(a => a.includes(":/workspace/"));
    assert.ok(mounts.length > 0, "the wrapper must mount working-tree paths");
    for (const m of mounts) {
      assert.match(m, /:ro$/, `mount must be read-only: ${m}`);
    }
    assert.ok(
      !mounts.some(m => m.includes("node_modules")),
      "node_modules must never be mounted (it would shadow image dependencies)"
    );
    // Core validation inputs must be present.
    for (const required of ["src", "scripts", "test", "data", "concourse", ".github"]) {
      assert.ok(
        mounts.some(m => m.includes(`/workspace/${required}:ro`)),
        `the wrapper must mount ${required}`
      );
    }
    for (const required of ["app.js", "index.html", "service-worker.js", "styles.css", "eslint.config.js", "ruff.toml", "Dockerfile.test", ".dockerignore", "package.json", "package-lock.json"]) {
      assert.ok(
        mounts.some(m => m.includes(`/workspace/${required}:ro`)),
        `the wrapper must mount ${required}`
      );
    }
  } finally {
    await rm(stub.dir, { recursive: true, force: true });
  }
});

test("the wrapper runs the command in /workspace", async () => {
  const stub = await makeStubEnv();
  try {
    const fp = await currentFingerprint();
    const result = runWrapper(["npm", "test"], { ...stub, env: { STUB_FP: fp } });
    assert.equal(result.status, 0, result.stderr);
    const calls = await readLog(stub.log);
    const run = calls.find(c => c[0] === "run");
    const wIndex = run.indexOf("-w");
    assert.notEqual(wIndex, -1, "the wrapper must set the working directory");
    assert.equal(run[wIndex + 1], "/workspace");
  } finally {
    await rm(stub.dir, { recursive: true, force: true });
  }
});

test("the wrapper propagates the wrapped command's exit status", async () => {
  const stub = await makeStubEnv();
  try {
    const fp = await currentFingerprint();
    const result = runWrapper(["npm", "test"], {
      ...stub,
      env: { STUB_FP: fp, STUB_RUN_EXIT: "7" }
    });
    assert.equal(result.status, 7, "the wrapper must preserve the command exit status");
  } finally {
    await rm(stub.dir, { recursive: true, force: true });
  }
});

test("the wrapper fails clearly when the image is missing", async () => {
  const stub = await makeStubEnv();
  try {
    const result = runWrapper(["npm", "test"], {
      ...stub,
      env: { STUB_IMAGE_MISSING: "1" }
    });
    assert.notEqual(result.status, 0, "a missing image must fail");
    assert.match(result.stderr, /not found/i);
    assert.match(result.stderr, /--build/);
    const calls = await readLog(stub.log);
    assert.ok(!calls.some(c => c[0] === "run"), "no container may run without an image");
  } finally {
    await rm(stub.dir, { recursive: true, force: true });
  }
});

test("the wrapper fails clearly when the image fingerprint is stale", async () => {
  const stub = await makeStubEnv();
  try {
    const result = runWrapper(["npm", "test"], {
      ...stub,
      env: { STUB_FP: "deadbeef" }
    });
    assert.notEqual(result.status, 0, "a stale image must fail");
    assert.match(result.stderr, /stale/i);
    assert.match(result.stderr, /--build/);
    const calls = await readLog(stub.log);
    assert.ok(!calls.some(c => c[0] === "run"), "no container may run against a stale image");
  } finally {
    await rm(stub.dir, { recursive: true, force: true });
  }
});

test("the wrapper fails clearly when the image has no fingerprint label", async () => {
  const stub = await makeStubEnv();
  try {
    const result = runWrapper(["npm", "test"], { ...stub, env: { STUB_FP: "" } });
    assert.notEqual(result.status, 0, "an unlabelled image must fail");
    assert.match(result.stderr, /fingerprint/i);
    assert.match(result.stderr, /--build/);
  } finally {
    await rm(stub.dir, { recursive: true, force: true });
  }
});

test("the wrapper runs when the image fingerprint matches", async () => {
  const stub = await makeStubEnv();
  try {
    const fp = await currentFingerprint();
    const result = runWrapper(["npm", "test"], { ...stub, env: { STUB_FP: fp } });
    assert.equal(result.status, 0, result.stderr);
    const calls = await readLog(stub.log);
    assert.ok(calls.some(c => c[0] === "run"), "a matching image must run the command");
  } finally {
    await rm(stub.dir, { recursive: true, force: true });
  }
});

test("--build passes the current fingerprint as a build arg and tags the image", async () => {
  const stub = await makeStubEnv();
  try {
    const fp = await currentFingerprint();
    const result = runWrapper(["--build"], { ...stub });
    assert.equal(result.status, 0, result.stderr);
    const calls = await readLog(stub.log);
    const build = calls.find(c => c[0] === "build");
    assert.ok(build, "the wrapper must invoke docker build");
    assert.ok(
      build.includes(`TEST_FINGERPRINT=${fp}`),
      "the build must receive the current fingerprint"
    );
    assert.ok(build.includes("toronto-dispatch-tests"), "the build must tag the image");
    assert.ok(build.includes("-f"), "the build must specify the Dockerfile");
  } finally {
    await rm(stub.dir, { recursive: true, force: true });
  }
});

test("--ensure-image builds only when the image is missing or stale", async () => {
  const stub = await makeStubEnv();
  try {
    const fp = await currentFingerprint();

    // Missing image: must build.
    let result = runWrapper(["--ensure-image"], { ...stub, env: { STUB_IMAGE_MISSING: "1" } });
    assert.equal(result.status, 0, result.stderr);
    let calls = await readLog(stub.log);
    assert.ok(calls.some(c => c[0] === "build"), "a missing image must be built");

    // Fresh image: must not build.
    await writeFile(stub.log, "");
    result = runWrapper(["--ensure-image"], { ...stub, env: { STUB_FP: fp } });
    assert.equal(result.status, 0, result.stderr);
    calls = await readLog(stub.log);
    assert.ok(!calls.some(c => c[0] === "build"), "a fresh image must not be rebuilt");

    // Stale image: must build.
    await writeFile(stub.log, "");
    result = runWrapper(["--ensure-image"], { ...stub, env: { STUB_FP: "stale" } });
    assert.equal(result.status, 0, result.stderr);
    calls = await readLog(stub.log);
    assert.ok(calls.some(c => c[0] === "build"), "a stale image must be rebuilt");
  } finally {
    await rm(stub.dir, { recursive: true, force: true });
  }
});

test("the wrapper reports a clear usage error with no command", async () => {
  const stub = await makeStubEnv();
  try {
    const result = runWrapper([], { ...stub });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /usage/i);
  } finally {
    await rm(stub.dir, { recursive: true, force: true });
  }
});

test("the wrapper fails clearly when docker is unavailable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "docker-test-nodocker-"));
  try {
    // Keep the shell utilities the wrapper needs reachable, but omit docker.
    const bin = join(dir, "bin");
    await mkdir(bin, { recursive: true });
    for (const tool of ["sh", "dirname", "cat", "awk", "shasum", "openssl", "uname"]) {
      const found = spawnSync("sh", ["-c", `command -v ${tool}`], { encoding: "utf8" });
      const path = found.stdout.trim();
      if (path && path.startsWith("/")) await symlink(path, join(bin, tool));
    }
    const result = spawnSync(join(bin, "sh"), [wrapperPath, "npm", "test"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, PATH: bin }
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /docker/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the wrapper uses --rm so no container remains after a run", async () => {
  const stub = await makeStubEnv();
  try {
    const fp = await currentFingerprint();
    const result = runWrapper(["npm", "test"], { ...stub, env: { STUB_FP: fp } });
    assert.equal(result.status, 0, result.stderr);
    const calls = await readLog(stub.log);
    const run = calls.find(c => c[0] === "run");
    assert.ok(run.includes("--rm"), "the wrapper must remove the container after the run");
  } finally {
    await rm(stub.dir, { recursive: true, force: true });
  }
});

test("the wrapper's fingerprint changes when a dependency input changes", async () => {
  // Copy the wrapper and its fingerprint inputs into a scratch repo, then mutate
  // package.json and confirm the reported fingerprint changes. This proves the
  // fingerprint is content-derived, not commit-derived.
  const scratch = await mkdtemp(join(tmpdir(), "docker-test-fp-"));
  try {
    await mkdir(join(scratch, "scripts"), { recursive: true });
    await cp(wrapperPath, join(scratch, "scripts", "docker-test.sh"));
    for (const f of ["Dockerfile.test", ".dockerignore", "package.json", "package-lock.json"]) {
      await cp(join(root, f), join(scratch, f));
    }
    const before = spawnSync("sh", [join(scratch, "scripts", "docker-test.sh"), "--fingerprint"], {
      encoding: "utf8"
    });
    assert.equal(before.status, 0, before.stderr);
    const fpBefore = before.stdout.trim();

    const pkg = JSON.parse(await readFile(join(scratch, "package.json"), "utf8"));
    pkg.dependencies["gtfs-realtime-bindings"] = "9.9.9";
    await writeFile(join(scratch, "package.json"), JSON.stringify(pkg, null, 2));

    const after = spawnSync("sh", [join(scratch, "scripts", "docker-test.sh"), "--fingerprint"], {
      encoding: "utf8"
    });
    assert.equal(after.status, 0, after.stderr);
    const fpAfter = after.stdout.trim();

    assert.notEqual(fpBefore, fpAfter, "a dependency change must change the fingerprint");
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("the wrapper's fingerprint is stable for unchanged inputs", async () => {
  const a = spawnSync("sh", [wrapperPath, "--fingerprint"], { encoding: "utf8" });
  const b = spawnSync("sh", [wrapperPath, "--fingerprint"], { encoding: "utf8" });
  assert.equal(a.status, 0, a.stderr);
  assert.equal(b.status, 0, b.stderr);
  assert.equal(a.stdout.trim(), b.stdout.trim());
  assert.match(a.stdout.trim(), /^[0-9a-f]{64}$/);
});
