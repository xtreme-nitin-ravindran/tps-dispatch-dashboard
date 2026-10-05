import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeRect,
  intersects,
  readChromeRects,
  measureChrome,
  assertNoOverlap,
  assertInViewport,
  assertNoHorizontalOverflow
} from "../scripts/lib/mobile-chrome-assert.js";

// Deterministic offline coverage for the shared rendered-browser geometry
// helpers (scripts/lib/mobile-chrome-assert.js). These tests exercise the pure
// geometry/assertion behavior without launching a browser.

// --- normalizeRect ---------------------------------------------------------

test("normalizeRect converts a DOMRect-like box into edge coordinates", () => {
  assert.deepEqual(normalizeRect({ x: 10, y: 20, width: 30, height: 40 }), {
    left: 10,
    top: 20,
    right: 40,
    bottom: 60,
    width: 30,
    height: 40
  });
});

test("normalizeRect returns null for a missing box", () => {
  assert.equal(normalizeRect(null), null);
  assert.equal(normalizeRect(undefined), null);
});

// --- intersects ------------------------------------------------------------

test("touching edges do not intersect", () => {
  const a = { left: 0, top: 0, right: 10, bottom: 10 };
  const b = { left: 10, top: 0, right: 20, bottom: 10 };
  assert.equal(intersects(a, b), false);
  assert.equal(intersects(b, a), false);
});

test("actual intersections are detected", () => {
  const a = { left: 0, top: 0, right: 10, bottom: 10 };
  const b = { left: 5, top: 5, right: 15, bottom: 15 };
  assert.equal(intersects(a, b), true);
  assert.equal(intersects(b, a), true);
});

test("a fully contained rectangle intersects", () => {
  const outer = { left: 0, top: 0, right: 100, bottom: 100 };
  const inner = { left: 10, top: 10, right: 20, bottom: 20 };
  assert.equal(intersects(outer, inner), true);
});

test("separated rectangles do not intersect", () => {
  const a = { left: 0, top: 0, right: 10, bottom: 10 };
  const b = { left: 20, top: 20, right: 30, bottom: 30 };
  assert.equal(intersects(a, b), false);
});

test("clearance tolerance requires a real gap", () => {
  const a = { left: 0, top: 0, right: 10, bottom: 10 };
  // b starts 4px to the right of a's right edge.
  const b = { left: 14, top: 0, right: 24, bottom: 10 };
  // Without tolerance they do not overlap.
  assert.equal(intersects(a, b), false);
  // A 4px gap satisfies a 4px clearance requirement (gap must be >= tolerance).
  assert.equal(intersects(a, b, 4), false);
  // A 5px clearance requirement is not met by the 4px gap.
  assert.equal(intersects(a, b, 5), true);
  // A 3px clearance requirement is satisfied by the 4px gap.
  assert.equal(intersects(a, b, 3), false);
});

test("touching edges count as overlapping once a clearance is required", () => {
  const a = { left: 0, top: 0, right: 10, bottom: 10 };
  const b = { left: 10, top: 0, right: 20, bottom: 10 };
  assert.equal(intersects(a, b), false);
  assert.equal(intersects(a, b, 1), true);
});

// --- readChromeRects (browser-side reader) ---------------------------------

// Runs `readChromeRects` with a stubbed global `document` so the browser-side
// callback body is exercised directly.
function withStubDocument(elements, fn) {
  const previous = globalThis.document;
  globalThis.document = {
    querySelector(selector) {
      return elements[selector] || null;
    }
  };
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

test("readChromeRects reads present elements and reports missing required ones", () => {
  const elements = {
    '#a': { getBoundingClientRect: () => ({ x: 1, y: 2, width: 3, height: 4 }) }
  };
  const out = withStubDocument(elements, () => readChromeRects({
    a: { selector: '#a', optional: false },
    b: { selector: '#b', optional: false }
  }));
  assert.deepEqual(out.a, { x: 1, y: 2, width: 3, height: 4 });
  assert.deepEqual(out.b, { missing: true, selector: '#b' });
});

test("readChromeRects reports a missing optional element as null", () => {
  const out = withStubDocument({}, () => readChromeRects({
    b: { selector: '#b', optional: true }
  }));
  assert.equal(out.b, null);
});

// --- measureChrome ---------------------------------------------------------

function stubPage(rects) {
  return {
    async evaluate(_fn, spec) {
      const out = {};
      for (const [name, { selector, optional }] of Object.entries(spec)) {
        const box = rects[selector];
        if (!box) {
          out[name] = optional ? null : { missing: true, selector };
        } else {
          out[name] = box;
        }
      }
      return out;
    }
  };
}

test("measureChrome normalizes present rectangles", async () => {
  const page = stubPage({ '#a': { x: 1, y: 2, width: 3, height: 4 } });
  const state = await measureChrome(page, { a: '#a' });
  assert.deepEqual(state.a, { left: 1, top: 2, right: 4, bottom: 6, width: 3, height: 4 });
});

test("measureChrome fails clearly for a missing required element", async () => {
  const page = stubPage({});
  await assert.rejects(
    () => measureChrome(page, { a: '#a' }),
    /required element "a" \(#a\) is not rendered/
  );
});

test("measureChrome handles a missing optional element intentionally", async () => {
  const page = stubPage({ '#a': { x: 0, y: 0, width: 1, height: 1 } });
  const state = await measureChrome(page, { a: '#a', b: { selector: '#b', optional: true } });
  assert.deepEqual(state.a, { left: 0, top: 0, right: 1, bottom: 1, width: 1, height: 1 });
  assert.equal(state.b, null);
});

// --- assertNoOverlap -------------------------------------------------------

test("assertNoOverlap passes for non-overlapping pairs", () => {
  const state = {
    a: { left: 0, top: 0, right: 10, bottom: 10 },
    b: { left: 20, top: 0, right: 30, bottom: 10 }
  };
  assert.doesNotThrow(() => assertNoOverlap(state, [['a', 'b']], '390x844 normal'));
});

test("assertNoOverlap fails for overlapping pairs with a useful message", () => {
  const state = {
    a: { left: 0, top: 0, right: 10, bottom: 10 },
    b: { left: 5, top: 5, right: 15, bottom: 15 }
  };
  assert.throws(
    () => assertNoOverlap(state, [['a', 'b']], '390x844 focused'),
    /390x844 focused: a overlaps b/
  );
});

test("assertNoOverlap skips pairs with a missing optional element", () => {
  const state = {
    a: { left: 0, top: 0, right: 10, bottom: 10 },
    b: null
  };
  assert.doesNotThrow(() => assertNoOverlap(state, [['a', 'b']], 'label'));
});

test("assertNoOverlap respects a clearance tolerance", () => {
  const state = {
    a: { left: 0, top: 0, right: 10, bottom: 10 },
    b: { left: 14, top: 0, right: 24, bottom: 10 }
  };
  assert.doesNotThrow(() => assertNoOverlap(state, [['a', 'b']], 'label'));
  assert.doesNotThrow(() => assertNoOverlap(state, [['a', 'b']], 'label', 4));
  assert.throws(
    () => assertNoOverlap(state, [['a', 'b']], 'label', 5),
    /label: a overlaps b/
  );
});

// --- assertInViewport ------------------------------------------------------

test("assertInViewport passes for a rectangle inside the viewport", () => {
  const rect = { left: 0, top: 0, right: 100, bottom: 100 };
  assert.doesNotThrow(() => assertInViewport(rect, { width: 200, height: 200 }, 'label'));
});

test("assertInViewport reports right-edge overflow", () => {
  const rect = { left: 0, top: 0, right: 250, bottom: 100 };
  assert.throws(
    () => assertInViewport(rect, { width: 200, height: 200 }, 'label'),
    /label: overflows the right edge \(250 > 200\)/
  );
});

test("assertInViewport reports bottom-edge overflow", () => {
  const rect = { left: 0, top: 0, right: 100, bottom: 250 };
  assert.throws(
    () => assertInViewport(rect, { width: 200, height: 200 }, 'label'),
    /label: overflows the bottom edge \(250 > 200\)/
  );
});

test("assertInViewport reports a rectangle starting outside the viewport", () => {
  const rect = { left: -10, top: -10, right: 100, bottom: 100 };
  assert.throws(
    () => assertInViewport(rect, { width: 200, height: 200 }, 'label'),
    /label: starts left of the viewport/
  );
});

test("assertInViewport fails clearly for a missing rectangle", () => {
  assert.throws(
    () => assertInViewport(null, { width: 200, height: 200 }, 'label'),
    /label: rectangle is not rendered/
  );
});

// --- assertNoHorizontalOverflow --------------------------------------------

test("assertNoHorizontalOverflow passes when the document fits", () => {
  assert.doesNotThrow(() => assertNoHorizontalOverflow({ docScrollWidth: 390, docClientWidth: 390 }, 'label'));
});

test("assertNoHorizontalOverflow reports horizontal document overflow", () => {
  assert.throws(
    () => assertNoHorizontalOverflow({ docScrollWidth: 420, docClientWidth: 390 }, 'label'),
    /label: horizontal overflow \(420 > 390\)/
  );
});

test("assertNoHorizontalOverflow respects a tolerance", () => {
  assert.doesNotThrow(() => assertNoHorizontalOverflow({ docScrollWidth: 391, docClientWidth: 390 }, 'label'));
  assert.throws(
    () => assertNoHorizontalOverflow({ docScrollWidth: 395, docClientWidth: 390 }, 'label', 1),
    /label: horizontal overflow/
  );
});
