import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { bumpAssetVersion, validateAssetVersionInput } from "../scripts/bump-asset-version.js";

const execFileAsync = promisify(execFile);
const root = new URL("../", import.meta.url);
const rootPath = new URL("../", import.meta.url).pathname;
const scriptPath = new URL("../scripts/bump-asset-version.js", import.meta.url).pathname;

const [html, worker] = await Promise.all([
  readFile(new URL("index.html", root), "utf8"),
  readFile(new URL("service-worker.js", root), "utf8")
]);

function matchOne(source, pattern, label) {
  const match = source.match(pattern);
  assert.ok(match, `expected ${label} to be present`);
  return match[1];
}

// The authoritative asset tag lives in index.html; the authoritative cache
// version lives in service-worker.js. Every other reference must agree.
const stylesheetTag = matchOne(html, /styles\.css\?v=([^"'<>\s]+)/, "index.html stylesheet version");
const appTag = matchOne(html, /app\.js\?v=([^"'<>\s]+)/, "index.html app module version");
const cacheVersion = matchOne(worker, /CACHE_VERSION = "([^"]+)"/, "service-worker.js cache version");

test("index.html stylesheet and app module share one asset version", () => {
  assert.equal(appTag, stylesheetTag);
});

test("service-worker cache version keeps the removable sirento-shell prefix", () => {
  assert.match(cacheVersion, /^sirento-shell-v\d+$/);
  assert.match(worker, /key\.startsWith\("sirento-shell-"\) && key !== CACHE_VERSION/);
});

test("every hardcoded asset-version reference agrees with the authoritative values", async () => {
  const references = [
    ["test/cluster-asset-versioning.test.js", /app\\\.js\\\?v=([A-Za-z0-9._-]+)/, appTag],
    ["test/cluster-asset-versioning.test.js", /CACHE_VERSION = "([^"]+)"/, cacheVersion],
    ["test/mobile-compositing.test.js", /styles\\\.css\\\?v=([A-Za-z0-9._-]+)/, stylesheetTag],
    ["test/mobile-compositing.test.js", /CACHE_VERSION = "([^"]+)"/, cacheVersion],
    ["test/pwa-metadata.test.js", /app\\\.js\\\?v=([A-Za-z0-9._-]+)/, appTag]
  ];
  for (const [file, pattern, expected] of references) {
    const source = await readFile(new URL(file, root), "utf8");
    const found = source.match(pattern);
    assert.ok(found, `${file} should reference a version matching ${pattern}`);
    assert.equal(found[1], expected, `${file} version drifted from the authoritative value`);
  }
});

async function withSandbox(run) {
  const dir = await mkdtemp(join(tmpdir(), "sirento-bump-"));
  try {
    await cp(join(rootPath, "index.html"), join(dir, "index.html"));
    await cp(join(rootPath, "service-worker.js"), join(dir, "service-worker.js"));
    await cp(join(rootPath, "test"), join(dir, "test"), { recursive: true });
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function readSandbox(dir) {
  const [nextHtml, nextWorker, cluster, compositing, pwa] = await Promise.all([
    readFile(join(dir, "index.html"), "utf8"),
    readFile(join(dir, "service-worker.js"), "utf8"),
    readFile(join(dir, "test", "cluster-asset-versioning.test.js"), "utf8"),
    readFile(join(dir, "test", "mobile-compositing.test.js"), "utf8"),
    readFile(join(dir, "test", "pwa-metadata.test.js"), "utf8")
  ]);
  return { nextHtml, nextWorker, cluster, compositing, pwa };
}

function assertBumped({ nextHtml, nextWorker, cluster, compositing, pwa }) {
  assert.match(nextHtml, /styles\.css\?v=story-99-1/);
  assert.match(nextHtml, /app\.js\?v=story-99-1/);
  assert.match(nextWorker, /CACHE_VERSION = "sirento-shell-v99"/);
  assert.match(cluster, /app\\\.js\\\?v=story-99-1/);
  assert.match(cluster, /CACHE_VERSION = "sirento-shell-v99"/);
  assert.match(compositing, /styles\\\.css\\\?v=story-99-1/);
  assert.match(compositing, /CACHE_VERSION = "sirento-shell-v99"/);
  assert.match(pwa, /app\\\.js\\\?v=story-99-1/);
}

test("bump script validation accepts complete input and rejects partial input", () => {
  assert.deepEqual(validateAssetVersionInput({ assetTag: "story-99-1", cacheVersion: "sirento-shell-v99" }), []);
  assert.equal(validateAssetVersionInput({ assetTag: "bad tag!", cacheVersion: "sirento-shell-v99" }).length, 1);
  assert.equal(validateAssetVersionInput({ assetTag: "story-99-1", cacheVersion: "v99" }).length, 1);
  assert.equal(validateAssetVersionInput({}).length, 2);
});

test("bump script updates every reference together", async () => {
  await withSandbox(async dir => {
    await execFileAsync("node", [scriptPath, "--asset", "story-99-1", "--cache", "sirento-shell-v99", "--root", dir]);
    assertBumped(await readSandbox(dir));
  });
});

test("bump script defaults to the working directory when no root is given", async () => {
  await withSandbox(async dir => {
    await execFileAsync("node", [scriptPath, "--asset", "story-99-1", "--cache", "sirento-shell-v99"], { cwd: dir });
    assertBumped(await readSandbox(dir));
  });
});

test("bump script reports no change when the requested versions already match", async () => {
  await withSandbox(async dir => {
    const { stdout } = await execFileAsync("node", [scriptPath, "--asset", stylesheetTag, "--cache", cacheVersion, "--root", dir]);
    assert.match(stdout, /No version references changed/);
    const changed = await bumpAssetVersion({ assetTag: stylesheetTag, cacheVersion, root: dir });
    assert.deepEqual(changed, []);
  });
});

test("bump script prints usage for --help and -h without editing files", async () => {
  await withSandbox(async dir => {
    for (const flag of ["--help", "-h"]) {
      const { stdout } = await execFileAsync("node", [scriptPath, flag, "--root", dir]);
      assert.match(stdout, /Usage: node scripts\/bump-asset-version\.js/);
    }
    const { nextHtml } = await readSandbox(dir);
    assert.match(nextHtml, new RegExp(`styles\\.css\\?v=${stylesheetTag}`));
  });
});

test("bump script rejects invalid input before touching any file", async () => {
  await withSandbox(async dir => {
    await assert.rejects(
      bumpAssetVersion({ assetTag: "bad tag!", cacheVersion, root: dir }),
      /Invalid asset tag/
    );
  });
});

test("bump script leaves every file unchanged on invalid or incomplete input", async () => {
  await withSandbox(async dir => {
    const before = await readSandbox(dir);
    for (const args of [
      ["--asset", "story-99-1"],
      ["--cache", "sirento-shell-v99"],
      ["--asset", "bad tag!", "--cache", "sirento-shell-v99"],
      ["--asset", "story-99-1", "--cache", "v99"],
      ["--asset", "story-99-1", "--cache", "sirento-shell-v99", "--bogus"]
    ]) {
      await assert.rejects(
        execFileAsync("node", [scriptPath, ...args, "--root", dir]),
        error => error.code === 1
      );
    }
    assert.deepEqual(await readSandbox(dir), before);
  });
});
