# Repository workflow

## Branching and publication

- Make code changes on `dev`. Do not commit or push application code directly to `main`.
- Pushes to `dev` are promoted automatically through a protected PR only after required checks pass. Do not bypass branch protection or force push.
- Do not push unless the user explicitly authorizes publication.
- Pull `origin/dev` with fast-forward only before new work, because automatic promotion may advance it.
- `data/current.json` is published by automation to the separate `data` branch. Do not include generated snapshot edits in code commits on `dev` unless the task explicitly requires changing snapshot output.

## Change discipline

- Make the smallest change necessary for the requested task.
- Do not refactor, redesign, or clean up unrelated code.
- Preserve existing behavior outside the requested scope.
- Reuse existing state, rendering, DOM, and data paths instead of introducing duplicate implementations.
- Remove legacy or duplicate code only when it is demonstrably dead or directly relevant to the task.
- Do not make speculative fixes before identifying the actual failure or root cause when reproduction is practical.
- Small changes should produce small diffs. Unexpected large diffs are a stop condition and must be investigated before continuing.

## Docker and local validation

- Use Docker for repository validation commands.
- Do not use port `8080`.
- During implementation, prefer the smallest relevant targeted test set, or `npm run verify:fast` (or `npm run verify:fast -- test/file.test.js`) for a fast inner-loop check.
- The canonical test image is named `toronto-dispatch-tests`. `scripts/docker-test.sh --ensure-image` is intentionally silent when that image already exists and its fingerprint is current; use its exit status rather than expecting success output.
- Run repository Node, ESLint, and Ruff validation through `scripts/docker-test.sh`, `npm run verify:fast`, or `npm run verify`. Do not use a missing or different host toolchain to diagnose a failure unless the same failure reproduces in the canonical Docker environment. Host-only failures still need a follow-up when the host version is within `package.json`'s supported `engines` range.
- Do not repeatedly run the full repository suite after every small change.
- Run broad/full verification at story or feature completion, or when required to reproduce a CI failure. Use `npm run verify` for final full validation; it is the single, versioned entry point for every required check. Continue to use the smallest relevant targeted checks during implementation.
- `npm run verify` runs its independent checks concurrently with bounded concurrency (`VERIFY_JOBS`, default `4`, maximum `8`); image preparation and the final Git/snapshot checks stay sequential. Every required check still runs exactly once. Set `VERIFY_JOBS=1` for fully sequential, readable diagnosis. An invalid `VERIFY_JOBS` value is rejected before any Docker work.
- `npm run verify:fast` is an inner-loop aid only. It ensures the Docker test image exists and is current, runs full lint and the browser syntax checks, and runs offline unit tests under `TZ=UTC`, but it omits the America/Los_Angeles suite, the Python tests, the live-source integration suite, the coverage gate, and the Git publication/snapshot checks. It does not satisfy the 100/100/100 coverage requirement and is not final, pre-push, or promotion verification.
- `npm test` and `npm run test:coverage` both run the canonical offline suite through `scripts/run-unit-tests.sh`. That runner is the single source of truth for which offline JavaScript test files run: it selects every `test/*.test.js` file, excludes every `test/*.integration.test.js` live-source test, and sorts the result deterministically. Do not reintroduce a manually duplicated file list in `package.json`; new offline `*.test.js` files join the suite automatically. `npm run test:coverage` runs that same file set with Node coverage and the mandatory 100/100/100 gate. Live-source integration tests run only under `npm run test:integration`; browser/Playwright suites run only under their `test:*:browser` scripts.
- Before declaring a task complete, verify that `git diff --stat` and `git diff` contain only intentional changes.

### Docker test image freshness and the working-tree wrapper

Validation runs through `scripts/docker-test.sh`, which mounts the current
working tree read-only over the image's `/workspace` while keeping the
image-installed `node_modules` and pinned tools (Node, ESLint, Ruff). The image
is a dependency/tooling snapshot, not a source snapshot.

- **Mandatory validation note:** Run `npx eslint .`, not only targeted files. Rendered-browser validation runs through `npm run test:browser`, which includes the TTC UI suite and manages its deliberate 61-second wait without relying on GNU `timeout`.
- Source, test, fixture, script, and bind-mounted configuration edits do **not**
  require a Docker rebuild. The wrapper supplies the current working-tree content
  on every run.
- Run validation through `scripts/docker-test.sh`, `npm run verify:fast`, or
  `npm run verify`. Do not call `docker run` directly for validation; a bare
  `docker run` uses the image's baked-in source and can silently validate old code.
- Rebuilding remains mandatory when the Dockerfile or the dependency/tooling
  fingerprint inputs change: `Dockerfile.test`, `.dockerignore`, `package.json`,
  and `package-lock.json`. Build with the canonical path:
  `scripts/docker-test.sh --build`.
- The wrapper computes a SHA-256 fingerprint of those inputs and compares it with
  the `org.sirento.test-fingerprint` label baked into the image. On mismatch it
  fails before testing with a clear rebuild command. `npm run verify` and
  `npm run verify:fast` call `scripts/docker-test.sh --ensure-image`, which builds
  only when the image is missing or stale.
- A commit-derived image tag alone does **not** detect uncommitted dependency
  changes, because the commit hash does not change. The fingerprint is
  content-derived, so uncommitted `package.json`/`package-lock.json`/`Dockerfile.test`/
  `.dockerignore` edits are detected.
- Keep the image cheap to rebuild: `npm ci` must stay in its own layer with only
  the manifests copied before it, and repository content must be copied from
  relatively stable to relatively volatile (`concourse`, `.github`, `data`,
  `scripts`, `src`, `test`, then the root frontend files). Do not add a broad `COPY . .`.
  `.dockerignore` must exclude only non-build inputs and must never exclude a
  path the Dockerfile copies. `test/docker-image-layout.test.js` enforces these
  properties structurally.
- When a local Docker result disagrees with CI, first run the wrapper's
  fingerprint check (`scripts/docker-test.sh --fingerprint` versus the image
  label) and, when appropriate, rebuild with `scripts/docker-test.sh --build`
  before suspecting the environment.
- Keep the image self-contained; do not rely on host Node or host tooling.

## Required tests and coverage

- Before considering implementation complete or recommending push or promotion, all required tests must pass.
- Coverage must be exactly:
  - 100.00% lines
  - 100.00% branches
  - 100.00% functions
- Do not treat passing tests as sufficient when coverage is below 100%.
- Run `npm run verify` (the canonical full-verification command) before push or promotion when a change can affect covered code; it includes the README Docker coverage command.
- `npm run verify:fast` does not satisfy the 100/100/100 coverage requirement; only `npm run verify` (or the README Docker coverage command) does.
- Files under `test/fixtures/` are helpers and are not selected as standalone tests by the canonical runner. Imported fixture modules may still appear in Node's coverage accounting; do not infer final coverage from a targeted test run. The full Docker coverage gate is authoritative.
- If coverage is below 100%, identify and report the exact file, uncovered line(s), branch(es), or function(s).
- Add meaningful tests for reachable behavior.
- Remove only genuinely dead or unreachable code.
- Do not add artificial execution paths solely to satisfy coverage.
- Before committing, run `npm run verify`, which covers the canonical offline unit suite in America/Los_Angeles, the same canonical offline suite in UTC with the 100/100/100 coverage gate, the live-source integration suite, browser JavaScript syntax checks, applicable lint checks, and `git diff --check`. The UTC coverage job is also the UTC unit-suite execution, so there is no separate redundant UTC unit job.

## Deterministic fixtures and regression tests

- Features or bugs involving external, live, timing-sensitive, browser-specific, or otherwise nondeterministic state must have a deterministic local fixture or test path when practical.
- Keep fixture/test-only behavior clearly separated from production behavior.
- Guard test-only fixtures so they cannot accidentally activate in production.
- Cover meaningful states such as:
  - normal data
  - zero results
  - unavailable/failure
  - stale or retained data where applicable
  - update/change state where applicable
- For regressions, reproduce the real failure sequence when practical and add a test that would have failed before the fix.
- Prefer structural and invariant assertions over brittle screenshot-only tests.
- For browser/rendering bugs, assert against actual rendered DOM, geometry, or state where possible.

## Mobile and browser validation

- Playwright Chromium regression testing is required when a change affects rendered layout, geometry, stacking, hit targets, pointer/touch interaction, responsive breakpoints, or browser-driven UI state transitions. Node DOM/string tests and JavaScript syntax checks do not replace it.
- Use `npm run test:browser` for applicable story-completion validation. It discovers every `test:*:browser` package script (excluding itself), starts and readiness-checks the deterministic loopback server on port `8765`, runs the suites sequentially in deterministic order, and tears down its server and child processes on success, failure, or interruption. Do not leave a manual port-8765 server running. A targeted `test:*:browser` script may be used during implementation. The browser suites are not part of the default Docker, CI, `npm run verify`, or `npm run verify:fast` suites; do not probe the Docker test image for Playwright or Chromium. Follow the README browser-test setup instead.
- `npm run test:browser` includes the TTC UI suite, whose deliberate wait makes that suite take a little over one minute. Missing local Playwright or Chromium is an outstanding validation requirement, not permission to mark a browser-relevant story `DONE`.
- If a relevant browser regression does not yet have a Playwright script, add or extend a deterministic rendered-browser regression that asserts DOM state, geometry, and interaction rather than relying only on screenshots.
- Automated Chromium success does not replace physical-device validation when the reported defect is specific to iPhone Safari, Brave, WebKit, or another browser/device environment.
- If physical-device validation is still outstanding, report the story as implemented or awaiting validation rather than fully complete.
- Preserve user-selected state during asynchronous loading, refreshes, and deferred UI work.
- Cancel stale deferred work when newer user interaction supersedes it.
- Avoid unnecessary rerenders, refetches, recalculations, and unbounded rendering behavior.

## SirenTO trust and data semantics

Preserve these product semantics in both logic and UI:

- Zero results does not mean source unavailable.
- Source unavailable does not mean zero results.
- Marker aging does not mean an incident is resolved.
- `NEW` or `UPDATED` does not mean severity.
- Number of responding units does not mean danger or severity.
- A police call is not confirmation that a crime occurred.
- Call density is not crime density or neighbourhood safety.
- Do not infer causality between TTC disruptions, road closures, emergency incidents, or other events unless an authoritative source explicitly establishes it.
- Do not infer geographic precision from free-form text.
- If TTC geography cannot be resolved from structured data, preserve the alert but do not invent map geometry.
- Clearly distinguish SirenTO-observed or inferred information from official-source information.
- Preserve zero, stale, unavailable, and retained-data semantics when changing UI or data flow.

## Privacy and location handling

- Minimize retention of exact user location.
- Keep saved locations local where the product currently does so.
- Do not introduce raw location-history collection.
- Do not send saved coordinates to backend services unless the feature explicitly requires and documents it.
- Keep browser geolocation state separate from saved-location state.
- Missing-person last-seen locations must never be presented as current locations.

## Service worker and deployment safety

- Preserve existing service-worker and cache behavior unless the task specifically requires changing it.
- When changing cached frontend assets, verify that:
  - asset version keys are current
  - module/cache-buster references are consistent
  - service-worker cache versions are advanced when needed
  - obsolete SirenTO caches are removed as intended
- Do not allow stale cached assets to reintroduce reverted application behavior.
- Use `npm run bump:asset-version -- --asset <tag> --cache <sirento-shell-vN>` for frontend asset/cache version changes. Do not update version references manually. Afterward, run the asset-version agreement test and inspect the diff.

## Repository hygiene

- Do not commit unrelated generated files, screenshots, debug artifacts, temporary credentials, local fixture output, or accidental `data/current.json` changes.
- Before full lint, inspect ignored `tmp/` content for stale repository debug scripts. Never clear `tmp/` indiscriminately: delete only files confirmed to be unreferenced debris, and record that cleanup in the roadmap.
- Remove temporary keys, credentials, and debug files after use.
- Run `git diff --check` before considering work complete.
- When asked for a commit message, keep it concise, high-level, and user-facing, using literal `-` bullets.

## Safe file editing

- **Mandatory prompt instruction:** Use only `perl -0pi -e` or `python3` heredocs for source/test edits. Never use `single_find_and_replace` or `edit_existing_file` on source or test files; they can reformat the whole file and waste implementation cycles before the changes must be reverted.
- The canonical roadmap is `SirenTO-Development-Roadmap.md` in the Continue rules directory. Generic edit tools cannot reach it, so roadmap changes must use a `python3` heredoc with the resolved path.
- Avoid editor-based or generic edit tools that may open files in VS Code or trigger automatic formatting.
- Do not use `single_find_and_replace`, `edit_file`, or similar tools on source/test files if they may rewrite formatting outside the intended change.
- Prefer surgical, non-formatting edits using:
  - `perl -0pi -e` for small in-place replacements
  - `python3` heredoc scripts for exact insertions/replacements
  - other literal text-editing commands that preserve untouched bytes
- Before and after any edit, inspect `git diff --stat` and `git diff`.
- If a supposedly small change produces large unrelated formatting churn, stop immediately.
- Revert the affected file(s) and re-apply the intended change with a surgical text-editing method.
- Do not keep formatter-generated churn in the final diff unless the task explicitly requires formatting changes.
- Treat unexpected file-wide reformatting as a tooling failure, not as part of the implementation.
- `package.json` must retain its trailing newline. Surgical edits must not introduce a spurious whole-file or final-line diff.
- Browser-executed scripts must declare the browser globals they use in their ESLint global comment when those globals are not supplied by the file's lint environment (for example, `getComputedStyle`). Do not add unnecessary globals or weaken ESLint rules globally, and do not modify ESLint configuration solely to accommodate one browser script.

## Story completion

- Record every change in the canonical roadmap, including at minimum why the change was needed and what was changed; this applies to follow-up fixes and maintenance work, not only completed stories.
- Do not mark a story `DONE` while a required production, CI, browser, or physical-device acceptance step is still outstanding.
- Use an intermediate status such as `IMPLEMENTED / AWAITING VALIDATION` when appropriate.
- When a SirenTO story is completed, update the canonical roadmap:
  `SirenTO-Development-Roadmap.md` (in the Continue rules directory, `~/.continue/rules/`)
- For a numbered roadmap increment, update its status-table row, detailed section heading/status, and completion handoff in one pass. The handoff must give the next task enough context to start without chat history.
- Every story retrospective/completion handoff must explicitly assess: (1) out-of-band chore or cleanup stories that should be created rather than expanding the current scope, and (2) durable workflow lessons that should refine `AGENTS.md` or `README.md`. Write `None` when no follow-up is warranted; do not silently omit either assessment.
- At the end of every story, print a clearly labelled **Retrospective** in the final response. Summarize what made the work smoother, what was missing or caused rework, verified local facts that should be carried into the next prompt, proposed out-of-band chore/cleanup stories, and recommended `AGENTS.md`/`README.md` refinements. Write `None` for sections with no findings.
- When a retrospective identifies verified repository-specific facts that would otherwise need rediscovery, add a concise **Known local facts** block to the next implementation prompt. Include only facts relevant to that increment: inherited working-tree files, contract shapes and units, fixture IDs/epochs and compatible helpers, known environment-only failures, exact inner-loop commands, and files owned by later stories. Distinguish stable facts from transient observations, and do not copy stale assumptions forward.
- Do not create or update duplicate roadmap copies elsewhere.
- Prefer a narrowly scoped follow-up or regression story over reopening a completed story with a broad rewrite.
