# Regression testing

[Documentation home](../README.md)

Regression tests protect important behavior when the application changes.

## What and why

- Keep a test for each significant bug fix so the same failure cannot silently return.
- Protect data meanings: zero results, unavailable sources, and stale or retained data must remain distinct.
- Preserve bounded map behavior, selected-incident state, cache freshness, and the distinction between official TTC data and SirenTO observations.
- Full coverage does not replace these checks: a test must assert the behavior that matters.

## How

- Reproduce the failing input or interaction with a deterministic fixture; the test should fail before the fix and pass afterward.
- Assert observable results. Use Playwright for layout and interaction, and keep fixtures disabled outside local test environments.
- Cover repeated selection, filtering, zooming, and Map/Calls transitions without stale or duplicate map connectors. Preserve the existing limits: 12 expanded incidents/connectors and a 96 px fan-out radius. Exercise a 100+ incident cluster and mobile sheet states with both map overlays enabled.
- Keep unresolved TTC alerts visible without inventing geometry. Scheduled-route context is not a confirmed diversion; observed paths do not require an invented official advisory association. A detour already in the current schedule may produce no inferred diversion.
- When changing cached frontend assets, advance asset and cache versions together, verify references agree, and confirm obsolete caches are removed. Use:

  ```bash
  npm run bump:asset-version -- --asset release-tag --cache sirento-shell-v100
  ```

  Choose a new asset tag and a cache version higher than the current one. Invalid input leaves files unchanged.

- Run the relevant regressions and required [pre-push checks](../README.md#pre-push-checklist). Change an existing expectation only when the intended behavior changes, updating tests and documentation together.

See [test inventory](validation.md#test-inventory) and [browser testing](browser-tests.md) for suites and commands.
