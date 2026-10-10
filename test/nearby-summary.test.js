import test from "node:test";
import assert from "node:assert/strict";
import { nearbySummary } from "../src/nearby-summary.js";
import { mobileNearbySummary } from "../src/mobile-nearby-summary.js";
import { distanceLabel } from "../src/nearby.js";

const now = Date.UTC(2026, 8, 23, 18);
const call = (source, eventCategory, minutesAgo) => ({
  source,
  eventCategory,
  timestamp: now - minutesAgo * 60_000
});

const locatedCall = (source, eventCategory, minutesAgo, coordinates) => ({
  ...call(source, eventCategory, minutesAgo),
  geography: { coordinates }
});

test("[MUST-1][STORY-1] nearby summary counts filtered calls by service and incident category", () => {
  const calls = [
    call("TFS", "fire", 3),
    call("TFS", "fire", 20),
    call("TFS", "medical", 15),
    call("TPS", "other", 8),
    call("TFS", "other", 12)
  ];

  assert.equal(
    nearbySummary(calls, 1, now),
    "5 recent calls within 1 km · 2 Fire · 1 Medical · 1 Police · 1 Other · Latest 3 min ago · Last 24h."
  );
});

test("[MUST-1][STORY-1] nearby summary handles empty and singular results", () => {
  assert.equal(nearbySummary([], 2, now), "0 recent calls within 2 km · Last 24h.");
  assert.equal(
    nearbySummary([call("TPS", "other", 0)], 5, now),
    "1 recent call within 5 km · 1 Police · Latest just now · Last 24h."
  );
});

test("[MUST-1][STORY-1] Toronto-wide summary does not imply a radius", () => {
  assert.equal(
    nearbySummary([call("TFS", "fire", 2), call("TPS", "other", 8)], null, now),
    "2 recent calls across Toronto · 1 Fire · 1 Police · Latest 2 min ago · Last 24h."
  );
  assert.equal(nearbySummary([], null, now), "0 recent calls across Toronto · Last 24h.");
});

test("[MUST-1][STORY-1] nearby summary always shows the active history window", () => {
  assert.match(nearbySummary([call("TFS", "fire", 2)], 2, now, null, undefined, 1), /· Last 1h\.$/);
  assert.match(nearbySummary([call("TFS", "fire", 2)], 2, now, null, undefined, 6), /· Last 6h\.$/);
  assert.match(nearbySummary([call("TFS", "fire", 2)], 2, now, null, undefined, 72), /· Last 3 days\.$/);
  assert.match(nearbySummary([call("TFS", "fire", 2)], 2, now, null, undefined, 168), /· Last 7 days\.$/);
  assert.match(nearbySummary([], 2, now, null, undefined, 168), /· Last 7 days\.$/);
});

test("[MUST-1][STORY-1] nearby summary formats hour, day, plural-day, and future ages", () => {
  assert.match(nearbySummary([call("TFS", "medical", 60)], 10, now), /Latest 1 hr ago · Last 24h\.$/);
  assert.match(nearbySummary([call("TFS", "fire", 1_440)], 10, now), /Latest 1 day ago · Last 24h\.$/);
  assert.match(nearbySummary([call("TFS", "other", 2_880)], 10, now), /Latest 2 days ago · Last 24h\.$/);
  assert.match(nearbySummary([call("TPS", "other", -5)], 10, now), /Latest just now · Last 24h\.$/);
});

test("[MUST-1][STORY-1] nearby summary calculates the closest filtered incident with the card distance formatter", () => {
  const origin = [43.65, -79.38];
  const calls = [
    locatedCall("TFS", "fire", 4, [43.66, -79.38]),
    locatedCall("TPS", "other", 8, [43.652, -79.38])
  ];
  const expected = distanceLabel(0.2223901604675615).replace(/ away$/, "");

  assert.equal(
    nearbySummary(calls, 2, now, origin),
    `2 recent calls within 2 km · 1 Fire · 1 Police · Closest ${expected} · Latest 4 min ago · Last 24h.`
  );
});

test("[MUST-1][STORY-1] nearby summary recalculates closest distance and preserves counts as filtered calls and radius change", () => {
  const origin = [43.65, -79.38];
  const calls = [
    locatedCall("TFS", "fire", 4, [43.66, -79.38]),
    locatedCall("TPS", "other", 8, [43.652, -79.38])
  ];

  assert.match(nearbySummary(calls, 2, now, origin), /^2 recent calls within 2 km · 1 Fire · 1 Police · Closest 0\.2 km ·/);
  assert.match(nearbySummary(calls.slice(0, 1), 1, now, origin), /^1 recent call within 1 km · 1 Fire · Closest 1\.1 km ·/);
});

test("[MUST-1][STORY-1] nearby summary omits closest distance with no incidents or no user location", () => {
  assert.equal(nearbySummary([], 2, now, [43.65, -79.38]), "0 recent calls within 2 km · Last 24h.");
  assert.equal(
    nearbySummary([locatedCall("TPS", "other", 0, [43.652, -79.38])], 2, now),
    "1 recent call within 2 km · 1 Police · Latest just now · Last 24h."
  );
});

test("[MUST-1][STORY-1] mobile summary keeps only count, closest, latest, and Toronto-wide context", () => {
  const origin = [43.65, -79.38];
  const calls = [
    locatedCall("TFS", "fire", 4, [43.66, -79.38]),
    locatedCall("TPS", "other", 8, [43.652, -79.38])
  ];

  assert.equal(mobileNearbySummary(calls, 2, now, origin), "2 calls · Closest 0.2 km · Latest 4 min ago · Last 24h");
  assert.equal(mobileNearbySummary(calls, null, now), "2 Toronto calls · Latest 4 min ago · Last 24h");
  assert.equal(mobileNearbySummary([], 0.5, now, origin), "No calls match in this area · Last 24h.");
  assert.equal(mobileNearbySummary([], null, now), "No recent Toronto calls · Last 24h.");
});

test("[MUST-1][STORY-1] mobile summary always shows the active history window", () => {
  assert.equal(mobileNearbySummary([call("TFS", "fire", 2)], 2, now, null, undefined, 1), "1 call · Latest 2 min ago · Last 1h");
  assert.equal(mobileNearbySummary([call("TFS", "fire", 2)], 2, now, null, undefined, 72), "1 call · Latest 2 min ago · Last 3 days");
  assert.equal(mobileNearbySummary([call("TFS", "fire", 2)], 2, now, null, undefined, 168), "1 call · Latest 2 min ago · Last 7 days");
  assert.equal(mobileNearbySummary([], 2, now, null, undefined, 168), "No calls match in this area · Last 7 days.");
});

test("[MUST-1][STORY-1] mobile summary formats singular, hour, day, plural-day, future, and custom-coordinate ages", () => {
  const origin = [43.65, -79.38];
  assert.equal(mobileNearbySummary([locatedCall("TFS", "fire", 60, [43.652, -79.38])], 2, now, origin), "1 call · Closest 0.2 km · Latest 1 hr ago · Last 24h");
  assert.equal(mobileNearbySummary([call("TFS", "fire", 1_440)], null, now), "1 Toronto call · Latest 1 day ago · Last 24h");
  assert.equal(mobileNearbySummary([call("TFS", "fire", 2_880)], null, now), "1 Toronto call · Latest 2 days ago · Last 24h");
  assert.equal(mobileNearbySummary([call("TPS", "other", -5)], 2, now), "1 call · Latest just now · Last 24h");
  assert.equal(
    mobileNearbySummary([{ timestamp: now - 120_000, point: [43.652, -79.38] }], 2, now, origin, item => item.point),
    "1 call · Closest 0.2 km · Latest 2 min ago · Last 24h"
  );
});

test("[MUST-1][STORY-1] nearby summary render derives non-empty details from loaded filtered calls without fetching", async () => {
  const { readFile } = await import("node:fs/promises");
  const app = await readFile(new URL("../src/app/app.js", import.meta.url), "utf8");
  const start = app.indexOf("function renderNearbySummary()");
  const body = app.slice(start, app.indexOf("\n}\n\nfunction renderStats", start) + 2);

  assert.match(body, /nearbySummary\(state\.filtered, state\.radiusKm, Date\.now\(\), state\.nearby, coordinatesForCall, state\.hours\)/);
  assert.match(body, /mobileNearbySummary\([\s\S]*?state\.filtered, state\.radiusKm, Date\.now\(\), state\.nearby, coordinatesForCall, state\.hours[\s\S]*?\)/);
  assert.match(body, /nearbyEmptyState\([\s\S]*matchingCalls: callsMatchingNonGeographicFilters\(\)/);
  assert.doesNotMatch(body, /fetch|loadData|refreshLoop/);
});
