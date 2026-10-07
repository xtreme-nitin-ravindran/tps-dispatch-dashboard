# CI and Data pipelines

[Documentation home](../README.md)

## Automated Data Updates

- **Concourse** runs `scripts/tfs-etl.js` approximately every five minutes to fetch feeds, merge history, and prepare map locations. Road and TTC feeds are checked at most once every five minutes.
- **GitHub Actions fallback** checks every five minutes and runs the updater if the snapshot or either incident feed is at least ten minutes old or unavailable. Scheduled runs may be delayed.
- Both use code from **`main`**. Concourse and the GitHub Actions fallback both publish `data/current.json` and `data/ttc-diversions.json` to **Cloudflare R2**. The site reads those files directly, so data updates do not require a Pages deployment.
- Failed sources retain their last successful data and are marked unavailable. If both incident feeds fail, the existing snapshot is preserved.

### Published data and the R2 sink

The published snapshot and TTC geometry live in a **Cloudflare R2** bucket
(S3-compatible object storage), not on a Git branch. Each publication phase writes a
different object key (`data/current.json` and `data/ttc-diversions.json`), and R2 is
last-writer-wins per key, so the two datasets cannot conflict and no lock or serial
group is needed.

- **Concourse** runs one `update-sirento` job. The incident ETL and the bounded TTC
  vehicle burst are sequential steps in that job. The incident phase publishes
  `data/current.json` first; the TTC geometry phase publishes `data/ttc-diversions.json`
  afterwards. Both publish directly to R2. The incident task seeds the ETL history input from the published snapshot with
  [`scripts/r2-fetch.js`](../scripts/r2-fetch.js); a missing object is tolerated so the ETL
  can start fresh even when `TFS_PREVIOUS` explicitly names the absent file. A
  present-but-malformed history snapshot fails rather than silently discarding history.
- **GitHub Actions** runs one `update-sirento` workflow
  (`.github/workflows/update-sirento.yml`) with the same sequential steps. It publishes
  to R2, with the four R2 values supplied as repository
  secrets (`R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`).

Because there is only one writer per scheduler, no `serial_groups` lock is needed. The
trade-off is deliberate: a TTC failure fails the whole build, so the next timer tick or
scheduled run retries both the incident snapshot and the TTC geometry together.

Keep generated snapshots out of code commits. The snapshot on `dev` and `main` is a
fixture; the live snapshot is in R2. Pipeline configuration is in
[`concourse/pipeline.yml`](../concourse/pipeline.yml), with example settings (including the
R2 credentials) in [`concourse/values.example.yml`](../concourse/values.example.yml).

Before publishing to R2, Concourse builds `Dockerfile.test` with the supported
OCI build task and uses that artifact as its task image. It enforces the same gates as
the protected GitHub Actions workflow: the canonical offline suite in
America/Los_Angeles, Python tests, ESLint and Ruff, browser JavaScript syntax checks,
and the canonical UTC suite with the 100/100/100 coverage thresholds. The structural
CI-strategy regression fails if either pipeline drops one of those shared checks.


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
