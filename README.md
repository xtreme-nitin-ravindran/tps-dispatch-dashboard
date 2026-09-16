# Toronto Fire Dispatch

A responsive, independent web dashboard for Toronto Fire Services public active-incident information.

## What it does

- Shows current public Toronto Fire Services incidents.
- Filters by fire-service division.
- Searches by incident type, location, division, or public incident number.
- Calculates the busiest division and most common call description in the current view.
- Refreshes when the configured public source updates.
- Clearly distinguishes a **call for service** from a confirmed crime.
- Includes TFS source, licensing, privacy, and non-affiliation language.

## Data source

The browser dashboard consumes the generated official TFS snapshot at `data/current.json`.
The website intentionally uses Toronto Fire Services data only.

Only official Toronto Fire Services data is used by the dashboard and source pipeline.

## TDD workflow

Install Node.js 20 or newer, then run:

```bash
npm test
```

Alternatively, run the tests in Docker without installing Node.js or npm locally:

```bash
docker build -f Dockerfile.test -t toronto-dispatch-tests .
docker run --rm toronto-dispatch-tests
```

Run the live official-source integration test separately:

```bash
docker run --rm toronto-dispatch-tests npm run test:integration
```

The integration test fetches the official Toronto Fire Services `livecad.xml` endpoint,
selects one random incident, and validates the normalized dashboard contract. It does not
snapshot or compare every live record.

The parser contract is in `src/tfs/normalize.js`, with representative official-feed-shaped input in `test/fixtures/tfs-incident.json` and behavior tests in `test/tfs-normalize.test.js`.

Build the current official TFS snapshot with:

```bash
docker build -f Dockerfile.test -t toronto-dispatch-tests .
docker run --rm -v "$PWD/data:/workspace/data" toronto-dispatch-tests npm run update:tfs
```

The generated `data/current.json` contains normalized incidents plus `fetchedAt`
and `sourceUpdatedAt` metadata. The browser reads this file on startup and checks for a changed source timestamp every 30 seconds.

## Scheduled updates with GitHub Actions

`.github/workflows/update-tfs.yml` runs every five minutes (at minutes 3, 8, 13, etc., UTC),
and can also be started manually from **Actions → Update TFS snapshot → Run workflow**.
It checks out the default branch, runs the unit tests, fetches the official TFS XML,
normalizes it, writes `data/current.json`, and commits the snapshot back to the default branch.
No npm dependencies or custom secrets are required. Each successful fetch records a new
`fetchedAt`, so successful runs normally create a commit even if incidents are unchanged.

To activate it, push the workflow and project changes to the repository's default branch.
GitHub Actions must be enabled, and repository rules must allow the workflow's
`GITHUB_TOKEN` to write commits to that branch. Protected branches may reject direct pushes.
Scheduled runs can be delayed by GitHub; this is not a guaranteed real-time feed.

Fetch errors or a missing source update timestamp fail the run before committing a new
snapshot. A valid feed with zero incidents is allowed. Existing hosted data remains available.
The updater has a 30-second fetch timeout, and the workflow has a five-minute job timeout.

This workflow implements the **commit changes** option. A deployed dashboard sees updates
only after its host serves the new commit; a local checkout needs to pull those commits.
GitHub Pages branch publishing is not automatically triggered by commits made with
`GITHUB_TOKEN`. For GitHub Pages hosting, use an explicit Pages artifact/deployment workflow
instead of relying on these bot commits to trigger a Pages build. See
[GitHub's publishing-source documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

## Run locally

Because browsers impose restrictions on `file://` pages, serve the folder through a tiny local web server.

### Python

```bash
cd tps-dispatch-dashboard
python3 -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

### Node

```bash
npx serve .
```

## Deploy

This is a static site. You can deploy the entire folder to:

- GitHub Pages
- Cloudflare Pages
- Netlify
- Vercel static hosting
- Any nginx/Apache web server

No build step is required.

## Important data caveats

A public dispatch record:

- is **not** proof that a crime occurred;
- may be delayed, revised, reclassified, or cancelled;
- may use an approximate/public location description;
- may omit sensitive calls for privacy or operational reasons.

Do not combine this feed with other datasets to try to identify an individual, household, business, victim, caller, or suspect.

## Attribution

Contains information licensed under the Open Government Licence – Ontario where applicable.

Toronto Fire Services is credited as the public-data source. This project is independent and is not affiliated with or endorsed by Toronto Fire Services or the City of Toronto. Do not add official crests, badges, logos, flags, or other official marks in a way that suggests endorsement.
