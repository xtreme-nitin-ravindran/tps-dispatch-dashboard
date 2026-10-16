// Node image drift detection for the Concourse runtime vs. the Docker test image.
//
// Renovate previously rewrote the Concourse `image_resource` tags and the
// `NPM_VERSION` in `concourse/tfs-etl.yml`. Renovate has been removed, and
// Dependabot cannot see those files (its `docker` ecosystem only parses
// Dockerfile `FROM` lines). The `docker` ecosystem is also left manual so a
// Dockerfile Major bump flows through a reviewed PR rather than auto-merging.
//
// This module is the safety net behind that flow: it compares the Node image
// referenced by `docker/Dockerfile.test` against `concourse/node-image.yml` and
// the inline Concourse task tags, and reports drift (the Dockerfile moved
// ahead of the runtime) without mutating anything. The CLI (see below) turns a
// detected drift into a GitHub issue, deduplicated by a stable title so a
// repeated run does not open duplicate issues while the drift remains unfixed.

// The testable body. `deps` injects `detect` (defaults to disk read), an
// `issue` object with `exists(title)` and `create(title, body)`, and a `log`.
// Returns a summary string describing what happened.
export function parseDockerfileNode(text) {
  const match = text.match(/^FROM node:(\S+)$/m);
  return match ? match[1] : null;
}

// Parse the flat `key: value` declared-tags map from concourse/node-image.yml.
export function parseDeclaredTags(text) {
  const tags = {};
  for (const line of text.split("\n")) {
    const match = line.match(/^([a-z]+):\s*(\S+)\s*$/);
    if (match) tags[match[1]] = match[2];
  }
  return tags;
}

// Extract the inline `repository: node, tag: X` values from a Concourse task
// file. Returns an array of the declared tags, in file order.
export function parseTaskNodeTags(text) {
  const tags = [];
  for (const match of text.matchAll(/repository:\s*node,\s*tag:\s*(\S+)/g)) {
    tags.push(match[1]);
  }
  return tags;
}

// Extract `NPM_VERSION: x.y.z` from a task file, or null when absent.
export function parseNpmVersion(text) {
  const match = text.match(/NPM_VERSION:\s*(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

// Compose a drift report from the four parsed sources. Returns:
//   { drifted: boolean, dockerfileTag, declaredFull, declaredSlim, taskTags, outOfBandTags }
// `outOfBandTags` are task tags not equal to either declared tag; a non-empty
// list is itself drift (tasks ahead of, or otherwise diverged from, the source
// of truth) even when the Dockerfile is in agreement.
export function detectDrift({ dockerfileText, nodeImageText, taskFiles }) {
  const dockerfileTag = parseDockerfileNode(dockerfileText);
  const declared = parseDeclaredTags(nodeImageText);
  const { full, slim } = declared;

  const taskTags = [];
  for (const { name, text } of taskFiles) {
    for (const tag of parseTaskNodeTags(text)) {
      taskTags.push({ file: name, tag });
    }
  }

  const allowed = new Set([full, slim].filter(Boolean));
  const outOfBandTags = taskTags.filter(entry => !allowed.has(entry.tag));

  // Drift means the Dockerfile references a different Node image than the
  // declared source of truth. A null/full/slim mismatch is the primary signal;
  // extra out-of-band task tags are reported separately but do not by
  // themselves mean "Dockerfile ahead of runtime".
  const drifted = Boolean(dockerfileTag && full && dockerfileTag !== full);

  return { drifted, dockerfileTag, declaredFull: full, declaredSlim: slim, taskTags, outOfBandTags };
}
