import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  changedPaths,
  classifyChanges,
  classifyPath,
  classifyRepository,
  collectToolingFiles,
  isDocumentationCandidate,
  isReferencedByTooling,
  listFilesUnder,
  listToolingFiles,
  parseNameStatus,
  readToolingFiles
} from "../scripts/docs-only.js";

// Story 52D: documentation-only changes may skip the expensive application test
// jobs, but only when every changed path is documentation that no executable
// tooling consumes. These tests pin the conservative classifier and the
// workflow wiring that keeps every required status context terminal.

const root = new URL("../", import.meta.url);
const scriptPath = fileURLToPath(new URL("../scripts/docs-only.js", import.meta.url));
const workflow = await readFile(new URL(".github/workflows/tests.yml", root), "utf8");

// A small, deterministic tooling corpus. `_config.yml` is a configuration file
// where a bare path token is a real reference; `app.js` is a code file where
// only a quoted/backticked literal counts.
const tooling = collectToolingFiles(
  ["_config.yml", "app.js", "scripts/example.js"],
  file => ({
    "_config.yml": "exclude:\n  - AGENTS.md\n",
    "app.js": "See README.md for the optional proxy setup.\n",
    "scripts/example.js": "const doc = 'docs/consumed.md';\n"
  })[file]
);

test("documentation candidates require an allowed extension and location", () => {
  assert.equal(isDocumentationCandidate("README.md"), true);
  assert.equal(isDocumentationCandidate("docs/guide.md"), true);
  assert.equal(isDocumentationCandidate("docs/notes.txt"), true);
  assert.equal(isDocumentationCandidate("docs/spec.rst"), true);
  // A Markdown extension alone is not enough: the location must be allowed.
  assert.equal(isDocumentationCandidate("src/notes.md"), false);
  assert.equal(isDocumentationCandidate("test/fixture.md"), false);
  // Non-documentation extensions are never candidates.
  assert.equal(isDocumentationCandidate("docs/script.js"), false);
  assert.equal(isDocumentationCandidate("app.js"), false);
  assert.equal(isDocumentationCandidate(""), false);
  assert.equal(isDocumentationCandidate(undefined), false);
});

test("a documentation file consumed by tooling keeps full validation", () => {
  // AGENTS.md is a bare path token in a configuration file: a real reference.
  assert.equal(isReferencedByTooling("AGENTS.md", tooling), true);
  // docs/consumed.md is a quoted literal in a script: a real reference.
  assert.equal(isReferencedByTooling("docs/consumed.md", tooling), true);
  // README.md appears only as prose in a code file: not a reference.
  assert.equal(isReferencedByTooling("README.md", tooling), false);
  assert.equal(isReferencedByTooling("docs/unreferenced.md", tooling), false);
  assert.equal(isReferencedByTooling("", tooling), false);
});

test("documentation-only, mixed, workflow-only, configuration-only and generated-snapshot changes", () => {
  // Documentation-only: every path is inert documentation.
  assert.equal(classifyChanges(["README.md", "docs/guide.md"], tooling).docsOnly, true);
  // Mixed: one application file forces full validation.
  assert.equal(classifyChanges(["README.md", "app.js"], tooling).docsOnly, false);
  // Workflow-only: a workflow file is executable tooling.
  assert.equal(classifyChanges([".github/workflows/tests.yml"], tooling).docsOnly, false);
  // Configuration-only: configuration is executable tooling.
  assert.equal(classifyChanges(["package.json"], tooling).docsOnly, false);
  assert.equal(classifyChanges(["_config.yml"], tooling).docsOnly, false);
  // Generated snapshot: data is never documentation.
  assert.equal(classifyChanges(["data/current.json"], tooling).docsOnly, false);
  // A documentation file that tooling consumes keeps full validation.
  assert.equal(classifyChanges(["AGENTS.md"], tooling).docsOnly, false);
  assert.equal(classifyChanges(["docs/consumed.md"], tooling).docsOnly, false);
  // No changed paths is never documentation-only.
  assert.equal(classifyChanges([], tooling).docsOnly, false);
  assert.equal(classifyChanges(undefined, tooling).docsOnly, false);
});

test("renames and deletions are handled conservatively", () => {
  // A rename contributes both the old and the new path.
  assert.deepEqual(
    parseNameStatus("R100\tdocs/old.md\tdocs/new.md\n"),
    ["docs/old.md", "docs/new.md"]
  );
  // A deletion contributes the deleted path.
  assert.deepEqual(parseNameStatus("D\tdocs/removed.md\n"), ["docs/removed.md"]);
  // A modification contributes its path.
  assert.deepEqual(parseNameStatus("M\tapp.js\n"), ["app.js"]);
  // A copy contributes both paths.
  assert.deepEqual(
    parseNameStatus("C075\tdocs/a.md\tdocs/b.md\n"),
    ["docs/a.md", "docs/b.md"]
  );
  // Blank lines are ignored.
  assert.deepEqual(parseNameStatus("\n\n"), []);
  // A rename from documentation into application code keeps full validation.
  assert.equal(
    classifyChanges(parseNameStatus("R100\tdocs/old.md\tsrc/new.js\n"), tooling).docsOnly,
    false
  );
  // A rename between two documentation paths stays documentation-only.
  assert.equal(
    classifyChanges(parseNameStatus("R100\tdocs/old.md\tdocs/new.md\n"), tooling).docsOnly,
    true
  );
  // Deleting a documentation file is documentation-only.
  assert.equal(
    classifyChanges(parseNameStatus("D\tdocs/removed.md\n"), tooling).docsOnly,
    true
  );
  // Deleting an application file keeps full validation.
  assert.equal(
    classifyChanges(parseNameStatus("D\tapp.js\n"), tooling).docsOnly,
    false
  );
});

test("classifyPath reports a reason for every outcome", () => {
  assert.match(classifyPath("app.js", tooling).reason, /not documentation/);
  assert.match(classifyPath("AGENTS.md", tooling).reason, /consumed by tooling/);
  assert.match(classifyPath("docs/guide.md", tooling).reason, /documentation-only/);
});

test("the real repository tooling corpus classifies documentation safely", () => {
  const realTooling = readToolingFiles();
  // README.md is only mentioned in prose, so it is documentation-only.
  assert.equal(classifyPath("README.md", realTooling).docsOnly, true);
  // AGENTS.md is referenced by _config.yml, so it keeps full validation.
  assert.equal(classifyPath("AGENTS.md", realTooling).docsOnly, false);
  // A representative docs file is documentation-only.
  assert.equal(classifyPath("docs/work-log.md", realTooling).docsOnly, true);
});

test("the workflow keeps every required context terminal for documentation-only changes", () => {
  // The classifier runs in its own job and exposes a docs_only output.
  assert.match(workflow, /name: Classify change/);
  assert.match(workflow, /docs_only: \$\{\{ steps\.classify\.outputs\.docs_only \}\}/);
  assert.match(workflow, /run: node scripts\/docs-only\.js/);
  // The tests job still runs and depends on the classifier.
  assert.match(workflow, /name: All tests \(Docker\)\n\s+needs: changes/);
  // Every expensive step is gated on the classifier, not skipped at the job level.
  const gated = [
    "Keep generated snapshots out of code changes",
    "Build test image",
    "Run unit tests (America/Los_Angeles)",
    "Run Python tests",
    "Run linters",
    "Check browser JavaScript syntax",
    "Run canonical offline suite with coverage (TZ=UTC)",
    "Save coverage badges and report"
  ];
  for (const step of gated) {
    const index = workflow.indexOf(`name: ${step}`);
    assert.ok(index >= 0, `workflow must contain step: ${step}`);
    const block = workflow.slice(index, index + 400);
    assert.match(block, /needs\.changes\.outputs\.docs_only != 'true'/, `${step} must be gated`);
  }
  // A documentation-only run still reports a terminal success step.
  assert.match(workflow, /Documentation-only change; application tests not required/);
  // The coverage job depends on the classifier and never downloads a missing artifact.
  assert.match(workflow, /needs: \[changes, tests\]/);
  assert.match(workflow, /Documentation-only change; no coverage to publish/);
  // Promotion still depends only on the tests job, so it proceeds after a docs-only pass.
  assert.match(workflow, /name: Promote tested dev\n\s+needs: tests/);
});

test("the workflow never skips an entire required workflow for documentation-only changes", () => {
  // A workflow-level paths-ignore would leave promotion waiting indefinitely.
  assert.doesNotMatch(workflow, /paths-ignore/);
  assert.doesNotMatch(workflow, /paths:/);
  // The tests job itself is never conditionally skipped.
  assert.doesNotMatch(workflow, /name: All tests \(Docker\)[\s\S]{0,200}if: needs\.changes/);
});

test("collectToolingFiles tolerates an unreadable tooling file", () => {
  const collected = collectToolingFiles(["missing.js", "present.js"], file => {
    if (file === "missing.js") throw new Error("ENOENT");
    return "const x = 1;";
  });
  assert.deepEqual(collected, [{ file: "present.js", text: "const x = 1;" }]);
});

test("listToolingFiles skips absent globs and walks present directories", () => {
  const dir = mkdtempSync(join(tmpdir(), "docs-only-list-"));
  try {
    // A cwd with none of the tooling globs yields no files (covers the statSync
    // catch branch).
    assert.deepEqual(listToolingFiles(dir), []);
    // A present directory is walked recursively and its files are returned.
    mkdirSync(join(dir, "scripts"));
    writeFileSync(join(dir, "scripts", "a.js"), "a");
    mkdirSync(join(dir, "scripts", "nested"));
    writeFileSync(join(dir, "scripts", "nested", "b.js"), "b");
    // A present file glob is included directly.
    writeFileSync(join(dir, "package.json"), "{}");
    const files = listToolingFiles(dir).sort();
    assert.deepEqual(files, ["package.json", "scripts/a.js", "scripts/nested/b.js"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("listToolingFiles excludes the classifier's own files", () => {
  const files = listToolingFiles();
  assert.ok(!files.includes("scripts/docs-only.js"));
  assert.ok(!files.includes("test/docs-only.test.js"));
  assert.ok(files.includes("app.js"));
});

test("listFilesUnder returns no files for an unreadable directory", () => {
  // A directory that cannot be read contributes no files rather than throwing.
  assert.deepEqual(listFilesUnder("/nonexistent-root", "missing-dir"), []);
});

test("listFilesUnder handles an empty relative prefix", () => {
  const dir = mkdtempSync(join(tmpdir(), "docs-only-root-"));
  try {
    writeFileSync(join(dir, "top.js"), "top");
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "nested.js"), "nested");
    // An empty relative prefix lists the directory's own entries by name.
    assert.deepEqual(listFilesUnder(dir, "").sort(), ["sub/nested.js", "top.js"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("changedPaths and classifyRepository read a real git diff", () => {
  const dir = mkdtempSync(join(tmpdir(), "docs-only-git-"));
  const git = (...args) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  try {
    git("init", "-q");
    git("config", "user.email", "test@example.test");
    git("config", "user.name", "Test");
    mkdirSync(join(dir, "docs"));
    writeFileSync(join(dir, "docs", "guide.md"), "hello\n");
    writeFileSync(join(dir, "app.js"), "const x = 1;\n");
    git("add", "-A");
    git("commit", "-q", "-m", "initial");
    const base = git("rev-parse", "HEAD").stdout.trim();

    // A documentation-only change is classified as documentation-only.
    writeFileSync(join(dir, "docs", "guide.md"), "hello world\n");
    git("add", "-A");
    git("commit", "-q", "-m", "docs");
    const docsHead = git("rev-parse", "HEAD").stdout.trim();
    assert.deepEqual(changedPaths(base, docsHead, dir), ["docs/guide.md"]);
    assert.equal(classifyRepository({ base, head: docsHead, cwd: dir }).docsOnly, true);

    // An application change keeps full validation.
    writeFileSync(join(dir, "app.js"), "const x = 2;\n");
    git("add", "-A");
    git("commit", "-q", "-m", "app");
    const appHead = git("rev-parse", "HEAD").stdout.trim();
    assert.equal(classifyRepository({ base: docsHead, head: appHead, cwd: dir }).docsOnly, false);

    // With no explicit range the default HEAD^...HEAD range is used.
    assert.deepEqual(changedPaths(undefined, undefined, dir), ["app.js"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the CLI writes the docs_only output and exits zero", () => {
  const dir = mkdtempSync(join(tmpdir(), "docs-only-cli-"));
  const output = join(dir, "github-output");
  const git = (...args) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  try {
    // A real git repo keeps the CLI's git diff working inside the read-only
    // Docker mount, which does not include the repository's own .git.
    git("init", "-q");
    git("config", "user.email", "test@example.test");
    git("config", "user.name", "Test");
    mkdirSync(join(dir, "docs"));
    writeFileSync(join(dir, "docs", "guide.md"), "hello\n");
    git("add", "-A");
    git("commit", "-q", "-m", "initial");
    const head = git("rev-parse", "HEAD").stdout.trim();

    const result = spawnSync(process.execPath, [scriptPath], {
      encoding: "utf8",
      cwd: dir,
      env: { ...process.env, DOCS_ONLY_BASE: head, DOCS_ONLY_HEAD: head, GITHUB_OUTPUT: output }
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /no changed paths detected/);
    assert.equal(readFileSync(output, "utf8"), "docs_only=false\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the CLI accepts base and head as arguments", () => {
  const dir = mkdtempSync(join(tmpdir(), "docs-only-argv-"));
  const git = (...args) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  try {
    git("init", "-q");
    git("config", "user.email", "test@example.test");
    git("config", "user.name", "Test");
    mkdirSync(join(dir, "docs"));
    writeFileSync(join(dir, "docs", "guide.md"), "hello\n");
    git("add", "-A");
    git("commit", "-q", "-m", "initial");
    const head = git("rev-parse", "HEAD").stdout.trim();

    // No DOCS_ONLY_* env vars: the CLI falls back to argv[2] and argv[3].
    const env = { ...process.env };
    delete env.DOCS_ONLY_BASE;
    delete env.DOCS_ONLY_HEAD;
    delete env.GITHUB_OUTPUT;
    const result = spawnSync(process.execPath, [scriptPath, head, head], { encoding: "utf8", cwd: dir, env });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /no changed paths detected/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the CLI fails safe when classification throws", () => {
  // An invalid git range makes classifyRepository throw; the CLI must keep full
  // validation rather than skip it, and must still exit zero.
  const dir = mkdtempSync(join(tmpdir(), "docs-only-fail-"));
  const output = join(dir, "github-output");
  try {
    const result = spawnSync(process.execPath, [scriptPath], {
      encoding: "utf8",
      cwd: dir,
      env: { ...process.env, DOCS_ONLY_BASE: "does-not-exist", DOCS_ONLY_HEAD: "also-missing", GITHUB_OUTPUT: output }
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /classification failed; keeping full validation/);
    assert.equal(readFileSync(output, "utf8"), "docs_only=false\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
