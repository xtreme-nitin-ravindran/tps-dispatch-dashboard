import test from "node:test";
import assert from "node:assert/strict";

import {
  INCIDENT_LOAD_STATE_KEY,
  INCIDENT_LOAD_READY,
  DEFAULT_FIXTURE_READY_TIMEOUT_MS,
  isFixtureReady,
  readIncidentLoadState,
  describeFixtureState,
  awaitFixtureReady
} from "../scripts/lib/browser-fixture.js";

// Deterministic offline coverage for the shared rendered-browser fixture
// readiness helper (scripts/lib/browser-fixture.js). These tests exercise the
// readiness contract and diagnostics without launching a browser.

// --- constants -------------------------------------------------------------

test("the readiness contract uses the documented dataset key and value", () => {
  assert.equal(INCIDENT_LOAD_STATE_KEY, "incidentLoadState");
  assert.equal(INCIDENT_LOAD_READY, "ready");
});

test("the default timeout is longer than Playwright's 30s default", () => {
  assert.ok(DEFAULT_FIXTURE_READY_TIMEOUT_MS > 30000, `default timeout ${DEFAULT_FIXTURE_READY_TIMEOUT_MS} is not longer than 30000ms`);
});

// --- browser-side readers (stubbed document) -------------------------------

// Runs `fn` with a stubbed global `document` whose documentElement carries the
// given dataset, so the browser-side callbacks are exercised directly.
function withStubDocument(dataset, fn) {
  const previous = globalThis.document;
  globalThis.document = { documentElement: { dataset } };
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = previous;
    }
  }
}

test("isFixtureReady is true only when the state is ready", () => {
  assert.equal(withStubDocument({ incidentLoadState: "ready" }, isFixtureReady), true);
  assert.equal(withStubDocument({ incidentLoadState: "loading" }, isFixtureReady), false);
  assert.equal(withStubDocument({}, isFixtureReady), false);
});

test("readIncidentLoadState returns the value or null when missing", () => {
  assert.equal(withStubDocument({ incidentLoadState: "stale" }, readIncidentLoadState), "stale");
  assert.equal(withStubDocument({}, readIncidentLoadState), null);
});

// --- describeFixtureState --------------------------------------------------

test("describeFixtureState distinguishes a missing state", () => {
  assert.match(describeFixtureState(null), /state is missing/);
});

test("describeFixtureState reports the current non-ready value", () => {
  for (const value of ["loading", "stale", "unavailable", "error"]) {
    const message = describeFixtureState(value);
    assert.match(message, new RegExp(`state is "${value}"`));
    assert.match(message, /expected "ready"/);
  }
});

// --- awaitFixtureReady -----------------------------------------------------

// A minimal Playwright-like page stub. `waitForFunction` models Playwright's
// internal polling: it resolves once the fixture reaches `ready` (after
// `readyAfter` polls) and only throws a TimeoutError when it never does.
// `evaluate` returns the current state. Records the options it was given so
// timeout forwarding can be asserted.
function stubPage({ state = "ready", readyAfter = 0, url = "http://127.0.0.1:8765/?fixture", evaluateError = null } = {}) {
  let polls = 0;
  const calls = { waitForFunction: [], evaluate: 0 };
  return {
    calls,
    url: () => url,
    async waitForFunction(_fn, _arg, options) {
      calls.waitForFunction.push(options);
      polls += 1;
      if (polls <= readyAfter) {
        const error = new Error("Timeout 30000ms exceeded.");
        error.name = "TimeoutError";
        throw error;
      }
      return true;
    },
    async evaluate() {
      calls.evaluate += 1;
      if (evaluateError) throw evaluateError;
      return state;
    }
  };
}

test("awaitFixtureReady returns promptly when the fixture is already ready", async () => {
  const page = stubPage({ state: "ready" });
  await awaitFixtureReady(page);
  // Exactly one wait call, no retry, and no state read on success.
  assert.equal(page.calls.waitForFunction.length, 1);
  assert.equal(page.calls.evaluate, 0);
});

test("awaitFixtureReady forwards the documented default timeout", async () => {
  const page = stubPage({ state: "ready" });
  await awaitFixtureReady(page);
  assert.deepEqual(page.calls.waitForFunction[0], { timeout: DEFAULT_FIXTURE_READY_TIMEOUT_MS });
});

test("awaitFixtureReady forwards a caller-specified timeout", async () => {
  const page = stubPage({ state: "ready" });
  await awaitFixtureReady(page, { timeout: 1234 });
  assert.deepEqual(page.calls.waitForFunction[0], { timeout: 1234 });
});

test("awaitFixtureReady resolves after a loading -> ready transition", async () => {
  // Playwright's waitForFunction polls internally: the predicate is false while
  // the fixture is loading and becomes true once it is ready. The helper issues
  // a single wait call and resolves when that wait succeeds.
  const page = stubPage({ state: "ready", readyAfter: 0 });
  await awaitFixtureReady(page);
  assert.equal(page.calls.waitForFunction.length, 1);
  assert.equal(page.calls.evaluate, 0);
});

test("awaitFixtureReady reports the URL and current state on timeout", async () => {
  const page = stubPage({ state: "loading", readyAfter: Infinity, url: "http://127.0.0.1:8765/?mobileAuditFixture=many" });
  await assert.rejects(
    () => awaitFixtureReady(page, { timeout: 5000 }),
    error => {
      assert.match(error.message, /did not become ready within 5000ms/);
      assert.match(error.message, /http:\/\/127\.0\.0\.1:8765\/\?mobileAuditFixture=many/);
      assert.match(error.message, /state is "loading"/);
      return true;
    }
  );
});

test("awaitFixtureReady distinguishes a missing dataset state on timeout", async () => {
  const page = stubPage({ state: null, readyAfter: Infinity });
  await assert.rejects(
    () => awaitFixtureReady(page),
    /state is missing/
  );
});

test("awaitFixtureReady preserves the underlying error as the cause", async () => {
  const page = stubPage({ state: "error", readyAfter: Infinity });
  await assert.rejects(
    () => awaitFixtureReady(page),
    error => {
      assert.ok(error.cause instanceof Error, "cause was not preserved");
      assert.equal(error.cause.name, "TimeoutError");
      return true;
    }
  );
});

test("awaitFixtureReady does not mask the readiness failure when the state read fails", async () => {
  const page = stubPage({ state: "loading", readyAfter: Infinity, evaluateError: new Error("page closed") });
  await assert.rejects(
    () => awaitFixtureReady(page),
    error => {
      // The readiness failure is reported, not the secondary evaluate error.
      assert.match(error.message, /did not become ready/);
      assert.match(error.message, /state is missing/);
      assert.ok(error.cause instanceof Error);
      return true;
    }
  );
});

test("awaitFixtureReady reports an unknown url when the page exposes no url()", async () => {
  const page = stubPage({ state: "loading", readyAfter: Infinity });
  delete page.url;
  await assert.rejects(
    () => awaitFixtureReady(page),
    error => {
      assert.match(error.message, /at \(unknown url\)/);
      assert.match(error.message, /state is "loading"/);
      return true;
    }
  );
});
