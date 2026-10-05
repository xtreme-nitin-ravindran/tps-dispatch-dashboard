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
- Do not repeatedly run the full repository suite after every small change.
- Run broad/full verification at story or feature completion, or when required to reproduce a CI failure. Use `npm run verify` for final full validation; it is the single, versioned entry point for every required check. Continue to use the smallest relevant targeted checks during implementation.
- `npm run verify:fast` is an inner-loop aid only. It builds the Docker image, runs full lint and the browser syntax checks, and runs offline unit tests under `TZ=UTC`, but it omits the America/Los_Angeles suite, the Python tests, the live-source integration suite, the coverage gate, and the Git publication/snapshot checks. It does not satisfy the 100/100/100 coverage requirement and is not final, pre-push, or promotion verification.
- Before declaring a task complete, verify that `git diff --stat` and `git diff` contain only intentional changes.

### Docker test image freshness

`Dockerfile.test` copies `scripts/` and `test/` into the image at build time
(`COPY scripts ./scripts`, `COPY test ./test`). The image is a snapshot, not a
mount of the working tree.

- **Mandatory validation note:** Rebuild the Docker test image after any `styles.css`, `app.js`, or `test/` change. Run `npx eslint .`, not only targeted files. `scripts/ttc-ui-browser.js` is an optional manual script and is not part of the required suite; it has a deliberate 61-second wait, so run it in the background, and note that `timeout` may be unavailable on macOS.
- After ANY change to `scripts/` or `test/`, rebuild before running tests:
  `docker build -f Dockerfile.test -t toronto-dispatch-tests .`
- A test/coverage/lint run against a stale image silently validates old code and
  can report false success (for example, 100% coverage on pre-change source).
- Never trust a local Docker result that disagrees with CI until you have rebuilt
  the image and re-run.
- When reproducing a CI failure locally, rebuild first; if the failure does not
  reproduce, suspect a stale image before suspecting the environment.

### Prefer content-tagged images

To make staleness visible instead of silent, tag the image by the content it was
built from rather than reusing a fixed tag:

```bash
TAG="toronto-dispatch-tests:$(git rev-parse --short HEAD)"
docker build -f Dockerfile.test -t "$TAG" .
docker run --rm "$TAG" npm run test:coverage
```

- A tag derived from the current commit makes it obvious when the image predates
  the working tree, and prevents accidentally reusing an older image.
- Rebuild whenever `scripts/` or `test/` changes, even if the commit hash is
  unchanged (for example, uncommitted edits): the tag reflects the commit, not
  the working tree, so rebuild after every edit before verifying.
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
- If coverage is below 100%, identify and report the exact file, uncovered line(s), branch(es), or function(s).
- Add meaningful tests for reachable behavior.
- Remove only genuinely dead or unreachable code.
- Do not add artificial execution paths solely to satisfy coverage.
- Before committing, run `npm run verify`, which covers the README Docker unit suites in UTC and America/Los_Angeles, the live-source integration suite, browser JavaScript syntax checks, applicable lint checks, coverage, and `git diff --check`.

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
- Use the applicable existing `test:*:browser` package script with the deterministic loopback fixture on port `8765`. The browser suites are feature-specific and are not part of the default Docker or CI suite; do not spend time probing the Docker test image for Playwright or Chromium. Follow the README browser-test setup instead.
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

## Story completion

- Do not mark a story `DONE` while a required production, CI, browser, or physical-device acceptance step is still outstanding.
- Use an intermediate status such as `IMPLEMENTED / AWAITING VALIDATION` when appropriate.
- When a SirenTO story is completed, update the canonical roadmap:
  `SirenTO-Development-Roadmap.md` (in the Continue rules directory, `~/.continue/rules/`)
- Do not create or update duplicate roadmap copies elsewhere.
- Prefer a narrowly scoped follow-up or regression story over reopening a completed story with a broad rewrite.
