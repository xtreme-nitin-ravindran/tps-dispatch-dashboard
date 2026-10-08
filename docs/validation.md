# Testing and Validation

[Documentation home](../README.md)

Run commands from the repository root. Use Docker for the same Node.js, ESLint,
and Ruff environment as CI. Unit tests use fixtures, mocked services, bundled geographic
data, and temporary files/repositories; they do not publish changes or require live feeds.
See [Test coverage](validation.md#test-coverage) for how coverage is measured and published.

### Docker test wrapper

`scripts/docker-test.sh` runs validation against the **current working tree** using the
pinned Docker test image for dependencies and tooling. It mounts the working-tree source,
scripts, tests, fixtures, and bind-mounted configuration read-only over the image's
`/workspace`, while keeping the image-installed `node_modules` and pinned tools (Node,
ESLint, Ruff). Ordinary source, test, fixture, script, and configuration edits therefore
do **not** require a Docker rebuild.

```bash
# Run any command in the container against the current working tree.
scripts/docker-test.sh npm test
scripts/docker-test.sh npm run lint
scripts/docker-test.sh node --test test/theme.test.js

# Canonical image build (only needed when the image inputs change).
scripts/docker-test.sh --build

# Build only when the image is missing or stale.
scripts/docker-test.sh --ensure-image
```

The canonical image name is `toronto-dispatch-tests`. A successful
`--ensure-image` check prints one concise readiness line naming that image when it
already exists and its fingerprint is current; check the command's exit status.
Build/stale diagnostics are printed only when action is required. Repository
validation should use the pinned Docker toolchain rather than ad hoc host Node,
ESLint, or Ruff commands. If a host-only failure uses a Node version allowed by
`package.json`'s `engines`, record it for compatibility follow-up even when the
canonical Docker gate passes.

The wrapper computes a SHA-256 fingerprint of the image-defining inputs
(`Dockerfile.test`, `.dockerignore`, `package.json`, `package-lock.json`) and compares it
with the `org.sirento.test-fingerprint` label baked into the image. On mismatch it fails
before testing with a clear rebuild command, so a stale image cannot silently validate old
code. A commit-derived tag alone cannot detect uncommitted dependency changes; the
fingerprint is content-derived, so it can. `.dockerignore` is included because it controls
which files reach the build context: a rule that excluded a copied path would change the
image while leaving the other inputs unchanged.

The image is a dependency/tooling snapshot, not a source snapshot. Rebuilds reuse
the dependency and tooling layers when only source changes. Build inputs must include
every path copied by `Dockerfile.test`; `.dockerignore` must never exclude those paths.
Keep dependency installation separate from source copies, and copy stable content before
volatile content so ordinary source changes do not reinstall dependencies.

`npm run verify` and `npm run verify:fast` call `scripts/docker-test.sh --ensure-image`
and run every container command through the wrapper. Do not call `docker run` directly for
validation: a bare `docker run` uses the image's baked-in source and can silently validate
old code. The wrapper uses `--rm`, so no container remains after a run, including on
failure. The [development snapshot command](#generate-a-development-snapshot) is the one exception: it intentionally
mounts `data/` writable to produce `data/current.json`.

### Test coverage

The badges show Node’s measured line, branch, and function coverage after successful CI checks on `dev`. They include test files and exclude unloaded code, browser UI interactions, and Python code; they are not whole-repository coverage. The generated badges and [full report](https://github.com/xtreme-nitin-ravindran/tps-dispatch-dashboard/blob/coverage/coverage-report.txt) live on the `coverage` branch and appear after the first successful publishing run. Python tests run separately and include checks for badge generation.

`npm run test:coverage` runs the canonical offline unit suite
(`scripts/run-unit-tests.sh --coverage`) — the same file set as `npm test`, with Node
coverage enabled and the 100/100/100 gate enforced by Node's coverage thresholds. It
excludes live-source integration tests, which run only under `npm run test:integration`.
During full verification the coverage job runs under `TZ=UTC` and therefore also serves
as the UTC unit-suite execution.

After building the Docker image, run the same coverage command used by CI:

```bash
scripts/docker-test.sh env TZ=UTC NODE_V8_COVERAGE=/tmp/coverage npm run test:coverage
```

The coverage command can fail even when every test passes because the coverage gate
requires these minimums:

- Lines: 100.00%
- Branches: 100.00%
- Functions: 100.00%

Files under `test/fixtures/` are helpers and are not selected as standalone tests by
`scripts/run-unit-tests.sh`. A fixture imported by a selected test may still participate
in Node's coverage accounting. Targeted coverage output is therefore not the final gate;
use the complete Docker coverage command above or `npm run verify` for the authoritative
100/100/100 result.

CI fails if any category in the final `all files` row is below 100.00%. For example:

```text
all files | 99.98 | 99.96 | 100.00
```

This means the tests may have passed, but the coverage gate still fails and promotion
is blocked.

To diagnose a failure:

- Find the non-100% file in the coverage table.
- Inspect its uncovered lines and branches.
- Add meaningful tests for reachable behavior.
- Remove code only when it is genuinely dead.
- For an intermittent branch failure, inspect short-circuit `||`/`&&` operands for
  missing deterministic tests. V8 coverage accounting can vary for an unexercised
  operand; add a meaningful regression for the reachable behavior.
- After fixing the gap, rerun the coverage command and require 100.00% lines,
  branches, and functions. A lucky rerun is not a fix.

100% line, branch, and function coverage does not replace regression-contract testing.
Critical product invariants must have explicit assertions even when ordinary coverage is
already 100%.

See the [pre-push checklist](../README.md#pre-push-checklist) before publishing changes.

### Offline suites

See [regression testing](regression-contracts.md) for the behavior these tests protect.

`npm test` runs the canonical offline JavaScript unit/regression suite through
`scripts/run-unit-tests.sh`. That runner is the executable source of truth for which
files run: it selects every `test/*.test.js` file, excludes every
`test/*.integration.test.js` live-source test, and sorts the result deterministically.
New offline `*.test.js` files join the suite automatically; no manual file list is
maintained. `npm run test:coverage` runs that exact same file set with Node coverage
enabled and the mandatory 100/100/100 gate.

### Test inventory

The table below is an illustrative, non-authoritative sample of what some unit files
verify. It is not the executable list and may lag the suite; run
`scripts/run-unit-tests.sh` (or inspect `test/*.test.js`) for the current membership.

| Test file (under `test/`) | What it verifies |
| --- | --- |
| `tfs-normalize.test.js` | TFS incident fields, empty vehicle assignments, and unfamiliar apparatus types. |
| `tfs-category.test.js` | Medical, Fire, and Other categories, including missing or unfamiliar descriptions. |
| `tfs-time.test.js` | Toronto timestamps and daylight-saving handling, XML timestamps, freshness, and history cutoffs. |
| `tfs-snapshot.test.js` | Snapshot metadata, history retention, incident updates, expiry, and removal of ongoing status when calls leave the active feed. |
| `tfs-etl.test.js` | Initial and subsequent snapshot generation, separate XML/history inputs, safe handling of bad inputs or failed feeds, independent incident/disruption data, CLI environment wiring, the compatibility entry point, and fallback GitHub output. |
| `tfs-fallback.test.js` | Fallback freshness thresholds, unchanged fresh snapshots, updater identity, and refusal to overwrite corrupt history. |
| `publication-sink.test.js` | The shared publication sink: the R2 SigV4 write/read path, no-change detection, credential validation, environment-driven sink selection, and the deterministic local-filesystem sink. |
| `tps-source.test.js` | TPS normalization, stable IDs, complete fetch batches, history retention, unit-code labels, and nearby distances. |
| `disruptions.test.js` | Road geometry and schedules, TTC alert parsing, active/stale filtering, nearby road segments, refresh caching, preserving data after failures, malformed payload rejection, and open-ended disruption periods. |
| `open-locations.test.js` | Bundled postal and street-segment resolution, missing cross streets, and rejection of ambiguous intersections. |
| `location-enrichment.test.js` | Deduplicated lookups, cache reuse, lookup limits, retrying pending locations, and resolver outages. |
| `location-display.test.js` | Street, postal-area, and laneway labels without implying an exact incident address. |
| `intersection-lookup.test.js` | Street-segment endpoints, possible divisions, and confidence checks for mocked intersection results. |
| `postal-lookup.test.js` | Toronto postal prefixes and rejection of incorrect or low-confidence mocked geocoder results. |
| `police-divisions.test.js` | Polygon/multipolygon matching, holes and overlaps, invalid locations, and bundled TPS boundaries. |
| `call-presentation.test.js` | Report ages, call explanations, location confidence, and source-specific status without inferring resolution. |
| `incident-badge.test.js` | NEW expiry, UPDATED precedence, persisted incident lifecycle state, and card wiring. |
| `marker-age.test.js` | Exact marker-age boundaries, accessible freshness labels, future/invalid timestamps, and persistent category/service glyphs. |
| `refresh-freshness.test.js` | Refresh completion timestamps, live age progression, failure preservation, and timer cleanup. |
| `nearby-summary.test.js` | Nearby counts, service/category breakdowns, newest-call ages, and empty or singular results. |
| `mobile-summary-map-info.test.js` | Concise mobile summary ownership, collapsed secondary map metadata, visible trust warnings, Calls-mode spacing, and desktop preservation. |
| `mobile-pre-map-stack.test.js` | Compact mobile header, visible Search and Quick Look action, collapsed Filters, bounded flow layout, and unchanged desktop spacing. |
| `nearby-sort.test.js` | Client-side nearest/newest ordering, stable ties, location availability, and preservation of nearby view state. |
| `siren-matches.test.js` | Two-kilometre siren-result scope, recency/distance ranking, result limits, and invalid-call handling. |
| `view-controls.test.js` | New-call detection, filter summaries/reset defaults, share links, clustering, row selection, preferences, and source timestamp labels. |
| `theme.test.js` | Theme preference validation, system-theme resolution, and document/browser-colour updates. |
| `mobile-radius-controls.test.js` | Mobile single-row search-area options, touch-target layout, active-option visibility, and radius-change rendering integration. |
| `promotion.test.js` | Promotion of only the tested dev commit, superseded/empty changes, protection rejection, existing PR reuse, retry handling, concurrent branch updates, and prevention of duplicate Pages requests. |

### Python tests

`npm run test:python` runs the files in `test/python/` using Python 3’s standard-library unittest runner. It verifies street endpoints, coordinate order and rounding, node deduplication, postal-area filtering and labels, repeatable output, and preservation of the existing index when inputs fail. Tests use temporary fixtures and do not download data or modify the bundled index.

### Live-source integration tests

The live integration suite has one test file per data source. `npm run test:integration` runs all eight files, including TFS. To check a single source, run `node --test test/tps-source.integration.test.js` (substitute the file below):

| Test file | Live checks |
| --- | --- |
| `test/tfs-source.integration.test.js` | TFS feed timestamp and normalization of one random active incident, when present. |
| `test/tps-source.integration.test.js` | TPS call sample and normalization. |
| `test/road-restrictions-source.integration.test.js` | Road restrictions through the production parser. |
| `test/ttc-alerts-source.integration.test.js` | TTC alerts through the production parser and feed timestamp. |
| `test/police-boundaries-source.integration.test.js` | TPS boundary polygon sample. |
| `test/centreline-source.integration.test.js` | Centreline street and intersection fields. |
| `test/geonames-source.integration.test.js` | GeoNames Canada archive and Toronto postal coordinates. |
| `test/openstreetmap-source.integration.test.js` | One OpenStreetMap PNG tile. |

These tests require internet access. Source outages, rate limits, or incompatible
responses fail the suite; empty valid incident/alert feeds are allowed. Geographic
checks sample the upstream sources rather than rebuilding bundled reference data.
They do not validate every live record or browser layout. Check relevant UI changes
visually as well.

### Run individual suites

Run individual suites through the wrapper, which mounts the current working tree
read-only over the image's `/workspace` and keeps the image-installed dependencies:

```bash
scripts/docker-test.sh npm run lint
scripts/docker-test.sh env TZ=UTC npm test
scripts/docker-test.sh env TZ=America/Los_Angeles npm test
scripts/docker-test.sh npm run test:integration
scripts/docker-test.sh node --test test/disruptions.test.js
```

`npm test` and `npm run test:coverage` run the same canonical offline suite
(`scripts/run-unit-tests.sh`); the only difference is that coverage enables Node's
coverage report and the 100/100/100 gate. The two timezone runs execute that same
offline suite to catch accidental dependence on the machine's local timezone.
`npm run test:watch` uses Node's default discovery, which can include the live
integration test; use an explicit file as above for offline watching.

### Run all required checks

`npm run verify` is the canonical full-verification command. Run it from the repository
root; it is the single, versioned entry point for every required check and stops at the
first failure.

```bash
npm run verify
```

It runs:

- Docker image preparation (`scripts/docker-test.sh --ensure-image`, which builds only when the image is missing or its dependency/tooling fingerprint changed) — always sequential, before any container check
- the independent validation jobs, scheduled concurrently with bounded concurrency:
  - full ESLint and Ruff linting (`npm run lint`)
  - browser JavaScript syntax checks (`app.js` and every `src`/`scripts` `.js` file)
  - the canonical offline unit suite in `TZ=America/Los_Angeles` (`npm test`)
  - Python tests (`npm run test:python`)
  - live-source integration tests (`npm run test:integration`)
  - the canonical offline unit suite in `TZ=UTC` with the CI-equivalent 100/100/100 coverage gate (`npm run test:coverage`)

The UTC coverage job is also the UTC unit-suite execution: it runs the same canonical
offline file set as `npm test`, so full verification no longer runs a separate redundant
UTC unit job. The `TZ=America/Los_Angeles` job runs that same offline suite without
coverage to detect local-time dependencies. Live-source integration tests run only in
the dedicated `integration` job; neither the unit nor the coverage job contacts live
sources.
- whitespace checks (`git diff --check` and `git diff --cached --check`) — always sequential, after the jobs
- both `data/current.json` exclusion checks — always sequential, after the jobs

Every required check runs exactly once regardless of scheduling. Each job's output is
captured to its own log so concurrent output never interleaves; a passing job prints a
bounded tail, and a failing job prints its complete output. On the first failure the
scheduler stops launching queued jobs, terminates any still-running siblings (including
their process trees), reports every failing job, and exits nonzero.

Concurrency is bounded by the `VERIFY_JOBS` environment variable (default `4`, maximum
`8`). Set `VERIFY_JOBS=1` for fully sequential, readable diagnosis; the same jobs run in
the same order with the same commands and environment.

```bash
# Default: up to 4 concurrent jobs.
npm run verify

# Fully sequential.
VERIFY_JOBS=1 npm run verify

# Up to 6 concurrent jobs.
VERIFY_JOBS=6 npm run verify
```

An invalid `VERIFY_JOBS` value (non-numeric, empty, less than 1, or greater than 8) is
rejected before any Docker work begins.

Prerequisites:

- Docker must be available and able to build `Dockerfile.test`.
- Live internet access is required for the integration suite. Source outages, rate
  limits, or incompatible responses fail that suite; empty valid feeds are allowed.
- The snapshot checks compare against the locally fetched `origin/main` reference.
  Synchronize remote references before validating a branch for publication.

The coverage command is mandatory: a passing test suite with less than 100.00% line,
branch, or function coverage is not ready for promotion. ESLint and Ruff catch static
correctness problems; the explicit syntax checks parse browser JavaScript without
executing it, and whitespace checks flag issues such as trailing spaces. None of these
checks replaces feature-specific regression contracts or required physical-device
validation.

### Fast inner-loop verification

`npm run verify:fast` is a deliberately reduced inner-loop check for use while
implementing. It is not a substitute for `npm run verify`.

```bash
# No arguments: run the canonical offline unit suite (npm test) under TZ=UTC.
npm run verify:fast

# One explicit test file.
npm run verify:fast -- test/mobile-map-focus.test.js

# Multiple explicit files, run in the order supplied.
npm run verify:fast -- test/mobile-map-focus.test.js test/theme.test.js
```

For a newly added offline test, the one-file form is the preferred first check. Fast
verification still runs the full Docker-backed lint and browser syntax checks before that
test. Local ignored files under `tmp/` are visible to `eslint .`; inspect that directory
for stale, unreferenced debug scripts if lint reports them, but do not delete unrelated
temporary work indiscriminately.

Fast mode runs, in order:

- Docker image preparation (`scripts/docker-test.sh --ensure-image`, which builds only when the image is missing or its dependency/tooling fingerprint changed)
- full ESLint and Ruff linting (`npm run lint`)
- browser JavaScript syntax checks (`app.js` and every `src`/`scripts` `.js` file)
- offline JavaScript unit tests under `TZ=UTC` — the canonical `npm test` suite with
  no arguments, or exactly the supplied `test/*.test.js` files with Node's test runner

Fast mode omits:

- the `TZ=America/Los_Angeles` unit suite
- the Python tests (`npm run test:python`)
- the live-source integration suite (`npm run test:integration`)
- the CI-equivalent 100/100/100 coverage gate (`npm run test:coverage`)
- the Git publication and generated-snapshot exclusion checks

Explicit file arguments are validated before any Docker work begins. Only
repository-relative regular files under `test/` ending in `.test.js` are accepted;
absolute paths, `..` traversal, directories, missing files, empty arguments,
option-like arguments, and `.integration.test.js` files are rejected with a clear
diagnostic and a nonzero exit status.

> [!WARNING]
> Fast mode does **not** replace `npm run verify`. It does not run the coverage gate,
> the live-source integration suite, the America/Los_Angeles timezone suite, applicable
> rendered-browser (Playwright) tests, or physical-device validation. A passing fast run
> does not satisfy the 100/100/100 coverage requirement and is not final, pre-push, or
> promotion verification. Run `npm run verify` at story completion and before
> recommending push or promotion.


### Individual linters

`npm run lint` runs ESLint over the JavaScript application, scripts, and tests, then
Ruff over the Python scripts and tests. Run either linter alone with `npm run lint:js`
or `npm run lint:python`. The Docker test image pins both tools, so Docker is the
simplest way to reproduce CI without installing Ruff on the host.


### JavaScript syntax checks

Full and fast verification parse `app.js` and every JavaScript file under `src/` and `scripts/` to catch syntax errors. This does not execute the application or verify browser rendering; use the relevant unit and browser suites for those behaviors.

### Generate a development snapshot

Create local data for development or manual testing. This generates a snapshot; it is not a test or a required validation check.

Build the current SirenTO incident snapshot with:

```bash
docker build -f Dockerfile.test -t toronto-dispatch-tests .
docker run --rm -v "$PWD/data:/workspace/data" toronto-dispatch-tests npm run update:tfs
```

- The command writes `data/current.json`; keep generated changes out of code commits.
- It requires live source access and a current test image.

- The snapshot contains normalized incidents and `fetchedAt` / `sourceUpdatedAt` metadata. The browser checks for updates every 30 seconds.
- Source and dispatch times are converted from Toronto time to UTC with daylight-saving handling. An ambiguous fall-back time uses its first occurrence.
- A successful JSON request does not by itself mean the data is current.
