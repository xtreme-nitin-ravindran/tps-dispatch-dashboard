import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { markerAgeLabel, markerAgeTier, markerGlyph } from "../src/marker-age.js";

const now = Date.parse("2026-09-24T16:00:00Z");
const minutesAgo = minutes => new Date(now - minutes * 60_000).toISOString();

test("marker age tiers change at the 10, 30, and 60 minute boundaries", () => {
  assert.equal(markerAgeTier(minutesAgo(0), now), "recent");
  assert.equal(markerAgeTier(minutesAgo(9.99), now), "recent");
  assert.equal(markerAgeTier(minutesAgo(10), now), "current");
  assert.equal(markerAgeTier(minutesAgo(29.99), now), "current");
  assert.equal(markerAgeTier(minutesAgo(30), now), "aging");
  assert.equal(markerAgeTier(minutesAgo(59.99), now), "aging");
  assert.equal(markerAgeTier(minutesAgo(60), now), "old");
  assert.equal(markerAgeTier(minutesAgo(240), now), "old");
});

test("future times are treated as just reported and invalid times are neutral", () => {
  assert.equal(markerAgeTier(new Date(now + 60_000), now), "recent");
  assert.equal(markerAgeTier("not-a-time", now), "unknown");
});

test("age labels describe freshness without implying incident status", () => {
  assert.equal(markerAgeLabel("recent"), "reported less than 10 minutes ago");
  assert.equal(markerAgeLabel("current"), "reported 10 to 30 minutes ago");
  assert.equal(markerAgeLabel("aging"), "reported 30 to 60 minutes ago");
  assert.equal(markerAgeLabel("old"), "reported at least 60 minutes ago");
  assert.equal(markerAgeLabel("unknown"), "report time unavailable");
  assert.equal(markerAgeLabel("unexpected"), "report time unavailable");
});

test("glyphs retain category and service cues independently of opacity", () => {
  assert.equal(markerGlyph("TFS", "medical"), "+");
  assert.equal(markerGlyph("TFS", "fire"), "F");
  assert.equal(markerGlyph("TPS", "other"), "P");
  assert.equal(markerGlyph("TFS", "other"), "T");
});

test("map wiring refreshes age styles and preserves non-opacity cues and selection", async () => {
  const [app, css, html] = await Promise.all([
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    readFile(new URL("../styles.css", import.meta.url), "utf8"),
    readFile(new URL("../index.html", import.meta.url), "utf8")
  ]);

  assert.match(app, /markerAgeTier\(call\.timestamp, now\)/);
  assert.match(app, /renderNearbySummary\(\);\s*updateMarkerAppearances\(\);\s*}, 60000\)/);
  assert.match(app, /function selectCall[\s\S]*?updateMarkerAppearances\(\)/);
  assert.match(css, /\.dispatch-marker\.age-aging \{ opacity: \.72; \}/);
  assert.match(css, /\.dispatch-marker\.age-old \{ opacity: \.52; \}/);
  assert.match(css, /\.dispatch-marker\.selected,[\s\S]*?opacity: 1/);
  assert.match(css, /\.dispatch-marker\.service-tps \{ border-radius: 4px; \}/);
  assert.match(css, /\.dispatch-marker\.category-fire \{ background: var\(--marker-fire\); \}/);
  assert.match(css, /\.dispatch-marker\.category-medical \{ background: var\(--marker-medical\); \}/);
  assert.match(css, /\.dispatch-marker\.category-other \{ background: var\(--marker-other\); \}/);
  for (const [className, category] of [["fire-key", "Fire"], ["medical-key", "Medical"], ["other-key", "Other"]]) {
    assert.match(html, new RegExp(`<i class="${className}"[^>]*></i>${category}`));
  }
  for (const label of ["0–10 min · strongest", "10–30 min · normal", "30–60 min", "60+ min"]) {
    assert.match(html, new RegExp(label.replace("+", "\\+")));
  }
});
