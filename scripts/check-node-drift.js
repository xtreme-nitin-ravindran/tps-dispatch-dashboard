// CLI entry point for the Node image drift check.
//
// Scheduled (and manually dispatchable) GitHub Actions workflow. It reads the
// Dockerfile, the declared tags, and the Concourse task files, computes drift,
// and opens a GitHub issue when the Dockerfile has moved ahead of the runtime
// (or a task tag is out of band). The issue title is stable so repeated runs
// do not open duplicate issues while the drift remains unfixed.
//
// The body of the entry point is kept minimal: the branching logic lives in
// `reportDrift` so both "drift found" and "no drift" paths are testable
// in-process without spawning the CLI.

import { readFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { detectDrift } from "./node-drift.js";

const root = fileURLToPath(new URL("../", import.meta.url));

export const ISSUE_TITLE = "Node image drift: Docker test image and Concourse runtime";

// The stable issue title is used for deduplication. A `--force` flag (for
// testing/backfill) bypasses the duplicate check.
export function buildTitle() {
  return ISSUE_TITLE;
}

// Compose the markdown body for a detected drift.
export function buildBody({ dockerfileTag, declaredFull, declaredSlim, outOfBandTags }) {
  const lines = [
    "Dependabot likely merged a `docker` Major bump that advanced the Docker test image ahead of the Concourse runtime. Update the following together, then rebuild the test image (`scripts/docker-test.sh --build`) and run `npm run verify`:",
    "",
    `- \`docker/Dockerfile.test\` \`FROM node:\` is currently \`${dockerfileTag ?? "(missing)"}\``,
    `- \`concourse/node-image.yml\` declares \`full: ${declaredFull ?? "(missing)"}\`, \`slim: ${declaredSlim ?? "(missing)"}\``,
  ];
  if (outOfBandTags.length) {
    lines.push("", "Out-of-band task tags (not equal to either declared tag):");
    for (const entry of outOfBandTags) {
      lines.push(`- \`concourse/${entry.file}\` \`tag: ${entry.tag}\``);
    }
  }
  lines.push(
    "",
    "The guard `test/concourse-node-image.test.js` enforces these stay aligned; do not close this issue until the Dockerfile, `concourse/node-image.yml`, all `concourse/*.yml` task tags, the `node:<tag>` mention in `docs/concourse.md`, and the two pinning tests (`test/ci-test-strategy.test.js`, `test/fly-exec-task.test.js`) are updated together."
  );
  return lines.join("\n");
}

// Read the three inputs from disk and compute drift.
async function readDrift() {
  const dockerfileText = await readFile(resolve(root, "docker/Dockerfile.test"), "utf8");
  const nodeImageText = await readFile(resolve(root, "concourse/node-image.yml"), "utf8");
  const dir = resolve(root, "concourse");
  const names = (await readdir(dir)).filter(name => name.endsWith(".yml") && name !== "node-image.yml");
  const taskFiles = [];
  for (const name of names) {
    taskFiles.push({ name, text: await readFile(resolve(dir, name), "utf8") });
  }
  return detectDrift({ dockerfileText, nodeImageText, taskFiles });
}

// Example issue object backed by the GitHub CLI. `exists` searches open issues
// for the stable title; `create` opens a new issue. Used by the production
// entry point; tests inject their own in-memory `issue` instead.
export function createGhIssue(repo, exec = execFileSync) {
  const run = (args, input) => String(exec("gh", args, { input, encoding: "utf8" }));
  return {
    exists(title) {
      const list = run([
        "issue",
        "list",
        "--repo",
        repo,
        "--state",
        "open",
        "--search",
        `"${title}"`,
        "--json",
        "number",
      ]);
      return JSON.parse(list).length > 0;
    },
    create(title, body) {
      run([
        "issue",
        "create",
        "--repo",
        repo,
        "--title",
        title,
        "--body",
        body,
      ]);
    },
  };
}

// The testable body. `deps` injects `detect` (defaults to disk read), an
// `issue` object with `exists(title)` and `create(title, body)`, and a `log`.
// Returns a summary string describing what happened.
export async function reportDrift({
  detect = readDrift,
  issue,
  log = console.log,
  force = false,
} = {}) {
  const result = await detect();

  const drifted = result.drifted || result.outOfBandTags.length > 0;
  if (!drifted) {
    log("No Node image drift detected.");
    return "no-drift";
  }

  const title = buildTitle();
  const body = buildBody(result);

  if (!force && issue.exists(title)) {
    log(`Drift issue already open (${title}); not creating a duplicate.`);
    return "duplicate";
  }

  issue.create(title, body);
  log(`Opened drift issue: ${title}`);
  return "created";
}

export async function main(env = process.env, deps = {}) {
  const repo = env.GITHUB_REPOSITORY;
  return reportDrift({
    detect: deps.detect,
    issue: deps.issue !== undefined ? deps.issue : (repo ? createGhIssue(repo) : undefined),
    force: deps.force,
  });
}

// Direct-invocation guard: always taken when run as the entry point, so its
// branch accounting stays a single path. `main` is exercised in-process by the
// test suite and through the guard by the CLI spawn test.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main(process.env);
}
