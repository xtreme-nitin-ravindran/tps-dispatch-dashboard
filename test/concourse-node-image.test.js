import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

// Drift guard for the Node image tags shared by the Concourse runtime tasks and
// the Docker test image.
//
// Dependabot bumps docker/Dockerfile.test (see .github/dependabot.yml), but it
// cannot see the Concourse `image_resource` tags: Dependabot's `docker`
// ecosystem only parses Dockerfile `FROM` lines and Kubernetes/Helm `image:`
// fields, not Concourse task YAML. Without a guard, a Dependabot Dockerfile
// bump would silently leave the production runtime on an older Node image.
//
// concourse/node-image.yml is the single declared source of truth. These tests
// assert that the Dockerfile and every Concourse task YAML agree with it, so a
// Dependabot bump fails CI until the runtime tags are updated in the same
// reviewed change. They also assert that the Dependabot
// `docker` entry that drives the bump still exists, so the guard cannot be
// silently disabled.
//
// These tests parse the files structurally; they never invoke Docker or Concourse.

const root = new URL("../", import.meta.url);

// Parse the two declared tags from concourse/node-image.yml. The file is a flat
// `key: value` map, so a simple line scan is sufficient and avoids a YAML
// dependency.
function parseDeclaredTags(text) {
  const tags = {};
  for (const line of text.split("\n")) {
    const match = line.match(/^([a-z]+):\s*(\S+)\s*$/);
    if (match) tags[match[1]] = match[2];
  }
  return tags;
}

const declaredText = await readFile(new URL("concourse/node-image.yml", root), "utf8");
const declared = parseDeclaredTags(declaredText);

test("[INFRA-CI][STORY-71] concourse/node-image.yml declares the full and slim Node image tags", () => {
  assert.equal(typeof declared.full, "string", "node-image.yml must declare `full`");
  assert.equal(typeof declared.slim, "string", "node-image.yml must declare `slim`");
  // The two tags must be distinct variants of the same Debian release so a
  // single Dependabot bump can move both together.
  assert.notEqual(declared.full, declared.slim);
  assert.match(declared.full, /^\d+-bookworm$/);
  assert.match(declared.slim, /^\d+-bookworm-slim$/);
  assert.equal(
    declared.slim,
    `${declared.full}-slim`,
    "the slim tag must be the full tag with a `-slim` suffix"
  );
});

test("[INFRA-CI][STORY-71] the Docker test image uses the declared full Node tag", async () => {
  const dockerfile = await readFile(new URL("docker/Dockerfile.test", root), "utf8");
  const match = dockerfile.match(/^FROM node:(\S+)$/m);
  assert.ok(match, "docker/Dockerfile.test must have a `FROM node:<tag>` line");
  assert.equal(
    match[1],
    declared.full,
    `docker/Dockerfile.test must use node:${declared.full}; update concourse/node-image.yml and the Concourse task YAMLs together when Dependabot bumps it`
  );
});

test("[INFRA-CI][STORY-71] every Concourse task uses a declared Node tag", async () => {
  const dir = new URL("concourse/", root);
  const files = (await readdir(dir)).filter(name => name.endsWith(".yml") && name !== "node-image.yml");
  assert.ok(files.length > 0, "concourse/ must contain task YAML files");
  const allowed = new Set([declared.full, declared.slim]);
  let seen = 0;
  for (const name of files) {
    const text = await readFile(new URL(name, dir), "utf8");
    for (const match of text.matchAll(/repository:\s*node,\s*tag:\s*(\S+)/g)) {
      seen++;
      assert.ok(
        allowed.has(match[1]),
        `concourse/${name} uses node tag ${match[1]}, which is not declared in concourse/node-image.yml (${declared.full} or ${declared.slim})`
      );
    }
  }
  assert.ok(seen > 0, "at least one Concourse task must reference a node image tag");
});

test("[INFRA-CI][STORY-71] dependabot.yml keeps the docker entry that drives the Node bump", async () => {
  const dependabot = await readFile(new URL(".github/dependabot.yml", root), "utf8");
  // The guard only has value while Dependabot still watches the Dockerfile.
  assert.match(
    dependabot,
    /package-ecosystem:\s*["']docker["']/,
    "dependabot.yml must keep a `docker` ecosystem entry"
  );
  assert.match(
    dependabot,
    /directory:\s*["']\/docker["']/,
    "the docker entry must point at /docker so it watches docker/Dockerfile.test"
  );
});
