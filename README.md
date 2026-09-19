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

The browser dashboard consumes the generated official TFS snapshot at `data/current.json`.
Incidents come only from Toronto Fire Services. Geographic context also uses TPS division boundaries, Esri postal geocoding, and Photon/OpenStreetMap street geocoding and maps.

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

Build the current official TFS snapshot with:

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

Configure XML change detection and polling in your Concourse pipeline. If the
pipeline supplies XML, add its artifact as a task input and set `TFS_XML` accordingly.
The task itself does not schedule, commit, or publish anything. Concourse is the primary
updater; the GitHub Actions fallback below takes over when the snapshot is stale.

Failed fetches (30-second timeout), invalid XML update timestamps, older feeds, or
invalid history fail the task without replacing the output. A valid empty feed
marks retained calls inactive. Run periodically even when XML is unchanged if you
want expired records physically removed on schedule.

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
- **Postal geocoding:** Esri ArcGIS World Geocoding Service; [data attribution and terms](https://www.esri.com/en-us/legal/terms/data-attributions) and [service terms](https://www.esri.com/en-us/legal/terms/web-site-service). These service terms are separate from municipal open-data licensing.
- **Street geocoding:** [Photon by komoot](https://photon.komoot.io/), based on OpenStreetMap.
- **Map data:** © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), under the Open Database License.

This project is independent and is not affiliated with or endorsed by Toronto Fire Services,
Toronto Police Service, the City of Toronto, or Esri. The Unlicense applies only to original
repository software, not third-party data, services, or assets.

## Rolling incident history

`data/current.json` retains calls dispatched within the last seven days (168 hours). Each update reads
this file, merges new records by incident ID, updates known records, and removes records
outside the retention window. The JSON is replaced atomically after merging; it is not
an append-only text log. Keep the previous file available between updater runs.

The dashboard defaults to **Last 24 hours**, with **Last 48 hours** and **Last 7 days** options. The source update time remains visible above the map. Calls absent from the
latest active feed remain in history with `isOngoing: false`; this does not establish
that an incident is resolved. The Ongoing filter reflects the last fetched feed.

History accumulates from observed snapshots only; it cannot backfill earlier calls or
capture calls that start and disappear between fetches. Invalid or older source update
timestamps and unreadable existing history fail the update rather than discarding it.

The header displays “Updates from the official TFS feed.” The source update
timestamp remains visible above the map.

### Deploy the Concourse updater pipeline

`concourse/pipeline.yml` uses `jgriff/http-resource` to check the official XML body
for changes using Concourse’s default resource check interval (normally one minute,
unless overridden by server configuration). A new body hash triggers `update-tfs`,
while unchanged content does not start a job.
It checks out Git history, runs all unit tests in both time zones and the live
integration test, merges the downloaded `tfs-xml/body` via `TFS_XML` into
`data/current.json`, commits only that
file, and pushes the commit to the configured branch. A failed test or ETL prevents
publication. Existing history is required; Git stores history between builds.
The full Node image includes Git. No runtime package installation is needed.

Copy `concourse/values.example.yml` to `concourse/values.yml`, set the branch,
and supply a dedicated SSH deploy key with **write access** to this repo.
`values.yml` is ignored by Git. Push the reviewed code before applying this pipeline.

```bash
fly -t local set-pipeline -p tfs-updater -c concourse/pipeline.yml -l concourse/values.yml
fly -t local unpause-pipeline -p tfs-updater
fly -t local trigger-job -j tfs-updater/update-tfs -w
```

Use a `fly` version matching the server. Unpausing enables automatic Git pushes.
Only XML version changes trigger builds, so snapshot commits do not create a build loop.
Builds are serialized and retain the latest 50 build logs. Use one updater pipeline
per branch; disable any other snapshot writers.

Pushes are fast-forward only. A concurrent branch change rejects the push. Trigger a
new build with fresh inputs after a failure, or wait for the next XML change; an
unchanged XML version does not automatically retry a failed job. There is no force
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

The dashboard uses the same ArcGIS postal geocoder and TPS division boundary layer
as [TPS My Neighbourhood](https://www.tps.ca/my-neighbourhood/). Standalone Toronto
postal prefixes are looked up once per page session, independently of the map's
geocoding queue. M5A resolves to Division 51. Postal results are estimates for a
representative point, not a guarantee that the entire postal area lies in one division.
Failed lookups remain Unknown and retry after five minutes. Results are kept in
memory only; the existing Photon map cache is not used to assign postal divisions.

Street locations use available map coordinates. Missing, ambiguous and out-of-boundary
locations remain Unknown. TFS fire beats remain unchanged in the snapshot.

Bundled boundary source: [TPS_POLICE_DIVISIONS_REV](https://services.arcgis.com/S9th0jAJ7bqgIRjw/arcgis/rest/services/TPS_POLICE_DIVISIONS_REV/FeatureServer/0),
retrieved September 18, 2026 with `outSR=4326`; `UNIT_NAME` is normalized to `AREA_NAME`.
Refresh the bundled GeoJSON when TPS boundaries change. This third-party dataset
is not covered by the repository's software license.

Intersection descriptions are split into primary-street/cross-street pairs after
removing TFS district abbreviations. Esri lookups must return high-confidence
intersection matches. Both ends of a street segment must resolve: matching divisions
produce one label, differing divisions show “Possible divisions …”, and incomplete
results remain Unknown. These lookups run independently of the map's 12-call limit,
are kept in memory, and failed results retry after five minutes. The map shows an
approximate resolved endpoint, not the exact incident position.

### GitHub Actions fallback

`Update TFS snapshot` checks `main` every five minutes (and supports manual runs).
It fetches TFS only when `current.json.fetchedAt` is at least ten minutes old;
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
