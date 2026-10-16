# SirenTO

[![Measured JavaScript lines coverage](https://raw.githubusercontent.com/xtreme-nitin-ravindran/tps-dispatch-dashboard/coverage/lines.svg)](docs/validation.md#test-coverage)
[![Measured JavaScript branches coverage](https://raw.githubusercontent.com/xtreme-nitin-ravindran/tps-dispatch-dashboard/coverage/branches.svg)](docs/validation.md#test-coverage)
[![Measured JavaScript functions coverage](https://raw.githubusercontent.com/xtreme-nitin-ravindran/tps-dispatch-dashboard/coverage/functions.svg)](docs/validation.md#test-coverage)

## Overview

Fire and police calls, road restrictions, and transit alerts across Toronto.

SirenTO is an independent dashboard for exploring public Toronto Fire Services (TFS)
and Toronto Police Service (TPS) calls on a map, finding recent calls nearby, and
checking City of Toronto road restrictions and TTC service alerts. It brings these
sources together with searchable call history.

⚠️ **Locations are approximate, and the dashboard is intended for public curiosity—not
emergency decisions or real-time safety guidance.**

### ⚠️ Important data caveats

> [!WARNING]
> A public dispatch record:
>
> - is **not** proof that a crime occurred;
> - may be delayed, revised, reclassified, or cancelled;
> - may use an approximate/public location description;
> - may omit sensitive calls for privacy or operational reasons.
>
> **Do not combine this feed with other datasets to try to identify an individual, household, business, victim, caller, or suspect.**

### What it does

- Maps public Toronto Police and Fire calls.
- Shows TTC service alerts.
- Lets you search and filter calls, save locations, and share views.
- Finds recent calls nearby with **Hear sirens?** and **Near me** quick searches.
- Uses [public data sources](docs/product-and-sources.md#data-sources) from Toronto services and geographic reference providers.

**Malformed source data:** When the City road-restrictions feed contains an illegal JSON escape, SirenTO repairs only that escape so the feed can be read, and clearly identifies the repair as a SirenTO alteration. See the [source warning](docs/product-and-sources.md#malformed-source-data).

## Run locally

### Preview with live public data (recommended)

The public dispatch feed does not send a CORS header that permits a localhost
origin, so a plain static server cannot load live data in a browser. Use the
bundled preview server, which serves the repository and proxies only the two
public JSON feeds through the same origin:

```bash
cd tps-dispatch-dashboard
python3 scripts/preview-server.py
```

Then open:

```text
http://localhost:8766
```

This is a development-only path; it binds to loopback and does not change any
deployed configuration. Pass `--port` to use a different port.

### Static server (no live data)

For UI-only work that does not need the live feed, any static server works:

```bash
cd tps-dispatch-dashboard
python3 -m http.server 4173
```

or:

```bash
cd tps-dispatch-dashboard
npx serve . --listen 4173
```

Then open:

```text
http://localhost:4173
```

## Development

For contributions to this repository:

Develop on **`dev`** and run the [required checks](docs/validation.md#run-all-required-checks) before committing.
Before starting new work, synchronize your branch:

```bash
git switch dev
git pull --ff-only origin dev
```

### Pre-push checklist

Before pushing, run `npm run verify` (the canonical full-verification command) and confirm the checklist below. See [Testing and Validation](#testing-and-validation) below for full testing details.

- [ ] `npm run verify` passes end to end. (`npm run verify:fast` is an inner-loop aid only
      and does not satisfy this checklist.)
- [ ] The coverage command reports 100.00% lines.
- [ ] The coverage command reports 100.00% branches.
- [ ] The coverage command reports 100.00% functions.
- [ ] Regression-contract tests relevant to the changed code pass.
- [ ] Applicable Playwright browser suites pass; required device-specific validation is complete.
- [ ] Lint and syntax checks pass as applicable.
- [ ] `git diff --check` passes.
- [ ] `data/current.json` is unchanged unless intentionally modified.
- [ ] For changes to the TTC GTFS-RT vehicle-capture stack, the host-level
      deployment test passes (`bash scripts/e2e.sh`; see
      [TTC GTFS-RT vehicle-capture](docs/e2e-test.md)).

## Testing and Validation

Tests check behavior, live data compatibility, coverage, and code quality. Fast mode gives feedback during development; before pushing, the full required checks and any applicable browser regressions must pass, with exactly 100% line, branch, and function coverage. Changes affecting Concourse tasks also require validation on the real worker.

A typical feature, update, or fix follows these testing steps:

- Add or update tests for the behavior you change.
- Run `npm run verify:fast`, using a targeted test file when useful, and iterate until it passes.
- Run `npm run verify` when the change is ready. Its coverage check must reach 100% for lines, branches, and functions.
- For UI layout or interaction changes, add or update Playwright regressions and run `npm run test:browser`.
- Before pushing, confirm all required checks pass for the final changes using the [pre-push checklist](#pre-push-checklist).

The checks and test suites are outlined below:

- **Fast feedback:** `npm run verify:fast` runs lint, syntax, and offline tests during development. It does not replace full verification. See [fast mode](docs/validation.md#fast-inner-loop-verification).
- **Docker test environment:** Use the pinned Docker toolchain to validate the current working tree. See [Docker setup and image freshness](docs/validation.md#docker-test-wrapper).
- **Unit and regression tests:** Deterministic offline tests check application behavior in UTC and America/Los_Angeles. See [offline suites](docs/validation.md#offline-suites) and [regression guidance](docs/regression-contracts.md).
- **Python tests:** Fixture-based tests check geographic-data preparation and coverage badges. See [Python tests](docs/validation.md#python-tests).
- **Live-source integration tests:** Check that external feeds remain compatible with the application. See [live-source tests](docs/validation.md#live-source-integration-tests).
  - **⚠️ Requires internet access 🌐**
  - **⚠️ Tests may fail because upstream data is unavailable or malformed 🚫**
- **Browser tests:** Playwright checks rendered layout and interaction; device-specific issues also need testing on the reported device. See [browser testing](docs/browser-tests.md).
- **Coverage:** JavaScript line, branch, and function coverage must each reach 100%. See [coverage requirements](docs/validation.md#test-coverage).
- **Linting and syntax:** ESLint, Ruff, and JavaScript syntax checks catch code errors. See [linting](docs/validation.md#individual-linters) and [syntax checks](docs/validation.md#javascript-syntax-checks).
- **Before pushing:** `npm run verify` runs the required full checks. Applicable browser tests run separately and must also pass. See [full verification](docs/validation.md#run-all-required-checks) and the [pre-push checklist](#pre-push-checklist).
- **Test inventory:** Browse the [test inventory](docs/validation.md#test-inventory) for what the suites cover and how test membership is determined.
- **Requirement traceability:** Every test is classified as either a `STORY-*` delivery increment or an explicit `INFRA-*` area, with the ID in the test name and in `test/requirements.map.json`. `scripts/check-requirement-coverage.js` enforces this as part of `npm run verify`. Prefix test names with bracketed IDs (for example `[STORY-4]`), and register every ID in the file's map entry. Infrastructure tests use one of the enumerated `INFRA-*` areas rather than an invented story ID; bounded legacy exemptions live only in `test/requirements.pending.json`.

  | `INFRA-*` area | Covers |
  |---|---|
  | `INFRA-DOCKER` | Docker test image and the working-tree wrapper |
  | `INFRA-VERIFY` | The `npm run verify` orchestration |
  | `INFRA-CI` | CI strategy, promotion, and pipeline configuration |
  | `INFRA-PUBLISH` | Data publication and the R2 sink |
  | `INFRA-BROWSER` | Playwright browser suites and the runner |
  | `INFRA-ASSETS` | Frontend asset versioning and cache busting |
  | `INFRA-PWA` | PWA metadata, manifest, and install scope |
  | `INFRA-WATCH` | Watch backend and notification delivery |
  | `INFRA-TTC-PIPELINE` | TTC capture and geometry pipeline |
  | `INFRA-LINT` | ESLint, Ruff, and syntax checks |
- **Frontend asset bumps:** Run `npm run bump:asset-version -- --asset <tag> --cache <sirento-shell-vN>` on the host because it mutates source files; the Docker wrapper mounts those files read-only. Then run the asset-version agreement test through the Docker wrapper and inspect the diff. Repository validation remains in Docker.
- **Development snapshot:** Generate local data for manual testing. This is not a validation check. See [snapshot generation](docs/validation.md#generate-a-development-snapshot).
- **Concourse worker validation:** Test affected tasks against the working tree on the real worker using `fly execute`, in addition to local Docker checks. See [worker validation](docs/concourse.md).
- **TTC GTFS-RT vehicle-capture test:** Deploy the TTC capture stack to an SSH-reachable host and verify it end-to-end. See [the TTC GTFS-RT vehicle-capture test](docs/e2e-test.md).

## Web Notifications

Watch a chosen area for new or meaningfully updated calls.

- Enable **Watch this area** to opt in; notification permission is requested only after your action.
- Notifications identify the service and incident, with an approximate distance when available. Opening one reveals the incident in the dashboard.
- Routine refreshes do not trigger repeat alerts. Notifications exclude saved-location labels, watch coordinates, and subscription credentials.
- See [notification behavior, setup, and testing](docs/watch-api.md).

**Limitations:**

- Notifications require HTTPS, browser support, permission, and a configured notification service. On iOS/iPadOS, an installed Home Screen app is required.
- Matching runs every five minutes, so alerts may be delayed. Stale or unavailable feeds do not trigger notifications; an expired incident may no longer be available when opened.
- An alert does not indicate severity or confirm that a call is still active. Do not rely on notifications for emergency or safety decisions.

## CI and Data pipelines

Automation validates code changes and keeps the dashboard’s public data current. These are the pipelines used by this repository; other deployments can choose their own hosting and automation.

### Concourse

- Runs the primary data updates approximately every three minutes (serialized runs may take longer), fetching feeds and preserving call history.
- Publishes incidents followed by TTC diversion data; code validation runs in the protected promotion gate.
- See [data pipeline details](docs/data-pipeline.md).

### GitHub Actions

- Tests pushes to **`dev`**. Passing checks promote the tested commit to **`main`** through a protected pull request; GitHub Pages then publishes the site.
- Documentation-only changes can skip expensive application tests when the conservative CI classifier confirms they are safe. Required status checks still finish. See [documentation-only checks](docs/data-pipeline.md#documentation-only-changes).
- Failed checks stop promotion. Do not bypass protection or push application code directly to **`main`**.
- Publishes coverage badges and reports to the generated **`coverage`** branch; do not use it for development.
- Provides fallback data updates when the snapshot or either incident feed is at least ten minutes old or unavailable. Scheduled checks run every five minutes but may be delayed.
- See [data pipeline details](docs/data-pipeline.md) and [coverage reporting](docs/validation.md#test-coverage).
- Dependabot watches `npm`, the Docker test image (`docker/Dockerfile.test`), and the pinned GitHub Actions. It cannot see the Concourse `image_resource` Node tags, so those are guarded by `concourse/node-image.yml` and `test/concourse-node-image.test.js`; bump them together with the Dockerfile. See [Dependabot coverage and the Concourse Node image drift guard](AGENTS.md#dependabot-coverage-and-the-concourse-node-image-drift-guard).

### Data storage

- Both data pipelines use code from **`main`** and publish to Cloudflare R2, an **S3-compatible object store**. R2 is the only publication target; the git `data` branch was retired.
- The dashboard reads the published incident and TTC data directly; data refreshes do not require a site deployment.
- Failed sources retain their last successful data and are marked unavailable. Keep generated snapshots out of code commits.
- See [storage and publication details](docs/data-pipeline.md#published-data-and-the-r2-sink).

## Deployment

The continuous TTC GTFS-RT vehicle-capture collector/processor runs as a Docker
Compose stack on a Linux host, deployed via Ansible. A host-level test exercises
the full lifecycle (target → deploy → verify → teardown, including a scratch R2
bucket).

Two documents cover it:

- **Deployment runbook** — explains the two long-running collector/processor
  services, how they take a single-writer ownership lease, and how to deploy,
  verify health, and roll back with the Ansible playbook. See
  [deploy/DEPLOYMENT.md](deploy/DEPLOYMENT.md).
- **TTC GTFS-RT vehicle-capture test** — a host-level test that deploys the stack,
  confirms it writes durable evidence to a scratch R2 bucket, and tears everything
  down cleanly. See [docs/e2e-test.md](docs/e2e-test.md).

## Attribution

SirenTO uses public feeds and geographic data from Toronto Fire Services, Toronto Police Service, the City of Toronto, TTC, GeoNames, and OpenStreetMap contributors. See [provider credits and source terms](docs/attribution.md).

## License

The [Spaghetti License](LICENSE) applies to original repository software. Third-party data, services, and assets retain their own terms. `LicenseRef-Spaghetti` is a custom SPDX reference, not an official SPDX License List identifier.
