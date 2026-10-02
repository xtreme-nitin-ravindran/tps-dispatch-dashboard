# Story 37K — Hide redundant Police division / History labels on mobile

## Scope

Hide the redundant **Police division** and **History** labels inside the mobile
Filters disclosure so each select fills its row, while keeping the labels in the
markup for accessibility and preserving the desktop label styling. This is a
narrowly scoped CSS follow-up to Stories 37E–37J.

## Rationale

Inside the collapsed mobile Filters disclosure, the two secondary-filter selects
already sit under a labelled Filters control, so the per-row labels are redundant
and consume horizontal space. Removing them visually lets each select use the full
row width without changing ownership, interaction, or the desktop layout.

## Changes

Scoped to `@media (max-width: 680px)` in `styles.css`:

- `.control-group.secondary-filter-control` collapses its grid to a single column
  (`grid-template-columns: minmax(0, 1fr)`), so the select fills the row.
- `.control-group.secondary-filter-control > label` uses the existing
  visually-hidden pattern (`position: absolute; width: 1px; height: 1px;
  overflow: hidden; clip-path: inset(50%); white-space: nowrap;`), matching the
  established `.theme-control > span`, `.radius-controls > .section-kicker`, and
  `.nearby-feature .section-kicker` mobile patterns.

Preserved: the labels remain in the markup for screen readers, the desktop
`.control-group label` styling is unchanged, and all existing filter state,
ownership, and 44 px touch targets are untouched.

### Service-worker cache version

The CSS change alone did not take effect in the browser because the service
worker serves app-shell assets with `caches.match(request, { ignoreSearch: true })`,
which ignores the `styles.css?v=…` query string. The previously cached
`styles.css` therefore continued to be served, so the labels still appeared on
mobile. `CACHE_VERSION` in `service-worker.js` is advanced from
`sirento-shell-v40` to `sirento-shell-v41` so the stale cached stylesheet is
replaced on activation and the new rule is delivered.

## Verification

- `test/mobile-secondary-filters.test.js` adds a regression test asserting the
  mobile single-column grid, the visually-hidden label rule, the unchanged desktop
  `.control-group label` rule, and that both labels remain in `index.html`.
- `test/mobile-compositing.test.js` and `test/cluster-asset-versioning.test.js`
  assert the advanced `CACHE_VERSION`, so the cache version cannot drift backwards
  while the stylesheet changes.
- Desktop layout is unchanged because the new rules are inside the mobile media
  query only.

## Automated validation

| Check | Result |
| --- | --- |
| Docker unit tests, UTC | Pass |
| Docker unit tests, America/Los_Angeles | Pass |
| Combined coverage suite | 100.00% lines / 100.00% branches / 100.00% functions |
| Live source integration | 8/8 |
| Python | Pass |
| JavaScript lint and browser/module syntax | Pass |
| `git diff --check` and staged whitespace checks | Pass |
| Generated snapshot unchanged | Pass |

## Status

**IMPLEMENTED / AWAITING VALIDATION.** Automated gates pass. Physical iPhone
Safari/Brave validation of the compacted mobile Filters disclosure remains
outstanding, so this story is not marked fully complete.

