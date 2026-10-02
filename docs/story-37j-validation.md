# Story 37J — Audit and compact remaining pre-map mobile stack

## Scope

Audit and compact the remaining pre-map mobile stack at `max-width: 680px`,
especially the top bar, Quick Look, and search/filter surfaces, without changing
established ownership or interaction models. This is a narrowly scoped CSS
compaction follow-up to Stories 37E–37I.

## Baseline measurements

Measured with headless Chromium at 390×844, Map view, collapsed bottom sheet,
using the deterministic loopback fixture
`?mobileAuditFixture=many&mobileAuditView=map&mobileAuditLocation=current&mobileAuditRadius=toronto&mobileAuditSheet=collapsed`.

| Region | Before | After |
| --- | ---: | ---: |
| Top bar | 61 px | 57 px |
| Quick Look (`nearby-feature`) | 275 px | 254 px |
| Search/Filters controls card | 64 px | 60 px |
| Radius controls | 108 px | 108 px |
| **Map top offset** | **548 px** | **519 px** |

Net recovery: **29 px** of vertical space before the map.

## Changes

All changes are scoped to `@media (max-width: 680px)` in `styles.css`:

- `.topbar` `min-height` 60 px → 56 px and vertical `padding` 8 px → 6 px.
- `.controls-card` `padding` 8 px → 6 px.
- `.nearby-feature .section-kicker` now uses the existing visually-hidden pattern
  (`position: absolute; width: 1px; height: 1px; overflow: hidden;
  clip-path: inset(50%); white-space: nowrap;`), matching the established
  `.radius-controls > .section-kicker` and `.nearby-summary-head` mobile patterns.
- `.nearby-options` disclosure chrome `margin-top`/`padding-top` 7 px → 4 px.

Preserved: all 44 px touch targets, the primary nearby action, location fallback,
Quick Look disclosure behavior, and the unchanged desktop layout.

## Verification

- Consistent at 320, 375, 390, and 430 px widths; desktop (768, 1440 px) unchanged.
- Map/Calls view toggle works; no page errors.
- `test/mobile-pre-map-stack.test.js` updated to assert the new intentional values
  and the new Quick Look kicker/disclosure rules, including the unchanged desktop
  `.nearby-feature .section-kicker` rule.

## Automated validation

| Check | Result |
| --- | --- |
| Docker unit tests, UTC | 425/425 |
| Docker unit tests, America/Los_Angeles | 425/425 |
| Combined coverage suite | 100.00% lines / 100.00% branches / 100.00% functions |
| Live source integration | 8/8 |
| Python | Pass |
| JavaScript lint and browser/module syntax | Pass |
| `git diff --check` and staged whitespace checks | Pass |
| Generated snapshot unchanged | Pass |

## Status

**IMPLEMENTED / AWAITING VALIDATION.** Automated gates pass. Physical iPhone
Safari/Brave validation of the compacted pre-map stack remains outstanding, so
this story is not marked fully complete.
