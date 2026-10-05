# SirenTO

[![Measured JavaScript lines coverage](https://raw.githubusercontent.com/xtreme-nitin-ravindran/tps-dispatch-dashboard/coverage/lines.svg)](#test-coverage)
[![Measured JavaScript branches coverage](https://raw.githubusercontent.com/xtreme-nitin-ravindran/tps-dispatch-dashboard/coverage/branches.svg)](#test-coverage)
[![Measured JavaScript functions coverage](https://raw.githubusercontent.com/xtreme-nitin-ravindran/tps-dispatch-dashboard/coverage/functions.svg)](#test-coverage)

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
- Keeps a compact mobile search-area selector within thumb reach while viewing the map or incident list, with 500 m, 1 km, 2 km, 5 km, and Toronto-wide scopes.
- Offers a prominent **Hear sirens?** action that ranks up to five recent calls within 2 km by recency and distance, using browser location or a manually chosen map area.
- Searches calls and filters by service, event type, police division, and history from one hour to seven days.
- Distinguishes TFS active-feed status from TPS calls, for which ongoing status is not supplied.
- Shows call counts by police division, distinguishing reported TPS divisions from estimated TFS divisions.
- Displays road restrictions with an optional map overlay and nearby filtering, alongside citywide TTC service alerts.
- Checks for new snapshots every 30 seconds and offers a **New calls available** button to apply updates without interrupting the current view.
- Supports shareable filtered views, clearing filters, remembering display preferences, and System/Light/Dark themes.
- Explains location uncertainty and source timestamps, and credits the data providers.

## Data Sources

| Source | Used for | Dataset or feed |
| --- | --- | --- |
| Toronto Fire Services (TFS) | Public active fire-service calls, dispatch times, alarm levels, and vehicle assignments when supplied. | [Active incidents XML](https://www.toronto.ca/data/fire/livecad.xml) |
| Toronto Police Service (TPS) | Public police calls, reported divisions, incident descriptions, and approximate coordinates. | [Calls for Service ArcGIS layer](https://services.arcgis.com/S9th0jAJ7bqgIRjw/arcgis/rest/services/C4S_Public_NoGO/FeatureServer/0) |
| City of Toronto Road Restrictions | Road restrictions, schedules, impacts, and map geometry. | [Dataset](https://open.toronto.ca/dataset/road-restrictions/) · [JSON feed](https://secure.toronto.ca/opendata/cart/road_restrictions/v3?format=json) |
| Toronto Transit Commission (TTC) | Service alerts, affected routes/stops, active periods, and stop coordinates used for geographic relevance. | [GTFS-Realtime alerts](https://gtfsrt.ttc.ca/alerts/all?format=text) · [TTC Routes and Schedules](https://open.toronto.ca/dataset/ttc-routes-and-schedules/) |
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

Incident cards label a call `NEW` for five minutes after its persisted `firstSeenAt`
time, or `UPDATED` after a meaningful source-field change. The window is configured
by `INCIDENT_BADGE_CONFIG.newWindowMs` in `src/incident-badge.js`; `UPDATED` takes
precedence and neither label represents severity or active status. Meaningful source
fields are centralized in `MEANINGFUL_INCIDENT_FIELDS` in `src/incident-lifecycle.js`.

## Development and Publishing

Develop on **`dev`** and run the [required checks](#run-all-required-checks) before committing.
Pushing to **`dev`** runs the GitHub tests. When they pass, automation merges the tested
commit into **`main`** through a pull request, and GitHub Pages publishes the site.
The **`coverage`** branch is generated solely to publish the [Code Coverage Badges](#test-coverage)
and coverage report; it is not a development branch and must not be used for development work.
Failed checks stop promotion; do not push code directly to **`main`**.

Before starting new work, synchronize with the last automatic merge:

```bash
git switch dev
git pull --ff-only origin dev
```

## Testing

Run commands from the repository root. Use Docker for the same Node.js, ESLint,
and Ruff environment as CI. Unit tests use fixtures, mocked services, bundled geographic
data, and temporary files/repositories; they do not publish changes or require live feeds.
See [Test coverage](#test-coverage) for how coverage is measured and published.

### Docker test wrapper

`scripts/docker-test.sh` runs validation against the **current working tree** using the
pinned Docker test image for dependencies and tooling. It mounts the working-tree source,
scripts, tests, fixtures, and bind-mounted configuration read-only over the image's
`/workspace`, while keeping the image-installed `node_modules` and pinned tools (Node,
ESLint, Ruff). Ordinary source, test, fixture, script, and configuration edits therefore
do **not** require a Docker rebuild.

```bash
# Run any command in the container against the current working tree.
scripts/docker-test.sh npm test
scripts/docker-test.sh npm run lint
scripts/docker-test.sh node --test test/theme.test.js

# Canonical image build (only needed when the image inputs change).
scripts/docker-test.sh --build

# Build only when the image is missing or stale.
scripts/docker-test.sh --ensure-image
```

The canonical image name is `toronto-dispatch-tests`. A successful
`--ensure-image` check intentionally prints nothing when that image already exists and
its fingerprint is current; check the command's exit status. Build/stale diagnostics are
printed only when action is required. Repository validation should use the pinned Docker
toolchain rather than ad hoc host Node, ESLint, or Ruff commands. If a host-only failure
uses a Node version allowed by `package.json`'s `engines`, record it for compatibility
follow-up even when the canonical Docker gate passes.

The wrapper computes a SHA-256 fingerprint of the image-defining inputs
(`Dockerfile.test`, `.dockerignore`, `package.json`, `package-lock.json`) and compares it
with the `org.sirento.test-fingerprint` label baked into the image. On mismatch it fails
before testing with a clear rebuild command, so a stale image cannot silently validate old
code. A commit-derived tag alone cannot detect uncommitted dependency changes; the
fingerprint is content-derived, so it can. `.dockerignore` is included because it controls
which files reach the build context: a rule that excluded a copied path would change the
image while leaving the other inputs unchanged.

The image is a dependency/tooling snapshot, not a source snapshot. `npm ci` runs in its own
layer with only the manifests copied before it, and repository content is copied from
relatively stable to relatively volatile (`concourse`, `.github`, `data`, `scripts`, `src`, `test`,
then the root frontend files). Editing a volatile path such as `test/` therefore reuses the
cached dependency, tooling, and stable-content layers instead of reinstalling dependencies.
`.dockerignore` excludes only non-build inputs (version control, host `node_modules`, local
caches and coverage, rendered-browser evidence, editor/OS files, local environment and
deployment secrets, documentation, and Python bytecode) and never a path the Dockerfile
copies.

`npm run verify` and `npm run verify:fast` call `scripts/docker-test.sh --ensure-image`
and run every container command through the wrapper. Do not call `docker run` directly for
validation: a bare `docker run` uses the image's baked-in source and can silently validate
old code. The wrapper uses `--rm`, so no container remains after a run, including on
failure. The snapshot-generation command below is the one exception: it intentionally
mounts `data/` writable to produce `data/current.json`.

### Rendered-browser regression tests

Playwright Chromium testing is required for changes whose correctness depends on
rendered layout, element geometry or stacking, hit targets, pointer/touch interaction,
responsive breakpoints, or browser-driven UI transitions. It is feature-specific, so
data-only and backend-only changes do not need it. These suites complement the Docker
unit and coverage suites; JavaScript syntax checks and string/DOM unit tests cannot
verify real browser layout or hit-testing.

The standard Docker test image intentionally does not contain Playwright or browser
binaries, and the rendered-browser suites are not currently run by CI. Install the
local test-only tooling once without changing `package.json` or `package-lock.json`:

```bash
npm install --no-save --package-lock=false playwright
npx playwright install chromium
```

Run all rendered-browser regression suites with one command:

```bash
npm run test:browser
```

The aggregate runner discovers every `test:*:browser` package script except itself,
sorts the suites deterministically, starts the repository's deterministic static site on
`127.0.0.1:8765`, waits for its own server to become ready, runs each suite sequentially,
and tears down the server and child processes on success, failure, or interruption. It
fails rather than reusing or terminating an unrelated listener when port `8765` is
occupied. Port `8080` must not be used.

The included suites are:

```bash
npm run test:story-39a:browser
npm run test:story-40e:browser
npm run test:road-closure-count:browser
npm run test:story-42:browser
npm run test:story-43:browser
npm run test:ttc-ui:browser
```

The suites cover bounded cluster connectors and lifecycle cleanup, mobile focus-control
geometry and interaction, the clipped road-closure count, mobile bottom-sheet header
geometry, fullscreen Map-info sizing, and TTC disruption rendering/state transitions.
The mobile focus-mode chrome contract these suites protect is documented in
[docs/mobile-focus-chrome.md](docs/mobile-focus-chrome.md).
The TTC suite has a deliberate 61-second wait; the aggregate runner reports that expected
delay and does not depend on the GNU `timeout` command. Each suite uses loopback-only
deterministic fixtures. Environment overrides such as `PLAYWRIGHT_MODULE`,
`CHROMIUM_EXECUTABLE`, and suite-specific `*_UI_URL` values remain available for
nonstandard local installations and are not overwritten when explicitly set.

Use an individual `test:*:browser` script for a targeted implementation loop. Run the
aggregate command before completing a story whose correctness depends on rendered-browser
behavior. The aggregate browser suites remain outside Docker, CI, `npm run verify`, and
`npm run verify:fast`; missing Playwright or Chromium therefore remains an outstanding
validation item rather than a skipped success.

When fixing another browser/rendering regression, add or extend a deterministic
Playwright suite and expose it as a `test:*:browser` package script. Assert rendered
DOM state, bounding geometry, hit-testing, and real unforced interaction where
applicable; screenshots are supporting evidence, not the only assertion. A relevant
browser suite must pass before the implementation is considered complete. Browser-
specific reports still require the physical-device validation described below.

### Local watch and push fixtures

For repeatable mobile layout audits without live feeds, use the loopback-only
`mobileAuditFixture` query switch. `many`, `zero`, `stale`, and `unavailable` provide deterministic
incident/disruption shapes; `mobileAuditView=map|calls` and
`mobileAuditSheet=collapsed|half|expanded` select presentation state. Add
`mobileAuditRoads=on|off` and `mobileAuditBoundaries=on|off` to exercise either
map overlay independently; both default to `on`. Add
`mobileAuditLocation=none|current|unavailable|denied|saved|manual` to exercise the compact Quick Look location states. The `many`
fixture enables the road overlay and police boundaries, includes long labels and a
selected-incident target, and can be combined with `watchFixture=current`:

Add `mobileAuditFilters=none|one|multiple|long|service|event|division|history|search|zero`
to exercise deterministic secondary-filter states through the production controls and rendering path.
Add `mobileAuditRadius=0.5|1|2|5|toronto` to select each production radius control;
combine it with `mobileAuditLocation=current` for deterministic nearby results.
Use `mobileAuditSheet=collapsed|half|expanded` with map mode to audit the compact
48 px overlay-control row and 52 px collapsed sheet header. For example:
`http://127.0.0.1:4173/?mobileAuditFixture=many&mobileAuditView=map&mobileAuditLocation=current&mobileAuditRadius=toronto&mobileAuditSheet=collapsed&mobileAuditRoads=on&mobileAuditBoundaries=on&incident=mobile-audit-selected`.

On mobile, Map mode uses the bottom-sheet header for the concise call count, closest-call,
and latest-call context rather than repeating the full Toronto/Nearby summary above the map.
Calls mode shows the same concise summary once above the incident list. Routine located counts,
source timestamps, marker shape/age keys, location-resolution guidance, and the source-times help
link stay inside the normal-flow **Map info** disclosure. Incident-feed stale or unavailable
warnings remain visible above the map and are never hidden in that disclosure. At 390 px, the
default summary plus Map-info footprint changed from about 187 px to 46 px (141 px recovered);
expanded Map info is about 481 px and may push the map in document flow. The compact result has
no document overflow at 320, 375, 390, or 430 px.

The remaining pre-map stack is also compact on mobile. Essential branding and the
44 px theme control share one header row; the duplicate second brand photo and routine
refresh copy are hidden there because source detail remains available in **Map info** and
critical feed warnings stay visible. Search and collapsed **Filters** share one row, while
Quick Look keeps its heading, primary action, location status, manual fallback, and
**Location & more options** disclosure. With the `many/current/toronto` fixture, the
radius controls begin at about 428 px and the map at about 548 px across 320, 375, 390,
and 430 px. At 390 px the previous positions were about 612 px and 732 px, recovering
about 184 px before both surfaces. Calls mode places its compact summary at about 544 px
and its first incident at about 664–682 px depending on summary wrapping. These states
have no document-level horizontal overflow.

- full map audit: `http://127.0.0.1:4173/?mobileAuditFixture=many&watchFixture=current&incident=mobile-audit-selected`
- expanded sheet: append `&mobileAuditSheet=expanded`
- calls view: append `&mobileAuditView=calls`
- zero calls: `http://127.0.0.1:4173/?mobileAuditFixture=zero&watchFixture=current`
- stale sources: `http://127.0.0.1:4173/?mobileAuditFixture=stale&watchFixture=current`
- unavailable TTC source with retained alerts: `http://127.0.0.1:4173/?mobileAuditFixture=unavailable&watchFixture=current`

These parameters are ignored off `localhost`, `127.0.0.1`, and `::1`; they do not
send push notifications or fetch the production snapshot.

Push fixtures are accepted only on `localhost`, `127.0.0.1`, or `::1`. Start a static
server on port 4173, select a current/saved/map location, open **Watch this area**, and
use these URLs to exercise the browser controller without a real push service or backend:

- granted subscribe: `http://127.0.0.1:4173/?watchFixture=current&permission=granted&subscription=missing&subscribe=success`
- denied or dismissed: `http://127.0.0.1:4173/?watchFixture=current&permission=denied` and `http://127.0.0.1:4173/?watchFixture=current&permission=default`
- unsupported: `http://127.0.0.1:4173/?watchFixture=unsupported`
- valid, missing, or expired reconciliation: append `subscription=valid`, `subscription=missing`, or `subscription=expired` with `permission=granted`
- subscribe failure: `http://127.0.0.1:4173/?watchFixture=current&permission=granted&subscription=missing&subscribe=failure`
- unsubscribe: `http://127.0.0.1:4173/?watchFixture=current&permission=granted&subscription=valid&unsubscribe=success`
- notification rendering: append `push=new-tfs`, `push=new-tps`, `push=update`, or `push=no-distance`; use `push=malformed` and `push=external` to verify rejection
- notification arrival: append `arrival=present` for a deterministic current incident or `arrival=missing` for the expired/missing state; these loopback-only modes use local data and do not fetch the live snapshot
- click handling: `click=existing-client` documents clicking with the fixture page open, while `click=no-client` documents closing it before clicking the notification

The default adapter intentionally does not send watch or subscription data anywhere.
Set the public VAPID key through the `sirento-vapid-public-key` meta element and inject a
backend adapter before enabling delivery in production. `pushsubscriptionchange` only
notifies open clients; foreground `getSubscription()` reconciliation is authoritative
until a backend exists to register replacement subscriptions.

### Local watch backend contract

The vendor-neutral Story 33E1 domain layer accepts the versioned
`sirento.watch-subscription` payload produced by the browser, but does not expose an
HTTP route or select a production database. It validates the complete payload again on
the server side and rejects unknown fields. Requests are limited to 16 KiB; coordinates,
the four supported radii, service/category filters, active state, HTTPS push endpoint,
optional expiry, and the standard 65-byte `p256dh` and 16-byte `auth` base64url keys are
all checked before storage.

The backend record contains only:

```text
id, centre, radiusKm, service, category, subscription,
createdAt, updatedAt, lastConfirmedAt, active,
possessionTokenHash, optional vapidKeyVersion
```

`subscription` contains `endpoint`, nullable `expirationTime`, `p256dh`, and `auth`.
The client-local watch ID is validated for contract compatibility and then discarded.
Saved-location labels and IDs, addresses, location history, map/search state, and UI
preferences are never stored.

Watch centres are rounded to four decimal places before storage. Around Toronto this is
roughly 11 m of latitude and 8 m of longitude per increment, with less than about 7 m of
rounding displacement. Three decimals could move a centre by tens of metres, while four
preserves reliable 500 m boundary matching without retaining unnecessary device-level
precision.

`createWatchService` depends only on the repository methods `createWatch`, `getWatch`,
`updateWatch`, `deleteWatch`, and `listActiveWatches`. Production defaults use a random
UUID watch ID and a 32-byte random possession token. The token is returned only by
creation and only its SHA-256 hash is stored; update and delete use a constant-time hash
comparison. Client responses omit the push endpoint, subscription keys, and token hash.
Errors and validation results identify fields without echoing endpoints, keys, tokens,
or coordinates.

`InMemoryWatchRepository` is deterministic, process-local, resettable, and writes
nothing to disk. It is not production persistence. Its guarded fixture factory requires
both an explicit enable switch and a loopback hostname, so a development mode cannot be
activated on the production hostname. Run its network-free targeted suite in Docker:

```bash
scripts/docker-test.sh npm run test:watch-backend
```

The suite uses injectable IDs, possession tokens, clocks, and real validation/service/
repository code. No push messages are sent and no real database or production data is
used.

### Production Watch API and durable storage

Story 33E2 uses a small Cloudflare Worker plus a private D1 database. SirenTO remains a
static GitHub Pages site; only the watch API is deployed to Cloudflare. This adds public
HTTPS, durable private storage, environment/secret bindings, and local Worker tooling
without migrating the dashboard or putting push subscriptions in a Git branch.

The Worker entry point is `src/watch-worker.js`. It wraps the existing Story 33E1
service with `D1WatchRepository` and the transport in `src/watch-api.js`; validation,
coordinate minimization, record normalization, token hashing/comparison, and response
sanitization remain in the shared domain layer. D1 stores each complete private record
as defensive JSON plus a separately indexed `active` flag. Apply
`migrations/0001_create_watches.sql` before serving traffic.

The API contract is:

```text
POST   /watches       application/json body; returns 201 with { watch, possessionToken }
PATCH  /watches/:id   application/json body and x-sirento-possession-token; returns 200
DELETE /watches/:id   x-sirento-possession-token; returns 204 and is idempotent
OPTIONS               CORS preflight for the routes above
```

There is intentionally no public read/list route. `watch` responses contain only the
opaque ID, minimized centre, matching settings, active state, timestamps, and optional
VAPID key version. Push endpoints, subscription keys, and token hashes never appear in
responses. A wrong PATCH token is indistinguishable from an unknown watch. DELETE
returns the same empty 204 response for successful, repeated, unknown, and wrong-token
requests, while only an authorized existing watch is actually removed. The API emits
small error codes and never logs request bodies, headers, coordinates, push endpoints,
subscription keys, or possession tokens.

All requests, including creation and preflight, require an exact origin from the
comma-separated `WATCH_ALLOWED_ORIGINS` binding. The example admits the real SirenTO
origin and explicit port-4173 loopback development origins; wildcard CORS is rejected.
This blocks drive-by browser mutations, while possession tokens additionally authorize
updates and deletes. It is not user authentication and an automated client can forge an
Origin header. Production creation requests therefore also require the
`WATCH_CREATE_RATE_LIMITER` Cloudflare binding, limited to 30 requests per client key per
minute. If the binding is absent, creation fails closed with 503; exceeded limits return
429 with a 60-second `Retry-After`. Updates and deletes remain narrowly protected by the
unpredictable possession token, exact origin, route/method allowlists, and request-size limits.

Copy `wrangler.toml.example` to the ignored `wrangler.toml`, create the D1 database,
replace its database ID, and configure the public VAPID values. Keep the private VAPID
key out of files and Git:

```bash
npx wrangler d1 create sirento-watch
npx wrangler d1 migrations apply sirento-watch --remote
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler deploy
```

For local Worker/D1 development, put the private key in the ignored `.dev.vars` file,
apply the migration with `--local`, and run `npx wrangler dev`. Wrangler simulates the
D1 binding locally and persists its local state by default.

`loadWatchBackendConfig` prepares `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
`VAPID_SUBJECT`, and `VAPID_KEY_VERSION` for later server-side delivery. The private
key is loaded only when sending configuration is explicitly requested, and that path
fails clearly if any required sending value is absent. Story 33E2 does not send push
messages.

### Incident matching and durable notification dedupe

Story 33F1 adds a scheduled matching stage. The Worker cron
fetches only the normalized `data/current.json` configured by `WATCH_SNAPSHOT_URL`,
validates it, retrieves active watches from D1, and passes each watch/incident pair to
the existing Story 33B matcher. `WATCH_INCIDENT_BASE_URL` supplies canonical incident
links. There is no public ingestion or candidate endpoint.

Apply `migrations/0002_create_notification_dedupe.sql` after the watches migration.
The `notification_dedupe` table stores only the stable dedupe key, opaque watch and
incident IDs, notification kind, timestamps, and minimal delivery state. Its primary key makes
overlapping cron runs and retried snapshots idempotent through `INSERT OR IGNORE`.
Subscription data is present only in the in-memory internal candidate and is neither
logged nor copied into dedupe storage.

Candidates use schema `sirento.notification-candidate` version 1 and contain the watch
and incident IDs, notification kind, stable dedupe key, canonical incident URL, minimal
published display fields (`source`, `description`, `location`, and `timestamp`), an
in-memory approximate distance derived during matching, and the private subscription
needed by delivery. They omit watch labels, coordinates, possession tokens, full incident
payloads, and UI state. The derived distance is not stored in dedupe state.

Dedupe rows expire after 30 days, comfortably beyond the seven-day incident retention.
Expired rows are removed at the start of each matching run using the injected run time,
so cleanup is deterministic. A first sighting uses `new:v1`; a meaningful lifecycle
update uses its normalized `lastMeaningfulUpdateAt` in the notification kind. Routine
refreshes, `lastSeenAt` changes, and timestamp churn retain the same key and create no
candidate. Stale or unavailable feeds create no candidates and do not mutate watches.

Run the targeted deterministic suite and the safe local demonstration in Docker:

```bash
scripts/docker-test.sh npm run test:watch-matching
scripts/docker-test.sh npm run fixture:watch-matching
```

The demonstration reports safe counts only: first match and first dedupe row `1`, repeat
`0`, meaningful update `1`, stale and unavailable `0`, and two overlapping runs totaling `1`. Fixtures
live under `test/fixtures`, use a fake D1 binding plus the real repository/pipeline, and
cannot be enabled by production Worker requests or environment configuration.

### Web Push delivery

Story 33F2 sends approved matcher candidates from the scheduled Worker with standards-based
Web Push (`aes128gcm`) and VAPID (`ES256`). The private VAPID key and subject remain Worker
configuration; only the public key is client-visible. The payload is intentionally small:
`sirento.push` version 1 plus the incident ID, a short title/body, and the canonical same-origin
incident URL. Watch geometry, labels, possession tokens, endpoints, and encryption keys are not
included.

The existing dedupe row is also the delivery state record. It moves from `pending` to an
atomically leased `sending` state, then to `delivered`, `permanent_failed`, or
`retry_exhausted`. Successful and permanent outcomes cannot be reclaimed. An expired `sending`
lease can recover after an interrupted invocation, while each matching run reconstructs
eligible pending candidates without storing subscriptions in the dedupe table.

Delivery tries at most three times. HTTP 408, 429, 5xx, and transport failures use bounded
exponential delays (100 ms, then 200 ms); `Retry-After` is honored but capped at one second for
Worker execution limits. HTTP 404 and 410 mark the notification permanently failed and
deactivate the watch only when its current endpoint is still the failed endpoint, preserving a
concurrently replaced subscription. At most 100 candidates are processed per invocation in
dedupe-key order. Delivery code does not log endpoints, subscription keys, possession tokens,
watch coordinates, or VAPID secrets.

Apply `migrations/0003_add_notification_delivery.sql` after the Story 33F1 dedupe migration,
then `migrations/0004_add_watch_retention.sql` for deterministic inactive-watch cleanup.

Run the deterministic sender/controller suite and demonstration without contacting a push
service or requiring notification permission:

```bash
scripts/docker-test.sh npm run test:watch-delivery
scripts/docker-test.sh npm run fixture:watch-delivery
```

Set the deployed Worker URL in the `sirento-watch-api-base-url` meta element and the
matching public key in `sirento-vapid-public-key`. The browser HTTP adapter creates a
server watch on first activation, retains the server ID and possession token only in
browser local storage, PATCHes subsequent saves, and DELETEs before unsubscribing. An
empty API URL keeps the adapter disabled. Loopback fixture mode still injects its own
adapter and makes no production network request; fixture query parameters are ignored
on production hostnames.

### Notification content and incident arrival

Story 33G uses the two notification kinds already produced by matching: `new:v1` and
`updated:<meaningful-update-time>`. New incidents use **SirenTO — New incident nearby**;
meaningful updates use **SirenTO — Incident update nearby**. The body contains the
normalized incident description, an approximate one-decimal distance only when reliably
derived during matching, and the full Toronto Fire Services or Toronto Police Service
name. It never includes a saved-location label, watch coordinates, watch ID, possession
token, or push-subscription data. Routine refreshes remain deduplicated and do not produce
update wording.

The canonical notification destination is `?view=1&incident=<stable-id>` on the configured
SirenTO origin and application path. Notification clicks close the notification, reject any
other origin/path/query shape, focus and navigate an existing SirenTO client when possible,
and otherwise open one new window. Arrival selects and reveals an incident from the full
current dataset even when local filters hid it. On mobile it opens the map with the selected
card in the half-height bottom sheet. If the incident has expired, SirenTO says “This
incident is no longer in the current SirenTO data.” while leaving the dashboard usable.

Run the deterministic UX suite and fixture without notification permission or push delivery:

```bash
scripts/docker-test.sh npm run test:notification-ux
scripts/docker-test.sh npm run fixture:notification-ux
```

For manual visual checks, serve the repository on port 4173 and use:

- New TFS incident with distance: `http://127.0.0.1:4173/?push=new-tfs&arrival=present&click=existing-client`
- New TPS incident: `http://127.0.0.1:4173/?push=new-tps&arrival=present`
- Meaningful update: `http://127.0.0.1:4173/?push=update&arrival=present`
- No reliable distance: `http://127.0.0.1:4173/?push=no-distance&arrival=present`
- Missing/expired incident: `http://127.0.0.1:4173/?push=new-tfs&arrival=missing`
- Direct present arrival: `http://127.0.0.1:4173/?view=1&incident=fixture-incident-1`
- Direct missing arrival: `http://127.0.0.1:4173/?view=1&incident=fixture-expired-incident`

For the existing-client case, leave the fixture page open and click its notification. For
the closed-client case, close the page after the notification appears, then click it. Use
responsive device mode at 390 × 844 for the mobile bottom-sheet check and a desktop viewport
for card/map synchronization. Browser notification permission is needed only for these
manual visual checks; the automated fixture does not request it.

### Watch production operations

Deploy the Worker only after all four D1 migrations have been applied in order. Copy
`wrangler.toml.example`, replace the D1 database ID and the rate-limit `namespace_id`
(a positive integer unique within the Cloudflare account), and configure:

| Setting | Purpose |
| --- | --- |
| `WATCH_DB` | Private D1 database containing watches and notification state. |
| `WATCH_ALLOWED_ORIGINS` | Comma-separated exact dashboard origins; never `*`. |
| `WATCH_SNAPSHOT_URL` | HTTPS URL of normalized `data/current.json`. |
| `WATCH_INCIDENT_BASE_URL` | HTTPS dashboard root used for notification links. |
| `WATCH_CREATE_RATE_LIMITER` | Cloudflare Rate Limiting binding; 30 creation attempts per client key per 60 seconds. |
| `VAPID_PUBLIC_KEY` | Base64url P-256 public key; also set in `sirento-vapid-public-key` in `index.html`. |
| `VAPID_PRIVATE_KEY` | Matching private key, stored only with `wrangler secret put`; never in TOML, HTML, logs, or Git. |
| `VAPID_SUBJECT` | Operator contact as a `mailto:` or HTTPS URI. |
| `VAPID_KEY_VERSION` | Opaque version recorded with new or updated watches for rotation tracking. |
| cron trigger | Runs matching, cleanup, and delivery every five minutes. |

Set the deployed Worker URL in `sirento-watch-api-base-url` in `index.html`, apply
`0001_create_watches.sql` through `0004_add_watch_retention.sql`, add the private-key
secret, and deploy. Missing D1, origin, rate-limit, snapshot, incident-base, or VAPID
sending configuration fails closed with no push attempt. Invalid VAPID material is rejected
before transport.

Keep a VAPID key pair stable. For a planned rotation, change the Worker secret, public key,
HTML public key, and `VAPID_KEY_VERSION` together. Existing push subscriptions are bound to
the old public key and stop receiving after the server key changes; they are not silently
reused. The next explicit **Watch this area** activation detects a browser-exposed key
mismatch, removes the old backend watch where possible, unsubscribes, and creates a fresh
subscription. A retained browser credential whose server watch was already cleaned up is
also recreated after a 404. Emergency rotation therefore fails closed but requires users to
explicitly re-enable watches; there is no hidden permission prompt.

Notification dedupe and all associated delivery-state rows expire 30 days after creation.
Disabled watches and watches deactivated after a 404/410 push response expire 30 days after
their last update. User deletion removes a watch immediately. Active watches do not expire:
they represent an explicit continuing user choice and are removed by unsubscribe, disable,
or confirmed dead-endpoint handling. Cleanup occurs deterministically at the start of a valid
scheduled matching run; stale/unavailable source states suppress candidates without deleting
active watches.

Each scheduled run writes one aggregate JSON operational event containing active-watch,
candidate, success, retry, failure, delivery-ceiling, and cleanup counts. A failed run writes
only the event name and failure flag. Neither path logs endpoints, subscription keys,
possession tokens, watch coordinates, saved-location labels, incident IDs, or VAPID secrets.

Platform behavior is feature-detected rather than inferred from browser branding. Desktop
and Android Chromium can enable push when the secure-context, Notification, Service Worker,
and Push APIs exist. On iOS/iPadOS, Web Push requires an installed Home Screen web app;
permission is requested only after the user presses the watch action. Safari, Brave, and
other iOS browsers show the installed-app instruction or unsupported state when those runtime
capabilities are absent. Verify actual delivery and notification-tap arrival on each target
device; desktop emulation does not establish iOS or Android delivery support.

The deterministic suites are the repeatable regression path and contact no real push service:

```bash
scripts/docker-test.sh npm run test:watch-production
scripts/docker-test.sh npm run test:watch-matching
scripts/docker-test.sh npm run test:watch-delivery
scripts/docker-test.sh npm run test:notification-ux
scripts/docker-test.sh npm run fixture:watch-matching
scripts/docker-test.sh npm run fixture:watch-delivery
scripts/docker-test.sh npm run fixture:notification-ux
```

Together these cover permission states, subscription validation and renewal, inside/outside
matching, service/category mismatch, duplicate and overlapping processing, stale/unavailable
sources, delivery success, transient retries and exhaustion, 404/410 cleanup, malformed push
payloads, click arrival, missing incidents, the send ceiling, creation rate limiting, and both
retention cleanups. Browser fixture query parameters remain inert off loopback hosts.

Run the deterministic Story 33E2 suite without live D1, Web Push, incident data, or
production secrets:

```bash
scripts/docker-test.sh npm run test:watch-production
```

The suite drives the real HTTP handler and D1 repository contract through an in-memory
D1-compatible fixture. It covers routing, create/update/delete, idempotency, token
enforcement, CORS, local origins, malformed/oversized/invalid requests, storage
failures, response redaction, browser adapter behavior, configuration, and production
fixture guards.

`npm run lint` runs ESLint over the JavaScript application, scripts, and tests, then
Ruff over the Python scripts and tests. Run either linter alone with `npm run lint:js`
or `npm run lint:python`. The Docker test image pins both tools, so Docker is the
simplest way to reproduce CI without installing Ruff on the host.

### Test coverage

The badges show Node’s measured line, branch, and function coverage after successful CI checks on `dev`. They include test files and exclude unloaded code, browser UI interactions, and Python code; they are not whole-repository coverage. The generated badges and [full report](https://github.com/xtreme-nitin-ravindran/tps-dispatch-dashboard/blob/coverage/coverage-report.txt) live on the `coverage` branch and appear after the first successful publishing run. Python tests run separately and include checks for badge generation.

`npm run test:coverage` runs the canonical offline unit suite
(`scripts/run-unit-tests.sh --coverage`) — the same file set as `npm test`, with Node
coverage enabled and the 100/100/100 gate enforced by Node's coverage thresholds. It
excludes live-source integration tests, which run only under `npm run test:integration`.
During full verification the coverage job runs under `TZ=UTC` and therefore also serves
as the UTC unit-suite execution.

After building the Docker image, run the same coverage command used by CI:

```bash
scripts/docker-test.sh env TZ=UTC NODE_V8_COVERAGE=/tmp/coverage npm run test:coverage
```

The coverage command can fail even when every test passes because the coverage gate
requires these minimums:

- Lines: 100.00%
- Branches: 100.00%
- Functions: 100.00%

Files under `test/fixtures/` are helpers and are not selected as standalone tests by
`scripts/run-unit-tests.sh`. A fixture imported by a selected test may still participate
in Node's coverage accounting. Targeted coverage output is therefore not the final gate;
use the complete Docker coverage command above or `npm run verify` for the authoritative
100/100/100 result.

CI fails if any category in the final `all files` row is below 100.00%. For example:

```text
all files | 99.98 | 99.96 | 100.00
```

This means the tests may have passed, but the coverage gate still fails and promotion
is blocked.

To diagnose a failure:

- Find the non-100% file in the coverage table.
- Inspect its uncovered lines and branches.
- Add meaningful tests for reachable behavior.
- Remove code only when it is genuinely dead.
- Rerun the coverage command until lines, branches, and functions are all 100.00%.

100% line, branch, and function coverage does not replace regression-contract testing.
Critical product invariants must have explicit assertions even when ordinary coverage is
already 100%.

#### Pre-push checklist

Before pushing, run `npm run verify` (the canonical full-verification command) and confirm:

- [ ] `npm run verify` passes end to end. (`npm run verify:fast` is an inner-loop aid only
      and does not satisfy this checklist.)
- [ ] The coverage command reports 100.00% lines.
- [ ] The coverage command reports 100.00% branches.
- [ ] The coverage command reports 100.00% functions.
- [ ] Regression-contract tests relevant to the changed code pass.
- [ ] Lint and syntax checks pass as applicable.
- [ ] `git diff --check` passes.
- [ ] `data/current.json` is unchanged unless intentionally modified.

### Regression contracts and feature invariants

Important production fixes must be protected by permanent regression tests.

When fixing a defect or introducing a safety, correctness, or performance bound:

- Add a regression test that would have failed before the fix.
- Test the actual invariant, not only the helper function that implements it.
- Reproduce the real user interaction sequence when the sequence is relevant to the failure.
- Prefer assertions against rendered DOM, map geometry, application state, serialized output, or other observable production behavior.
- Use deterministic fixtures for large, rare, timing-sensitive, browser-specific, or external-data states.
- Keep test-only fixtures clearly separated from production behavior and guard them so they cannot activate on production hosts.
- Do not weaken or remove an existing regression invariant merely to make a new implementation pass.
- If an invariant intentionally changes, update the implementation, tests, and relevant documentation together and explain the reason.
- Regression-contract tests are part of the product contract and must pass before push or promotion.

#### Map cluster expansion

Marker-clustering regression tests must enforce:

- no more than 12 incidents are expanded from a single cluster
- no more than 12 `.cluster-connector` paths are rendered
- cluster fan-out radius never exceeds 96 px
- connector endpoints remain within 96 px of the cluster center
- large clusters remain clustered instead of expanding every incident
- a selected incident from a large cluster may be surfaced separately
- stale connectors are removed after:
  - deselection
  - selection replacement
  - cluster collapse
  - filter changes
  - radius changes
  - zoom changes
  - Map → Calls
  - Calls → Map
- repeated interactions do not accumulate duplicate connector paths

The deterministic large-cluster browser regression should use a 100+ incident cluster and
assert against the actual rendered SVG/DOM, not only clustering helper output.

#### Mobile map regression sequence

Maintain regression coverage for the production sequence that previously caused
viewport-spanning radiating connector lines:

1. Enter Map mode.
2. Enable Road closures.
3. Enable Police boundaries.
4. Select an incident in a dense cluster.
5. Exercise collapsed, half, and expanded bottom-sheet states.
6. Return to collapsed.
7. Switch Map → Calls → Map.
8. Pan and/or zoom.

At relevant stages verify:

- connector count remains bounded
- no viewport-spanning connector fan appears
- no stale or duplicate connectors remain
- selected-incident state remains valid
- large clusters remain bounded

#### Service-worker and frontend asset consistency

Tests must prevent cached frontend assets from silently reintroducing older application behavior.

When cached frontend assets or modules change, verify:

- `index.html` references the current application asset version
- dynamically referenced module versions are current
- service-worker cache versions are consistent with deployed assets
- obsolete SirenTO caches are removed as intended
- query-string and cache-key behavior cannot serve an older implementation unexpectedly

Bump frontend asset and cache versions together with:

```bash
npm run bump:asset-version -- --asset story-44-1 --cache sirento-shell-v54
```

The command updates the stylesheet, app-module, service-worker cache, and
corresponding test references together. Invalid input leaves the files unchanged.

#### Data-state semantics

Regression tests must preserve distinct states for:

- valid zero results
- source unavailable
- stale or retained data
- current successful data

UI tests must not collapse these states into the same user-facing meaning.

#### TTC geography and provenance

Regression tests must ensure:

- structured TTC geography can produce mapped affected-route geometry
- unresolved or free-form TTC alerts remain visible as alerts
- unresolved alert text does not produce invented map geometry
- affected scheduled-route geometry is not presented as the actual temporary diversion route
- SirenTO-observed diversion geometry remains visibly distinguishable from official TTC data
- zero TTC results remain distinct from TTC source unavailability

`npm test` runs the canonical offline JavaScript unit/regression suite through
`scripts/run-unit-tests.sh`. That runner is the executable source of truth for which
files run: it selects every `test/*.test.js` file, excludes every
`test/*.integration.test.js` live-source test, and sorts the result deterministically.
New offline `*.test.js` files join the suite automatically; no manual file list is
maintained. `npm run test:coverage` runs that exact same file set with Node coverage
enabled and the mandatory 100/100/100 gate.

The table below is an illustrative, non-authoritative sample of what some unit files
verify. It is not the executable list and may lag the suite; run
`scripts/run-unit-tests.sh` (or inspect `test/*.test.js`) for the current membership.

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
| `incident-badge.test.js` | NEW expiry, UPDATED precedence, persisted incident lifecycle state, and card wiring. |
| `marker-age.test.js` | Exact marker-age boundaries, accessible freshness labels, future/invalid timestamps, and persistent category/service glyphs. |
| `refresh-freshness.test.js` | Refresh completion timestamps, live age progression, failure preservation, and timer cleanup. |
| `nearby-summary.test.js` | Nearby counts, service/category breakdowns, newest-call ages, and empty or singular results. |
| `mobile-summary-map-info.test.js` | Concise mobile summary ownership, collapsed secondary map metadata, visible trust warnings, Calls-mode spacing, and desktop preservation. |
| `mobile-pre-map-stack.test.js` | Compact mobile header, visible Search and Quick Look action, collapsed Filters, bounded flow layout, and unchanged desktop spacing. |
| `nearby-sort.test.js` | Client-side nearest/newest ordering, stable ties, location availability, and preservation of nearby view state. |
| `siren-matches.test.js` | Two-kilometre siren-result scope, recency/distance ranking, result limits, and invalid-call handling. |
| `view-controls.test.js` | New-call detection, filter summaries/reset defaults, share links, clustering, row selection, preferences, and source timestamp labels. |
| `theme.test.js` | Theme preference validation, system-theme resolution, and document/browser-colour updates. |
| `mobile-radius-controls.test.js` | Mobile single-row search-area options, touch-target layout, active-option visibility, and radius-change rendering integration. |
| `promotion.test.js` | Promotion of only the tested dev commit, superseded/empty changes, protection rejection, existing PR reuse, retry handling, concurrent branch updates, and prevention of duplicate Pages requests. |

`npm run test:python` runs the files in `test/python/` using Python 3’s standard-library unittest runner. It verifies street endpoints, coordinate order and rounding, node deduplication, postal-area filtering and labels, repeatable output, and preservation of the existing index when inputs fail. Tests use temporary fixtures and do not download data or modify the bundled index.

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

Run individual suites through the wrapper, which mounts the current working tree
read-only over the image's `/workspace` and keeps the image-installed dependencies:

```bash
scripts/docker-test.sh npm run lint
scripts/docker-test.sh env TZ=UTC npm test
scripts/docker-test.sh env TZ=America/Los_Angeles npm test
scripts/docker-test.sh npm run test:integration
scripts/docker-test.sh node --test test/disruptions.test.js
```

`npm test` and `npm run test:coverage` run the same canonical offline suite
(`scripts/run-unit-tests.sh`); the only difference is that coverage enables Node's
coverage report and the 100/100/100 gate. The two timezone runs execute that same
offline suite to catch accidental dependence on the machine's local timezone.
`npm run test:watch` uses Node's default discovery, which can include the live
integration test; use an explicit file as above for offline watching.

### Run all required checks

`npm run verify` is the canonical full-verification command. Run it from the repository
root; it is the single, versioned entry point for every required check and stops at the
first failure.

```bash
npm run verify
```

It runs:

- Docker image preparation (`scripts/docker-test.sh --ensure-image`, which builds only when the image is missing or its dependency/tooling fingerprint changed) — always sequential, before any container check
- the independent validation jobs, scheduled concurrently with bounded concurrency:
  - full ESLint and Ruff linting (`npm run lint`)
  - browser JavaScript syntax checks (`app.js` and every `src`/`scripts` `.js` file)
  - the canonical offline unit suite in `TZ=America/Los_Angeles` (`npm test`)
  - Python tests (`npm run test:python`)
  - live-source integration tests (`npm run test:integration`)
  - the canonical offline unit suite in `TZ=UTC` with the CI-equivalent 100/100/100 coverage gate (`npm run test:coverage`)

The UTC coverage job is also the UTC unit-suite execution: it runs the same canonical
offline file set as `npm test`, so full verification no longer runs a separate redundant
UTC unit job. The `TZ=America/Los_Angeles` job runs that same offline suite without
coverage to detect local-time dependencies. Live-source integration tests run only in
the dedicated `integration` job; neither the unit nor the coverage job contacts live
sources.
- whitespace checks (`git diff --check` and `git diff --cached --check`) — always sequential, after the jobs
- both `data/current.json` exclusion checks — always sequential, after the jobs

Every required check runs exactly once regardless of scheduling. Each job's output is
captured to its own log so concurrent output never interleaves; a passing job prints a
bounded tail, and a failing job prints its complete output. On the first failure the
scheduler stops launching queued jobs, terminates any still-running siblings (including
their process trees), reports every failing job, and exits nonzero.

Concurrency is bounded by the `VERIFY_JOBS` environment variable (default `4`, maximum
`8`). Set `VERIFY_JOBS=1` for fully sequential, readable diagnosis; the same jobs run in
the same order with the same commands and environment.

```bash
# Default: up to 4 concurrent jobs.
npm run verify

# Fully sequential.
VERIFY_JOBS=1 npm run verify

# Up to 6 concurrent jobs.
VERIFY_JOBS=6 npm run verify
```

An invalid `VERIFY_JOBS` value (non-numeric, empty, less than 1, or greater than 8) is
rejected before any Docker work begins.

Prerequisites:

- Docker must be available and able to build `Dockerfile.test`.
- Live internet access is required for the integration suite. Source outages, rate
  limits, or incompatible responses fail that suite; empty valid feeds are allowed.
- The snapshot checks compare against the locally fetched `origin/main` reference.
  Synchronize remote references before validating a branch for publication.

The coverage command is mandatory: a passing test suite with less than 100.00% line,
branch, or function coverage is not ready for promotion. ESLint and Ruff catch static
correctness problems; the explicit syntax checks parse browser JavaScript without
executing it, and whitespace checks flag issues such as trailing spaces. None of these
checks replaces feature-specific regression contracts or required physical-device
validation.

### Fast inner-loop verification

`npm run verify:fast` is a deliberately reduced inner-loop check for use while
implementing. It is not a substitute for `npm run verify`.

```bash
# No arguments: run the canonical offline unit suite (npm test) under TZ=UTC.
npm run verify:fast

# One explicit test file.
npm run verify:fast -- test/mobile-map-focus.test.js

# Multiple explicit files, run in the order supplied.
npm run verify:fast -- test/mobile-map-focus.test.js test/theme.test.js
```

For a newly added offline test, the one-file form is the preferred first check. Fast
verification still runs the full Docker-backed lint and browser syntax checks before that
test. Local ignored files under `tmp/` are visible to `eslint .`; inspect that directory
for stale, unreferenced debug scripts if lint reports them, but do not delete unrelated
temporary work indiscriminately.

Fast mode runs, in order:

- Docker image preparation (`scripts/docker-test.sh --ensure-image`, which builds only when the image is missing or its dependency/tooling fingerprint changed)
- full ESLint and Ruff linting (`npm run lint`)
- browser JavaScript syntax checks (`app.js` and every `src`/`scripts` `.js` file)
- offline JavaScript unit tests under `TZ=UTC` — the canonical `npm test` suite with
  no arguments, or exactly the supplied `test/*.test.js` files with Node's test runner

Fast mode omits:

- the `TZ=America/Los_Angeles` unit suite
- the Python tests (`npm run test:python`)
- the live-source integration suite (`npm run test:integration`)
- the CI-equivalent 100/100/100 coverage gate (`npm run test:coverage`)
- the Git publication and generated-snapshot exclusion checks

### Story retrospective checklist

Every numbered story retrospective or completion handoff must explicitly assess:

- out-of-band chore or cleanup work that should become a separate roadmap story instead
  of expanding the current implementation
- durable workflow knowledge that should be added to `AGENTS.md` or this README

Record `None` when either assessment finds no follow-up. This distinguishes a deliberate
decision from an omitted review.

Explicit file arguments are validated before any Docker work begins. Only
repository-relative regular files under `test/` ending in `.test.js` are accepted;
absolute paths, `..` traversal, directories, missing files, empty arguments,
option-like arguments, and `.integration.test.js` files are rejected with a clear
diagnostic and a nonzero exit status.

> [!WARNING]
> Fast mode does **not** replace `npm run verify`. It does not run the coverage gate,
> the live-source integration suite, the America/Los_Angeles timezone suite, applicable
> rendered-browser (Playwright) tests, or physical-device validation. A passing fast run
> does not satisfy the 100/100/100 coverage requirement and is not final, pre-push, or
> promotion verification. Run `npm run verify` at story completion and before
> recommending push or promotion.

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

- **Concourse** runs `scripts/tfs-etl.js` approximately every five minutes to fetch feeds, merge history, and prepare map locations. Road and TTC feeds are checked at most once every five minutes.
- **GitHub Actions fallback** checks every five minutes and runs the updater if the snapshot or either incident feed is at least ten minutes old or unavailable. Scheduled runs may be delayed.
- Both use code from **`main`** and publish `data/current.json` and `data/ttc-diversions.json` to the **`data`** branch. The site reads those files directly, so data updates do not require a Pages deployment.
- Failed sources retain their last successful data and are marked unavailable. If both incident feeds fail, the existing snapshot is preserved.

### Single data-branch writer

The `data` branch is a single Git ref, so any two writers that push to it can race a
fast-forward push: whichever finishes second is based on an older commit and is
rejected. SirenTO avoids this by using **exactly one writer per pipeline** rather than
serializing two writers with a shared lock.

- **Concourse** runs one `update-sirento` job. The incident ETL and the bounded TTC
  vehicle burst are sequential steps in that job, and a single `put: snapshots` step
  publishes both `data/current.json` and `data/ttc-diversions.json` in one push.
- **GitHub Actions** runs one `update-sirento` workflow (`.github/workflows/update-sirento.yml`)
  with the same sequential steps and a single `git push origin HEAD:data`.

Because there is only one writer, no `serial_groups` lock is needed. The trade-off is
deliberate: a TTC failure fails the whole build, so the next timer tick or scheduled
run retries both the incident snapshot and the TTC geometry together. This is preferred
over a shared serial group, which previously deadlocked the pipeline when a resource
check stalled and no build could start.

Keep generated snapshots out of code commits. The snapshot on `dev` and `main` is a
fixture; the live snapshot is on `data`. Pipeline configuration is in
[`concourse/pipeline.yml`](concourse/pipeline.yml), with example settings in
[`concourse/values.example.yml`](concourse/values.example.yml).

Before updating the data branch, Concourse builds `Dockerfile.test` with the supported
OCI build task and uses that artifact as its task image. It enforces the same gates as
the protected GitHub Actions workflow: the canonical offline suite in
America/Los_Angeles, Python tests, ESLint and Ruff, browser JavaScript syntax checks,
and the canonical UTC suite with the 100/100/100 coverage thresholds. The structural
CI-strategy regression fails if either pipeline drops one of those shared checks.

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
| [Toronto Fire Services](https://www.toronto.ca/community-people/public-safety-alerts/alerts-notifications/toronto-fire-active-incidents/) · [XML feed](https://www.toronto.ca/data/fire/livecad.xml) | Public active fire-service incidents, dispatch times, alarm levels, and vehicle assignments when supplied. | Credit: Toronto Fire Services. Source data is not covered by this repository’s Spaghetti License. |
| [Toronto Police Service Calls for Service](https://services.arcgis.com/S9th0jAJ7bqgIRjw/arcgis/rest/services/C4S_Public_NoGO/FeatureServer/0) | Public police calls, reported divisions, and approximate incident coordinates. | Credit: Toronto Police Service. Source data and services retain their own terms. |
| [City of Toronto Road Restrictions](https://open.toronto.ca/dataset/road-restrictions/) · [JSON feed](https://secure.toronto.ca/opendata/cart/road_restrictions/v3?format=json) · [Official restrictions map](https://www.toronto.ca/services-payments/streets-parking-transportation/road-restrictions-closures/restrictions-map/) | Road restriction descriptions, schedules, impacts, and geometry for the map overlay. | Credit: City of Toronto. Consult the dataset’s published terms; no blanket licence is asserted here. |
| [TTC GTFS-Realtime](https://gtfsrt.ttc.ca/) · [Alerts feed](https://gtfsrt.ttc.ca/alerts/all?format=text) · [TTC Routes and Schedules](https://open.toronto.ca/dataset/ttc-routes-and-schedules/) · [Official service advisories](https://www.ttc.ca/service-advisories/all-service-alerts) | Transit alerts, affected routes/stops, active periods, and stop coordinates used for geographic relevance. | Credit: Toronto Transit Commission. Static GTFS data is provided under the Open Government Licence – Toronto; other source data and services retain their own terms. |
| [TPS_POLICE_DIVISIONS_REV](https://www.arcgis.com/home/item.html?id=fdd36b8dd9544c97b926958f3eb8cb98) · [TPS My Neighbourhood](https://www.tps.ca/my-neighbourhood/) | Division boundary overlay, station metadata, and geographic estimates of TFS police divisions. | Credit: Toronto Police Service. The ArcGIS item’s licence field was blank when checked September 18, 2026; this data is not covered by the repository’s Spaghetti License. |
| [Toronto Centreline](https://open.toronto.ca/dataset/toronto-centreline-tcl/) | Street intersections and segments used to interpret TFS locations. | Credit: City of Toronto, under the [Open Government Licence – Toronto](https://www.toronto.ca/city-government/data-research-maps/open-data/open-data-licence/). |
| [GeoNames](https://www.geonames.org/) · [Postal data](https://www.geonames.org/postal-codes/) | Approximate postal-area coordinates and names; these may differ from other neighbourhood definitions. | Credit: GeoNames, under [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/). |
| [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) | Background map data and geographic context. | © OpenStreetMap contributors, under the Open Database License. |

This project is independent and is not affiliated with or endorsed by Toronto Fire Services,
Toronto Police Service, the City of Toronto, the Toronto Transit Commission, or Esri.
The Spaghetti License applies only to original repository software, not third-party data,
services, or assets.

## License

Original repository software is available under the [Spaghetti License](LICENSE),
identified in SPDX expressions as the custom LicenseRef `LicenseRef-Spaghetti`.
This is a custom SPDX LicenseRef, not an identifier from the official SPDX License List.
Any user-facing application that uses this software must visibly display
[`brand-spaghetti.jpg`](brand-spaghetti.jpg).
