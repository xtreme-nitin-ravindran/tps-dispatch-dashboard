import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, writeFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { extractTaskConfig, runCli, isMainModule, main } from "../scripts/lib/extract-task.js";

// Deterministic regression coverage for the inline Concourse task extraction
// helper (scripts/lib/extract-task.js) and its shell wrapper
// (scripts/fly-exec-task.sh).
//
// The wrapper must extract a named task's config from the pipeline and run it
// with `fly execute` against the working tree, without duplicating task YAML.
// These tests never invoke the real `fly`: they place a stub `fly` on PATH that
// records its arguments, so extraction, argument forwarding, cleanup, and exit
// propagation can be asserted precisely.

const root = fileURLToPath(new URL("../", import.meta.url)).replace(/\/$/, "");
const wrapperPath = join(root, "scripts", "fly-exec-task.sh");
const pipelinePath = join(root, "concourse", "pipeline.yml");

// --- Node helper: extractTaskConfig ---------------------------------------

test("extractTaskConfig extracts an inline config and de-indents it", () => {
  const pipeline = [
    "jobs:",
    "  - name: j",
    "    plan:",
    "      - task: t",
    "        config:",
    "          platform: linux",
    "          run:",
    "            path: echo",
    "      - task: other",
    "        config:",
    "          platform: linux"
  ].join("\n");
  const result = extractTaskConfig(pipeline, "t");
  assert.equal(result.kind, "inline");
  assert.equal(result.config, "platform: linux\nrun:\n  path: echo\n");
});

test("extractTaskConfig returns a file reference for a file: task", () => {
  const pipeline = [
    "jobs:",
    "  - name: j",
    "    plan:",
    "      - task: t",
    "        file: repo/concourse/thing.yml"
  ].join("\n");
  const result = extractTaskConfig(pipeline, "t");
  assert.deepEqual(result, { kind: "file", path: "repo/concourse/thing.yml" });
});

test("extractTaskConfig strips surrounding quotes from a task name", () => {
  const pipeline = [
    "jobs:",
    "  - name: j",
    "    plan:",
    '      - task: "quoted-name"',
    "        config:",
    "          platform: linux"
  ].join("\n");
  const result = extractTaskConfig(pipeline, "quoted-name");
  assert.equal(result.kind, "inline");
  assert.equal(result.config, "platform: linux\n");
});

test("extractTaskConfig stops at the next task item", () => {
  const pipeline = [
    "jobs:",
    "  - name: j",
    "    plan:",
    "      - task: first",
    "        config:",
    "          platform: linux",
    "      - task: second",
    "        config:",
    "          platform: darwin"
  ].join("\n");
  assert.equal(extractTaskConfig(pipeline, "first").config, "platform: linux\n");
  assert.equal(extractTaskConfig(pipeline, "second").config, "platform: darwin\n");
});

test("extractTaskConfig preserves a multi-line block scalar verbatim", () => {
  const pipeline = [
    "jobs:",
    "  - name: j",
    "    plan:",
    "      - task: t",
    "        config:",
    "          run:",
    "            path: sh",
    "            args:",
    "              - -ec",
    "              - |",
    "                echo one",
    "                echo two"
  ].join("\n");
  const result = extractTaskConfig(pipeline, "t");
  assert.match(result.config, /- \|\n {6}echo one\n {6}echo two\n$/);
});

test("extractTaskConfig strips single quotes from a task name", () => {
  const pipeline = [
    "jobs:",
    "  - name: j",
    "    plan:",
    "      - task: 'single-quoted'",
    "        config:",
    "          platform: linux"
  ].join("\n");
  const result = extractTaskConfig(pipeline, "single-quoted");
  assert.equal(result.kind, "inline");
  assert.equal(result.config, "platform: linux\n");
});

test("extractTaskConfig leaves an unbalanced quote in a task name intact", () => {
  // A name that starts with a quote but does not end with one must not be
  // stripped: the compound quote check must fall through to the raw value.
  const pipeline = [
    "jobs:",
    "  - name: j",
    "    plan:",
    '      - task: "unbalanced',
    "        config:",
    "          platform: linux"
  ].join("\n");
  const result = extractTaskConfig(pipeline, '"unbalanced');
  assert.equal(result.kind, "inline");
  assert.equal(result.config, "platform: linux\n");
});

test("extractTaskConfig handles a single-character task name", () => {
  // A one-character name is shorter than the two-character quote check, so the
  // length guard must short-circuit before indexing the ends.
  const pipeline = [
    "jobs:",
    "  - name: j",
    "    plan:",
    "      - task: x",
    "        config:",
    "          platform: linux"
  ].join("\n");
  assert.equal(extractTaskConfig(pipeline, "x").config, "platform: linux\n");
});

test("extractTaskConfig stops at the next task item when the first has no config", () => {
  // A task with no config/file key, followed by another `- task:` at the same
  // indentation, must stop at that next task rather than borrowing its config.
  const pipeline = [
    "jobs:",
    "  - name: j",
    "    plan:",
    "      - task: bare",
    "        timeout: 5m",
    "      - task: real",
    "        config:",
    "          platform: linux"
  ].join("\n");
  assert.throws(() => extractTaskConfig(pipeline, "bare"), /no config: or file: key: bare/);
  assert.equal(extractTaskConfig(pipeline, "real").config, "platform: linux\n");
});

test("extractTaskConfig stops at a sibling list item before any config key", () => {
  // A task item with no config/file key, followed by a sibling `- get:` item at
  // the same dash indentation, must not borrow the next task's config.
  const pipeline = [
    "jobs:",
    "  - name: j",
    "    plan:",
    "      - task: bare",
    "        timeout: 5m",
    "      - get: repo",
    "      - task: real",
    "        config:",
    "          platform: linux"
  ].join("\n");
  assert.throws(() => extractTaskConfig(pipeline, "bare"), /no config: or file: key: bare/);
  assert.equal(extractTaskConfig(pipeline, "real").config, "platform: linux\n");
});

test("extractTaskConfig de-indents a line shallower than key+2 but deeper than key", () => {
  // A config child indented by only one space (less than the usual two) must be
  // de-indented by its own indentation, not over-trimmed.
  const pipeline = [
    "jobs:",
    "  - name: j",
    "    plan:",
    "      - task: t",
    "        config:",
    "         platform: linux"
  ].join("\n");
  const result = extractTaskConfig(pipeline, "t");
  assert.equal(result.config, "platform: linux\n");
});

test("extractTaskConfig throws clearly when the task is missing", () => {
  assert.throws(() => extractTaskConfig("jobs: []\n", "nope"), /task not found: nope/);
});

test("extractTaskConfig throws when the task has no config or file key", () => {
  const pipeline = [
    "jobs:",
    "  - name: j",
    "    plan:",
    "      - task: t",
    "        timeout: 5m"
  ].join("\n");
  assert.throws(() => extractTaskConfig(pipeline, "t"), /no config: or file: key: t/);
});

test("extractTaskConfig throws when the config block is empty", () => {
  const pipeline = [
    "jobs:",
    "  - name: j",
    "    plan:",
    "      - task: t",
    "        config:",
    "      - task: next",
    "        config:",
    "          platform: linux"
  ].join("\n");
  assert.throws(() => extractTaskConfig(pipeline, "t"), /config: block is empty: t/);
});

test("extractTaskConfig throws when a file: path is empty", () => {
  const pipeline = [
    "jobs:",
    "  - name: j",
    "    plan:",
    "      - task: t",
    "        file:"
  ].join("\n");
  assert.throws(() => extractTaskConfig(pipeline, "t"), /file: path is empty: t/);
});

// --- Node helper: runCli ---------------------------------------------------

test("runCli writes an inline config and prints inline:<path>", async () => {
  const dir = await mkdtemp(join(tmpdir(), "extract-cli-"));
  try {
    const pipeline = join(dir, "pipeline.yml");
    const scratch = join(dir, "out.yml");
    await writeFile(pipeline, "jobs:\n  - name: j\n    plan:\n      - task: t\n        config:\n          platform: linux\n");
    const lines = [];
    const result = await runCli({
      argv: ["node", "extract-task.js", pipeline, "t", scratch],
      out: line => lines.push(line)
    });
    assert.equal(result.kind, "inline");
    assert.deepEqual(lines, [`inline:${scratch}`]);
    assert.equal(await readFile(scratch, "utf8"), "platform: linux\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runCli prints file:<path> for a file: task without writing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "extract-cli-file-"));
  try {
    const pipeline = join(dir, "pipeline.yml");
    await writeFile(pipeline, "jobs:\n  - name: j\n    plan:\n      - task: t\n        file: repo/x.yml\n");
    const lines = [];
    const result = await runCli({
      argv: ["node", "extract-task.js", pipeline, "t", join(dir, "unused.yml")],
      out: line => lines.push(line)
    });
    assert.deepEqual(result, { kind: "file", path: "repo/x.yml" });
    assert.deepEqual(lines, ["file:repo/x.yml"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runCli exits 2 on a usage error", async () => {
  const codes = [];
  const errs = [];
  await runCli({
    argv: ["node", "extract-task.js"],
    err: line => errs.push(line),
    exit: code => codes.push(code)
  });
  assert.deepEqual(codes, [2]);
  assert.match(errs[0], /usage:/);
});

test("runCli exits 3 with a clear message when extraction fails", async () => {
  const dir = await mkdtemp(join(tmpdir(), "extract-cli-fail-"));
  try {
    const pipeline = join(dir, "pipeline.yml");
    await writeFile(pipeline, "jobs: []\n");
    const codes = [];
    const errs = [];
    await runCli({
      argv: ["node", "extract-task.js", pipeline, "missing", join(dir, "out.yml")],
      err: line => errs.push(line),
      exit: code => codes.push(code)
    });
    assert.deepEqual(codes, [3]);
    assert.match(errs[0], /task not found: missing/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runCli exits 3 when the pipeline file cannot be read", async () => {
  const codes = [];
  const errs = [];
  await runCli({
    argv: ["node", "extract-task.js", "/nonexistent/pipeline.yml", "t", "/tmp/out.yml"],
    err: line => errs.push(line),
    exit: code => codes.push(code)
  });
  assert.deepEqual(codes, [3]);
  assert.match(errs[0], /extract-task:/);
});

test("runCli uses the default console output and exit handlers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "extract-cli-defaults-"));
  const originalLog = console.log;
  const originalError = console.error;
  const logs = [];
  const errs = [];
  console.log = line => logs.push(line);
  console.error = line => errs.push(line);
  try {
    const pipeline = join(dir, "pipeline.yml");
    const scratch = join(dir, "out.yml");
    await writeFile(pipeline, "jobs:\n  - name: j\n    plan:\n      - task: t\n        config:\n          platform: linux\n");
    // No out/err/exit overrides: the defaults must be used.
    const result = await runCli({ argv: ["node", "extract-task.js", pipeline, "t", scratch] });
    assert.equal(result.kind, "inline");
    assert.deepEqual(logs, [`inline:${scratch}`]);

    // The default usage-error path writes to console.error and calls the real
    // process.exit; stub it so the test process survives.
    const originalExit = process.exit;
    const codes = [];
    process.exit = code => { codes.push(code); throw new Error("exit"); };
    try {
      await assert.rejects(
        runCli({ argv: ["node", "extract-task.js"] }),
        /exit/
      );
    } finally {
      process.exit = originalExit;
    }
    assert.deepEqual(codes, [2]);
    assert.match(errs[0], /usage:/);
  } finally {
    console.log = originalLog;
    console.error = originalError;
    await rm(dir, { recursive: true, force: true });
  }
});

test("isMainModule is true only when the module is the process entry point", () => {
  const moduleUrl = "file:///repo/scripts/lib/extract-task.js";
  // Direct invocation: argv[1] resolves to the module URL.
  assert.equal(isMainModule(["node", "/repo/scripts/lib/extract-task.js"], moduleUrl), true);
  // Imported: argv[1] is the test runner, not this module.
  assert.equal(isMainModule(["node", "/repo/test/runner.js"], moduleUrl), false);
  // No argv[1] at all.
  assert.equal(isMainModule(["node"], moduleUrl), false);
});

test("main runs the CLI only when the module is the entry point", async () => {
  const dir = await mkdtemp(join(tmpdir(), "extract-main-"));
  try {
    const pipeline = join(dir, "pipeline.yml");
    const scratch = join(dir, "out.yml");
    await writeFile(pipeline, "jobs:\n  - name: j\n    plan:\n      - task: t\n        config:\n          platform: linux\n");
    const moduleUrl = "file:///repo/scripts/lib/extract-task.js";

    // Imported (not the entry point): main must not run the CLI.
    const skipped = await main(["node", "/repo/test/runner.js"], moduleUrl);
    assert.equal(skipped, undefined);

    // Entry point: main runs the CLI and returns its result.
    const ran = await main(
      ["node", "/repo/scripts/lib/extract-task.js", pipeline, "t", scratch],
      moduleUrl
    );
    assert.equal(ran.kind, "inline");
    assert.equal(await readFile(scratch, "utf8"), "platform: linux\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("extractTaskConfig ignores a nested task item deeper than the task dash", () => {
  // A `- task:` line nested deeper than the outer task's dash (for example a
  // task step inside a `params:`/`on_success:` block) must not be mistaken for
  // the end of the outer task; the outer task's own config: key still wins.
  const pipeline = [
    "jobs:",
    "  - name: j",
    "    plan:",
    "      - task: outer",
    "        params:",
    "          steps:",
    "            - task: nested-step",
    "        config:",
    "          platform: linux",
    "      - task: after",
    "        config:",
    "          platform: darwin"
  ].join("\n");
  const outer = extractTaskConfig(pipeline, "outer");
  assert.equal(outer.kind, "inline");
  assert.equal(outer.config, "platform: linux\n");
  assert.equal(extractTaskConfig(pipeline, "after").config, "platform: darwin\n");
});

test("extractTaskConfig skips blank and comment lines before the config key", () => {
  const pipeline = [
    "jobs:",
    "  - name: j",
    "    plan:",
    "      - task: t",
    "",
    "        # a comment before the key",
    "        config:",
    "          platform: linux"
  ].join("\n");
  const result = extractTaskConfig(pipeline, "t");
  assert.equal(result.kind, "inline");
  assert.equal(result.config, "platform: linux\n");
});

test("the CLI entry-point guard runs runCli when invoked directly", async () => {
  // Spawn the helper as a subprocess so the `import.meta.url === argv[1]` guard
  // is exercised. The subprocess writes the extracted config and prints the
  // inline marker.
  const dir = await mkdtemp(join(tmpdir(), "extract-cli-guard-"));
  try {
    const pipeline = join(dir, "pipeline.yml");
    const scratch = join(dir, "out.yml");
    await writeFile(pipeline, "jobs:\n  - name: j\n    plan:\n      - task: t\n        config:\n          platform: linux\n");
    const result = spawnSync(
      process.execPath,
      [join(root, "scripts", "lib", "extract-task.js"), pipeline, "t", scratch],
      { encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), `inline:${scratch}`);
    assert.equal(await readFile(scratch, "utf8"), "platform: linux\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// --- Real pipeline: extraction is faithful --------------------------------

test("the real pipeline's inline tasks extract with their run blocks intact", async () => {
  const text = await readFile(pipelinePath, "utf8");
  const publish = extractTaskConfig(text, "update-and-publish");
  assert.equal(publish.kind, "inline");
  // The run block and the four R2 params must survive extraction.
  assert.match(publish.config, /^run:/m);
  assert.match(publish.config, /path: sh/);
  for (const param of ["R2_ENDPOINT", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]) {
    assert.match(publish.config, new RegExp(`${param}:`), `extracted config must contain ${param}`);
  }
  // The multi-line script body must be preserved, not truncated.
  assert.match(publish.config, /publish-incidents\.js/);

  assert.match(publish.config, /repository: node, tag: 24-bookworm-slim/);
  assert.match(publish.config, /npm ci --omit=dev/);
  assert.throws(() => extractTaskConfig(text, "build-test-image"), /task not found/);

  const geometry = extractTaskConfig(text, "publish-ttc-geometry");
  assert.equal(geometry.kind, "inline");
  assert.match(geometry.config, /publish-ttc-phase\.js/);

  const vehicles = extractTaskConfig(text, "observe-vehicles");
  assert.deepEqual(vehicles, { kind: "file", path: "repo/concourse/ttc-vehicles.yml" });
});

// --- Shell wrapper ---------------------------------------------------------

const STUB_FLY = `#!/bin/sh
set -eu
{
  printf 'ARGV'
  for a in "$@"; do printf '\\t%s' "$a"; done
  printf '\\n'
} >> "$STUB_LOG"
exit "\${STUB_FLY_EXIT:-0}"
`;

async function makeStubEnv() {
  const dir = await mkdtemp(join(tmpdir(), "fly-exec-stub-"));
  const bin = join(dir, "bin");
  await mkdir(bin, { recursive: true });
  const fly = join(bin, "fly");
  await writeFile(fly, STUB_FLY);
  await chmod(fly, 0o755);
  const log = join(dir, "log");
  await writeFile(log, "");
  return { dir, bin, log };
}

function runWrapper(args, { bin, log, env = {}, cwd = root } = {}) {
  return spawnSync("sh", [wrapperPath, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      STUB_LOG: log,
      ...env
    }
  });
}

async function readLog(log) {
  const text = await readFile(log, "utf8");
  return text
    .split("\n")
    .filter(Boolean)
    .map(line => line.split("\t").slice(1));
}

test("the wrapper is POSIX sh and does not use eval", async () => {
  const script = await readFile(wrapperPath, "utf8");
  assert.match(script, /^#!\/bin\/sh$/m, "fly-exec-task.sh must use a POSIX sh shebang");
  assert.match(script, /^set -eu$/m, "fly-exec-task.sh must use `set -eu`");
  const code = script
    .split("\n")
    .filter(line => !line.trimStart().startsWith("#"))
    .join("\n");
  assert.doesNotMatch(code, /\beval\b/, "fly-exec-task.sh must not use eval");
  assert.doesNotMatch(code, /\bbash\b/, "fly-exec-task.sh must not require bash");
  assert.doesNotMatch(code, /\btimeout\b/, "fly-exec-task.sh must not rely on GNU timeout");
});

test("the wrapper extracts an inline task and runs fly execute with -c", async () => {
  const stub = await makeStubEnv();
  try {
    const result = runWrapper(["update-and-publish"], stub);
    assert.equal(result.status, 0, result.stderr);
    const calls = await readLog(stub.log);
    assert.equal(calls.length, 1);
    const argv = calls[0];
    assert.equal(argv[0], "execute");
    const cIndex = argv.indexOf("-c");
    assert.notEqual(cIndex, -1, "fly execute must receive -c");
    const configPath = argv[cIndex + 1];
    assert.match(configPath, /update-and-publish\.yml$/);
  } finally {
    await rm(stub.dir, { recursive: true, force: true });
  }
});

test("the wrapper forwards --target as fly -t", async () => {
  const stub = await makeStubEnv();
  try {
    const result = runWrapper(["update-and-publish", "--target", "main"], stub);
    assert.equal(result.status, 0, result.stderr);
    const argv = (await readLog(stub.log))[0];
    const tIndex = argv.indexOf("-t");
    assert.notEqual(tIndex, -1, "fly must receive -t");
    assert.equal(argv[tIndex + 1], "main");
    assert.equal(argv[tIndex + 2], "execute");
  } finally {
    await rm(stub.dir, { recursive: true, force: true });
  }
});

test("the wrapper forwards args after -- unchanged and in order", async () => {
  const stub = await makeStubEnv();
  try {
    const result = runWrapper(
      ["update-and-publish", "--", "--input", "repo=.", "--output", "incident-repo=./out"],
      stub
    );
    assert.equal(result.status, 0, result.stderr);
    const argv = (await readLog(stub.log))[0];
    const cIndex = argv.indexOf("-c");
    assert.deepEqual(argv.slice(cIndex + 2), [
      "--input",
      "repo=.",
      "--output",
      "incident-repo=./out"
    ]);
  } finally {
    await rm(stub.dir, { recursive: true, force: true });
  }
});

test("the wrapper resolves a file: task to the repository-root path", async () => {
  const stub = await makeStubEnv();
  try {
    const result = runWrapper(["observe-vehicles"], stub);
    assert.equal(result.status, 0, result.stderr);
    const argv = (await readLog(stub.log))[0];
    const cIndex = argv.indexOf("-c");
    assert.equal(argv[cIndex + 1], join(root, "concourse", "ttc-vehicles.yml"));
  } finally {
    await rm(stub.dir, { recursive: true, force: true });
  }
});

test("the wrapper propagates fly's exit status", async () => {
  const stub = await makeStubEnv();
  try {
    const result = runWrapper(["update-and-publish"], {
      ...stub,
      env: { STUB_FLY_EXIT: "7" }
    });
    assert.equal(result.status, 7, "the wrapper must preserve fly's exit status");
  } finally {
    await rm(stub.dir, { recursive: true, force: true });
  }
});

test("the wrapper removes the scratch config after a successful run", async () => {
  const stub = await makeStubEnv();
  try {
    const result = runWrapper(["update-and-publish"], stub);
    assert.equal(result.status, 0, result.stderr);
    const scratch = join(root, ".cache", "fly-exec", "update-and-publish.yml");
    await assert.rejects(readFile(scratch, "utf8"), /ENOENT/);
  } finally {
    await rm(stub.dir, { recursive: true, force: true });
  }
});

test("the wrapper removes the scratch config after a failed run", async () => {
  const stub = await makeStubEnv();
  try {
    const result = runWrapper(["update-and-publish"], {
      ...stub,
      env: { STUB_FLY_EXIT: "1" }
    });
    assert.equal(result.status, 1);
    const scratch = join(root, ".cache", "fly-exec", "update-and-publish.yml");
    await assert.rejects(readFile(scratch, "utf8"), /ENOENT/);
  } finally {
    await rm(stub.dir, { recursive: true, force: true });
  }
});

test("the wrapper resolves the repository root independent of the caller's cwd", async () => {
  const stub = await makeStubEnv();
  const elsewhere = await mkdtemp(join(tmpdir(), "fly-exec-cwd-"));
  try {
    const result = runWrapper(["update-and-publish"], { ...stub, cwd: elsewhere });
    assert.equal(result.status, 0, result.stderr);
    const argv = (await readLog(stub.log))[0];
    const cIndex = argv.indexOf("-c");
    assert.ok(
      argv[cIndex + 1].startsWith(root + "/"),
      "the config path must resolve against the repository root"
    );
    assert.ok(
      !argv[cIndex + 1].startsWith(elsewhere),
      "the config path must not resolve against the caller's cwd"
    );
  } finally {
    await rm(stub.dir, { recursive: true, force: true });
    await rm(elsewhere, { recursive: true, force: true });
  }
});

test("the wrapper reports a usage error with no task name", async () => {
  const stub = await makeStubEnv();
  try {
    const result = runWrapper([], stub);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /usage:/);
    const calls = await readLog(stub.log);
    assert.equal(calls.length, 0, "fly must not run without a task name");
  } finally {
    await rm(stub.dir, { recursive: true, force: true });
  }
});

test("the wrapper fails clearly for an unknown task name", async () => {
  const stub = await makeStubEnv();
  try {
    const result = runWrapper(["no-such-task"], stub);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /task not found: no-such-task/);
    const calls = await readLog(stub.log);
    assert.equal(calls.length, 0, "fly must not run for an unknown task");
  } finally {
    await rm(stub.dir, { recursive: true, force: true });
  }
});

test("the wrapper rejects an unknown option", async () => {
  const stub = await makeStubEnv();
  try {
    const result = runWrapper(["update-and-publish", "--bogus"], stub);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /unknown option: --bogus/);
  } finally {
    await rm(stub.dir, { recursive: true, force: true });
  }
});

test("the wrapper fails clearly when fly is unavailable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fly-exec-nofly-"));
  try {
    const bin = join(dir, "bin");
    await mkdir(bin, { recursive: true });
    // Keep the shell utilities the wrapper needs reachable, but omit fly.
    for (const tool of ["sh", "dirname", "cat", "mkdir", "rm", "node"]) {
      const found = spawnSync("sh", ["-c", `command -v ${tool}`], { encoding: "utf8" });
      const path = found.stdout.trim();
      if (path && path.startsWith("/")) {
        const { symlink } = await import("node:fs/promises");
        await symlink(path, join(bin, tool));
      }
    }
    const result = spawnSync(join(bin, "sh"), [wrapperPath, "update-and-publish"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, PATH: bin }
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /fly is not installed/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the wrapper fails clearly when the pipeline file is missing", async () => {
  const stub = await makeStubEnv();
  try {
    const result = runWrapper(
      ["update-and-publish", "--pipeline", "/nonexistent/pipeline.yml"],
      stub
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /pipeline not found/);
  } finally {
    await rm(stub.dir, { recursive: true, force: true });
  }
});
