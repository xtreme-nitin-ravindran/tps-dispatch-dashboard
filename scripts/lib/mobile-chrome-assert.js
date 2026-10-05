// Shared rendered-browser geometry helpers for the mobile chrome regressions
// (Stories 39A, 40E, 42, 43, 44).
//
// These helpers exist only to remove the genuinely duplicated geometry math and
// assertion plumbing from the feature scripts. Each feature script keeps its own
// selectors, scenarios, thresholds, and feature-specific assertions, and must
// explicitly declare which element pairs must not overlap.
//
// Design notes:
//   - `measureChrome(page, selectors)` runs a single `page.evaluate` that reads
//     the real bounding rectangles for the requested selectors. A selector may
//     be a plain string (required) or `{ selector, optional: true }` (optional).
//   - A missing required element fails clearly; a missing optional element is
//     reported as `null` so the caller can skip it intentionally.
//   - Touching edges are treated as non-overlapping unless the caller supplies a
//     clearance tolerance.
//   - Every assertion message identifies the label (viewport + scenario) and the
//     relevant element(s).
/* global document */
import assert from 'node:assert/strict';

// Normalizes a DOMRect-like box ({ x, y, width, height }) into an edge-based
// rectangle ({ left, top, right, bottom }) while retaining width/height so
// callers can still assert target sizes.
export function normalizeRect(box) {
  if (!box) return null;
  return {
    left: box.x,
    top: box.y,
    right: box.x + box.width,
    bottom: box.y + box.height,
    width: box.width,
    height: box.height
  };
}

// True when two edge-based rectangles overlap. Touching edges (zero overlap)
// are not an intersection. A positive `tolerance` requires a real clearance: the
// rectangles must be separated by at least `tolerance` pixels on both axes to
// count as non-overlapping, so a gap smaller than the tolerance is treated as an
// overlap.
export function intersects(a, b, tolerance = 0) {
  const gapX = Math.max(a.left, b.left) - Math.min(a.right, b.right);
  const gapY = Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom);
  return gapX < tolerance && gapY < tolerance;
}

// Browser-side reader: runs inside `page.evaluate`. Reads the raw bounding
// rectangles for each selector in `specs` (name -> { selector, optional }).
// A missing required element is reported as { missing: true, selector }; a
// missing optional element is reported as null. Exported so its behavior can be
// unit-tested directly with a stubbed `document`.
export function readChromeRects(specs) {
  const out = {};
  for (const [name, { selector, optional }] of Object.entries(specs)) {
    const el = document.querySelector(selector);
    if (!el) {
      out[name] = optional ? null : { missing: true, selector };
      continue;
    }
    const r = el.getBoundingClientRect();
    out[name] = { x: r.x, y: r.y, width: r.width, height: r.height };
  }
  return out;
}

// Reads the rendered bounding rectangles for the requested selectors in one
// page evaluation. `selectors` is a map of name -> selector string or
// { selector, optional }. Returns a map of name -> normalized rectangle (or
// null for an absent optional element). A missing required element throws.
export async function measureChrome(page, selectors = {}) {
  const spec = {};
  for (const [name, value] of Object.entries(selectors)) {
    if (typeof value === 'string') {
      spec[name] = { selector: value, optional: false };
    } else {
      spec[name] = { selector: value.selector, optional: Boolean(value.optional) };
    }
  }
  const raw = await page.evaluate(readChromeRects, spec);

  const result = {};
  for (const [name, value] of Object.entries(raw)) {
    if (value && value.missing) {
      throw new Error(`measureChrome: required element "${name}" (${value.selector}) is not rendered`);
    }
    result[name] = value ? normalizeRect(value) : null;
  }
  return result;
}

// Asserts that none of the declared element pairs overlap. `pairs` is an array
// of [nameA, nameB] tuples referencing keys in `state`. A pair whose elements
// are both present is checked; a pair with a missing (optional) element is
// skipped. `tolerance` is an optional clearance in pixels.
export function assertNoOverlap(state, pairs, label, tolerance = 0) {
  for (const [nameA, nameB] of pairs) {
    const a = state[nameA];
    const b = state[nameB];
    if (!a || !b) continue;
    assert.ok(
      !intersects(a, b, tolerance),
      `${label}: ${nameA} overlaps ${nameB}`
    );
  }
}

// Asserts that a rectangle stays inside the viewport (with a small tolerance for
// sub-pixel rounding). `viewport` is { width, height }.
export function assertInViewport(rect, viewport, label, tolerance = 0.5) {
  assert.ok(rect, `${label}: rectangle is not rendered`);
  assert.ok(rect.left >= -tolerance, `${label}: starts left of the viewport (${rect.left})`);
  assert.ok(rect.top >= -tolerance, `${label}: starts above the viewport (${rect.top})`);
  assert.ok(rect.right <= viewport.width + tolerance, `${label}: overflows the right edge (${rect.right} > ${viewport.width})`);
  assert.ok(rect.bottom <= viewport.height + tolerance, `${label}: overflows the bottom edge (${rect.bottom} > ${viewport.height})`);
}

// Asserts that the document does not overflow horizontally. `state` must carry
// `docScrollWidth` and `docClientWidth` (as produced by the feature scripts'
// measure helpers).
export function assertNoHorizontalOverflow(state, label, tolerance = 1) {
  assert.ok(
    state.docScrollWidth <= state.docClientWidth + tolerance,
    `${label}: horizontal overflow (${state.docScrollWidth} > ${state.docClientWidth})`
  );
}
