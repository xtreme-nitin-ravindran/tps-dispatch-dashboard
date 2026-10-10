import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { ESLint } from "eslint";

// Regression coverage for the root tmp/** ESLint ignore.
//
// The repository-root tmp/ directory is git-ignored scratch space (see
// .gitignore: "/tmp/"). Developers drop throwaway debug scripts there, and
// those scripts are not repository inputs: they are not tracked, not copied
// into the Docker image, and not part of any required lint input. Before this
// ignore existed, a stray debug script in tmp/ could fail `eslint .` and block
// validation for a reason unrelated to the change under test.
//
// These tests pin two properties:
//
//   1. tmp/** is globally ignored, so a debug script placed there cannot break
//      `eslint .`;
//   2. the ignore is narrowly scoped: required repository inputs (scripts,
//      src, test, fixtures, browser helpers, and the root frontend files)
//      remain linted.
//
// The tests use ESLint's own resolution (isPathIgnored) against the real
// eslint.config.js, so they fail if the ignore is removed or widened.

const root = new URL("../", import.meta.url);

test("eslint.config.js globally ignores the git-ignored root tmp/ directory", async () => {
  const eslint = new ESLint({ cwd: new URL(".", root).pathname });
  assert.equal(
    await eslint.isPathIgnored("tmp/debug-script.js"),
    true,
    "tmp/** must be globally ignored so scratch debug scripts cannot break eslint ."
  );
  assert.equal(
    await eslint.isPathIgnored("tmp/nested/debug-script.js"),
    true,
    "the tmp/** ignore must cover nested scratch paths"
  );
});

test("a debug script in tmp/ cannot break eslint .", async () => {
  const repoRoot = new URL(".", root).pathname;
  const scratchDir = join(repoRoot, "tmp", "eslint-ignore-regression");
  const debugScript = join(scratchDir, "debug-script.js");
  try {
    await mkdir(scratchDir, { recursive: true });
    // A file that would certainly fail linting if it were linted: it uses an
    // undefined global and an unused variable.
    await writeFile(
      debugScript,
      "const unused = 1;\nnotDefinedAnywhere();\n",
      "utf8"
    );

    // Lint the repository the way `eslint .` does. Because tmp/** is ignored,
    // the debug script is never selected, so it cannot contribute errors.
    const eslint = new ESLint({ cwd: repoRoot });
    const results = await eslint.lintFiles(["."]);
    const lintedTmpFiles = results.filter(r =>
      r.filePath.includes(`${join(repoRoot, "tmp")}`)
    );
    assert.equal(
      lintedTmpFiles.length,
      0,
      "an ignored tmp/ debug script must not be selected by eslint ."
    );
    assert.ok(
      results.length > 0,
      "eslint . must still lint the required repository inputs"
    );
  } finally {
    await rm(scratchDir, { recursive: true, force: true });
  }
});

test("required repository inputs remain linted", async () => {
  const eslint = new ESLint({ cwd: new URL(".", root).pathname });
  const required = [
    "src/app/app.js",
    "service-worker.js",
    "eslint.config.js",
    "src/ttc/ttc-alerts.js",
    "scripts/lib/browser-timing.js",
    "test/docker-image-layout.test.js"
  ];
  for (const path of required) {
    assert.equal(
      await eslint.isPathIgnored(path),
      false,
      `${path} must remain linted; the tmp/** ignore must stay narrowly scoped`
    );
  }
});

test("the tmp/** ignore is scoped to the root and does not hide nested fixture paths", async () => {
  const eslint = new ESLint({ cwd: new URL(".", root).pathname });
  // A nested path that merely contains "tmp" as a segment must not be ignored.
  assert.equal(
    await eslint.isPathIgnored("test/fixtures/tmp/example.js"),
    false,
    "only the root tmp/** directory is ignored, not nested tmp-named paths"
  );
});
