import test from "node:test";
import assert from "node:assert/strict";

import {
  TIMING_FORMAT_ENV,
  resolveTimingFormat,
  createBrowserTiming
} from "../scripts/lib/browser-timing.js";

// Deterministic offline coverage for the shared rendered-browser timing helper
// (scripts/lib/browser-timing.js). These tests exercise span recording, failure
// marking, summary shape, and formatting without launching a browser.

// A controllable clock so durations are exact and deterministic.
function fakeClock(values) {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)];
    index += 1;
    return value;
  };
}

// --- resolveTimingFormat ---------------------------------------------------

test("resolveTimingFormat defaults to text", () => {
  assert.equal(resolveTimingFormat({}), "text");
  assert.equal(resolveTimingFormat({ [TIMING_FORMAT_ENV]: "" }), "text");
  assert.equal(resolveTimingFormat({ [TIMING_FORMAT_ENV]: "text" }), "text");
  assert.equal(resolveTimingFormat({ [TIMING_FORMAT_ENV]: "verbose" }), "text");
});

test("resolveTimingFormat selects json only for an explicit json value", () => {
  assert.equal(resolveTimingFormat({ [TIMING_FORMAT_ENV]: "json" }), "json");
  assert.equal(resolveTimingFormat({ [TIMING_FORMAT_ENV]: "JSON" }), "json");
  assert.equal(resolveTimingFormat({ [TIMING_FORMAT_ENV]: "  json  " }), "json");
});

test("resolveTimingFormat tolerates a missing environment", () => {
  assert.equal(resolveTimingFormat(undefined), "text");
});

test("resolveTimingFormat defaults to the process environment when called with no argument", () => {
  // Exercises the default-parameter branch (globalThis.process?.env || {}).
  const previous = process.env[TIMING_FORMAT_ENV];
  try {
    delete process.env[TIMING_FORMAT_ENV];
    assert.equal(resolveTimingFormat(), "text");
    process.env[TIMING_FORMAT_ENV] = "json";
    assert.equal(resolveTimingFormat(), "json");
  } finally {
    if (previous === undefined) delete process.env[TIMING_FORMAT_ENV];
    else process.env[TIMING_FORMAT_ENV] = previous;
  }
});

test("resolveTimingFormat falls back to an empty environment when process is absent", () => {
  // Exercises the `|| {}` fallback branch: no process, so no env to read.
  const previous = globalThis.process;
  try {
    globalThis.process = undefined;
    assert.equal(resolveTimingFormat(), "text");
  } finally {
    globalThis.process = previous;
  }
});

// --- time() ----------------------------------------------------------------

test("time records a span with the elapsed duration", async () => {
  const timing = createBrowserTiming({ now: fakeClock([100, 250]) });
  const result = await timing.time("server-ready", async () => "ok");
  assert.equal(result, "ok");
  assert.deepEqual(timing.entries(), [{ name: "server-ready", durationMs: 150, failed: false }]);
});

test("time records a failed span and rethrows the original error", async () => {
  const timing = createBrowserTiming({ now: fakeClock([0, 40]) });
  const boom = new Error("did not become ready");
  await assert.rejects(
    () => timing.time("fixture-ready", async () => { throw boom; }),
    error => error === boom
  );
  assert.deepEqual(timing.entries(), [{ name: "fixture-ready", durationMs: 40, failed: true }]);
});

test("time records a span for a synchronous return value", async () => {
  const timing = createBrowserTiming({ now: fakeClock([5, 5]) });
  const result = await timing.time("noop", () => 42);
  assert.equal(result, 42);
  assert.deepEqual(timing.entries(), [{ name: "noop", durationMs: 0, failed: false }]);
});

test("time records spans in completion order", async () => {
  const timing = createBrowserTiming({ now: fakeClock([0, 10, 10, 30]) });
  await timing.time("first", async () => { });
  await timing.time("second", async () => { });
  assert.deepEqual(timing.entries().map(s => s.name), ["first", "second"]);
});

// --- start() / end() -------------------------------------------------------

test("start and end record a manual span", () => {
  const timing = createBrowserTiming({ now: fakeClock([1000, 1250]) });
  const startedAt = timing.start("chromium-launch");
  assert.equal(startedAt, 1000);
  const span = timing.end("chromium-launch");
  assert.deepEqual(span, { name: "chromium-launch", durationMs: 250, failed: false });
  assert.deepEqual(timing.entries(), [span]);
});

test("end marks a manual span as failed", () => {
  const timing = createBrowserTiming({ now: fakeClock([0, 5]) });
  timing.start("page-goto");
  const span = timing.end("page-goto", { failed: true });
  assert.equal(span.failed, true);
});

test("end ignores a span that was never started", () => {
  const timing = createBrowserTiming({ now: fakeClock([0]) });
  assert.equal(timing.end("missing"), null);
  assert.deepEqual(timing.entries(), []);
});

test("end defaults to a non-failed span when no options are given", () => {
  const timing = createBrowserTiming({ now: fakeClock([0, 5]) });
  timing.start("a");
  const span = timing.end("a");
  assert.equal(span.failed, false);
});

test("createBrowserTiming defaults to a real clock when none is injected", async () => {
  // Exercises the default `now` and default-options branches.
  const timing = createBrowserTiming();
  await timing.time("a", async () => { });
  const [span] = timing.entries();
  assert.equal(span.name, "a");
  assert.ok(span.durationMs >= 0, "the default clock must produce a non-negative duration");
});

// --- summary() -------------------------------------------------------------

test("summary reports ordered spans, total duration, and failed count", async () => {
  const timing = createBrowserTiming({ now: fakeClock([0, 100, 100, 150, 150, 200]) });
  await timing.time("a", async () => { });
  await timing.time("b", async () => { });
  await assert.rejects(() => timing.time("c", async () => { throw new Error("x"); }));
  const summary = timing.summary();
  assert.deepEqual(summary.spans.map(s => s.name), ["a", "b", "c"]);
  assert.equal(summary.totalMs, 200);
  assert.equal(summary.failed, 1);
});

test("summary of an empty recorder is empty and zeroed", () => {
  const timing = createBrowserTiming();
  assert.deepEqual(timing.summary(), { spans: [], totalMs: 0, failed: 0 });
});

test("entries returns a copy that cannot mutate the recorder", async () => {
  const timing = createBrowserTiming({ now: fakeClock([0, 10]) });
  await timing.time("a", async () => { });
  const copy = timing.entries();
  copy[0].name = "mutated";
  assert.equal(timing.entries()[0].name, "a");
});

// --- format() --------------------------------------------------------------

test("format renders a human-readable block by default", async () => {
  const timing = createBrowserTiming({ now: fakeClock([0, 150, 150, 190]) });
  await timing.time("server-ready", async () => { });
  await assert.rejects(() => timing.time("fixture-ready", async () => { throw new Error("x"); }));
  const text = timing.format({ label: "[1/6] test:story-43:browser" });
  assert.match(text, /\[1\/6\] test:story-43:browser timing: 2 span\(s\), total 190ms, 1 failed/);
  assert.match(text, /server-ready: 150ms/);
  assert.match(text, /fixture-ready: 40ms \(failed\)/);
});

test("format renders a single JSON line when requested", async () => {
  const timing = createBrowserTiming({ now: fakeClock([0, 25]) });
  await timing.time("page-goto", async () => { });
  const line = timing.format({ format: "json", label: "suite" });
  assert.equal(line.includes("\n"), false, "JSON output must be a single line");
  const parsed = JSON.parse(line);
  assert.equal(parsed.label, "suite");
  assert.equal(parsed.totalMs, 25);
  assert.equal(parsed.failed, 0);
  assert.deepEqual(parsed.spans, [{ name: "page-goto", durationMs: 25, failed: false }]);
});

test("format omits the label prefix when none is given", async () => {
  const timing = createBrowserTiming({ now: fakeClock([0, 5]) });
  await timing.time("a", async () => { });
  assert.match(timing.format(), /^timing: 1 span\(s\), total 5ms/);
});

test("format defaults the label when only the format is given", async () => {
  const timing = createBrowserTiming({ now: fakeClock([0, 5]) });
  await timing.time("a", async () => { });
  const parsed = JSON.parse(timing.format({ format: "json" }));
  assert.equal(parsed.label, "");
});

test("format defaults the format when only the label is given", async () => {
  const timing = createBrowserTiming({ now: fakeClock([0, 5]) });
  await timing.time("a", async () => { });
  assert.match(timing.format({ label: "suite" }), /^suite timing: 1 span\(s\), total 5ms/);
});
