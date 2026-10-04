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

Run commands from the repository root. Use Docker for the same Node.js 22, ESLint,
and Ruff environment as CI. Unit tests use fixtures, mocked services, bundled geographic
data, and temporary files/repositories; they do not publish changes or require live feeds.
See [Test coverage](#test-coverage) for how coverage is measured and published.

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

Start the deterministic site in one terminal (port `8765` is the browser-suite
default and port `8080` must not be used):

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

Then run every applicable suite from another terminal:

```bash
npm run test:story-39a:browser
node scripts/ttc-ui-browser.js
```

The Story 39A suite checks bounded cluster connectors and lifecycle cleanup. The Story
TTC suite checks disruption rendering and state transitions. Each uses loopback-only
deterministic fixtures. Environment overrides such as `PLAYWRIGHT_MODULE`,
`CHROMIUM_EXECUTABLE`, and the suite-specific `*_UI_URL` remain available for
nonstandard local installations.

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
docker build -f Dockerfile.test -t toronto-dispatch-tests .
docker run --rm toronto-dispatch-tests npm run test:watch-backend
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
docker build -f Dockerfile.test -t toronto-dispatch-tests .
docker run --rm toronto-dispatch-tests npm run test:watch-matching
docker run --rm toronto-dispatch-tests npm run fixture:watch-matching
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
docker build -f Dockerfile.test -t toronto-dispatch-tests .
docker run --rm toronto-dispatch-tests npm run test:watch-delivery
docker run --rm toronto-dispatch-tests npm run fixture:watch-delivery
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
docker build -f Dockerfile.test -t toronto-dispatch-tests .
docker run --rm toronto-dispatch-tests npm run test:notification-ux
docker run --rm toronto-dispatch-tests npm run fixture:notification-ux
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
docker run --rm toronto-dispatch-tests npm run test:watch-production
docker run --rm toronto-dispatch-tests npm run test:watch-matching
docker run --rm toronto-dispatch-tests npm run test:watch-delivery
docker run --rm toronto-dispatch-tests npm run test:notification-ux
docker run --rm toronto-dispatch-tests npm run fixture:watch-matching
docker run --rm toronto-dispatch-tests npm run fixture:watch-delivery
docker run --rm toronto-dispatch-tests npm run fixture:notification-ux
```

Together these cover permission states, subscription validation and renewal, inside/outside
matching, service/category mismatch, duplicate and overlapping processing, stale/unavailable
sources, delivery success, transient retries and exhaustion, 404/410 cleanup, malformed push
payloads, click arrival, missing incidents, the send ceiling, creation rate limiting, and both
retention cleanups. Browser fixture query parameters remain inert off loopback hosts.

Run the deterministic Story 33E2 suite without live D1, Web Push, incident data, or
production secrets:

```bash
docker build -f Dockerfile.test -t toronto-dispatch-tests .
docker run --rm toronto-dispatch-tests npm run test:watch-production
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

After building the Docker image, run the same coverage command used by CI:

```bash
docker run --rm \
  -e NODE_V8_COVERAGE=/tmp/coverage \
  toronto-dispatch-tests \
  npm run test:coverage
```

The coverage command can fail even when every test passes because the coverage gate
requires these minimums:

- Lines: 100.00%
- Branches: 100.00%
- Functions: 100.00%

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

Before pushing:

- [ ] All required tests pass.
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

`npm test` runs all 25 JavaScript unit test files below:

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

Build the Docker image once after changing code or tests:

```bash
docker build -f Dockerfile.test -t toronto-dispatch-tests .
docker run --rm toronto-dispatch-tests npm run lint
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
the Docker image, runs both linters, both timezone unit suites, the Python tests, the
live integration suite, the CI-equivalent 100/100/100 coverage gate, browser JavaScript
syntax checks, and whitespace checks, and verifies that generated snapshot changes are
not included in the code branch. It stops at the first failure.

```bash
(
  set -e
  docker build -f Dockerfile.test -t toronto-dispatch-tests .
  docker run --rm toronto-dispatch-tests npm run lint
  docker run --rm -e TZ=UTC toronto-dispatch-tests
  docker run --rm -e TZ=America/Los_Angeles toronto-dispatch-tests
  docker run --rm toronto-dispatch-tests npm run test:python
  docker run --rm toronto-dispatch-tests npm run test:integration
  docker run --rm \
    -e NODE_V8_COVERAGE=/tmp/coverage \
    toronto-dispatch-tests \
    npm run test:coverage
  docker run --rm -i toronto-dispatch-tests node --input-type=module --check < app.js
  docker run --rm toronto-dispatch-tests sh -c 'find src scripts -name "*.js" -exec node --check {} +'
  git diff --check
  git diff --cached --check
  git diff --exit-code origin/main...HEAD -- data/current.json
  git diff --exit-code HEAD -- data/current.json
)
```

The snapshot checks use the locally fetched `origin/main` reference. Synchronize
remote references before validating a branch for publication. ESLint and Ruff catch
static correctness problems; the explicit syntax checks parse browser JavaScript
without executing it, and whitespace checks flag issues such as trailing spaces. The
coverage command is also mandatory: a passing test suite with less than 100.00% line,
branch, or function coverage is not ready for promotion. None of these checks replaces
feature-specific regression contracts or required physical-device validation.

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

### TTC construction/detour ingestion (Story 30A)

The data pipeline fetches binary GTFS-Realtime alerts from
`https://bustime.ttc.ca/gtfsrt/alerts` using MobilityData's pinned
`gtfs-realtime-bindings` package. Node 22.13+ (or 24+) and `npm ci` are required;
Dockerfile.test provides the runtime and installs the lockfile.

Production output is `data/current.json` → `ttcAlerts` (schemaVersion 1), published
atomically with the existing incident snapshot on the `data` branch. It contains
`items`, `status`, `checkedAt`, `fetchedAt`, and `sourceUpdatedAt`. Items contain
source alert IDs, cause/effect/severity enum names, ISO UTC active periods, exact
unique route/stop IDs, original selectors (including trip descriptors), selected
English/unlabeled/fallback text and all original translations. Unknown enums use
`UNKNOWN_<number>`. No route/stop names or geometry are inferred.

Selection prefers CONSTRUCTION or DETOUR; when cause/effect is missing, a narrow
construction/detour/diversion text match is allowed. Explicit subway-only selectors
are excluded; unspecified route types remain eligible without guessing from route
IDs. Relevant future and expired records are retained with explicit lifecycle state;
all original periods remain available.
Differential, malformed, stale (over one hour), and future-dated feed headers are
rejected. Header timestamps may be absent. Requests time out after 12 seconds;
the next scheduled run retries, as with existing disruption feeds.

Concourse installs dependencies before tests and the shared ETL; its standalone
`concourse/tfs-etl.yml` task also installs production dependencies. The GitHub
fallback installs the same lockfile and calls the same updater when the incident
snapshot needs refresh. Existing publication and deployment of current.json carry
this new section automatically. TTC failures log structured source/status/error
JSON, retain prior items and successful fetch time, and mark status unavailable.
A first-run failure has empty items and null fetchedAt, distinct from a successful
empty feed. TTC failure does not abort incident ingestion. Existing UI transit
consumption remains unchanged.

```sh
npm ci
npm run update:tfs       # full production refresh including TTC
npm run update:ttc       # strict standalone ingestion to data/ttc-alerts.json
npm run test:ttc         # deterministic protobuf-builder tests (also in npm test)
npm run test:ttc:live    # opt-in live smoke; no files written; zero alerts is valid
```

`TTC_OUTPUT` overrides the standalone artifact path. Standalone fetch/decode
failure exits nonzero and leaves existing output untouched. This diagnostic file
is not the production artifact and should not be committed. Docker equivalents
use `docker run --rm toronto-dispatch-tests npm run test:ttc` (or `test:ttc:live`);
mount the data directory as documented above for local artifact generation.

### TTC lifecycle and snapshot contract (Story 30B)

`ttcAlerts` keeps schemaVersion 1 and adds `lifecycleVersion: 1` on successful
refresh. Existing fields and `status: "ok" | "unavailable"` remain compatible.
`checkedAt` is the latest attempt; `fetchedAt` is the last successful fetch;
`sourceUpdatedAt` is the optional upstream header time. No separate API is needed:
consumers read this section of the same published current.json used by the app.

Each item adds `contentHash` (SHA-256 of canonical normalized content, excluding ID,
fetch time and lifecycle metadata), `firstSeenAt`, `updatedAt`, and `state`:
`active`, `scheduled`, or `expired`, evaluated at successful fetch time. Consumers
needing evaluation at another time can use `isAlertActive(item, referenceTime)`.
Starts are inclusive, ends exclusive; missing bounds are unlimited. No periods
means unrestricted. Any active period wins; a gap before a future valid period is
scheduled. All-ended periods are expired. No arbitrary age expiry is applied.

Source entity IDs are preserved exactly. Missing/blank IDs use `fallback:<hash>`;
content changes without a source ID necessarily appear as removal plus addition.
Identical repeated IDs collapse; conflicting content for one ID rejects the feed
and retains prior state. Different source IDs stay distinct even with equal content.

`changes` contains sorted `new`, `unchanged`, and `updated` ID arrays plus `removed`
records (`id`, `contentHash`, `state: "removed" | "expired"`). This describes only
the latest successful comparison, not an event history. Disappeared records leave
`items`; tombstones survive until the next successful refresh. Reappearance is new
once removed. No unbounded history is stored. Future/expired items still present
upstream remain in `items`; select `state === "active"` for the active set.

An empty successful feed clears items and records removals with status ok. Failure
retains the complete known-good items, lifecycle and changes, and successful time;
only status and checkedAt change. Retained states are observations at fetchedAt,
not a claim of current activity. Recovery reconciles against that retained state.
Malformed previous state or final publication state aborts publication. Logs report
counts and retention without descriptions. Both existing pipelines use the shared
ETL and previous current.json; no pipeline changes or new state files are needed.

`npm run test:ttc` covers deterministic lifecycle and protobuf fixtures; `npm test`
also covers protobuf → reconciliation → atomic snapshot → JSON reader, including
publication rejection. `npm run update:ttc` performs strict standalone reconciliation
with its prior artifact; `npm run test:ttc:live` remains an opt-in decoding smoke.
No browser TTC fetching, UI changes, or map behavior is introduced.

### Story 30C: backend static GTFS correlation

The shared backend entry point is `src/ttc/backend.js`. It runs the existing
30A parser and 30B lifecycle reconciliation, then adds static correlation; derived
correlation is excluded from the source-content hash. Existing UI, Story 32
geofenced alerts, and their bundled `src/disruptions/ttc-stops.js` remain unchanged.
Inspection found that stop-only bundle had neither trip patterns nor a refresh
mechanism. Its older GTFS identifiers must not be assumed compatible with BusTime.

Use Toronto's [Surface Routes and Schedules for BusTime](https://open.toronto.ca/dataset/surface-routes-and-schedules-for-bustime/),
resource `28514055-d011-4ed7-8bb0-97961dfe2b66`, `surfacegtfs.zip`. The City's
metadata explicitly pairs it with enhanced NVAS/BusTime GTFS-RT; it is different
from the legacy and merged all-mode datasets. Required files: `routes.txt`,
`stops.txt`, `trips.txt`, `stop_times.txt`. Optional files: `shapes.txt`,
`calendar.txt`, `calendar_dates.txt`. No schedule times are retained. All source
IDs are exact strings (including leading zeroes), with no route-short-name,
stop-code, or trip aliases. Missing joins retain their IDs and `matched:false`.
Trips without stop times remain diagnosable but generate no pattern.

The loader reads each necessary member once per build and indexes routes, stops,
trips, shapes, patterns by route, and patterns by stop. ZIP entries are read in
memory without filesystem extraction; compressed input is bounded to 128 MiB and
individual inflated members to 768 MiB. Equivalent `(route_id, direction_id,
shape_id, ordered stop IDs)` tuples share a deterministic SHA-256 pattern ID;
trips with different schedule times or numeric sequence spacing collapse together.
Duplicate sequences, invalid coordinates, and missing required internal route/stop
references reject a replacement dataset. A missing shape preserves stop matching.

Selectors scope stops to their route; trip and direction evidence narrow candidates
only when selectors consistently supply it. Unscoped stops can search the stop
index. Route-only alerts resolve metadata but produce no segment. Candidates with
maximum stop coverage survive; full coverage outranks partial coverage. Among
these, service calendars and exception dates prefer service on the Toronto date
of the current period (or first future period for a scheduled alert). Previous-day
service remains credible for overnight trips because arrival/departure times are
not retained. This is a calendar preference, not proof that a vehicle is operating.
Without a usable calendar, all otherwise credible patterns survive. Branches,
short turns, directions 0/1, and missing directions remain distinct patterns.

`informed_entity` is an unordered set, and 30A sorts its stop-ID index. Never treat
that lexical order as traversal order. Segment order comes from static stop times.
A caller with independent sequence evidence may supply `affectedStopOrder`; a
conflict downgrades the match and suppresses its segment. No text-derived order
or direction is guessed. Multiple equal full candidates are `ambiguous`; incomplete
coverage is `partial`; one supported full candidate per route is `exact`; no
usable joins is `unmatched`. Exact is a statement about scheduled stop/pattern
correlation, not exact geometry or actual service. Inspect candidate geometry and
calendar flags separately. Unknown IDs prevent an exact aggregate result.

Each candidate can carry an `affectedSegment`: the first through last matched
stop, including intermediate scheduled stops. Repeated affected stops suppress
occurrence selection. Shape points are ordered by `shape_pt_sequence`.
Clipping projects every segment stop onto a local equirectangular polyline, with
a 100 m maximum distance. Distinct positions more than one shape edge apart within
5 m of the best distance are treated as ambiguous. Projections must be monotonic
and endpoints distinct. Successful geometry is `[longitude, latitude]`; otherwise
only the shape reference and `geometryStatus: ambiguous|missing` are retained.

**The geometry generated in Story 30C represents the affected scheduled TTC route,
not the actual temporary detour path.**

The additive contract keeps `ttcAlerts.schemaVersion:1`, adds each item's
`correlation`, and adds `ttcAlerts.staticCorrelation` (its own schemaVersion 1).
The latter holds dataset SHA-256 version, availability, counts, join diagnostics,
and a shared catalog of referenced patterns. Candidates reference catalog IDs;
full shapes, schedule times, and individual scheduled trip lists are not shipped
to the browser. Shape IDs refer to the versioned backend GTFS cache. Only clipped
segments are included in alert data. Validation is non-mutating and rejects invalid
coordinates, geometry, unsupported exact claims, and missing pattern references.

The default backend-only cache is `.cache/ttc/surface.zip`, configurable with
`TTC_STATIC_CACHE`. It is ignored by Git and Docker builds, refreshed after 24 hours,
and replaced atomically only after all indexes validate. Requests have a 60-second
timeout and two attempts. A failed refresh uses validated previous bytes with
`staticCorrelation.status:stale`. Without usable static data, RT lifecycle updates
continue with `status:unavailable`; only unchanged alerts retain their previous
correlation. Changed/new alerts do not inherit stale conclusions. Static-source
unavailability is distinct from an empty alert feed. The cache is not published.

Concourse's existing ETL task caches `ttc-static-cache` and sets `TTC_STATIC_CACHE`;
GitHub fallback restores/saves `.cache/ttc` using Actions cache. Both invoke the same
backend through existing ETL code, with correlation after lifecycle reconciliation
and before snapshot validation/atomic publication to the data branch. No separate
YAML parser, new job, new dependency, or frontend consumer is required.

```bash
npm run update:ttc         # standalone RT lifecycle + static correlation
npm run update:tfs         # full production snapshot pipeline
npm run test:ttc           # offline protobuf, lifecycle, static and ETL fixtures
npm run update:ttc:static  # opt-in static refresh/validation + live join diagnostic
```

Docker supports the same commands. For a persistent local cache:

```bash
mkdir -p .cache/ttc
docker run --rm -v "$PWD/.cache/ttc:/workspace/.cache/ttc" toronto-dispatch-tests npm run update:ttc:static
```

`test/fixtures/ttc-static` is a tiny network-free GTFS dataset. The test suite covers
exact and missing IDs, equivalent trips, directions/branches, partial and ordered
matches, projection/tolerance, ambiguous loops, missing shapes, calendars, multiple
routes, cache failure/retention, malformed schema, and protobuf-to-published-snapshot
behavior. The live diagnostic reports loaded table/pattern counts, missing-stop-time
trips, matched/unmatched route/stop/trip references, process memory, loading runtime,
and output bytes. Zero qualifying alerts succeeds and explicitly reports that live
alert correlation was not exercised. Failure to fetch RT is reported separately
from static validation. Normal tests never download GTFS.

The completed implementation's [validation report](docs/story-30c-validation.md)
records the live dataset counts, memory/runtime observations, identifier-validation
limits, file inventory, regression results, and implications for Story 30D.
`npm run test:ttc:live` retains its existing RT-only smoke behavior; use
`npm run update:ttc:static` for live static correlation diagnostics.

### Story 30D: backend TTC vehicle deviation evidence

Story 30D detects **deviation from scheduled TTC route geometry**. It does not
determine the actual diversion route or the cause of the deviation. No UI or map
consumer reads these artifacts; `data/current.json` remains unchanged.

The shared GTFS-RT runtime decodes `https://bustime.ttc.ca/gtfsrt/vehicles`.
`vehicle.id` is the physical identity (preserved exactly, including leading zeroes).
Missing identities are counted and discarded; entity IDs and coordinates never
substitute for them. Observations require numeric valid latitude/longitude and a
vehicle timestamp. Optional fields include trip/route/direction IDs, start date/time,
bearing, speed, stop ID/sequence, status, and schedule relationship. Missing fields
stay absent. Timestamp normalization and protobuf decoding are shared with alerts.
See the [GTFS-RT reference](https://gtfs.org/documentation/realtime/reference/).

Correlation first validates a static trip ID against supplied route, direction and
stop context. A conflicting known trip is rejected, not silently remapped. An
unknown trip can fall back to the route index, direction, and stop membership.
Exactly one pattern with available surface-mode geometry must survive; multiple
patterns remain ambiguous even if one is geographically closer. Coordinates cannot
select whichever branch makes a point appear on-route. Non-scheduled trip
relationships are excluded. Start date/time segment assignments but are not proof
of service-calendar compatibility; stop sequence is retained but not used as an
array offset (Story 30C groups trips with different numeric sequence spacing).
No route-name, stop-code or numeric trip-ID aliases are introduced.

**Live limitation:** the September 28 diagnostic found extensive trip-ID collisions
between the realtime and static sources (443/444 recognized IDs had different route
IDs). Matching ID strings alone are unsafe. The detector rejected these joins;
most vehicles remain ambiguous or unmatched. See `docs/story-30d-validation.md`.

Shape projection uses a local equirectangular metric (111,320 metres per latitude
degree, longitude scaled by cosine of shape latitude), consistent with Story 30C.
Segments are compiled lazily once per shape; bounding-box lower bounds prune scans
without losing the global nearest segment. Results retain distance, segment index,
fraction, projected lon/lat, and cumulative progress. Self-crossing/parallel
positions within 5 m and separated by over 50 m of progress are flagged ambiguous;
Story 30E must not treat their progress as uniquely resolved. Degenerate shapes
cannot classify observations. No shape coordinates are duplicated in exports.

Named policy (`VEHICLE_POLICY` in `src/ttc/vehicle-detector.js`):

- Entry: strictly more than **100 m** from geometry; recovery: strictly under **50 m**.
- Confirmation: **3 consecutive off-route timestamps**, spanning **60 seconds**,
  with **100 m displacement** from the first point. Counts are observations, not polls.
- Recovery: **3 consecutive on-route timestamps over 60 seconds**. Intermediate
  observations mark rejoining. The 50–100 m band preserves confirmed/rejoining state
  but breaks consecutive evidence. Unconfirmed neutral evidence returns to unknown.
- Off-route positions within **150 m of either shape endpoint** are neutral, reducing
  terminal, loop entrance and layover false positives. Stationary off-route vehicles
  cannot confirm. This is general geometry, not a Toronto garage exception list.
- Reject jumps beyond **100 m + 40 m/s × elapsed seconds**, before assignment resets.
  Rejected positions never enter history or future path evidence.
- Vehicle and feed times must be at most **120 seconds old**, at most **30 seconds
  ahead**. Missing/invalid feed time is unavailable. Duplicate/out-of-order vehicle
  times cannot advance state; conflicting same-time records are discarded together.
- Retain at most **20 observations / 10 minutes**, whichever is smaller, per vehicle;
  at most **3,000 vehicles**, freshest first with deterministic identity tie-breaks.
  History expires after **10 minutes** without accepted observations. Gaps greater
  than **6 minutes**, route/trip/direction/start-date/start-time/pattern changes,
  and static-version changes reset evidence. History never becomes a tracking archive.
  These limits are deliberately larger than the five-minute data-writer cadence so a
  track survives between runs; otherwise every run would start cold and a completed
  departure-to-rejoin episode could never form.

The 100 m entry threshold is deliberately conservative for GPS uncertainty, road
width, loops, and static shape approximation. Live matched-distance medians were
about 0.13 m, with p95 below 2 m in the initial four polls; these unusually small
values may reflect upstream snapping and do not measure GPS accuracy. The tail
included 400 m+ observations. Those were not assumed normal to inflate a threshold,
nor assumed genuine diversions to tune it downward. Wider calibration is still
needed for coverage and recall; no causes are inferred.

Active current alerts are supporting context only. Explicit single-route selectors
without stop/trip ambiguity, or exact Story 30C pattern correlations with compatible
selectors, supply `relatedAlertIds`. Unavailable, expired, scheduled or ambiguous
scoped alert matches are excluded. Detection works with zero alerts.

Backend files (all ignored locally):

- `.cache/ttc/vehicle-state.json`: schema v1 bounded restart state, maximum 32 MiB.
- `.cache/ttc/deviations.json`: schema v1 compact possible/confirmed/rejoining records,
  references to static version/pattern/shape, current episode dates, bounded projected
  observations, and related alert IDs. No full fleet, shapes, or cause field.

Validators reject invalid coordinates/timestamps, negative distances, invalid states,
unbounded arrays, duplicate identity, and inconsistent index references. Writes are
atomic per file. Corrupt cache is rejected and logged, never repaired into evidence.
Consumers must validate with the matching static index, reject incompatible static
versions, and enforce freshness from `checkedAt`/`lastObservedAt` themselves: a file
cannot age itself if a scheduler stops. Successful-empty polls are `ok`; unmatched
vehicles are reported separately. Fetch, decode and stale-header failures have
separate reasons, immediately export unavailable with **no deviations**, and age
restart state for at most 10 minutes. Static failure clears restart evidence.
Failures are isolated from all incident/alert publication jobs.

Concourse runs the vehicle burst as the `observe-vehicles` step inside the single
`update-sirento` job, after the incident ETL. `concourse/ttc-vehicles.yml` loads static
GTFS once and makes **four polls 30 seconds apart** (a 90-second burst plus
network/setup time). Actual starts are limited by the job's total duration; this is not
a guaranteed continuous 30-second service. A bounded task cache carries state when
available; losing it is safe because each burst can confirm independently.
`ttc-vehicle-evidence/deviations.json` is a task output consumed by the following
`publish-ttc-geometry` step; it is not committed or published to the web data branch.
Build logs retain 50 builds. The incident ETL step requires no changes for this feature.

GitHub `.github/workflows/update-sirento.yml` runs the same four-poll code every five
minutes when scheduled, as a step in the single data-writer job. It restores the
`.cache/ttc` directory (including bounded vehicle and inference state) through the
Actions cache, so a completed departure-to-rejoin episode can span runs when the cache
is available. A cold cache starts fresh and cannot fabricate confirmation. Scheduler
delays and feed repetition may yield no confirmed deviations; correctness is unchanged.
No new always-on service, browser polling, or dependencies are added.

Local commands (no UI startup):

```bash
npm run test:ttc
npm run update:ttc:vehicles                         # one poll, bounded local state
npm run test:ttc:vehicles:live                      # four live polls
npm run update:ttc:vehicles -- --polls 10 --interval-ms 30000
npm run update:ttc:vehicles -- --fixture /path/sequence.json --static-fixture test/fixtures/ttc-static
```

Fixture JSON is an array of `{now, protobufBase64, alerts?}` records. Fixture mode
skips waits and all live fetches when a static fixture is supplied. The test builder
in `test/fixtures/ttc-vehicles/builders.js` creates deterministic protobuf sequences.
Override paths with `TTC_STATIC_CACHE`, `TTC_VEHICLE_STATE`, `TTC_VEHICLE_OUTPUT`.
Use Docker with the same cache mount shown above and `npm run test:ttc:vehicles:live`.
Logs show counts, ID conflicts, correlation quality, states, anomalies, expiry,
rejoins, related alerts, distance percentiles, matching/projection duration, RSS,
and export bytes; routine logs contain no vehicle coordinate list.

### TTC observed diversion inference (Story 30E, backend only)

Story 30E geometry is inferred by SirenTO from observed TTC vehicle movement and is
not TTC-published route geometry. Nothing in this story changes the map or browser.
The existing vehicle poller now feeds accepted Story 30D history into bounded
inference; its static matching and realtime/static trip-ID conflict rejection are
unchanged. Scheduled geometry never consumes inference output.

The poller writes `.cache/ttc/diversion-state.json` (private bounded restart evidence)
and `.cache/ttc/diversions.json` (compact versioned geometry/metadata). Override with
`TTC_DIVERSION_STATE` and `TTC_DIVERSION_OUTPUT`; defaults follow the directories of
`TTC_VEHICLE_STATE` and `TTC_VEHICLE_OUTPUT`. These files are not `data/current.json`
and are not published to the data branch. Check artifact `status`, `checkedAt` and
`lastObservedAt` before future consumption. Unavailable feeds export zero diversions;
static failure clears inference. A stopped scheduler cannot expire its own files.

An episode belongs to one vehicle assignment and Story 30D deviation start, with
accepted observations in time order, departure raw/projected evidence, and an
optional recovery-confirmed rejoin. Possible episodes are retained to preserve the
departure, but cannot vote until Story 30D confirms them. Three on-route observations
over 60 seconds close recovery. Missing departure anchors, missing rejoins and
ambiguous progress remain explicit uncertainty. Gaps/reassignments never join paths.

Clustering partitions by route/direction/pattern/shape and 150 m departure bins,
checks departure/rejoin within 150 m, and uses ordered Fréchet distance within 100 m
for every member pair. Prefix matching allows incomplete observations; a prefix
compatible with multiple completed corridors does not vote for either. Materially
different corridors remain independent clusters. Representative geometry is an
observed medoid, with 8 m endpoint-preserving simplification; it is not concatenated
or averaged into unobserved turns. There is no road/track snapping or stop inference.

Confidence rules are explicit:

- `candidate`: confirmed 30D episode evidence, insufficient repetition.
- `likely`: at least two vehicles or three completed episodes, without sufficient
  anchored completed evidence for confirmation.
- `confirmed`: at least two different vehicles with completed, departure-anchored
  episodes, or three separate such completed episodes (including one vehicle).

Duplicate polls cannot increase episode counts. Active, safely scoped detour or
construction alerts strengthen the separate `alertSupported` flag only when exact
30C affected segments overlap. Alerts cannot replace independent vehicle evidence.
IDs persist through compatible geometry updates using a retained spatial anchor;
materially different paths get different IDs. Evidence expires after 30 minutes;
three credible scheduled traversals shorten stale support to five minutes, and an
ended qualifying alert shortens it to ten. Fresh movement can renew support.

Bounds: 500 episodes, 120 points/30 minutes per episode, 24 contributing episodes
per cluster, 12 clusters per route, 200 total clusters, 122 geometry points, 256
comparison vertices. Restart JSON is limited to 16 MiB, with at most 8 MiB devoted
to episode evidence. Overlong/discontinuous episodes or oversized comparison paths
are rejected rather than simplified across unseen blocks. Counts describe retained
support, not total fleet activity.

```sh
npm run update:ttc:vehicles                    # shared live detection + inference
npm run test:ttc:diversions:live                # four polls + developer GeoJSON
npm run update:ttc:vehicles -- --infer-only --geojson .cache/ttc/diversions.geojson
npm run fixture:ttc:diversions                 # offline protobuf → static → inference
npm run test:ttc                              # deterministic 30A–30E tests
```

`--infer-only` reads the existing Story 30D state, uses the reference clock and static
index, and does not fetch vehicles or alerts. Stale input exports unavailable, not
fresh evidence. The offline fixture writes to `.cache/ttc/diversion-fixture/`, isolated
from live evidence; its GeoJSON includes scheduled shape, affected scheduled segment,
individual episodes, inferred path and projected endpoints. Re-running it starts fresh and deterministically reproduces
the same episode IDs. Use `TTC_DIVERSION_FIXTURE_DIR` to choose another output directory.
Existing `--fixture`/`--static-fixture` options also run inference on custom sequences.

The existing Concourse vehicle task caches inference alongside detection and exports
`ttc-vehicle-evidence/diversions.json`. No separate pipeline or incident-ETL dependency
was added. The GitHub fallback uploads both compact artifacts with one-day retention;
it restores bounded vehicle/inference state from the Actions cache so evidence can
continue between runs, but a cold cache cannot assume cross-run continuity. Four polls
alone usually cannot establish completed departure-to-rejoin evidence. Cold starts never
fabricate confirmation. See [the Story 30E validation report](docs/story-30e-validation.md)
for algorithms, diagnostics, limitations and validation results.

### Story 30F — TTC disruption UI

The Travel section now includes construction/detour alerts from `ttcAlerts`, with
human-readable GTFS route names, affected stops, official alert text and active
periods. Nearby alerts sort first when a location is selected; unmapped alerts stay
available and are explicitly labelled citywide. Other TTC service alerts retain
nearby support, but the same stable ID is not repeated in nearby, citywide and
construction cards. On mobile Map mode, the TTC content moves into the existing
bottom sheet; Calls mode and desktop use the Travel section. Selecting a path opens
that same disruption, and selecting an emergency incident clears TTC selection.

- **Dashed amber**: the affected section of the normal scheduled route. Only an
  exact route correlation with projected Story 30C geometry is displayed.
- **Solid teal**: a confirmed temporary path, labelled **Observed by SirenTO**.
  Observed TTC diversion geometry is inferred by SirenTO from multiple vehicle
  trajectories and is not TTC-published geometry.
- One contextual checkbox controls the TTC geometry group. It is session-only,
  defaults on, and disappears when no geometry exists. The existing legend gains
  conditional TTC entries. No extra floating map control or stop-marker cloud is
  introduced. Both line types have distinct dark/light styling and 24 px hit paths.

`src/ttc/presentation.js` owns the browser presentation contract. Each stable alert
has arrays of routes, stops, scheduled parts and confirmed diversion parts, plus
alert copy, periods, geographic context and freshness. Components never join raw
trip IDs or recalculate confidence. Multiple backend diversion identities remain
separate even when they share a route/direction. Direction IDs are not translated
into guessed east/west labels: current metadata does not supply those labels.

`src/ttc/map-layer.js` owns a dedicated pane at z-index 440, below road closures
(450) and emergency markers. A Map keyed by alert ID, kind and part ID retains each
visible line and its transparent hit line. Geometry is converted only when changed;
styles update on selection. Theme changes use CSS, toggles hide the pane, and pan,
zoom and sheet/view changes do not rebuild TTC paths. Geometry fetches run beside
incident loading and never hold up emergency calls. Mobile framing reserves space
for the bottom sheet. A 30-second expiry check runs independently of fetch success;
freshness text updates without rebuilding unchanged cards.

An alert without observed geometry remains a useful official notice with stops and
scheduled sections, plus “No observed diversion route available yet.” Candidate and
likely paths are hidden. An unavailable/stale observed source hides only observed
paths; official alerts and scheduled sections remain until their own validity or
one-hour cache limit expires. Observations require a successful artifact checked
within two minutes, a last observation within 30 minutes, and an unexpired backend
`expiresAt`. An unavailable official source is labelled with its last successful
update. A successful empty construction feed leaves no extra panel or zero counter.

The new public `data/ttc-diversions.json` on the **data branch** is an allow-listed
projection of the separate Story 30E output. `scripts/publish-ttc-geometry.js` drops
all raw boundary evidence, vehicle data and confidence diagnostics. The single
`update-sirento` writer (Concourse job and GitHub workflow) publishes this file
together with `data/current.json` in one fast-forward push, so no two writers can race.
No polling workload was added to the incident ETL. These workflow changes require
normal code promotion/pipeline configuration before production can serve the new
artifact. A missing artifact is handled as unavailable, not as an incident failure.

Generate the frontend fixture from the same two-vehicle protobuf trajectory used
by Story 30E:

```sh
npm run fixture:ttc:ui
python3 -m http.server 8765 --bind 127.0.0.1
```

Open `http://127.0.0.1:8765/?mobileAuditFixture=many&ttcFixture=confirmed`.
`ttcFixture` also accepts `alert-only`, `multiple`, `expired`, `unavailable` and
`empty`. These flags are inert outside loopback. The checked-in compact JSON fixture
contains no vehicle histories; refresh timestamps are rebased at load time. Combine
with `mobileAuditSheet=expanded`, `mobileAuditView=calls` and the existing road and
police-boundary fixture options for regression testing.

`test/ttc-ui.test.js` covers the real backend-to-frontend fixture, confidence and
expiry policies, source failures, multi-part/multi-route identity, safe geometry,
nearby context, updates and 100 layer-reuse cycles. The feature-specific real-browser
suite uses the locally installed Playwright test tooling described in
[Rendered-browser regression tests](#rendered-browser-regression-tests):

```sh
# Start the local server above, then use Playwright's installed Chromium:
node scripts/ttc-ui-browser.js
# Optional environment overrides: PLAYWRIGHT_MODULE (absolute module path),
# CHROMIUM_EXECUTABLE, TTC_UI_URL, TTC_VISUAL_OUTPUT.
```

It checks 320/375/390/430/768/1440 px, both themes, alert-only and observed states,
multiple disruptions, live selection/expiry, existing incidents, road/boundary
coexistence, and repeated theme/Map/Calls/sheet/zoom/visibility transitions. Screenshots
and results go to `.cache/ttc-ui-visual`. See `docs/story-30f-validation.md` for the
implementation and validation report, including limits of desktop-emulated mobile QA.

### Story 30G — final coverage and release validation

The strict coverage gate is restored to 100% lines, branches and functions in both
required timezones. TTC details explicitly name the observed diversion and its
SirenTO provenance; the single conditional control reads “TTC disruptions.” Invalid
active-period dates are omitted safely. The multiple fixture pairs 504 King with an
alert-only 501 Queen disruption. The app-shell cache and asset versions are updated.
See [Story 30G validation](docs/story-30g-validation.md) for exact coverage gaps,
validation totals, production publication checks, physical-device acceptance and
remaining release gates. A passing local suite does not mean the live feature has
been deployed.
