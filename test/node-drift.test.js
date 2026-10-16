import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseDockerfileNode,
  parseDeclaredTags,
  parseTaskNodeTags,
  parseNpmVersion,
  detectDrift,
} from "../scripts/node-drift.js";
import {
  buildTitle,
  buildBody,
  reportDrift,
  main,
  createGhIssue,
  ISSUE_TITLE,
} from "../scripts/check-node-drift.js";

const DOCKERFILE = `FROM ghcr.io/astral-sh/ruff:0.17.1 AS ruff

FROM node:26-bookworm
`;
const NODE_IMAGE = `full: 26-bookworm
slim: 26-bookworm-slim
`;
const TASK = [
  { name: "tfs-etl.yml", text: "source: { repository: node, tag: 26-bookworm-slim }\nNPM_VERSION: 12.2.0\n" },
  { name: "ttc-vehicles.yml", text: "source: { repository: node, tag: 26-bookworm-slim }\n" },
];

test("[INFRA-CI][STORY-73] parseDockerfileNode extracts the FROM node tag", () => {
  assert.equal(parseDockerfileNode(DOCKERFILE), "26-bookworm");
  assert.equal(parseDockerfileNode("FROM scratch\n"), null);
});

test("[INFRA-CI][STORY-73] parseDeclaredTags parses the flat declared-tags map", () => {
  assert.deepEqual(parseDeclaredTags(NODE_IMAGE), { full: "26-bookworm", slim: "26-bookworm-slim" });
});

test("[INFRA-CI][STORY-73] parseTaskNodeTags extracts inline repository node tags", () => {
  assert.deepEqual(parseTaskNodeTags(TASK[0].text), ["26-bookworm-slim"]);
  assert.deepEqual(parseTaskNodeTags("no tags here\n"), []);
});

test("[INFRA-CI][STORY-73] parseNpmVersion extracts the pinned NPM_VERSION", () => {
  assert.equal(parseNpmVersion(TASK[0].text), "12.2.0");
  assert.equal(parseNpmVersion("NPM_VERSION:\n"), null);
});

test("[INFRA-CI][STORY-73] detectDrift reports no drift when Dockerfile and declared tags agree", () => {
  const result = detectDrift({ dockerfileText: DOCKERFILE, nodeImageText: NODE_IMAGE, taskFiles: TASK });
  assert.equal(result.drifted, false);
  assert.equal(result.dockerfileTag, "26-bookworm");
  assert.equal(result.declaredFull, "26-bookworm");
  assert.equal(result.declaredSlim, "26-bookworm-slim");
  assert.deepEqual(result.outOfBandTags, []);
});

test("[INFRA-CI][STORY-73] detectDrift reports drift when the Dockerfile moves ahead of the declared tags", () => {
  const result = detectDrift({
    dockerfileText: DOCKERFILE.replace("26-bookworm", "27-bookworm"),
    nodeImageText: NODE_IMAGE,
    taskFiles: TASK,
  });
  assert.equal(result.drifted, true);
  assert.equal(result.dockerfileTag, "27-bookworm");
  assert.equal(result.declaredFull, "26-bookworm");
});

test("[INFRA-CI][STORY-73] detectDrift flags task tags outside the declared pair", () => {
  const result = detectDrift({
    dockerfileText: DOCKERFILE,
    nodeImageText: NODE_IMAGE,
    taskFiles: [
      ...TASK,
      { name: "pipeline.yml", text: "source: { repository: node, tag: 26-bookworm }\nsource: { repository: node, tag: 99-bookworm }\n" },
    ],
  });
  assert.equal(result.drifted, false);
  assert.deepEqual(result.outOfBandTags, [{ file: "pipeline.yml", tag: "99-bookworm" }]);
});

test("[INFRA-CI][STORY-73] detectDrift tolerates a missing FROM and missing declared tags without crashing", () => {
  const result = detectDrift({ dockerfileText: "FROM scratch\n", nodeImageText: "", taskFiles: [] });
  assert.equal(result.drifted, false);
  assert.equal(result.dockerfileTag, null);
  assert.equal(result.declaredFull, undefined);
});

test("[INFRA-CI][STORY-73] buildTitle and buildBody produce a stable deduplicatable issue", () => {
  assert.equal(buildTitle(), ISSUE_TITLE);
  const body = buildBody({ dockerfileTag: "27-bookworm", declaredFull: "26-bookworm", declaredSlim: "26-bookworm-slim", outOfBandTags: [] });
  assert.match(body, /27-bookworm/);
  assert.match(body, /26-bookworm/);
  assert.match(body, /test\/concourse-node-image\.test\.js/);
  assert.doesNotMatch(body, /Out-of-band task tags/);
});

test("[INFRA-CI][STORY-73] buildBody lists out-of-band task tags when present", () => {
  const body = buildBody({
    dockerfileTag: "27-bookworm",
    declaredFull: "26-bookworm",
    declaredSlim: "26-bookworm-slim",
    outOfBandTags: [{ file: "pipeline.yml", tag: "99-bookworm" }],
  });
  assert.match(body, /Out-of-band task tags/);
  assert.match(body, /pipeline\.yml/);
  assert.match(body, /99-bookworm/);
});

test("[INFRA-CI][STORY-73] buildBody renders `(missing)` when tags are absent", () => {
  const body = buildBody({ dockerfileTag: null, declaredFull: undefined, declaredSlim: undefined, outOfBandTags: [] });
  assert.match(body, /\(missing\)/);
});

test("[INFRA-CI][STORY-73] reportDrift creates an issue on drift and skips on no drift", async () => {
  const calls = [];
  const issue = {
    exists: (title) => { calls.push(["exists", title]); return false; },
    create: (title, body) => calls.push(["create", title, body]),
  };
  const noDrift = { drifted: false, outOfBandTags: [], dockerfileTag: "26-bookworm", declaredFull: "26-bookworm", declaredSlim: "26-bookworm-slim" };
  assert.equal(await reportDrift({ detect: async () => noDrift, issue, log: () => {} }), "no-drift");
  assert.deepEqual(calls, []);

  const drift = { drifted: true, outOfBandTags: [], dockerfileTag: "27-bookworm", declaredFull: "26-bookworm", declaredSlim: "26-bookworm-slim" };
  assert.equal(await reportDrift({ detect: async () => drift, issue, log: () => {} }), "created");
  assert.deepEqual(calls.map(c => c[0]), ["exists", "create"]);
});

test("[INFRA-CI][STORY-73] reportDrift does not duplicate an existing open issue", async () => {
  const calls = [];
  const issue = {
    exists: () => calls.push(["exists"]) || true,
    create: (title, body) => calls.push(["create", title, body]),
  };
  const drift = { drifted: true, outOfBandTags: [], dockerfileTag: "27-bookworm", declaredFull: "26-bookworm", declaredSlim: "26-bookworm-slim" };
  assert.equal(await reportDrift({ detect: async () => drift, issue, log: () => {} }), "duplicate");
  assert.deepEqual(calls.map(c => c[0]), ["exists"]);
});

test("[INFRA-CI][STORY-73] reportDrift force-bypasses the duplicate check", async () => {
  const calls = [];
  const issue = {
    exists: () => calls.push(["exists"]) || true,
    create: (title, body) => calls.push(["create", title, body]),
  };
  const drift = { drifted: true, outOfBandTags: [], dockerfileTag: "27-bookworm", declaredFull: "26-bookworm", declaredSlim: "26-bookworm-slim" };
  assert.equal(await reportDrift({ detect: async () => drift, issue, log: () => {}, force: true }), "created");
  assert.deepEqual(calls.map(c => c[0]), ["create"]);
});

test("[INFRA-CI][STORY-73] createGhIssue returns exists-true and exists-false issue objects", () => {
  // Exists path: gh reports at least one matching open issue.
  const existsIssue = createGhIssue("owner/repo", () => JSON.stringify([{ number: 1 }]));
  assert.equal(existsIssue.exists("Node image drift"), true);

  // Not-exists path: gh reports an empty list.
  const noneIssue = createGhIssue("owner/repo", () => "[]");
  assert.equal(noneIssue.exists("Node image drift"), false);
});

test("[INFRA-CI][STORY-73] createGhIssue create invokes gh issue create", () => {
  const seen = [];
  const issue = createGhIssue("owner/repo", (cmd, args) => {
    seen.push({ cmd, args });
    return "";
  });
  issue.create("Node image drift", "body text");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].cmd, "gh");
  assert.ok(seen[0].args.includes("issue"));
  assert.ok(seen[0].args.includes("create"));
  assert.ok(seen[0].args.includes("Node image drift"));
  assert.ok(seen[0].args.includes("body text"));
});

test("[INFRA-CI][STORY-73] main injects an explicit issue and detect for in-process testing", async () => {
  const calls = [];
  const noDrift = { drifted: false, outOfBandTags: [], dockerfileTag: "26-bookworm", declaredFull: "26-bookworm", declaredSlim: "26-bookworm-slim" };
  const result = await main(
    { GITHUB_REPOSITORY: "owner/repo" },
    {
      detect: async () => noDrift,
      issue: {
        exists: (t) => calls.push(["exists", t]) || false,
        create: (t, b) => calls.push(["create", t, b]),
      },
    }
  );
  assert.equal(result, "no-drift");
  assert.deepEqual(calls, []);
});

test("[INFRA-CI][STORY-73] main defaults the issue to undefined when no repo is set", async () => {
  const noDrift = { drifted: false, outOfBandTags: [], dockerfileTag: "26-bookworm", declaredFull: "26-bookworm", declaredSlim: "26-bookworm-slim" };
  // No GITHUB_REPOSITORY and no injected issue: reportDrift's `no-drift` path
  // returns before issue.exists/create are touched, so an undefined issue is safe.
  const result = await main(
    {},
    { detect: async () => noDrift }
  );
  assert.equal(result, "no-drift");
});

test("[INFRA-CI][STORY-73] check-node-drift CLI exits cleanly with no drift and a fake gh", () => {
  const bin = mkdtempSync(join(tmpdir(), "node-drift-cli-"));
  try {
    const gh = join(bin, "gh");
    // No drift in the real working tree, so `gh` should never be invoked; the
    // fake returns an empty list if it is, exercising the exists() false path.
    writeFileSync(gh, `#!/bin/sh\necho '[]'\n`);
    chmodSync(gh, 0o755);
    const result = spawnSync(process.execPath, ["scripts/check-node-drift.js"], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_REPOSITORY: "owner/repo" },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /No Node image drift detected\./);
  } finally {
    rmSync(bin, { recursive: true, force: true });
  }
});
