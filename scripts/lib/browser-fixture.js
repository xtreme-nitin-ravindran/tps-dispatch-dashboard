// Shared rendered-browser fixture-readiness helper.
//
// Every deterministic rendered-browser regression loads the same audit fixture
// and must wait until the incident data has finished loading before it measures
// geometry. That wait was duplicated verbatim across the mobile and desktop
// scripts:
//
//   await page.waitForFunction(
//     () => document.documentElement.dataset.incidentLoadState === 'ready'
//   );
//
// This module centralizes that single readiness contract. It is test-only: it
// is imported exclusively by the `scripts/*-browser.js` regressions and has no
// effect on production behavior.
//
// Design notes:
//   - `awaitFixtureReady(page, options?)` returns promptly when the fixture is
//     already ready (the first poll resolves immediately).
//   - It waits for `document.documentElement.dataset.incidentLoadState` to equal
//     `"ready"`.
//   - The default timeout is deliberately longer than Playwright's 30s default
//     because the deterministic audit fixture is large and a cold CI browser can
//     take longer than 30s to reach `ready`.
//   - A caller may override the timeout where genuinely useful.
//   - On a timeout the helper performs a bounded readiness handshake: it reloads
//     the page and retries the readiness wait (default one retry). This corrects
//     a cold-start stall without increasing the global timeout, adding sleeps,
//     or rerunning the whole suite, and it never weakens the readiness contract.
//   - On failure the thrown error reports the page URL and the current
//     incident-load state, and distinguishes a missing state from values such as
//     `loading`, `stale`, `unavailable`, or `error`.
//   - The original Playwright error is preserved as the `cause` when possible.
//   - Page errors and unrelated failures are never swallowed or converted into
//     readiness timeouts: only the readiness wait itself is wrapped.
/* global document */

// The dataset key and ready value that define the deterministic fixture
// readiness contract.
export const INCIDENT_LOAD_STATE_KEY = 'incidentLoadState';
export const INCIDENT_LOAD_READY = 'ready';

// Documented default timeout. Longer than Playwright's 30s default so a cold
// browser loading the large deterministic audit fixture is not misreported as a
// readiness failure.
export const DEFAULT_FIXTURE_READY_TIMEOUT_MS = 60000;

// Bounded readiness handshake. A cold browser can occasionally stall the very
// first page load past the readiness budget (observed as a `fixture-ready`
// timeout on a cold run that passes on rerun). Rather than increasing the
// global timeout, `awaitFixtureReady` re-establishes the page load once and
// retries the readiness wait. The fixture must still reach `ready`, so no
// assertion is weakened; the retry is finite and scoped to the readiness stage.
export const DEFAULT_FIXTURE_READY_RETRIES = 1;

// Browser-side predicate: true once the incident fixture has finished loading.
// Exported so its behavior can be unit-tested directly with a stubbed
// `document`.
//
// NOTE: this function is serialized and evaluated inside the browser by
// `page.waitForFunction`, so it must be self-contained. It cannot reference the
// module-scope constants above; the dataset key and ready value are inlined and
// kept in sync with `INCIDENT_LOAD_STATE_KEY` / `INCIDENT_LOAD_READY`.
export function isFixtureReady() {
  return document.documentElement.dataset.incidentLoadState === 'ready';
}

// Browser-side reader: returns the current incident-load state (or null when the
// dataset attribute is absent). Exported so it can be unit-tested directly.
//
// NOTE: like `isFixtureReady`, this runs inside the browser via `page.evaluate`
// and must be self-contained, so the dataset key is inlined.
export function readIncidentLoadState() {
  const value = document.documentElement.dataset.incidentLoadState;
  return value === undefined ? null : value;
}

// Builds the diagnostic message for a readiness failure. Distinguishes a missing
// state from a present-but-not-ready value so the failure is actionable.
export function describeFixtureState(state) {
  if (state === null) {
    return 'incident-load state is missing (document.documentElement.dataset.incidentLoadState is undefined)';
  }
  return `incident-load state is "${state}" (expected "${INCIDENT_LOAD_READY}")`;
}

// Waits until the deterministic incident fixture reports `ready`.
//
// `page` is a Playwright Page. `options.timeout` overrides the default timeout
// (milliseconds). `options.retries` overrides the bounded readiness handshake:
// on a timeout the page is reloaded and the readiness wait is retried, up to
// that many times. Resolves as soon as the fixture is ready; rejects with a
// diagnostic error that preserves the underlying Playwright error as `cause`.
export async function awaitFixtureReady(page, options = {}) {
  const timeout = options.timeout ?? DEFAULT_FIXTURE_READY_TIMEOUT_MS;
  const retries = options.retries ?? DEFAULT_FIXTURE_READY_RETRIES;
  let attempt = 0;
  for (; ;) {
    try {
      await page.waitForFunction(isFixtureReady, undefined, { timeout });
      return;
    } catch (error) {
      // Bounded readiness handshake: a cold browser can stall the first load
      // past the budget. Re-establish the page load and retry the readiness
      // wait rather than increasing the global timeout. The fixture must still
      // reach `ready`, so no assertion is weakened.
      if (attempt < retries && typeof page.reload === 'function') {
        attempt += 1;
        await page.reload({ waitUntil: 'domcontentloaded' });
        continue;
      }
      const url = typeof page.url === 'function' ? page.url() : null;
      let state = null;
      try {
        state = await page.evaluate(readIncidentLoadState);
      } catch {
        // Reading the state is best-effort diagnostics only; never mask the
        // original readiness failure with a secondary evaluation error.
      }
      const message = `awaitFixtureReady: fixture did not become ready within ${timeout}ms at ${url || '(unknown url)'}: ${describeFixtureState(state)}`;
      throw new Error(message, { cause: error });
    }
  }
}
