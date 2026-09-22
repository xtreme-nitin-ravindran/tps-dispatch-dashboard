# SirenTO

Fire-service calls, mapped to your neighbourhood.

A responsive, independent web dashboard for Toronto Fire Services public active-incident information.

## What it does

- Shows current public Toronto Fire Services incidents.
- Filters by event category (Medical, Fire, Ongoing, or Other) and division when available.
- Searches by incident type, location, division, or public incident number.
- Shows calls by division and approximate incident locations on an interactive map.
- Checks the generated snapshot for updates every 30 seconds.
- Includes TFS source, licensing, privacy, and non-affiliation language.

## Data source

The browser dashboard consumes the generated SirenTO incident snapshot at `data/current.json`.
Incidents come from Toronto Fire Services and Toronto Police Service. Geographic context also uses TPS division boundaries, Toronto Centreline intersections, GeoNames postal areas, and OpenStreetMap tiles.

The updater fetches `https://www.toronto.ca/data/fire/livecad.xml`, parses the XML,
and normalizes the incidents into a single JSON schema. The browser reads the generated
snapshot rather than requesting the official feed directly. TPS calls come from the public C4S_Public_NoGO ArcGIS layer.

The updater prepares display labels, map coordinates and TPS division estimates in
each incident's `geography` field. It uses bundled open data, with no live geocoder
requests. The browser renders the prepared snapshot as one update; it performs no
geocoding or division assignment. Unchanged calls do not trigger another render,
and snapshot updates preserve the map view. The original TFS beat remains in
`division`; the display uses `geography.division`.

## TDD workflow

Install Node.js 20 or newer, then run:

```bash
npm test
```

Alternatively, run the tests in Docker without installing Node.js or npm locally:

```bash
docker build -f Dockerfile.test -t toronto-dispatch-tests .
docker run --rm -e TZ=UTC toronto-dispatch-tests
docker run --rm -e TZ=America/Los_Angeles toronto-dispatch-tests
```

Run the live official-source integration test separately:

```bash
docker run --rm toronto-dispatch-tests npm run test:integration
```

The integration test fetches the official Toronto Fire Services `livecad.xml` endpoint,
selects one random incident, and validates the normalized dashboard contract. It does not
snapshot or compare every live record.

The parser contract is in `src/tfs/normalize.js`, with representative official-feed-shaped input in `test/fixtures/tfs-incident.json` and behavior tests in `test/tfs-normalize.test.js`.

Build the current SirenTO incident snapshot with:

```bash
docker build -f Dockerfile.test -t toronto-dispatch-tests .
docker run --rm -v "$PWD/data:/workspace/data" toronto-dispatch-tests npm run update:tfs
```

The generated `data/current.json` contains normalized incidents plus `fetchedAt`
and `sourceUpdatedAt` metadata. The browser reads this file on startup and reloads it every 30 seconds. Source and dispatch timestamps are converted from
`America/Toronto` to UTC with daylight-saving handling. During the repeated fall-back
hour, an offset-free time is ambiguous; the parser chooses its first occurrence.
A successful JSON request alone does not mean the data is current.

## Continuous integration and branch policy

`.github/workflows/tests.yml` runs all tests in Docker on every push to `dev`,
on pull requests targeting `main`, and on manual dispatch. Its stable check name
is **All tests (Docker)**. Both the unit suite and the live official-source integration
test must pass. The integration test still runs if unit tests fail, provided the image built.
An upstream TFS outage can therefore fail this check.

**`main` has no branch protection.** The previously created rule was removed.
Test results are informational: failed tests do not block merges, pull requests are
not required, and direct pushes to `main` are allowed for users with write access.
The remaining test workflow uses `actions/checkout@v5` and the Node.js 20
Docker image defined by `Dockerfile.test`. There is no GitHub snapshot updater.

## ETL and Concourse

`scripts/tfs-etl.js` is the scheduler-independent task entry point. It fetches the
official XML, normalizes and merges incidents, and atomically writes the snapshot.
It uses the modules under `src/`; supply the repository checkout, not just this script.
Node.js 20+ is required; no npm dependencies need installing.

```bash
node scripts/tfs-etl.js
# Separate Concourse input and output artifacts:
TFS_PREVIOUS=history/current.json TFS_OUTPUT=snapshot/current.json node scripts/tfs-etl.js
# Process the exact XML that triggered the pipeline instead of fetching again:
TFS_XML=feed/livecad.xml TFS_PREVIOUS=history/current.json TFS_OUTPUT=snapshot/current.json node scripts/tfs-etl.js
```

`npm run update:tfs` calls the same task. The old `scripts/update-tfs.js` entry point
remains compatible. `TFS_OUTPUT` defaults to `data/current.json`. Without
`TFS_PREVIOUS`, the output file is also the history input; a missing file starts new
history. An explicitly supplied history path must exist and contain valid JSON.
For the first Concourse run, deliberately seed history with
`{"source":"TFS","incidents":[]}` or an existing valid snapshot.

`concourse/tfs-etl.yml` is a reusable task definition with `repo` and `history`
inputs and a `snapshot` output. In your pipeline, retrieve the last successfully
published `current.json` as `history/current.json`, run this task, then publish
`snapshot/current.json` to the dashboard's storage. Task outputs alone are not
persistent storage between builds. Serialize the entire read/merge/publish job
(`serial: true`) and use a single writer to avoid losing concurrent updates.

The supplied Concourse pipeline runs every minute and fetches each feed independently.

When one feed fails, its saved calls are retained and its status is marked unavailable.
The successful feed still updates. If both fail, the published snapshot is preserved.
Invalid history fails rather than discarding records.

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

Contains information licensed under the Open Government Licence – Toronto where applicable.

- **Incidents:** [Toronto Fire Services](https://www.toronto.ca/community-people/public-safety-alerts/alerts-notifications/toronto-fire-active-incidents/).
- **Municipal open data:** [Open Government Licence – Toronto](https://www.toronto.ca/city-government/data-research-maps/open-data/open-data-licence/).
- **Division boundaries:** Toronto Police Service, [TPS_POLICE_DIVISIONS_REV on ArcGIS](https://www.arcgis.com/home/item.html?id=fdd36b8dd9544c97b926958f3eb8cb98), also used by [TPS My Neighbourhood](https://www.tps.ca/my-neighbourhood/). The item credits Toronto Police Service but its licence field was blank when checked September 18, 2026; it is not covered by this repository's Unlicense.
- **Map data:** © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), under the Open Database License.

This project is independent and is not affiliated with or endorsed by Toronto Fire Services,
Toronto Police Service, the City of Toronto, or Esri. The Unlicense applies only to original
repository software, not third-party data, services, or assets.

## Rolling incident history

`data/current.json` retains calls dispatched within the last seven days (168 hours). Each update reads
this file, merges new records by incident ID, updates known records, and removes records
outside the retention window. The JSON is replaced atomically after merging; it is not
an append-only text log. Keep the previous file available between updater runs.

The History options are **Last 1 hour**, **Last 3 hours**, **Last 6 hours**, **Last 12 hours**, **Last 24 hours** (default), **Last 3 days**, and **Last 7 days**. The source update time remains visible above the map. Calls absent from the
latest active feed remain in history with `isOngoing: false`; this does not establish
that an incident is resolved. The Ongoing filter reflects the last fetched feed.

History accumulates from observed snapshots only; it cannot backfill earlier calls or
capture calls that start and disappear between fetches. Invalid or older source update
timestamps and unreadable existing history fail the update rather than discarding it.

The header displays “Updates from official TFS and TPS feeds.” The source update
timestamp remains visible above the map.

### Deploy the Concourse updater pipeline

`concourse/pipeline.yml` uses a one-minute time resource so TPS continues updating
even if TFS is unchanged or unavailable. Each job tests the code and runs the shared
updater before committing the snapshot. Reapply the pipeline with fly after this change.

Pushes are fast-forward only. A concurrent branch change rejects the push. Trigger a
new build with fresh inputs after a failure, or wait for the next scheduled run. There is no force
push or automatic conflict resolution.

The HTTP resource fetches during both check and get. Because the endpoint cannot
retrieve historical versions, `strict: false` accepts the latest XML if it changes
between these requests. The ETL uses that downloaded body without another fetch;
the live integration test makes its own independent request. Body hashing includes
the source timestamp, so timestamp-only XML changes also trigger a build.

When XML stops changing, no new snapshot is committed: `fetchedAt` remains the last
ETL time, and expired history is physically removed on the next successful update.
The dashboard still filters calls by dispatch age.

This publishes data to Git, not directly to a website. Your dashboard host must
serve the updated commit. The local Concourse deployment must remain running;
polling intervals are approximate and depend on worker availability. The saved
production configuration has not yet been deployed with write credentials.

## License

The original software in this repository is released under the [Unlicense](LICENSE),
a public-domain dedication allowing use, modification, redistribution, and commercial
use without an attribution requirement or a requirement to publish derivative source code.
The software is provided without warranty.

This applies to the project’s original code, not third-party data or components.
Toronto Fire Services feed data and derived snapshots (including `data/current.json`)
remain subject to their source terms and attribution requirements. Third-party
libraries, fonts, map tiles, and geocoding data retain their respective licenses.

### Police division estimates

Both updaters use bundled Toronto Centreline intersection nodes, GeoNames postal
area coordinates/labels and TPS boundaries. All matching runs locally before the
snapshot is published. No ArcGIS geocoder results are stored.

Street pairs must share a unique Centreline node. Missing or ambiguous matches stay
unresolved. Both segment ends must resolve for a division estimate; different end
divisions produce “Possible divisions …”. A segment pin is its endpoint midpoint,
not an exact incident address. Postal points are broad area estimates.

The versioned `locationCache` is reused by both updaters and pruned to retained
locations. Resolved entries refresh after 30 days; misses after an hour. All local
matches are prepared on the first run, without a network lookup budget.

Sources and rebuild instructions: [geography data](data/geography/README.md).
Refresh the bundled indexes and change the source version in `scripts/tfs-etl.js`
when reference data changes. TPS boundaries remain separately licensed third-party data.

### GitHub Actions fallback

`Update SirenTO incidents` checks `main` every five minutes (and supports manual runs).
It fetches both feeds only when `current.json.fetchedAt` is at least ten minutes old;
manual runs obey the same guard. GitHub schedules may be delayed. Missing timestamps
or future timestamps trigger an update; malformed history fails without overwriting it.
Fresh snapshots cause no fetch, write, commit or Pages rebuild.

Snapshots record `updatedBy`: `concourse`, `github-actions`, or `manual`.
Redeploy the updated Concourse pipeline to enable its identity field. Older snapshots
have no identity until an updater runs. The age check uses `fetchedAt`, not the TFS
source timestamp, which may remain unchanged after a successful fetch.

The fallback pushes fast-forward only; concurrent Concourse updates cause a safe
push rejection, and the next scheduled run checks again. It explicitly requests a
Pages rebuild because GITHUB_TOKEN commits do not automatically trigger Pages.
This assumes the existing Pages configuration publishes `main` from the repository
root. The workflow needs repository Contents and Pages write permissions.

Incident filters classify descriptions: Medical includes medical calls; Fire includes fires and alarms; Other includes remaining TFS incidents such as collisions, rescues, gas leaks, and hazards. Alarm levels are displayed only for the Fire category.

Map labels expand TFS street abbreviations. Blue markers indicate resolved intersections or street segments, not exact incident addresses; amber markers indicate postal areas or incomplete matches. Postal area labels use GeoNames area names and may differ from other neighbourhood lookup tables. Original TFS descriptions remain the lookup keys.

Postal data: [GeoNames](https://www.geonames.org/), Creative Commons Attribution 4.0. Street nodes: [Toronto Centreline](https://open.toronto.ca/dataset/toronto-centreline-tcl/), Open Government Licence – Toronto.

The map includes a switchable TPS division boundary overlay. Hover or click a division for its station address. Station metadata comes from the same TPS boundary layer (retrieved September 19, 2026); boundaries are geographic context and do not change incident estimates.

## Combined fire and police calls

The service filter selects All / Fire (TFS) / Police (TPS). Records remain separate,
even when their times and locations coincide. TPS reported divisions are distinguished
from TFS estimates. TPS does not publish vehicles or ongoing status in this layer;
the dashboard does not infer either. TPS pins show public approximate coordinates.

TPS source: https://services.arcgis.com/S9th0jAJ7bqgIRjw/arcgis/rest/services/C4S_Public_NoGO/FeatureServer/0
Credit: Toronto Police Service. The updater fetches IDs then bounded batches and
rejects incomplete responses. Object IDs can be recycled, so record identity uses
a source-prefixed hash of public timestamp/type/location/division/coordinates.
Identical public attributes cannot distinguish separate calls.

The snapshot retains seven days and has independent TFS/TPS fetch times and statuses
in `feeds`. Top-level `source: TFS` remains for backwards schema compatibility.
Both Concourse and the GitHub fallback use the combined updater. Neither stores
ArcGIS geocoder output; TPS incident coordinates are supplied by the incident layer.

The scheduled Concourse job runs deterministic unit tests only; live-source integration tests remain a separate validation check so a TFS outage cannot prevent TPS ingestion.

Automated commits use “chore: refresh SirenTO incidents”. The default identity is “SirenTO updater”; GitHub Actions retains its standard bot identity. The Concourse job is named `update-sirento`. Existing script filenames and TFS_* environment variables remain compatible.

### Road and transit disruptions

The combined updater also prepares `current.json.disruptions` from the City of
Toronto [Road Restrictions v3 JSON feed](https://secure.toronto.ca/opendata/cart/road_restrictions/v3?format=json)
and the [official TTC GTFS-RT text feed](https://gtfsrt.ttc.ca/alerts/all?format=text).
Both Concourse and GitHub fallback use this path. Each source is checked at most
once per five minutes, independently; failures preserve the last successful data
and timestamp and never prevent an incident update. Data over one hour old is not displayed.
The browser requests no live disruption feeds.

Road restrictions are filtered by their published date range, expired flag and
current impact (`None` is excluded). Recurring schedules are displayed as supplied;
these are reported restrictions, not a guarantee a road is currently fully closed.
The optional purple dashed map layer uses published road segments, with point fallback.
Calls near me filters roads using distance to the segment. Emergency service,
call type, division and history filters do not filter this separate section.
TTC alerts use active periods and remain citywide: route/stop IDs are supplied,
but this implementation does not invent stop coordinates or tie alerts to calls.

Source attribution: City of Toronto Road Restrictions and Toronto Transit Commission
GTFS-Realtime Service Disruptions. The Toronto Open Data catalogue currently marks
both dataset licences as unspecified; no blanket licence is asserted for them.
Official road and TTC advisory links are available in the section.

## View controls

Background call changes wait behind the “New calls available” button (or “Call updates available” for revisions). Applying updates preserves the results scroll position. Clear filters restores all services/events/divisions, a 24-hour window, and removes nearby filtering. Share view copies a URL containing search, service, event, division and history; nearby coordinates are never included.

Map calls cluster by screen position. Click a cluster to zoom, then expand overlapping markers at close zoom. Click a located result (or press Enter/Space) to reveal it on the map. Map pins still reveal their result rows.

History, service, event, division and road/boundary layer preferences are saved locally in the browser. Shared links override saved filters. Search text and geolocation are not saved; blocked or invalid browser storage falls back safely to defaults.
