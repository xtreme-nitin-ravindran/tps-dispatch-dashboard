# Browser tests and local fixtures

[Documentation home](../README.md)

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

The individual commands below retain their existing compatibility names; use
`npm run test:browser` to run the complete set without relying on those names.

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
[docs/mobile-focus-chrome.md](mobile-focus-chrome.md).
The TTC suite has a deliberate 61-second wait; the aggregate runner reports that expected
delay and does not depend on the GNU `timeout` command. Each suite uses loopback-only
deterministic fixtures. Environment overrides such as `PLAYWRIGHT_MODULE`,
`CHROMIUM_EXECUTABLE`, and suite-specific `*_UI_URL` values remain available for
nonstandard local installations and are not overwritten when explicitly set.

The runner and all six suites report timing spans including server readiness, Chromium launch,
navigation, fixture readiness, suite execution, and teardown where applicable.
Use these spans to identify the failing stage. For machine-readable summaries, run:

```bash
BROWSER_TIMING=json npm run test:browser
```

Fixture readiness requires
`document.documentElement.dataset.incidentLoadState === 'ready'`. By default it
allows 60 seconds per readiness attempt and reloads once before retrying a failed
readiness wait. It still requires `ready` before assertions run; this retry is scoped
to fixture startup. Helper tests that require a single failed attempt must pass
`{ retries: 0 }`. For asynchronous UI assertions, use bounded waits for the expected
rendered state instead of fixed sleeps.

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
specific reports still require the physical-device validation on the reported browser and device.

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

Without a configured Watch API URL, no watch or subscription data is sent.
Set the public VAPID key through the `sirento-vapid-public-key` meta element and the
API URL through `sirento-watch-api-base-url` before enabling delivery in production. `pushsubscriptionchange` only
notifies open clients; foreground `getSubscription()` reconciliation is authoritative
when reconciling replacement subscriptions.

