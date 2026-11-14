# CI and Data pipelines

[Documentation home](../README.md)

## Automated Data Updates

- **Concourse** runs `scripts/tfs-etl.js` approximately every five minutes to fetch feeds, merge history, and prepare map locations. Road and TTC feeds are checked at most once every five minutes. Concourse is the single writer for the published incident snapshot (`data/current.json`); the GitHub Actions fallback scheduler was removed once Concourse became resilient enough to own the role outright.
- Concourse uses code from **`main`** and publishes `data/current.json` (the incident snapshot) to **Cloudflare R2**. TTC geometry (`data/ttc-diversions.json`) is owned by the always-on continuous capture stack, not this scheduler (Story 79 single-writer ownership; see `docs/homelab-deploy-handoff.md`). The site reads both files directly, so data updates do not require a Pages deployment.
- Failed sources retain their last successful data and are marked unavailable. If both incident feeds fail, the existing snapshot is preserved.

### Published data and the R2 sink

The published snapshot and TTC geometry live in a **Cloudflare R2** bucket
(S3-compatible object storage). R2 is the only publication target: the git `data`
branch was retired in Story 55E, so the scheduler writes no branch and the
publication sink fails loudly when the R2 credentials are missing. Each key has
exactly one writer: the Concourse scheduler writes `data/current.json`, and the
continuous TTC capture stack (deployed from the homelab repo by contract) writes
`data/ttc-diversions.json`. R2 is last-writer-wins per key, so the two datasets
cannot conflict and no lock or serial group is needed.

- **Concourse** runs one `update-feed` job: the incident ETL only. It publishes
  `data/current.json` directly to R2. TTC geometry is no longer published here: the
  continuous capture stack (collector + processor, Story 64) owns
  `data/ttc-diversions.json` (Story 79 records the ownership boundary). The incident
  task seeds the ETL history input from the published snapshot with
  [`scripts/r2-fetch.js`](../scripts/r2-fetch.js); a missing object is tolerated so the ETL
  can start fresh even when `TFS_PREVIOUS` explicitly names the absent file. A
  present-but-malformed history snapshot fails rather than silently discarding history.

Because the scheduler writes only `data/current.json` (the TTC geometry writer is the
independent continuous capture stack), no `serial_groups` lock is needed. An incident
ETL failure fails the build, so the next timer tick retries it.

Keep generated snapshots out of code commits. The snapshot on `dev` and `main` is a
fixture; the live snapshot is in R2. Pipeline configuration is in
[`concourse/pipeline.yml`](../concourse/pipeline.yml), with the non-secret example settings in
[`concourse/values.example.yml`](../concourse/values.example.yml). The secret R2 keys are
not pipeline vars: the task fetches them from Vault (AppRole login) in-task.

Concourse does not build the test image or rerun repository checks: `main` has
already passed the protected GitHub Actions promotion gate (the canonical offline
suite in America/Los_Angeles, Python tests, ESLint and Ruff, browser JavaScript
syntax checks, and the canonical UTC suite with the 100/100/100 coverage
thresholds). The `update-and-publish` task runs on the homelab `task-base` image,
installs Node and runtime dependencies in-task, and runs only the incident update and
R2 publication. The structural CI-strategy regression fails if the pipeline
reintroduces those checks.


## Documentation-only changes

Documentation-only changes skip the expensive application test steps. A `changes` job runs
`scripts/docs-only.js`, which classifies the diff with an explicit allow-list: documentation
extensions (`.md`, `.txt`, `.rst`) inside `docs/` or an explicit root documentation file, and
only when no executable tooling references the path. A Markdown extension alone is not enough,
because a documentation file can be read by a script, test, workflow, or build step. Mixed
changes and every application, script, test, fixture, workflow, package, Docker,
deployment/configuration, and generated-data change keep full validation. Renames and deletions
are conservative: both the old and new path must qualify. The `tests` job still runs and reports
a terminal result for documentation-only changes, so a required status context is never left
pending and promotion is never left waiting. The classifier is covered by
`test/docs-only.test.js`.
