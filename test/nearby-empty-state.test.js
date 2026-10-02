import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { nearbyEmptyState, nextNearbyRadius, radiusLabel } from "../src/nearby-empty-state.js";

const origin = [43.65, -79.38];
const locatedCall = coordinates => ({ geography: { coordinates } });

test("empty state appears when no incidents are inside the selected radius", () => {
  assert.equal(
    nearbyEmptyState({ radiusKm: 2, origin }).message,
    "No recent calls within 2 km · Last 24h."
  );
});

test("empty radius state includes the selected radius and closest loaded outside call", () => {
  const result = nearbyEmptyState({
    radiusKm: 0.5,
    origin,
    matchingCalls: [locatedCall([43.66, -79.38]), locatedCall([43.6574, -79.38])]
  });
  assert.equal(result.message, "No recent calls within 500 m · Last 24h. Closest recent call is 0.8 km away.");
});

test("fallback is omitted if the supplied matching calls already include one inside the radius", () => {
  const result = nearbyEmptyState({ radiusKm: 2, origin, matchingCalls: [locatedCall([43.651, -79.38])] });
  assert.equal(result.message, "No recent calls within 2 km · Last 24h.");
});

test("fallback ignores matching calls without usable coordinates", () => {
  const result = nearbyEmptyState({ radiusKm: 2, origin, matchingCalls: [{}, null] });
  assert.equal(result.message, "No recent calls within 2 km · Last 24h.");
});

test("fallback accepts the application's coordinate resolver", () => {
  const result = nearbyEmptyState({
    radiusKm: 0.5,
    origin,
    matchingCalls: [{ coordinates: [43.66, -79.38] }],
    coordinatesForCall: call => call.coordinates
  });
  assert.equal(result.message, "No recent calls within 500 m · Last 24h. Closest recent call is 1.1 km away.");
});

test("closest distance is omitted when user location is unavailable", () => {
  const result = nearbyEmptyState({ radiusKm: 1, origin: null, matchingCalls: [locatedCall([43.66, -79.38])] });
  assert.equal(result.message, "No recent calls within 1 km · Last 24h.");
});

test("Toronto-wide empty state describes filtered results without a fallback or expansion", () => {
  assert.deepEqual(
    nearbyEmptyState({ radiusKm: null, origin, matchingCalls: [locatedCall([43.66, -79.38])] }),
    { message: "No recent calls match the current filters across Toronto · Last 24h.", nextRadiusKm: undefined }
  );
});

test("empty state reflects the active history window", () => {
  assert.equal(nearbyEmptyState({ radiusKm: 2, origin, hours: 1 }).message, "No recent calls within 2 km · Last 1h.");
  assert.equal(nearbyEmptyState({ radiusKm: 2, origin, hours: 6 }).message, "No recent calls within 2 km · Last 6h.");
  assert.equal(nearbyEmptyState({ radiusKm: 2, origin, hours: 72 }).message, "No recent calls within 2 km · Last 3 days.");
  assert.equal(nearbyEmptyState({ radiusKm: 2, origin, hours: 168 }).message, "No recent calls within 2 km · Last 7 days.");
  assert.equal(
    nearbyEmptyState({ radiusKm: null, origin, hours: 168 }).message,
    "No recent calls match the current filters across Toronto · Last 7 days."
  );
});

test("expand action chooses each next sensible radius", () => {
  assert.deepEqual([0.5, 1, 2, 5, null].map(nextNearbyRadius), [1, 2, 5, null, undefined]);
  assert.equal(radiusLabel(null), "Toronto-wide");
});

test("global empty dataset has a clean message and no expand action", () => {
  assert.deepEqual(
    nearbyEmptyState({ radiusKm: 0.5, origin, datasetIsEmpty: true }),
    { message: "No recent calls are currently available · Last 24h.", nextRadiusKm: undefined }
  );
});

test("fallback and radius expansion use loaded data without fetching or resetting filters", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const renderStart = app.indexOf("function renderNearbySummary()");
  const renderBody = app.slice(renderStart, app.indexOf("\n}\n\nfunction callsMatchingNonGeographicFilters", renderStart) + 2);
  assert.match(renderBody, /matchingCalls: callsMatchingNonGeographicFilters\(\)/);
  assert.doesNotMatch(renderBody, /fetch|refreshLoop|loadData/);

  const selectStart = app.indexOf("function selectNearbyRadius(value)");
  const selectBody = app.slice(selectStart, app.indexOf("\nradiusToggles.forEach", selectStart));
  assert.match(selectBody, /state\.radiusKm = radiusKm;[\s\S]*updateNearbyView\(\)/);
  assert.doesNotMatch(selectBody, /state\.(?:search|division|serviceFilter|eventFilter|hours)\s*=|Object\.assign\(state/);
  assert.match(app, /expandNearbyRadius\.addEventListener\('click'[\s\S]*selectNearbyRadius\(nextRadiusKm\)/);
  assert.match(app, /zero-result nearby radius should not erase a division[\s\S]*state\.radiusKm !== null[\s\S]*divisions\.push\(current\)/);
});
