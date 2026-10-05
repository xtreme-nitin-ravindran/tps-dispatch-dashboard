import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Structural regression coverage for the Docker test image definition.
//
// The image is a dependency/tooling snapshot, not a source snapshot: the wrapper
// (scripts/docker-test.sh) mounts the current working tree read-only over
// /workspace during normal validation. These tests pin the properties that make
// the image correct and cheap to rebuild:
//
//   - the dependency install (`npm ci`) is isolated in its own layer, so a change
//     limited to source, scripts, tests, data, or frontend assets never
//     invalidates it;
//   - repository content is copied from relatively stable to relatively volatile
//     so an edit to a volatile path (for example test/) does not invalidate the
//     cache of the stable layers copied before it;
//   - every path the tests, linters, fixtures, or fingerprinting require is
//     copied explicitly, so the image stays self-contained;
//   - .dockerignore excludes only non-build inputs and never a copied path.
//
// These tests parse the files structurally; they never invoke Docker.

const root = new URL("../", import.meta.url);
const [dockerfile, dockerignore] = await Promise.all([
  readFile(new URL("Dockerfile.test", root), "utf8"),
  readFile(new URL(".dockerignore", root), "utf8")
]);

// The repository paths the image must contain. These are the paths the
// Dockerfile copies and that the offline suite, linters, and fixtures read.
const REQUIRED_COPY_PATHS = [
  "concourse",
  ".github",
  "data",
  "scripts",
  "src",
  "test",
  "app.js",
  "index.html",
  "service-worker.js",
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
  "styles.css",
  "eslint.config.js",
  "ruff.toml",
  "package.json",
  "package-lock.json",
  "Dockerfile.test",
  ".dockerignore"
];

// Parse the Dockerfile into ordered instructions, ignoring comments and blanks.
function instructions(text) {
  return text
    .split("\n")
    .map(line => line.trim())
    .filter(line => line && !line.startsWith("#"));
}

const lines = instructions(dockerfile);

test("the Dockerfile installs dependencies in an isolated layer", () => {
  const ciIndex = lines.findIndex(line => line === "RUN npm ci");
  assert.notEqual(ciIndex, -1, "the Dockerfile must run `npm ci`");
  // Only the manifests and multi-stage tooling copies (for example the pinned
  // Ruff binary) may precede `npm ci`; no repository content may.
  const beforeCi = lines.slice(0, ciIndex);
  const contentCopies = beforeCi.filter(
    line =>
      line.startsWith("COPY ") &&
      !line.startsWith("COPY --from=") &&
      !line.includes("package.json")
  );
  assert.deepEqual(
    contentCopies,
    [],
    "no repository content may be copied before `npm ci`"
  );
  // The manifests must be copied immediately before the install.
  assert.ok(
    beforeCi.some(line => line.startsWith("COPY package.json package-lock.json")),
    "the manifests must be copied before `npm ci`"
  );
});

test("the Dockerfile copies repository content from stable to volatile", () => {
  // The relative order of the content COPY layers must be stable-first so an
  // edit to a volatile path does not invalidate the stable layers before it.
  const order = ["concourse", ".github", "data", "scripts", "src", "test"];
  const positions = order.map(name => {
    const index = lines.findIndex(line => line === `COPY ${name} ./${name}`);
    assert.notEqual(index, -1, `the Dockerfile must copy ${name}`);
    return index;
  });
  const sorted = [...positions].sort((a, b) => a - b);
  assert.deepEqual(
    positions,
    sorted,
    "content COPY layers must be ordered stable-first (concourse, .github, data, scripts, src, test)"
  );
});

test("the Dockerfile copies every required repository path", () => {
  const copied = lines
    .filter(line => line.startsWith("COPY "))
    .join("\n");
  for (const path of REQUIRED_COPY_PATHS) {
    assert.ok(
      copied.includes(path),
      `the Dockerfile must copy ${path}`
    );
  }
});

test("the Dockerfile copies the pinned Ruff binary before repository content", () => {
  const ruffIndex = lines.findIndex(line => line.startsWith("COPY --from=ruff"));
  const firstContentIndex = lines.findIndex(line => line === "COPY concourse ./concourse");
  assert.notEqual(ruffIndex, -1, "the Dockerfile must copy the Ruff binary");
  assert.notEqual(firstContentIndex, -1);
  assert.ok(ruffIndex < firstContentIndex, "Ruff must be copied before repository content");
});

test("the Dockerfile keeps the fingerprint label and build arg", () => {
  assert.match(dockerfile, /^ARG TEST_FINGERPRINT=/m);
  assert.match(dockerfile, /^LABEL org\.sirento\.test-fingerprint=\$TEST_FINGERPRINT$/m);
});

test("the Dockerfile does not use a broad `COPY . .`", () => {
  assert.doesNotMatch(
    dockerfile,
    /^COPY\s+\.\s+\./m,
    "the Dockerfile must copy explicit paths, not the whole context"
  );
});

test("the Dockerfile default command runs the canonical test suite", () => {
  assert.match(dockerfile, /^CMD \["npm", "test"\]$/m);
});

// --- .dockerignore ---------------------------------------------------------

// Parse .dockerignore into non-comment, non-blank patterns.
const ignorePatterns = dockerignore
  .split("\n")
  .map(line => line.trim())
  .filter(line => line && !line.startsWith("#"));

test(".dockerignore excludes version control and host dependencies", () => {
  for (const pattern of [".git", "node_modules"]) {
    assert.ok(ignorePatterns.includes(pattern), `.dockerignore must exclude ${pattern}`);
  }
});

test(".dockerignore excludes local caches, coverage, and debug artifacts", () => {
  for (const pattern of [".cache", "coverage", "coverage-badges", "*.log"]) {
    assert.ok(ignorePatterns.includes(pattern), `.dockerignore must exclude ${pattern}`);
  }
});

test(".dockerignore excludes local environment and deployment secrets", () => {
  for (const pattern of [".env", ".env.*", ".dev.vars", "wrangler.toml", ".wrangler"]) {
    assert.ok(ignorePatterns.includes(pattern), `.dockerignore must exclude ${pattern}`);
  }
});

test(".dockerignore excludes editor and OS files", () => {
  for (const pattern of [".DS_Store", ".vscode", ".idea"]) {
    assert.ok(ignorePatterns.includes(pattern), `.dockerignore must exclude ${pattern}`);
  }
});

test(".dockerignore never excludes a path the Dockerfile copies", () => {
  // A rule that excluded a copied path would silently change the image while
  // leaving the fingerprint inputs unchanged. Guard the required paths.
  const required = [
    "concourse",
    ".github",
    "data",
    "scripts",
    "src",
    "test",
    "app.js",
    "index.html",
    "service-worker.js",
    "manifest.webmanifest",
    "icon-192.png",
    "icon-512.png",
    "styles.css",
    "eslint.config.js",
    "ruff.toml",
    "package.json",
    "package-lock.json",
    "Dockerfile.test"
  ];
  for (const path of required) {
    assert.ok(
      !ignorePatterns.includes(path),
      `.dockerignore must not exclude the copied path ${path}`
    );
  }
});

test(".dockerignore does not exclude the whole repository", () => {
  assert.ok(!ignorePatterns.includes("."), ".dockerignore must not exclude the whole context");
  assert.ok(!ignorePatterns.includes("*"), ".dockerignore must not exclude everything");
});
