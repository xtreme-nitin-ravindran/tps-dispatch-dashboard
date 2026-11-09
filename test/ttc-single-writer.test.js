import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { TTC_GEOMETRY_KEY } from "../src/ttc/runtime.js";

// [STORY-79] Single-writer ownership of data/ttc-diversions.json.
//
// The continuous capture stack is the only writer of the public TTC geometry
// key. `buildTtcPublish` in src/ttc/runtime.js is the sole code path that PUTs
// the key (through the injected R2 sink); the incident schedulers (Concourse +
// GitHub Actions) publish only data/current.json, and the frontend only
// consumes the key as a fetch URL. The deployment orchestration that runs the
// stack lives in the homelab repo (see docs/homelab-deploy-handoff.md), so
// nothing in this repository's schedulers, CI, or scripts may publish the key.
//
// These tests are structural: they read the mounted repository files and assert
// the single-writer invariant, so a reintroduced scheduler write fails the
// canonical suite instead of shipping a second live writer.

const root = new URL("../", import.meta.url);

async function readRel(rel) {
  return readFile(new URL(rel, root), "utf8");
}

// Recursively list files (repo-relative paths) under a directory that ends in
// one of the given extensions.
async function listFiles(dir, extensions) {
  const files = [];
  const walk = async (current) => {
    const entries = await readdir(new URL(current, root), { withFileTypes: true });
    for (const entry of entries) {
      const rel = `${current}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(rel);
      } else if (extensions.some(ext => entry.name.endsWith(ext))) {
        files.push(rel);
      }
    }
    return files;
  };
  return walk(dir);
}

const publicKey = "data/ttc-diversions.json";

test("[STORY-79] TTC_GEOMETRY_KEY names the public geometry key", () => {
  assert.equal(TTC_GEOMETRY_KEY, publicKey);
});

test("[STORY-79] the key constant is defined exactly once, in src/ttc/runtime.js", async () => {
  const files = [
    ...(await listFiles("src", [".js"])),
    ...(await listFiles("scripts", [".js"]))
  ];
  const definitions = [];
  for (const rel of files) {
    const text = await readRel(rel);
    if (text.includes("export const TTC_GEOMETRY_KEY")) definitions.push(rel);
  }
  assert.deepEqual(definitions, ["src/ttc/runtime.js"]);
});

test("[STORY-79] buildTtcPublish is the sole publish path and uses the constant", async () => {
  const runtime = await readRel("src/ttc/runtime.js");
  assert.match(runtime, /publishFn\(\{ key: TTC_GEOMETRY_KEY, body: /);
  // The service entrypoint wires the publish collaborator from the runtime; it
  // contains no other publish of the public key.
  const service = await readRel("scripts/ttc-service.js");
  assert.match(service, /buildTtcPublish\(\{ sink: envCtx\.publishSink/);
});

test("[STORY-79] the projection never publishes: it validates, projects, and writes a local file", async () => {
  const projection = await readRel("scripts/publish-ttc-geometry.js");
  assert.doesNotMatch(projection, /createR2Sink|createR2CaptureSink|publishFn|createSinkFromEnv/);
  assert.match(projection, /writeFile\(process\.argv\[3\]/);
});

test("[STORY-79] the schedulers and CI reference neither the key nor the retired writer step", async () => {
  const files = [
    ...(await listFiles("concourse", [".yml", ".yaml"])),
    ...(await listFiles(".github", [".yml", ".yaml"]))
  ];
  assert.ok(files.length > 0, "expected scheduler files under concourse/ and .github/");
  for (const rel of files) {
    const text = await readRel(rel);
    // The retired scheduler step must never reappear.
    assert.ok(!text.includes("publish-ttc-geometry"), `${rel} references publish-ttc-geometry`);
    // The key may only appear inside comment lines (documentation of the
    // single-writer ownership); no active configuration may reference it.
    const activeLines = text.split("\n").filter(line => !line.trimStart().startsWith("#"));
    assert.ok(!activeLines.join("\n").includes(publicKey), `${rel} references ${publicKey} outside comments`);
  }
});

test("[STORY-79] the frontend only consumes the key (fetch URL), never the writer", async () => {
  const app = await readRel("src/app/app.js");
  assert.match(app, /fetch\(CONFIG\.snapshotUrl\.replace\('current\.json','ttc-diversions\.json'\)/);
  assert.ok(!app.includes("TTC_GEOMETRY_KEY"), "src/app/app.js must not import the writer constant");
  assert.ok(!app.includes("buildTtcPublish"), "src/app/app.js must not import the publisher");
});
