// Test-to-requirement traceability checker (Story 62).
//
// Every offline test file must be classified as either tied to a PRD
// requirement or explicitly infrastructure. This is a traceability layer with
// an explicit infrastructure bucket, not a forced 1:1 mapping: a large fraction
// of tests are tooling (Docker wrapper, verify script, CI strategy, publication
// sink, browser runner, asset versioning, PWA, watch backend, TTC pipeline,
// lint), and forcing those under a product ID would be dishonest.
//
// Two tracked files drive the check:
//
//   test/requirements.map.json
//     {
//       "requirements": ["MUST-1", "SHOULD-9", "STORY-28", ...],
//       "files": { "test/nearby-summary.test.js": ["MUST-1", "STORY-1"], ... }
//     }
//     `requirements` is the authoritative valid PRD ID space (the roadmap is
//     git-ignored and not available inside the Docker test mount, so the ID
//     space is declared here instead). `files` is the authoritative
//     test-file -> [IDs] map (many-to-many).
//
//   test/requirements.pending.json
//     ["test/foo.test.js", ...]
//     A bounded, explicit allow-list of not-yet-tagged files, so the tooling can
//     land before every file is tagged. The list shrinks as tagging increments
//     complete and is deleted when empty.
//
// The requirement ID also lives in the test name itself, as a leading bracket
// token, e.g. test("[MUST-1] nearby summary counts calls within radius", ...).
// Multiple IDs stack, e.g. test("[SHOULD-9][STORY-28] saved locations ...").
// The checker cross-validates the two: every ID in a test name must appear in
// that file's map entry, and every ID in the map entry must appear in at least
// one test name in that file.
//
// The checker fails when:
//   - a test file has no mapping and is not on the pending list;
//   - a mapping references an unknown PRD ID or an unknown INFRA-* area;
//   - a test name carries an ID not present in that file's map entry;
//   - a mapped ID does not appear in any test name in that file;
//   - a pending file is fully tagged but still listed.
// It reports PRD requirements with zero tests as the obsolete-code signal.
//
// POSIX-friendly Node: no external dependencies, deterministic output.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// The fixed infrastructure allow-list. A test that is not tied to a product
// requirement must carry exactly one of these areas. Adding a new area is a
// deliberate change to this list.
export const INFRA_AREAS = [
  'INFRA-DOCKER',
  'INFRA-VERIFY',
  'INFRA-CI',
  'INFRA-PUBLISH',
  'INFRA-BROWSER',
  'INFRA-ASSETS',
  'INFRA-PWA',
  'INFRA-WATCH',
  'INFRA-TTC-PIPELINE',
  'INFRA-LINT'
];

// Product requirement ID prefixes. A valid PRD ID is one of these prefixes
// followed by a positive integer, optionally with a trailing uppercase letter
// for a story increment (for example STORY-41A).
export const PRD_PREFIXES = ['MUST', 'SHOULD', 'COULD', 'STORY'];

// The checker's own test file necessarily embeds example ID literals (for
// example "[MUST-1] a") to exercise the parser, so its test names cannot be
// cross-validated against its map entry. It is still required to be mapped.
export const SELF_TEST_FILE = 'test/requirement-coverage.test.js';

// A bracket ID token in a test name. It matches both PRD ids
// (PREFIX-number[letter], e.g. "[MUST-1]", "[STORY-41A]") and infrastructure
// areas ("[INFRA-DOCKER]", "[INFRA-TTC-PIPELINE]"). Multiple tokens stack:
// "[SHOULD-9][STORY-28] saved locations ...".
const ID_TOKEN = /\[([A-Z]+-(?:[0-9]+[A-Z]?|[A-Z][A-Z-]*))\]/g;

// A syntactically valid PRD ID: a known prefix, a positive integer, and an
// optional trailing uppercase letter.
const PRD_ID = /^(MUST|SHOULD|COULD|STORY)-([1-9][0-9]*)([A-Z]?)$/;

// A syntactically valid infrastructure area: the INFRA- prefix and an uppercase
// area name.
const INFRA_ID = /^INFRA-[A-Z][A-Z-]*$/;

// True when the token is a syntactically valid PRD ID.
export function isPrdId(token) {
  return typeof token === 'string' && PRD_ID.test(token);
}

// True when the token is a syntactically valid infrastructure area.
export function isInfraId(token) {
  return typeof token === 'string' && INFRA_ID.test(token);
}

// True when the token is a syntactically valid requirement ID of either kind.
export function isRequirementId(token) {
  return isPrdId(token) || isInfraId(token);
}

// Extract the leading bracket ID tokens from a test name. Only tokens at the
// very start of the name count, so a bracket that appears mid-sentence (for
// example in a description) is not treated as a tag.
export function extractIds(testName) {
  if (typeof testName !== 'string') return [];
  const ids = [];
  let rest = testName;
  // Consume leading "[ID]" tokens one at a time.
  for (;;) {
    const match = /^\[([A-Z]+-(?:[0-9]+[A-Z]?|[A-Z][A-Z-]*))\]/.exec(rest);
    if (!match) break;
    ids.push(match[1]);
    rest = rest.slice(match[0].length);
  }
  return ids;
}

// Extract every bracket ID token anywhere in a test name. Used to detect a
// misplaced tag (an ID that is present but not at the start), which is a
// likely authoring mistake worth failing on.
export function extractAllIds(testName) {
  if (typeof testName !== 'string') return [];
  const ids = [];
  let match;
  ID_TOKEN.lastIndex = 0;
  while ((match = ID_TOKEN.exec(testName)) !== null) {
    ids.push(match[1]);
  }
  return ids;
}

// Parse the test names out of a test file's source. A test name is the first
// string literal argument of a `test(...)` or `test.only(...)`/`test.skip(...)`
// call. This is a deliberately simple, deterministic scan: it matches the
// repository's consistent `test("name", ...)` style and does not attempt to
// evaluate the file.
export function extractTestNames(source) {
  if (typeof source !== 'string') return [];
  const names = [];
  // Match `test(` or `test.<modifier>(` followed by a quoted string.
  const call = /\btest(?:\.(?:only|skip|todo))?\s*\(\s*(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
  let match;
  while ((match = call.exec(source)) !== null) {
    names.push(match[2]);
  }
  return names;
}

// List the offline test files under test/ (every test/*.test.js, excluding
// test/*.integration.test.js), sorted deterministically. This mirrors
// scripts/run-unit-tests.sh so the checker and the runner agree on membership.
export function listTestFiles(cwd = process.cwd()) {
  const dir = resolve(cwd, 'test');
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter(name => name.endsWith('.test.js') && !name.endsWith('.integration.test.js'))
    .filter(name => {
      try {
        return statSync(join(dir, name)).isFile();
      } catch {
        return false;
      }
    })
    .map(name => `test/${name}`)
    .sort();
}

// Read and parse a JSON file, returning a clear error on failure.
function readJson(path) {
  const text = readFileSync(path, 'utf8');
  return JSON.parse(text);
}

// Load the map and pending list from disk. Missing files are reported as
// errors so the checker never silently passes with no configuration.
export function loadConfig(cwd = process.cwd()) {
  const mapPath = resolve(cwd, 'test/requirements.map.json');
  const pendingPath = resolve(cwd, 'test/requirements.pending.json');
  const map = readJson(mapPath);
  let pending = [];
  try {
    pending = readJson(pendingPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // A missing pending list means no exemptions remain (the final increment);
    // `pending` already holds the empty default.
  }
  return { map, pending };
}

// Validate the shape of the map and pending list. Returns an array of error
// strings (empty when the shapes are valid).
export function validateConfigShape(map, pending) {
  const errors = [];
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    errors.push('requirements.map.json must be a JSON object');
    return errors;
  }
  if (!Array.isArray(map.requirements)) {
    errors.push('requirements.map.json must have a "requirements" array');
  }
  if (!map.files || typeof map.files !== 'object' || Array.isArray(map.files)) {
    errors.push('requirements.map.json must have a "files" object');
  }
  if (!Array.isArray(pending)) {
    errors.push('requirements.pending.json must be a JSON array');
  }
  return errors;
}

// Run the full traceability check. Returns a structured result:
//   { errors: [...], warnings: [...], untested: [...], stats: {...} }
// `errors` is non-empty when the check fails. `untested` lists PRD
// requirements with zero tests (the obsolete-code signal) and is reported but
// does not fail the check.
export function checkRequirements({ cwd = process.cwd(), map, pending, testFiles, readFile } = {}) {
  const errors = [];
  const warnings = [];

  if (map === undefined || pending === undefined) {
    const loaded = loadConfig(cwd);
    if (map === undefined) map = loaded.map;
    if (pending === undefined) pending = loaded.pending;
  }

  const shapeErrors = validateConfigShape(map, pending);
  if (shapeErrors.length > 0) {
    return { errors: shapeErrors, warnings, untested: [], stats: emptyStats() };
  }

  const read = readFile || (path => readFileSync(resolve(cwd, path), 'utf8'));
  const files = testFiles || listTestFiles(cwd);

  // The declared valid PRD ID space.
  const declared = new Set(map.requirements);
  for (const id of map.requirements) {
    if (!isPrdId(id)) {
      errors.push(`requirements.map.json declares an invalid PRD id: ${id}`);
    }
  }

  // The pending list must be a set of known test files with no duplicates.
  const pendingSet = new Set();
  for (const path of pending) {
    if (typeof path !== 'string' || !path.startsWith('test/')) {
      errors.push(`requirements.pending.json lists an invalid path: ${path}`);
      continue;
    }
    if (pendingSet.has(path)) {
      errors.push(`requirements.pending.json lists a duplicate path: ${path}`);
    }
    pendingSet.add(path);
  }

  // Every mapped file must exist and every existing file must be mapped or
  // pending.
  const mappedFiles = Object.keys(map.files);
  const fileSet = new Set(files);
  for (const path of mappedFiles) {
    if (!fileSet.has(path)) {
      errors.push(`requirements.map.json maps a file that is not an offline test: ${path}`);
    }
  }
  for (const path of pendingSet) {
    if (!fileSet.has(path)) {
      errors.push(`requirements.pending.json lists a file that is not an offline test: ${path}`);
    }
  }

  // Validate each mapped file's IDs and cross-check against its test names.
  const usedIds = new Set();
  for (const path of mappedFiles) {
    const ids = map.files[path];
    if (!Array.isArray(ids) || ids.length === 0) {
      errors.push(`requirements.map.json must map ${path} to a non-empty array of ids`);
      continue;
    }
    const idSet = new Set();
    for (const id of ids) {
      if (!isRequirementId(id)) {
        errors.push(`requirements.map.json maps ${path} to an invalid id: ${id}`);
        continue;
      }
      if (isPrdId(id) && !declared.has(id)) {
        errors.push(`requirements.map.json maps ${path} to an undeclared PRD id: ${id}`);
      }
      if (isInfraId(id) && !INFRA_AREAS.includes(id)) {
        errors.push(`requirements.map.json maps ${path} to an unknown INFRA area: ${id}`);
      }
      if (idSet.has(id)) {
        errors.push(`requirements.map.json maps ${path} to a duplicate id: ${id}`);
      }
      idSet.add(id);
      usedIds.add(id);
    }

    // Cross-check the map against the IDs actually present in test names.
    // The checker's own test file embeds example ID literals, so it is exempt
    // from the name/map cross-validation (it is still required to be mapped).
    if (path === SELF_TEST_FILE) {
      continue;
    }
    let source;
    try {
      source = read(path);
    } catch {
      errors.push(`requirements.map.json maps an unreadable file: ${path}`);
      continue;
    }
    const names = extractTestNames(source);
    const nameIds = new Set();
    for (const name of names) {
      for (const id of extractIds(name)) {
        nameIds.add(id);
      }
      // A bracket ID that is present but not at the start is a likely mistake.
      const leading = new Set(extractIds(name));
      for (const id of extractAllIds(name)) {
        if (!leading.has(id)) {
          errors.push(`${path} has a misplaced id token (not at the start of the test name): ${id}`);
        }
      }
    }
    for (const id of nameIds) {
      if (!idSet.has(id)) {
        errors.push(`${path} has a test name id not present in its map entry: ${id}`);
      }
    }
    for (const id of idSet) {
      if (!nameIds.has(id)) {
        errors.push(`${path} maps id ${id} but no test name in the file carries it`);
      }
    }
  }

  // A pending file that is fully tagged must be removed from the pending list.
  for (const path of pendingSet) {
    if (map.files[path]) {
      errors.push(`requirements.pending.json lists ${path}, but it is already mapped`);
      continue;
    }
    let source;
    try {
      source = read(path);
    } catch {
      continue;
    }
    const names = extractTestNames(source);
    const tagged = names.length > 0 && names.every(name => extractIds(name).length > 0);
    if (tagged) {
      errors.push(`requirements.pending.json lists ${path}, but every test in it is already tagged`);
    }
  }

  // Every offline test file must be mapped or pending.
  for (const path of files) {
    if (!map.files[path] && !pendingSet.has(path)) {
      errors.push(`test file is neither mapped nor pending: ${path}`);
    }
  }

  // PRD requirements with zero tests are the obsolete-code signal.
  const untested = map.requirements.filter(id => !usedIds.has(id));

  return {
    errors,
    warnings,
    untested,
    stats: {
      testFiles: files.length,
      mappedFiles: mappedFiles.length,
      pendingFiles: pendingSet.size,
      declaredRequirements: map.requirements.length,
      usedRequirements: usedIds.size
    }
  };
}

function emptyStats() {
  return {
    testFiles: 0,
    mappedFiles: 0,
    pendingFiles: 0,
    declaredRequirements: 0,
    usedRequirements: 0
  };
}

// Format a human-readable report for the CLI.
export function formatReport(result) {
  const lines = [];
  const { stats } = result;
  lines.push(
    `requirement-coverage: ${stats.mappedFiles} mapped, ${stats.pendingFiles} pending, ` +
      `${stats.testFiles} offline test file(s)`
  );
  lines.push(
    `requirement-coverage: ${stats.usedRequirements}/${stats.declaredRequirements} declared PRD requirement(s) have tests`
  );
  if (result.untested.length > 0) {
    // The untested list is the obsolete-code signal. It can be long while
    // tagging is in progress, so print a bounded sample and the total count.
    const sample = result.untested.slice(0, 20);
    const suffix = result.untested.length > sample.length ? ', ...' : '';
    lines.push(
      `requirement-coverage: ${result.untested.length} PRD requirement(s) with no tests: ` +
        `${sample.join(', ')}${suffix}`
    );
  }
  for (const warning of result.warnings) {
    lines.push(`requirement-coverage: warning: ${warning}`);
  }
  for (const error of result.errors) {
    lines.push(`requirement-coverage: error: ${error}`);
  }
  return lines.join('\n');
}

// CLI entry point. Exported so it is covered in-process (a spawned CLI's
// coverage is not reliably merged by the Node test runner).
export function main({ cwd = process.cwd(), log = console.log, error = console.error } = {}) {
  let result;
  try {
    result = checkRequirements({ cwd });
  } catch (err) {
    error(`requirement-coverage: failed to run: ${err.message}`);
    return 1;
  }
  log(formatReport(result));
  if (result.errors.length > 0) {
    error(`requirement-coverage: ${result.errors.length} error(s); traceability check failed`);
    return 1;
  }
  log('requirement-coverage: traceability check passed');
  return 0;
}

// True when this module is the process entry point.
export function isMainModule() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

if (isMainModule()) {
  process.exitCode = main();
}
