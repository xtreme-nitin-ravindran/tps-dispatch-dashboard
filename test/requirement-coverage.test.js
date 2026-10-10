import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  INFRA_AREAS,
  PRD_PREFIXES,
  checkRequirements,
  extractAllIds,
  extractIds,
  extractTestNames,
  formatReport,
  isInfraId,
  isMainModule,
  isPrdId,
  isRequirementId,
  listTestFiles,
  loadConfig,
  main,
  validateConfigShape
} from "../scripts/check-requirement-coverage.js";

const scriptPath = fileURLToPath(new URL("../scripts/check-requirement-coverage.js", import.meta.url));

// Story 62: every offline test file must be classified as either tied to a PRD
// requirement or explicitly infrastructure. These tests pin the checker's
// pass/fail branches, the ID-token parsing, the map/pending cross-validation,
// and the CLI entry point.

// Build a temporary repository-shaped directory with a test/ folder and the two
// configuration files, so the checker can be exercised deterministically.
function makeRepo({ files = {}, map, pending } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "reqcov-"));
  mkdirSync(join(dir, "test"));
  for (const [name, source] of Object.entries(files)) {
    writeFileSync(join(dir, "test", name), source);
  }
  if (map !== undefined) {
    writeFileSync(join(dir, "test", "requirements.map.json"), JSON.stringify(map));
  }
  if (pending !== undefined) {
    writeFileSync(join(dir, "test", "requirements.pending.json"), JSON.stringify(pending));
  }
  return dir;
}

function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true });
}

// A minimal valid map with one declared requirement.
const baseMap = { requirements: ["MUST-1"], files: {} };

test("[STORY-62] isPrdId accepts valid PRD ids and rejects everything else", () => {
  assert.equal(isPrdId("MUST-1"), true);
  assert.equal(isPrdId("SHOULD-12"), true);
  assert.equal(isPrdId("COULD-6"), true);
  assert.equal(isPrdId("STORY-41A"), true);
  // Leading zero is not a valid positive integer.
  assert.equal(isPrdId("MUST-01"), false);
  // Zero is not a positive integer.
  assert.equal(isPrdId("MUST-0"), false);
  // Unknown prefix.
  assert.equal(isPrdId("NOPE-1"), false);
  // Lowercase prefix.
  assert.equal(isPrdId("must-1"), false);
  // Missing number.
  assert.equal(isPrdId("MUST-"), false);
  // Non-string inputs.
  assert.equal(isPrdId(undefined), false);
  assert.equal(isPrdId(42), false);
});

test("[STORY-62] isInfraId accepts the INFRA- shape and rejects everything else", () => {
  assert.equal(isInfraId("INFRA-DOCKER"), true);
  assert.equal(isInfraId("INFRA-TTC-PIPELINE"), true);
  assert.equal(isInfraId("INFRA-"), false);
  assert.equal(isInfraId("INFRA-lower"), false);
  assert.equal(isInfraId("MUST-1"), false);
  assert.equal(isInfraId(undefined), false);
});

test("[STORY-62] isRequirementId accepts either kind", () => {
  assert.equal(isRequirementId("MUST-1"), true);
  assert.equal(isRequirementId("INFRA-CI"), true);
  assert.equal(isRequirementId("nonsense"), false);
});

test("[STORY-62] extractIds reads only leading bracket tokens", () => {
  assert.deepEqual(extractIds("[MUST-1] nearby summary"), ["MUST-1"]);
  assert.deepEqual(extractIds("[SHOULD-9][STORY-28] saved locations"), ["SHOULD-9", "STORY-28"]);
  // A bracket that is not at the start is not a tag.
  assert.deepEqual(extractIds("nearby [MUST-1] summary"), []);
  // No tokens.
  assert.deepEqual(extractIds("plain name"), []);
  // Non-string input.
  assert.deepEqual(extractIds(undefined), []);
});

test("[STORY-62] extractAllIds reads bracket tokens anywhere", () => {
  assert.deepEqual(extractAllIds("[MUST-1] nearby"), ["MUST-1"]);
  assert.deepEqual(extractAllIds("nearby [MUST-1] summary"), ["MUST-1"]);
  assert.deepEqual(extractAllIds("[MUST-1][INFRA-CI] x"), ["MUST-1", "INFRA-CI"]);
  assert.deepEqual(extractAllIds("plain"), []);
  assert.deepEqual(extractAllIds(undefined), []);
});

test("[STORY-62] extractTestNames reads test() names and modifiers", () => {
  const source = [
    'test("[MUST-1] a", () => {});',
    "test('[MUST-2] b', () => {});",
    'test.only("[MUST-3] c", () => {});',
    'test.skip("[MUST-4] d", () => {});',
    'test.todo("[MUST-5] e");',
    "const x = 1;"
  ].join("\n");
  assert.deepEqual(extractTestNames(source), [
    "[MUST-1] a",
    "[MUST-2] b",
    "[MUST-3] c",
    "[MUST-4] d",
    "[MUST-5] e"
  ]);
  // Non-string input.
  assert.deepEqual(extractTestNames(undefined), []);
});

test("[STORY-62] extractTestNames handles escaped quotes in a name", () => {
  const source = 'test("[MUST-1] a \\"quoted\\" name", () => {});';
  assert.deepEqual(extractTestNames(source), ['[MUST-1] a \\"quoted\\" name']);
});

test("[STORY-62] listTestFiles selects offline tests and excludes integration tests", () => {
  const dir = makeRepo({
    files: {
      "a.test.js": "",
      "b.integration.test.js": "",
      "c.test.js": "",
      "helper.js": ""
    }
  });
  try {
    assert.deepEqual(listTestFiles(dir), ["test/a.test.js", "test/c.test.js"]);
  } finally {
    cleanup(dir);
  }
});

test("[STORY-62] listTestFiles returns empty when test/ is absent", () => {
  const dir = mkdtempSync(join(tmpdir(), "reqcov-none-"));
  try {
    assert.deepEqual(listTestFiles(dir), []);
  } finally {
    cleanup(dir);
  }
});

test("[STORY-62] listTestFiles skips an entry that cannot be stat'd", () => {
  const dir = makeRepo({ files: { "a.test.js": "" } });
  try {
    // A broken symlink named like a test file makes statSync throw; the entry
    // must be skipped rather than failing the whole listing.
    symlinkSync(join(dir, "test", "does-not-exist"), join(dir, "test", "broken.test.js"));
    assert.deepEqual(listTestFiles(dir), ["test/a.test.js"]);
  } finally {
    cleanup(dir);
  }
});

test("[STORY-62] loadConfig reads the map and an optional pending list", () => {
  const dir = makeRepo({ map: baseMap, pending: ["test/a.test.js"] });
  try {
    const { map, pending } = loadConfig(dir);
    assert.deepEqual(map, baseMap);
    assert.deepEqual(pending, ["test/a.test.js"]);
  } finally {
    cleanup(dir);
  }
});

test("[STORY-62] loadConfig treats a missing pending list as no exemptions", () => {
  const dir = makeRepo({ map: baseMap });
  try {
    assert.deepEqual(loadConfig(dir).pending, []);
  } finally {
    cleanup(dir);
  }
});

test("[STORY-62] loadConfig propagates a non-ENOENT read error", () => {
  const dir = makeRepo({ map: baseMap });
  try {
    // A directory where the pending file is expected makes readFileSync throw
    // EISDIR, which is not ENOENT and must propagate.
    mkdirSync(join(dir, "test", "requirements.pending.json"));
    assert.throws(() => loadConfig(dir));
  } finally {
    cleanup(dir);
  }
});

test("[STORY-62] validateConfigShape rejects malformed configuration", () => {
  assert.deepEqual(validateConfigShape(baseMap, []), []);
  assert.match(validateConfigShape(null, [])[0], /must be a JSON object/);
  assert.match(validateConfigShape([], [])[0], /must be a JSON object/);
  assert.match(validateConfigShape({ files: {} }, [])[0], /"requirements" array/);
  assert.match(validateConfigShape({ requirements: [] }, [])[0], /"files" object/);
  assert.match(validateConfigShape({ requirements: [], files: [] }, [])[0], /"files" object/);
  assert.match(validateConfigShape(baseMap, {})[0], /must be a JSON array/);
});

test("[STORY-62] a fully tagged, fully mapped tree passes", () => {
  const dir = makeRepo({
    files: { "a.test.js": 'test("[MUST-1] a", () => {});' },
    map: { requirements: ["MUST-1"], files: { "test/a.test.js": ["MUST-1"] } },
    pending: []
  });
  try {
    const result = checkRequirements({ cwd: dir });
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.untested, []);
    assert.equal(result.stats.mappedFiles, 1);
    assert.equal(result.stats.usedRequirements, 1);
  } finally {
    cleanup(dir);
  }
});

test("[STORY-62] an infrastructure-tagged file passes", () => {
  const dir = makeRepo({
    files: { "a.test.js": 'test("[INFRA-DOCKER] a", () => {});' },
    map: { requirements: [], files: { "test/a.test.js": ["INFRA-DOCKER"] } },
    pending: []
  });
  try {
    assert.deepEqual(checkRequirements({ cwd: dir }).errors, []);
  } finally {
    cleanup(dir);
  }
});

test("[STORY-62] an untagged, unmapped file fails", () => {
  const dir = makeRepo({
    files: { "a.test.js": 'test("plain", () => {});' },
    map: baseMap,
    pending: []
  });
  try {
    const result = checkRequirements({ cwd: dir });
    assert.ok(result.errors.some(e => /neither mapped nor pending/.test(e)));
  } finally {
    cleanup(dir);
  }
});

test("[STORY-62] a pending file is exempt from mapping", () => {
  const dir = makeRepo({
    files: { "a.test.js": 'test("plain", () => {});' },
    map: baseMap,
    pending: ["test/a.test.js"]
  });
  try {
    assert.deepEqual(checkRequirements({ cwd: dir }).errors, []);
  } finally {
    cleanup(dir);
  }
});

test("[STORY-62] a pending file that is fully tagged fails", () => {
  const dir = makeRepo({
    files: { "a.test.js": 'test("[MUST-1] a", () => {});' },
    map: baseMap,
    pending: ["test/a.test.js"]
  });
  try {
    const result = checkRequirements({ cwd: dir });
    assert.ok(result.errors.some(e => /every test in it is already tagged/.test(e)));
  } finally {
    cleanup(dir);
  }
});

test("[STORY-62] a pending file with no tests is not considered fully tagged", () => {
  const dir = makeRepo({
    files: { "a.test.js": "const x = 1;" },
    map: baseMap,
    pending: ["test/a.test.js"]
  });
  try {
    assert.deepEqual(checkRequirements({ cwd: dir }).errors, []);
  } finally {
    cleanup(dir);
  }
});

test("[STORY-62] a pending file that is also mapped fails", () => {
  const dir = makeRepo({
    files: { "a.test.js": 'test("[MUST-1] a", () => {});' },
    map: { requirements: ["MUST-1"], files: { "test/a.test.js": ["MUST-1"] } },
    pending: ["test/a.test.js"]
  });
  try {
    const result = checkRequirements({ cwd: dir });
    assert.ok(result.errors.some(e => /already mapped/.test(e)));
  } finally {
    cleanup(dir);
  }
});

test("[STORY-62] a pending file that cannot be read is tolerated", () => {
  const dir = makeRepo({
    files: { "a.test.js": 'test("plain", () => {});' },
    map: baseMap,
    pending: ["test/a.test.js"]
  });
  try {
    // A reader that throws for the pending file exercises the catch branch.
    const result = checkRequirements({
      cwd: dir,
      readFile: () => {
        throw new Error("unreadable");
      }
    });
    assert.deepEqual(result.errors, []);
  } finally {
    cleanup(dir);
  }
});

test("[STORY-62] a mapping to an undeclared PRD id fails", () => {
  const dir = makeRepo({
    files: { "a.test.js": 'test("[MUST-2] a", () => {});' },
    map: { requirements: ["MUST-1"], files: { "test/a.test.js": ["MUST-2"] } },
    pending: []
  });
  try {
    const result = checkRequirements({ cwd: dir });
    assert.ok(result.errors.some(e => /undeclared PRD id: MUST-2/.test(e)));
  } finally {
    cleanup(dir);
  }
});

test("[STORY-62] a mapping to an unknown INFRA area fails", () => {
  const dir = makeRepo({
    files: { "a.test.js": 'test("[INFRA-NOPE] a", () => {});' },
    map: { requirements: [], files: { "test/a.test.js": ["INFRA-NOPE"] } },
    pending: []
  });
  try {
    const result = checkRequirements({ cwd: dir });
    assert.ok(result.errors.some(e => /unknown INFRA area: INFRA-NOPE/.test(e)));
  } finally {
    cleanup(dir);
  }
});

test("[STORY-62] a mapping to a syntactically invalid id fails", () => {
  const dir = makeRepo({
    files: { "a.test.js": 'test("plain", () => {});' },
    map: { requirements: [], files: { "test/a.test.js": ["not-an-id"] } },
    pending: []
  });
  try {
    const result = checkRequirements({ cwd: dir });
    assert.ok(result.errors.some(e => /invalid id: not-an-id/.test(e)));
  } finally {
    cleanup(dir);
  }
});

test("[STORY-62] a declared requirement with an invalid id fails", () => {
  const dir = makeRepo({
    files: { "a.test.js": 'test("[MUST-1] a", () => {});' },
    map: { requirements: ["MUST-1", "bogus"], files: { "test/a.test.js": ["MUST-1"] } },
    pending: []
  });
  try {
    const result = checkRequirements({ cwd: dir });
    assert.ok(result.errors.some(e => /declares an invalid PRD id: bogus/.test(e)));
  } finally {
    cleanup(dir);
  }
});

test("[STORY-62] a mapping to an empty id array fails", () => {
  const dir = makeRepo({
    files: { "a.test.js": 'test("plain", () => {});' },
    map: { requirements: [], files: { "test/a.test.js": [] } },
    pending: []
  });
  try {
    const result = checkRequirements({ cwd: dir });
    assert.ok(result.errors.some(e => /non-empty array of ids/.test(e)));
  } finally {
    cleanup(dir);
  }
});

test("[STORY-62] a mapping to a non-array id value fails", () => {
  const dir = makeRepo({
    files: { "a.test.js": 'test("plain", () => {});' },
    map: { requirements: [], files: { "test/a.test.js": "MUST-1" } },
    pending: []
  });
  try {
    const result = checkRequirements({ cwd: dir });
    assert.ok(result.errors.some(e => /non-empty array of ids/.test(e)));
  } finally {
    cleanup(dir);
  }
});

test("[STORY-62] a duplicate id in a map entry fails", () => {
  const dir = makeRepo({
    files: { "a.test.js": 'test("[MUST-1] a", () => {});' },
    map: { requirements: ["MUST-1"], files: { "test/a.test.js": ["MUST-1", "MUST-1"] } },
    pending: []
  });
  try {
    const result = checkRequirements({ cwd: dir });
    assert.ok(result.errors.some(e => /duplicate id: MUST-1/.test(e)));
  } finally {
    cleanup(dir);
  }
});

test("[STORY-62] a test name id missing from the map entry fails", () => {
  const dir = makeRepo({
    files: { "a.test.js": 'test("[MUST-1][MUST-2] a", () => {});' },
    map: { requirements: ["MUST-1", "MUST-2"], files: { "test/a.test.js": ["MUST-1"] } },
    pending: []
  });
  try {
    const result = checkRequirements({ cwd: dir });
    assert.ok(result.errors.some(e => /test name id not present in its map entry: MUST-2/.test(e)));
  } finally {
    cleanup(dir);
  }
});

test("[STORY-62] a mapped id absent from every test name fails", () => {
  const dir = makeRepo({
    files: { "a.test.js": 'test("[MUST-1] a", () => {});' },
    map: { requirements: ["MUST-1", "MUST-2"], files: { "test/a.test.js": ["MUST-1", "MUST-2"] } },
    pending: []
  });
  try {
    const result = checkRequirements({ cwd: dir });
    assert.ok(result.errors.some(e => /maps id MUST-2 but no test name/.test(e)));
  } finally {
    cleanup(dir);
  }
});

test("[STORY-62] a misplaced id token fails", () => {
  const dir = makeRepo({
    files: { "a.test.js": 'test("nearby [MUST-1] summary", () => {});' },
    map: { requirements: ["MUST-1"], files: { "test/a.test.js": ["MUST-1"] } },
    pending: []
  });
  try {
    const result = checkRequirements({ cwd: dir });
    assert.ok(result.errors.some(e => /misplaced id token/.test(e)));
  } finally {
    cleanup(dir);
  }
});

test("[STORY-62] a mapping to a non-existent test file fails", () => {
  const dir = makeRepo({
    files: { "a.test.js": 'test("[MUST-1] a", () => {});' },
    map: { requirements: ["MUST-1"], files: { "test/missing.test.js": ["MUST-1"] } },
    pending: []
  });
  try {
    const result = checkRequirements({ cwd: dir });
    assert.ok(result.errors.some(e => /not an offline test: test\/missing.test.js/.test(e)));
  } finally {
    cleanup(dir);
  }
});

test("[STORY-62] a pending entry that is not an offline test fails", () => {
  const dir = makeRepo({
    files: { "a.test.js": 'test("plain", () => {});' },
    map: baseMap,
    pending: ["test/a.test.js", "test/missing.test.js"]
  });
  try {
    const result = checkRequirements({ cwd: dir });
    assert.ok(result.errors.some(e => /not an offline test: test\/missing.test.js/.test(e)));
  } finally {
    cleanup(dir);
  }
});

test("[STORY-62] a pending entry with an invalid path fails", () => {
  const dir = makeRepo({
    files: { "a.test.js": 'test("plain", () => {});' },
    map: baseMap,
    pending: ["a.test.js"]
  });
  try {
    const result = checkRequirements({ cwd: dir });
    assert.ok(result.errors.some(e => /invalid path: a.test.js/.test(e)));
  } finally {
    cleanup(dir);
  }
});

test("[STORY-62] a duplicate pending entry fails", () => {
  const dir = makeRepo({
    files: { "a.test.js": 'test("plain", () => {});' },
    map: baseMap,
    pending: ["test/a.test.js", "test/a.test.js"]
  });
  try {
    const result = checkRequirements({ cwd: dir });
    assert.ok(result.errors.some(e => /duplicate path: test\/a.test.js/.test(e)));
  } finally {
    cleanup(dir);
  }
});

test("[STORY-62] a mapped file that cannot be read fails", () => {
  const dir = makeRepo({
    files: { "a.test.js": 'test("[MUST-1] a", () => {});' },
    map: { requirements: ["MUST-1"], files: { "test/a.test.js": ["MUST-1"] } },
    pending: []
  });
  try {
    const result = checkRequirements({
      cwd: dir,
      readFile: () => {
        throw new Error("unreadable");
      }
    });
    assert.ok(result.errors.some(e => /maps an unreadable file/.test(e)));
  } finally {
    cleanup(dir);
  }
});

test("[STORY-62] a malformed configuration short-circuits with shape errors", () => {
  const result = checkRequirements({ map: null, pending: [] });
  assert.ok(result.errors.some(e => /must be a JSON object/.test(e)));
  assert.deepEqual(result.untested, []);
  assert.equal(result.stats.testFiles, 0);
});

test("[STORY-62] checkRequirements loads configuration when not supplied", () => {
  const dir = makeRepo({
    files: { "a.test.js": 'test("[MUST-1] a", () => {});' },
    map: { requirements: ["MUST-1"], files: { "test/a.test.js": ["MUST-1"] } },
    pending: []
  });
  try {
    // No map/pending passed: the checker loads them from cwd.
    assert.deepEqual(checkRequirements({ cwd: dir }).errors, []);
  } finally {
    cleanup(dir);
  }
});

test("[STORY-62] untested PRD requirements are reported but do not fail", () => {
  const dir = makeRepo({
    files: { "a.test.js": 'test("[MUST-1] a", () => {});' },
    map: { requirements: ["MUST-1", "SHOULD-1"], files: { "test/a.test.js": ["MUST-1"] } },
    pending: []
  });
  try {
    const result = checkRequirements({ cwd: dir });
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.untested, ["SHOULD-1"]);
  } finally {
    cleanup(dir);
  }
});

test("[STORY-62] formatReport summarizes the result", () => {
  const report = formatReport({
    errors: ["boom"],
    warnings: ["careful"],
    untested: ["SHOULD-1"],
    stats: {
      testFiles: 3,
      mappedFiles: 2,
      pendingFiles: 1,
      declaredRequirements: 4,
      usedRequirements: 3
    }
  });
  assert.match(report, /2 mapped, 1 pending, 3 offline test file\(s\)/);
  assert.match(report, /3\/4 declared PRD requirement\(s\) have tests/);
  assert.match(report, /1 PRD requirement\(s\) with no tests: SHOULD-1/);
  assert.match(report, /warning: careful/);
  assert.match(report, /error: boom/);
});

test("[STORY-62] formatReport bounds a long untested list", () => {
  const untested = Array.from({ length: 25 }, (_, i) => `MUST-${i + 1}`);
  const report = formatReport({
    errors: [],
    warnings: [],
    untested,
    stats: {
      testFiles: 1,
      mappedFiles: 1,
      pendingFiles: 0,
      declaredRequirements: 25,
      usedRequirements: 0
    }
  });
  assert.match(report, /25 PRD requirement\(s\) with no tests/);
  assert.match(report, /MUST-20, \.\.\./);
  assert.doesNotMatch(report, /MUST-21/);
});

test("[STORY-62] formatReport omits the untested line when nothing is untested", () => {
  const report = formatReport({
    errors: [],
    warnings: [],
    untested: [],
    stats: {
      testFiles: 1,
      mappedFiles: 1,
      pendingFiles: 0,
      declaredRequirements: 1,
      usedRequirements: 1
    }
  });
  assert.doesNotMatch(report, /PRD requirements with no tests/);
});

test("[STORY-62] main returns zero and logs a pass on a valid tree", () => {
  const dir = makeRepo({
    files: { "a.test.js": 'test("[MUST-1] a", () => {});' },
    map: { requirements: ["MUST-1"], files: { "test/a.test.js": ["MUST-1"] } },
    pending: []
  });
  const logs = [];
  const errors = [];
  try {
    const code = main({ cwd: dir, log: m => logs.push(m), error: m => errors.push(m) });
    assert.equal(code, 0);
    assert.ok(logs.some(m => /traceability check passed/.test(m)));
    assert.deepEqual(errors, []);
  } finally {
    cleanup(dir);
  }
});

test("[STORY-62] main returns one and reports errors on a failing tree", () => {
  const dir = makeRepo({
    files: { "a.test.js": 'test("plain", () => {});' },
    map: baseMap,
    pending: []
  });
  const logs = [];
  const errors = [];
  try {
    const code = main({ cwd: dir, log: m => logs.push(m), error: m => errors.push(m) });
    assert.equal(code, 1);
    assert.ok(errors.some(m => /traceability check failed/.test(m)));
  } finally {
    cleanup(dir);
  }
});

test("[STORY-62] main fails safe when the check throws", () => {
  const errors = [];
  // A cwd with no configuration makes loadConfig throw; main must report it and
  // return nonzero rather than crashing.
  const dir = mkdtempSync(join(tmpdir(), "reqcov-throw-"));
  try {
    const code = main({ cwd: dir, log: () => {}, error: m => errors.push(m) });
    assert.equal(code, 1);
    assert.ok(errors.some(m => /failed to run/.test(m)));
  } finally {
    cleanup(dir);
  }
});

test("[STORY-62] isMainModule is false when imported by the test runner", () => {
  // The test runner imports this module, so it is not the process entry point.
  assert.equal(isMainModule(), false);
});

test("[STORY-62] the fixed infrastructure allow-list is stable", () => {
  assert.deepEqual(INFRA_AREAS, [
    "INFRA-DOCKER",
    "INFRA-VERIFY",
    "INFRA-CI",
    "INFRA-PUBLISH",
    "INFRA-BROWSER",
    "INFRA-ASSETS",
    "INFRA-PWA",
    "INFRA-WATCH",
    "INFRA-TTC-PIPELINE",
    "INFRA-LINT"
  ]);
  assert.deepEqual(PRD_PREFIXES, ["MUST", "SHOULD", "COULD", "STORY"]);
});

test("[STORY-62] the CLI entry point runs and exits zero on a valid tree", () => {
  const dir = makeRepo({
    files: { "a.test.js": 'test("[MUST-1] a", () => {});' },
    map: { requirements: ["MUST-1"], files: { "test/a.test.js": ["MUST-1"] } },
    pending: []
  });
  try {
    // Spawning the CLI covers the isMainModule() entry-point guard, which is
    // not taken when the module is imported by the test runner.
    const result = spawnSync(process.execPath, [scriptPath], { encoding: "utf8", cwd: dir });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /traceability check passed/);
  } finally {
    cleanup(dir);
  }
});

test("[STORY-62] the CLI entry point exits nonzero on a failing tree", () => {
  const dir = makeRepo({
    files: { "a.test.js": 'test("plain", () => {});' },
    map: baseMap,
    pending: []
  });
  try {
    const result = spawnSync(process.execPath, [scriptPath], { encoding: "utf8", cwd: dir });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /traceability check failed/);
  } finally {
    cleanup(dir);
  }
});

test("[STORY-62] the real repository configuration passes the checker", () => {
  // The tracked map and pending list must keep the real tree green.
  const result = checkRequirements();
  assert.deepEqual(result.errors, []);
  assert.ok(result.stats.testFiles > 0);
});
