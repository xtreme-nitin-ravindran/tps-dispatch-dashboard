# SirenTO

Fire and police calls, road restrictions, and transit alerts across Toronto.

SirenTO is an independent dashboard for exploring public Toronto Fire Services (TFS)
and Toronto Police Service (TPS) calls on a map, finding recent calls nearby, and
checking City of Toronto road restrictions and TTC service alerts. It brings these
sources together with searchable call history.

⚠️ **Locations are approximate, and the dashboard is intended for public curiosity—not
emergency decisions or real-time safety guidance.**

## ⚠️ Important data caveats

> [!WARNING]
> A public dispatch record:
>
> - is **not** proof that a crime occurred;
> - may be delayed, revised, reclassified, or cancelled;
> - may use an approximate/public location description;
> - may omit sensitive calls for privacy or operational reasons.
>
> **Do not combine this feed with other datasets to try to identify an individual, household, business, victim, caller, or suspect.**

## What it does

- Maps public fire and police calls, with clustering and links between map pins and call records.
- Offers **Calls near me** to find calls around a location shared with browser permission.
- Searches calls and filters by service, event type, police division, and history from one hour to seven days.
- Distinguishes TFS active-feed status from TPS calls, for which ongoing status is not supplied.
- Shows call counts by police division, distinguishing reported TPS divisions from estimated TFS divisions.
- Displays road restrictions with an optional map overlay and nearby filtering, alongside citywide TTC service alerts.
- Checks for new snapshots every 30 seconds and offers a **New calls available** button to apply updates without interrupting the current view.
- Supports shareable filtered views, clearing filters, and remembering display preferences.
- Explains location uncertainty and source timestamps, and credits the data providers.

## Data Sources

| Source | Used for | Dataset or feed |
| --- | --- | --- |
| Toronto Fire Services (TFS) | Public active fire-service calls, dispatch times, alarm levels, and vehicle assignments when supplied. | [Active incidents XML](https://www.toronto.ca/data/fire/livecad.xml) |
| Toronto Police Service (TPS) | Public police calls, reported divisions, incident descriptions, and approximate coordinates. | [Calls for Service ArcGIS layer](https://services.arcgis.com/S9th0jAJ7bqgIRjw/arcgis/rest/services/C4S_Public_NoGO/FeatureServer/0) |
| City of Toronto Road Restrictions | Road restrictions, schedules, impacts, and map geometry. | [Dataset](https://open.toronto.ca/dataset/road-restrictions/) · [JSON feed](https://secure.toronto.ca/opendata/cart/road_restrictions/v3?format=json) |
| Toronto Transit Commission (TTC) | Citywide service alerts, affected routes, and active periods. | [GTFS-Realtime alerts](https://gtfsrt.ttc.ca/alerts/all?format=text) |
| TPS police division boundaries | Division boundary overlay, station information, and geographic division estimates for TFS calls. | [TPS_POLICE_DIVISIONS_REV on ArcGIS](https://www.arcgis.com/home/item.html?id=fdd36b8dd9544c97b926958f3eb8cb98) |
| City of Toronto Centreline | Street intersections and segments used to resolve TFS location descriptions. | [Toronto Centreline](https://open.toronto.ca/dataset/toronto-centreline-tcl/) |
| GeoNames | Approximate postal-area locations and area names for Toronto postal prefixes. | [Postal data](https://www.geonames.org/postal-codes/) |
| OpenStreetMap contributors | Background map tiles and geographic context. | [OpenStreetMap](https://www.openstreetmap.org/) · [Attribution](https://www.openstreetmap.org/copyright) |

The updater combines incident and disruption feeds into `data/current.json` on the
`data` branch. The browser reads that published snapshot rather than requesting
those feeds directly. Geographic reference data is bundled with the application;
location labels, coordinates, and TFS division estimates are prepared by the updater,
without live geocoder requests in the browser. Source credits and licensing information
are listed in [Attribution](#attribution).

## Development and Publishing

Develop on **`dev`** and run the [required checks](#run-all-required-checks) before committing.
Pushing to **`dev`** runs the GitHub tests. When they pass, automation merges the tested
commit into **`main`** through a pull request, and GitHub Pages publishes the site.
Failed checks stop promotion; do not push code directly to **`main`**.

Before starting new work, synchronize with the last automatic merge:

```bash
git switch dev
git pull --ff-only origin dev
```

## Testing

Run commands from the repository root. Use Docker for the same Node.js 20 environment
as CI, or install Node.js 20 or newer and Git to run tests locally. No npm dependencies
need to be installed. Unit tests use fixtures, mocked services, bundled geographic data,
and temporary files/repositories; they do not publish changes or require live feeds.

### Test coverage

`npm test` runs all 18 JavaScript unit test files below:

| Test file (under `test/`) | What it verifies |
| --- | --- |
| `tfs-normalize.test.js` | TFS incident fields, empty vehicle assignments, and unfamiliar apparatus types. |
| `tfs-category.test.js` | Medical, Fire, and Other categories, including missing or unfamiliar descriptions. |
| `tfs-time.test.js` | Toronto timestamps and daylight-saving handling, XML timestamps, freshness, and history cutoffs. |
| `tfs-snapshot.test.js` | Snapshot metadata, history retention, incident updates, expiry, and removal of ongoing status when calls leave the active feed. |
| `tfs-etl.test.js` | Initial and subsequent snapshot generation, separate XML/history inputs, safe handling of bad inputs or failed feeds, independent incident/disruption data, CLI environment wiring, the compatibility entry point, and fallback GitHub output. |
| `tfs-fallback.test.js` | Fallback freshness thresholds, unchanged fresh snapshots, updater identity, and refusal to overwrite corrupt history. |
| `commit-tfs.test.js` | Snapshot-only commits in temporary Git repositories, skipping unchanged data, and rejecting unrelated staged files. |
| `tps-source.test.js` | TPS normalization, stable IDs, complete fetch batches, history retention, unit-code labels, and nearby distances. |
| `disruptions.test.js` | Road geometry and schedules, TTC alert parsing, active/stale filtering, nearby road segments, refresh caching, preserving data after failures, malformed payload rejection, and open-ended disruption periods. |
| `open-locations.test.js` | Bundled postal and street-segment resolution, missing cross streets, and rejection of ambiguous intersections. |
| `location-enrichment.test.js` | Deduplicated lookups, cache reuse, lookup limits, retrying pending locations, and resolver outages. |
| `location-display.test.js` | Street, postal-area, and laneway labels without implying an exact incident address. |
| `intersection-lookup.test.js` | Street-segment endpoints, possible divisions, and confidence checks for mocked intersection results. |
| `postal-lookup.test.js` | Toronto postal prefixes and rejection of incorrect or low-confidence mocked geocoder results. |
| `police-divisions.test.js` | Polygon/multipolygon matching, holes and overlaps, invalid locations, and bundled TPS boundaries. |
| `call-presentation.test.js` | Report ages, call explanations, location confidence, and source-specific status without inferring resolution. |
| `view-controls.test.js` | New-call detection, filter summaries/reset defaults, share links, clustering, row selection, preferences, and source timestamp labels. |
| `promotion.test.js` | Promotion of only the tested dev commit, superseded/empty changes, protection rejection, existing PR reuse, retry handling, concurrent branch updates, and prevention of duplicate Pages requests. |

`npm run test:python` runs `test/python/test_location_index.py` using Python 3’s standard-library unittest runner. It verifies street endpoints, coordinate order and rounding, node deduplication, postal-area filtering and labels, repeatable output, and preservation of the existing index when inputs fail. Tests use temporary fixtures and do not download data or modify the bundled index.

The live integration suite has one test file per data source. `npm run test:integration` runs all eight files, including TFS. To check a single source, run `node --test test/tps-source.integration.test.js` (substitute the file below):

| Test file | Live checks |
| --- | --- |
| `test/tfs-source.integration.test.js` | TFS feed timestamp and normalization of one random active incident, when present. |
| `test/tps-source.integration.test.js` | TPS call sample and normalization. |
| `test/road-restrictions-source.integration.test.js` | Road restrictions through the production parser. |
| `test/ttc-alerts-source.integration.test.js` | TTC alerts through the production parser and feed timestamp. |
| `test/police-boundaries-source.integration.test.js` | TPS boundary polygon sample. |
| `test/centreline-source.integration.test.js` | Centreline street and intersection fields. |
| `test/geonames-source.integration.test.js` | GeoNames Canada archive and Toronto postal coordinates. |
| `test/openstreetmap-source.integration.test.js` | One OpenStreetMap PNG tile. |

These tests require internet access. Source outages, rate limits, or incompatible
responses fail the suite; empty valid incident/alert feeds are allowed. Geographic
checks sample the upstream sources rather than rebuilding bundled reference data.
They do not validate every live record or browser layout. Check relevant UI changes
visually as well.

### Run individual suites

With Node.js and Git installed:

```bash
npm test                              # JavaScript unit tests
npm run test:python                   # Python location-index tests (requires Python 3)
npm run test:integration               # All live-source integration tests
node --test test/disruptions.test.js   # One file; substitute any file listed above
node --test --watch test/disruptions.test.js # Re-run one file as it changes
```

For Docker, build the image once after changing code or tests:

```bash
docker build -f Dockerfile.test -t toronto-dispatch-tests .
docker run --rm -e TZ=UTC toronto-dispatch-tests
docker run --rm -e TZ=America/Los_Angeles toronto-dispatch-tests
docker run --rm toronto-dispatch-tests npm run test:integration
docker run --rm toronto-dispatch-tests node --test test/disruptions.test.js
```

The two timezone runs execute the same unit suite to catch accidental dependence
on the machine's local timezone. `npm run test:watch` uses Node's default discovery,
which can include the live integration test; use an explicit file as above for offline watching.

### Run all required checks

Copy this complete command block into a shell from the repository root. It builds
the Docker image, runs both timezone unit suites and the live integration suite,
checks JavaScript syntax, checks whitespace, and verifies that generated snapshot
changes are not included in the code branch. It stops at the first failure.
Docker and Git are required; Node.js is not required on the host.

```bash
(
  set -e
  docker build -f Dockerfile.test -t toronto-dispatch-tests .
  docker run --rm -e TZ=UTC toronto-dispatch-tests
  docker run --rm -e TZ=America/Los_Angeles toronto-dispatch-tests
  docker run --rm toronto-dispatch-tests npm run test:python
  docker run --rm toronto-dispatch-tests npm run test:integration
  docker run --rm -i toronto-dispatch-tests node --input-type=module --check < app.js
  docker run --rm toronto-dispatch-tests sh -c 'find src scripts -name "*.js" -exec node --check {} +'
  git diff --check
  git diff --cached --check
  git diff --exit-code origin/main...HEAD -- data/current.json
  git diff --exit-code HEAD -- data/current.json
)
```

The snapshot checks use the locally fetched `origin/main` reference. Synchronize
remote references before validating a branch for publication. Syntax checks parse
JavaScript without executing it; whitespace checks flag issues such as trailing spaces.
Neither replaces the behavioral tests above.

### Generate a development snapshot (not a test)

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

## Automated Data Updates

- **Concourse** runs `scripts/tfs-etl.js` approximately every minute to fetch feeds, merge history, and prepare map locations. Road and TTC feeds are checked at most once every five minutes.
- **GitHub Actions fallback** checks every five minutes and runs the updater if the snapshot is at least ten minutes old. Scheduled runs may be delayed.
- Both use code from **`main`** and publish only `data/current.json` to the **`data`** branch. The site reads that snapshot directly, so data updates do not require a Pages deployment.
- Failed sources retain their last successful data and are marked unavailable. If both incident feeds fail, the existing snapshot is preserved.

Keep generated snapshots out of code commits. The snapshot on `dev` and `main` is a
fixture; the live snapshot is on `data`. Pipeline configuration is in
[`concourse/pipeline.yml`](concourse/pipeline.yml), with example settings in
[`concourse/values.example.yml`](concourse/values.example.yml).

## Run locally


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

## Attribution

Contains information licensed under the Open Government Licence – Toronto where applicable.

| Provider and references | Contribution to SirenTO | Attribution and terms |
| --- | --- | --- |
| [Toronto Fire Services](https://www.toronto.ca/community-people/public-safety-alerts/alerts-notifications/toronto-fire-active-incidents/) · [XML feed](https://www.toronto.ca/data/fire/livecad.xml) | Public active fire-service incidents, dispatch times, alarm levels, and vehicle assignments when supplied. | Credit: Toronto Fire Services. Source data is not covered by this repository’s Unlicense. |
| [Toronto Police Service Calls for Service](https://services.arcgis.com/S9th0jAJ7bqgIRjw/arcgis/rest/services/C4S_Public_NoGO/FeatureServer/0) | Public police calls, reported divisions, and approximate incident coordinates. | Credit: Toronto Police Service. Source data and services retain their own terms. |
| [City of Toronto Road Restrictions](https://open.toronto.ca/dataset/road-restrictions/) · [JSON feed](https://secure.toronto.ca/opendata/cart/road_restrictions/v3?format=json) · [Official restrictions map](https://www.toronto.ca/services-payments/streets-parking-transportation/road-restrictions-closures/restrictions-map/) | Road restriction descriptions, schedules, impacts, and geometry for the map overlay. | Credit: City of Toronto. Consult the dataset’s published terms; no blanket licence is asserted here. |
| [TTC GTFS-Realtime](https://gtfsrt.ttc.ca/) · [Alerts feed](https://gtfsrt.ttc.ca/alerts/all?format=text) · [Official service advisories](https://www.ttc.ca/service-advisories/all-service-alerts) | Transit alerts, affected routes, and active periods. | Credit: Toronto Transit Commission. Source data and services retain their own terms. |
| [TPS_POLICE_DIVISIONS_REV](https://www.arcgis.com/home/item.html?id=fdd36b8dd9544c97b926958f3eb8cb98) · [TPS My Neighbourhood](https://www.tps.ca/my-neighbourhood/) | Division boundary overlay, station metadata, and geographic estimates of TFS police divisions. | Credit: Toronto Police Service. The ArcGIS item’s licence field was blank when checked September 18, 2026; this data is not covered by the repository’s Unlicense. |
| [Toronto Centreline](https://open.toronto.ca/dataset/toronto-centreline-tcl/) | Street intersections and segments used to interpret TFS locations. | Credit: City of Toronto, under the [Open Government Licence – Toronto](https://www.toronto.ca/city-government/data-research-maps/open-data/open-data-licence/). |
| [GeoNames](https://www.geonames.org/) · [Postal data](https://www.geonames.org/postal-codes/) | Approximate postal-area coordinates and names; these may differ from other neighbourhood definitions. | Credit: GeoNames, under [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/). |
| [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) | Background map data and geographic context. | © OpenStreetMap contributors, under the Open Database License. |

This project is independent and is not affiliated with or endorsed by Toronto Fire Services,
Toronto Police Service, the City of Toronto, the Toronto Transit Commission, or Esri.
The Unlicense applies only to original repository software, not third-party data,
services, or assets.
