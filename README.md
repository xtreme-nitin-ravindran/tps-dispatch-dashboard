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

The browser dashboard consumes the generated official TFS snapshot at `data/tfs-current.json`.
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

The generated `data/tfs-current.json` contains normalized incidents plus `fetchedAt`
and `sourceUpdatedAt` metadata. It is the next dashboard data contract and is not yet
wired into the browser app.

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
