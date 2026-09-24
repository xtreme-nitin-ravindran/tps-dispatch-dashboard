import test from "node:test";
import assert from "node:assert/strict";
import { nearbySummary } from "../src/nearby-summary.js";
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

test("nearby summary counts filtered calls by service and incident category", () => {
  const calls = [
    call("TFS", "fire", 3),
    call("TFS", "fire", 20),
    call("TFS", "medical", 15),
    call("TPS", "other", 8),
    call("TFS", "other", 12)
  ];

  assert.equal(
    nearbySummary(calls, 1, now),
    "5 recent calls within 1 km · 2 Fire · 1 Medical · 1 Police · 1 Other · Latest 3 min ago."
  );
});

test("nearby summary handles empty and singular results", () => {
  assert.equal(nearbySummary([], 2, now), "0 recent calls within 2 km.");
  assert.equal(
    nearbySummary([call("TPS", "other", 0)], 5, now),
    "1 recent call within 5 km · 1 Police · Latest just now."
  );
});

test("Toronto-wide summary does not imply a radius", () => {
  assert.equal(
    nearbySummary([call("TFS", "fire", 2), call("TPS", "other", 8)], null, now),
    "2 recent calls across Toronto · 1 Fire · 1 Police · Latest 2 min ago."
  );
  assert.equal(nearbySummary([], null, now), "0 recent calls across Toronto.");
});

test("nearby summary formats hour, day, plural-day, and future ages", () => {
  assert.match(nearbySummary([call("TFS", "medical", 60)], 10, now), /Latest 1 hr ago\.$/);
  assert.match(nearbySummary([call("TFS", "fire", 1_440)], 10, now), /Latest 1 day ago\.$/);
  assert.match(nearbySummary([call("TFS", "other", 2_880)], 10, now), /Latest 2 days ago\.$/);
  assert.match(nearbySummary([call("TPS", "other", -5)], 10, now), /Latest just now\.$/);
});

test("nearby summary calculates the closest filtered incident with the card distance formatter", () => {
  const origin = [43.65, -79.38];
  const calls = [
    locatedCall("TFS", "fire", 4, [43.66, -79.38]),
    locatedCall("TPS", "other", 8, [43.652, -79.38])
  ];
  const expected = distanceLabel(0.2223901604675615).replace(/ away$/, "");

  assert.equal(
    nearbySummary(calls, 2, now, origin),
    `2 recent calls within 2 km · 1 Fire · 1 Police · Closest ${expected} · Latest 4 min ago.`
  );
});

test("nearby summary recalculates closest distance and preserves counts as filtered calls and radius change", () => {
  const origin = [43.65, -79.38];
  const calls = [
    locatedCall("TFS", "fire", 4, [43.66, -79.38]),
    locatedCall("TPS", "other", 8, [43.652, -79.38])
  ];

  assert.match(nearbySummary(calls, 2, now, origin), /^2 recent calls within 2 km · 1 Fire · 1 Police · Closest 0\.2 km ·/);
  assert.match(nearbySummary(calls.slice(0, 1), 1, now, origin), /^1 recent call within 1 km · 1 Fire · Closest 1\.1 km ·/);
});

test("nearby summary omits closest distance with no incidents or no user location", () => {
  assert.equal(nearbySummary([], 2, now, [43.65, -79.38]), "0 recent calls within 2 km.");
  assert.equal(
    nearbySummary([locatedCall("TPS", "other", 0, [43.652, -79.38])], 2, now),
    "1 recent call within 2 km · 1 Police · Latest just now."
  );
});

test("nearby summary render derives non-empty details from loaded filtered calls without fetching", async () => {
  const { readFile } = await import("node:fs/promises");
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const start = app.indexOf("function renderNearbySummary()");
  const body = app.slice(start, app.indexOf("\n}\n\nfunction renderStats", start) + 2);

  assert.match(body, /nearbySummary\(state\.filtered, state\.radiusKm, Date\.now\(\), state\.nearby, coordinatesForCall\)/);
  assert.match(body, /nearbyEmptyState\([\s\S]*matchingCalls: callsMatchingNonGeographicFilters\(\)/);
  assert.doesNotMatch(body, /fetch|loadData|refreshLoop/);
});
