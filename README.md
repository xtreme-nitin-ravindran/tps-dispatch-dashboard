# Toronto Fire Dispatch

A responsive, independent web dashboard for Toronto Fire Services public active-incident information.

## What it does

- Shows current public Toronto Fire Services incidents.
- Filters by event category (Medical, Fire, Ongoing, or Other) and division when available.
- Searches by incident type, location, division, or public incident number.
- Shows calls by division and approximate incident locations on an interactive map.
- Checks the generated snapshot for updates every 30 seconds.
- Includes TFS source, licensing, privacy, and non-affiliation language.

## Data source

The browser dashboard consumes the generated official TFS snapshot at `data/current.json`.
The website intentionally uses Toronto Fire Services data only.

The updater fetches `https://www.toronto.ca/data/fire/livecad.xml`, parses the XML,
and normalizes the incidents into a single JSON schema. The browser reads the generated
snapshot rather than requesting the official feed directly. There is no Toronto Police
data integration.

The source adapter preserves the published `beat` as the dashboard division; missing
beats appear as `Unknown`. It does not supply coordinates. Map locations are approximated
using the Photon geocoder and cached in browser local storage. The map uses Leaflet and OpenStreetMap tiles.

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
and `sourceUpdatedAt` metadata. The browser reads this file on startup and reloads it every 30 seconds. Source and dispatch timestamps are converted from
`America/Toronto` to UTC with daylight-saving handling. During the repeated fall-back
hour, an offset-free time is ambiguous; the parser chooses its first occurrence.
The status indicator warns when either the source timestamp or fetch timestamp is
missing or more than 15 minutes old. A successful JSON request alone does not mean
the data is current.

## Continuous integration and branch policy

`.github/workflows/tests.yml` runs all tests in Docker on every push to `dev`,
on pull requests targeting `main`, and on manual dispatch. Its stable check name
is **All tests (Docker)**. Both the unit suite and the live official-source integration
test must pass. The integration test still runs if unit tests fail, provided the image built.
An upstream TFS outage can therefore fail this check.

**`main` has no branch protection.** The previously created rule was removed.
Test results are informational: failed tests do not block merges, pull requests are
not required, and direct pushes to `main` are allowed for users with write access.
The scheduled snapshot workflow commits directly to `main` using `GITHUB_TOKEN`.

The tests run in the Node.js 20 Docker image defined by `Dockerfile.test`.
Both workflows use `actions/checkout@v5`; the snapshot workflow also uses
`actions/setup-node@v5`. These actions use Node.js 24 internally, resolving the earlier
Node.js 20 action-runtime deprecation warning. The snapshot script itself runs on
Node.js 22, with package-manager caching disabled because no dependencies are installed.

## Scheduled updates with GitHub Actions

`.github/workflows/update-tfs.yml` runs every five minutes (at minutes 3, 8, 13, etc., UTC),
and can also be started manually from **Actions → Update TFS snapshot → Run workflow**.
It checks out the default branch, runs the unit tests, fetches the official TFS XML,
normalizes it, writes `data/current.json`, and commits the snapshot back to the default branch.
No npm dependencies or custom secrets are required. Each successful fetch records a new
`fetchedAt`, so successful runs normally create a commit even if incidents are unchanged.

The workflow is published on `main`, the default branch, and manual runs have completed
successfully. It grants `contents: write` to `GITHUB_TOKEN` for snapshot commits and
serializes runs through a concurrency group to avoid overlapping updates.
Scheduled runs can be delayed by GitHub; this is not a guaranteed real-time feed.

View or manually run [Update TFS snapshot](https://github.com/xtreme-nitin-ravindran/tps-dispatch-dashboard/actions/workflows/update-tfs.yml)
and inspect [Tests](https://github.com/xtreme-nitin-ravindran/tps-dispatch-dashboard/actions/workflows/tests.yml)
in GitHub Actions.

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
