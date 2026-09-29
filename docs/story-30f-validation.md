# Story 30F — TTC detour UI integration

Implemented on `dev`, fast-forwarded from `origin/dev` before work. The existing
uncommitted Story 30A–30E work was preserved. No commit, push, live pipeline update,
or production deployment was performed. `data/current.json` is unchanged.

1. **Files changed for 30F.** `app.js`, `index.html`, `styles.css`,
   `service-worker.js`, `src/disruptions/ui.js`, `src/ttc/presentation.js`,
   `src/ttc/map-layer.js`, `src/ttc/ui.js`, `src/ttc/fixture.js`,
   `src/ttc/diversion-inference.js`, `scripts/publish-ttc-geometry.js`,
   `scripts/ttc-ui-fixture.js`, `scripts/ttc-ui-browser.js`,
   `test/ttc-ui.test.js`, `test/disruptions.test.js`,
   `test/mobile-compositing.test.js`, `test/dark-map.test.js`, `test/fixtures/ttc-diversions/frontend.js`,
   `test/fixtures/ttc-diversions/frontend.json`, `package.json`,
   `eslint.config.js`, `.github/workflows/ttc-vehicles.yml`,
   `concourse/pipeline.yml`, `README.md`, and this report. Other dirty/untracked
   files predate this task. Some listed files already contained backend work;
   their prior changes were retained.
2. **UX approach.** One expandable construction/disruption card per stable alert,
   containing official text, named routes/stops, affected scheduled sections and
   any confirmed observed paths. Alerts with mapped geography sort by distance
   from the selected area; unresolved notices remain explicitly citywide.
3. **Prior UI consolidation.** Existing nearby and citywide service-alert lists
   no longer repeat the same alert; alerts represented by the new backend model
   are removed from the legacy lists while they remain valid. Other TTC service
   notices retain existing behavior. No separate “observed routes” panel exists.
4. **Presentation contract.** Stable alert ID, title/description, routes[], stops[],
   scheduled[], diversions[], cause, periods, geography and freshness. Geometry
   parts have stable IDs and provenance. UI code does not match trips, process
   vehicle histories, or compute confidence. Numeric direction IDs are never
   guessed into compass directions. Distinct direction/branch path identities
   remain separate; multiple paths receive individual labels.
5. **Map architecture.** Dedicated pane at z-index 440 and one owned layer group,
   below road closures at 450 and emergency markers/clusters/user location.
   Each part owns a visible line and a transparent 24 px hit line. No stop-marker
   cloud, per-GPS DOM, pan listener, or new map instance.
6. **Scheduled styling.** Dashed amber/brown in light mode; pale amber in dark.
   Only exact route correlation and projected Story 30C segments are drawn.
   Ambiguous or malformed geometry is suppressed conservatively.
7. **Observed styling.** Solid teal in light mode; bright cyan in dark. Selected
   lines widen. Solid versus dashed preserves meaning beyond color alone.
8. **Provenance.** “Observed by SirenTO” and “This is not TTC-published geometry.”
   Observed TTC diversion geometry is inferred by SirenTO from multiple vehicle
   trajectories and is not TTC-published geometry. The detail also shows when
   the path was last observed. Future `ttc-official` provenance has separate copy.
9. **Confidence policy.** Only backend `confirmed` paths are shown. Candidate and
   likely states are excluded; raw thresholds, trip IDs and evidence counts are
   absent from the UI. Expiry comes from backend `expiresAt` plus source freshness.
10. **Controls.** One contextual, default-on, session-only TTC geometry checkbox
    beside the disruption content. It disappears without geometry and adds no
    floating map control or stored preference migration.
11. **Legend.** Existing legend gains conditional “TTC affected route” and
    “Observed TTC diversion” entries. Visibility follows the checkbox and actual
    geometry; future official provenance changes the label appropriately.
12. **Mobile.** The same TTC DOM moves into the existing Map bottom sheet and back
    to Travel in Calls mode. Selection uses the shared road-detail surface, clears
    incident selection, and offers a focusable Back control. Selected route framing
    accounts for sheet overlap. Controls retain 44 px touch targets and wrapping.
13. **Desktop.** The existing Travel section contains expandable TTC details. Map
    selection opens/focuses the corresponding card, without creating duplicate
    desktop detail cards or redesigning unrelated controls.
14. **Selection synchronization.** Summary expansion highlights the disruption;
    Show on map frames its parts and opens mobile detail. Hit-line selection opens
    the same card/detail. Incident/closure selection clears TTC highlighting;
    disabling TTC or removing the alert clears the selected detail. Focus returns
    to the summary after Back. Geometry expiry preserves the official notice.
15. **Zero-data behavior.** A successful empty construction feed hides its content,
    checkbox and legend entries. Existing non-construction service notices are
    still available. No new permanent zero counter or empty panel.
16. **Unavailable/stale behavior.** Official cache is labelled with source state
    and last success, retained for at most one hour and only within active periods.
    Observed geometry requires an OK artifact checked within two minutes, evidence
    within 30 minutes, and unexpired backend expiry. A 30-second timer enforces
    removal even after incident fetch failure. Missing geometry is normal alert-only
    copy; it does not erase official or scheduled information.
17. **Lifecycle/deduplication.** Keys combine alert ID, geometry kind and part ID.
    Existing Leaflet objects are updated in place; unchanged coordinates are not
    decoded again. CSS handles themes; pane visibility retains paths across toggles.
    Expired parts remove both line objects/listeners. Map replacement disposes the
    prior group. Freshness-only updates avoid rebuilding cards.
18. **Deterministic fixture.** `npm run fixture:ttc:ui` runs the real Story 30E
    two-vehicle protobuf sequence through correlation, detection, inference and the
    public projector. The checked-in compact fixture drives browser and unit tests.
    Loopback-only `ttcFixture=confirmed|alert-only|multiple|expired|unavailable|empty`
    rebases timestamps. No production fixture control or live vehicle markers.
19. **Automated tests.** Eleven new unit tests cover backend fixture conversion,
    confidence/expiry/source states, multiple routes/paths/disruptions, invalid and
    ambiguous geometry, geographic context, public-data redaction, updates, and
    100 refresh/selection/visibility cycles. Existing list tests now assert
    deduplication; service-worker version assertions were updated.
20. **Responsive/visual validation.** Chromium at 320, 375, 390, 430, 768 and 1440 px,
    light and dark themes, no document horizontal overflow. Confirmed, alert-only,
    multiple, expired, unavailable and empty fixtures exercised. Screenshots reviewed
    for mobile/desktop, distinct lines and road/emergency/boundary coexistence.
    This is desktop browser emulation, not a physical iPhone/Safari toolbar test.
21. **Map stress.** The checked-in optional Playwright suite performs 12 theme,
    layer, zoom, sheet and Map/Calls cycles per width, 20 real renderer refreshes,
    map-to-detail and incident selection, and removal of observed paths while the
    alert remains. Stable SVG identities and layer counts are asserted. Unit tests
    additionally perform 100 cycles without new Leaflet allocations.
22. **Performance.** No whole-map rebuilds or TTC pan/zoom recomputation. Geometry
    fetches do not block incident snapshot rendering. The 1,212-incident fixture
    retained the same TTC SVG paths through toggles/themes/views. Measured browser
    long-task observations are recorded with the screenshots (117 ms maximum in
    the complete six-width run); these are local
    regression observations, not a mobile-device performance guarantee.
23. **Validation.** Docker UTC and America/Los_Angeles suites: 386/386 each. Story
    38G regression suite: 96/96. Live-source integration: 8/8. Python: 7/7.
    All 656 tests in the combined CI-wide suite pass. JavaScript/Python lint,
    browser/module syntax, and `git diff --check` pass. **The separate strict CI
    coverage gate fails:** 99.85% lines, 98.06% branches, 99.44% functions, versus
    its required 100% for each. This prevents automatic promotion. Uncovered
    branches include unchanged Story 30 backend modules and the new adapter;
    browser-exercised UI coverage is not merged into Node's report. The gate was
    not weakened or bypassed.
    `data/current.json` has no working-tree changes. Browser results and screenshots
    accompany this report outside the source tree.
24. **Follow-up.** Close the coverage gap before requesting promotion. After
    authorized normal promotion, update the Concourse pipeline
    and verify the new public `data/ttc-diversions.json` artifact. The independent
    Concourse and GitHub jobs now contain publication wiring, but were not deployed
    by this task. Concurrent data-branch writes fail fast-forward safely and retry
    on the next scheduled cycle. Validate on physical iOS Safari, and inspect a
    genuine confirmed diversion when live evidence becomes available. Current live
    evidence is not represented as having confirmed a diversion.

## Reproduction

See the README Story 30F section. The optional `scripts/ttc-ui-browser.js` accepts
`PLAYWRIGHT_MODULE`, `CHROMIUM_EXECUTABLE`, `TTC_UI_URL`, and `TTC_VISUAL_OUTPUT`.
It uses the existing mobile audit fixture with roads, boundaries and emergency calls.
Its default output folder is ignored `.cache/ttc-ui-visual`.

## Saved visual evidence

Final screenshots and measured results: `/Users/nitinravindran/.codex/visualizations/2026/09/28/01a0ea38-d604-7ce3-9b78-b2c7c142c850/story-30f`.

- [Mobile, dark theme](/Users/nitinravindran/.codex/visualizations/2026/09/28/01a0ea38-d604-7ce3-9b78-b2c7c142c850/story-30f/390-dark.png)
- [Desktop, light theme](/Users/nitinravindran/.codex/visualizations/2026/09/28/01a0ea38-d604-7ce3-9b78-b2c7c142c850/story-30f/1440-light.png)
- [Machine-readable browser results](/Users/nitinravindran/.codex/visualizations/2026/09/28/01a0ea38-d604-7ce3-9b78-b2c7c142c850/story-30f/results.json)
