// Shared rendered-browser timing helper.
//
// The rendered-browser regressions and their aggregate runner have a recurring
// class of cold-start problem: the first run of `npm run test:browser` can be
// slow enough to trip a readiness bound, and the failure disappears on rerun.
// Diagnosing that requires knowing *how long each stage took* — server
// readiness, Chromium launch, page navigation, fixture readiness, teardown —
// rather than guessing which timeout fired.
//
// This module is that shared tool. It is deliberately generic: it records named
// spans (start, end, duration, and whether the span failed) for any call, so it
// can debug this race and any future browser-startup issue. It is test-only and
// has no effect on production behavior.
//
// Design notes:
//   - Node standard library only; no dependency is added.
//   - The clock is injectable (`now`) so tests are deterministic.
//   - `time(name, fn)` wraps an async call: it records the span, and if the call
//     throws it still records the span (marked `failed`) and rethrows, so it
//     composes with existing readiness/cleanup semantics and never swallows an
//     error.
//   - `start(name)` / `end(name)` support manual spans where wrapping a call is
//     not practical.
//   - Spans are recorded in completion order and are never dropped.
//   - `summary()` returns a bounded, ordered structure; `format()` renders it as
//     a human-readable block by default, or as a single JSON line when the
//     caller requests JSON (the runner/suites select this from an env flag).
//   - Recording is always on: the overhead is negligible and the whole point is
//     to have evidence whenever a cold run fails.

// The environment variable that switches the summary format to JSON.
export const TIMING_FORMAT_ENV = 'BROWSER_TIMING';

// Resolve the requested summary format from an environment-like object.
// Returns 'json' only for an explicit `json` value (case-insensitive); anything
// else (including unset) yields the human-readable default.
export function resolveTimingFormat(env = globalThis.process?.env || {}) {
  const value = env[TIMING_FORMAT_ENV];
  return typeof value === 'string' && value.trim().toLowerCase() === 'json' ? 'json' : 'text';
}

// Round a duration to a stable, readable precision (tenths of a millisecond).
function roundMs(value) {
  return Math.round(value * 10) / 10;
}

// Create a timing recorder. `now` is injectable for deterministic tests and
// defaults to a monotonic-ish wall clock.
export function createBrowserTiming({ now = () => Date.now() } = {}) {
  const spans = [];
  const open = new Map();

  // Begin a manual span. Returns the start timestamp so a caller can pass it to
  // `end` if it prefers to thread the value explicitly.
  function start(name) {
    const startedAt = now();
    open.set(name, startedAt);
    return startedAt;
  }

  // End a manual span. `failed` marks the span as having thrown. A span that was
  // never started is ignored rather than throwing, so teardown paths stay safe.
  function end(name, { failed = false } = {}) {
    if (!open.has(name)) return null;
    const startedAt = open.get(name);
    open.delete(name);
    const span = {
      name,
      durationMs: roundMs(now() - startedAt),
      failed: Boolean(failed)
    };
    spans.push(span);
    return span;
  }

  // Time an async (or sync) call. Records the span, marks it failed and rethrows
  // if the call throws, and returns the call's result otherwise.
  async function time(name, fn) {
    start(name);
    try {
      const result = await fn();
      end(name, { failed: false });
      return result;
    } catch (error) {
      end(name, { failed: true });
      throw error;
    }
  }

  // The recorded spans, in completion order, as a shallow copy.
  function entries() {
    return spans.map(span => ({ ...span }));
  }

  // A bounded summary: the ordered spans plus the total wall-clock of the
  // recorded spans and the count of failed spans.
  function summary() {
    const totalMs = roundMs(spans.reduce((sum, span) => sum + span.durationMs, 0));
    return {
      spans: entries(),
      totalMs,
      failed: spans.filter(span => span.failed).length
    };
  }

  // Render the summary. `format` is 'text' (default) or 'json'. `label` prefixes
  // the text block so concurrent suites are distinguishable.
  function format({ format = 'text', label = '' } = {}) {
    const data = summary();
    if (format === 'json') {
      return JSON.stringify({ label, ...data });
    }
    const prefix = label ? `${label} ` : '';
    const lines = data.spans.map(span => {
      const mark = span.failed ? ' (failed)' : '';
      return `  ${span.name}: ${span.durationMs}ms${mark}`;
    });
    const header = `${prefix}timing: ${data.spans.length} span(s), total ${data.totalMs}ms${data.failed ? `, ${data.failed} failed` : ''}`;
    return [header, ...lines].join('\n');
  }

  return { start, end, time, entries, summary, format };
}
