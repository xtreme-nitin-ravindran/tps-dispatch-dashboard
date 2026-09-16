# Toronto Dispatch

A responsive, independent web dashboard for Toronto Police Service public Calls for Service (C4S) dispatch information.

## What it does

- Shows public dispatch calls for the last 1, 3, 6, 12, 18, or 24 hours.
- Filters by Toronto Police division.
- Searches by call type, location, division, or public call ID.
- Calculates the busiest division and most common call description in the current view.
- Refreshes when the configured public source updates.
- Clearly distinguishes a **call for service** from a confirmed crime.
- Includes TPS source, licensing, privacy, and non-affiliation language.

## Data source

The source replacement is being developed against official Toronto Police Service and Toronto Fire Services data only. The TFS transformation is the first TDD slice; the browser dashboard will be connected to the normalized output after the official-source fetch layer is implemented. The existing browser app still uses its checkpointed source until that migration is complete.

No new source code should depend on GTA Update.

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

Toronto Police Service and Toronto Fire Services are credited as public-data sources. This project is independent and is not affiliated with or endorsed by either service. Do not add official crests, badges, logos, flags, or other official marks in a way that suggests endorsement.
