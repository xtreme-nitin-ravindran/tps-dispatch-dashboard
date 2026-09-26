import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateWatchMatch,
  incidentNotificationKind,
  normalizeWatch,
  notificationDedupeKey,
  sourceAllowsNotification,
  validateWatch,
  watchMatchesIncident
} from "../src/watch-matcher.js";
import { fixtureIncidents, fixtureWatch } from "./fixtures/watch-matcher.js";

test("valid watches normalize to the minimal versioned schema", () => {
  const normalized = normalizeWatch({ ...fixtureWatch, id: "  local-1  ", ignoredUiState: "map" });
  assert.deepEqual(normalized, { ...fixtureWatch, id: "local-1" });
  assert.equal(validateWatch(normalized).valid, true);
  assert.equal("ignoredUiState" in normalized, false);
});

test("watch validation rejects invalid schema, coordinates, radius, filters, and active state", () => {
  for (const value of [null, [], 'watch']) assert.equal(validateWatch(value).valid, false);
  for (const patch of [
    { schema: 'wrong' }, { version: 2 }, { id: '' }, { centre: null }, { centre: [] },
    { centre: { latitude: '43.65', longitude: -79.38 } },
    { centre: { latitude: 91, longitude: -79.38 } },
    { centre: { latitude: 43.65, longitude: -181 } }, { radiusKm: null },
    { radiusKm: 10 }, { service: "EMS" }, { category: "crime" }, { active: "yes" }
  ]) assert.equal(validateWatch({ ...fixtureWatch, ...patch }).valid, false);
  assert.match(validateWatch({ ...fixtureWatch, radiusKm: null }).errors.join(" "), /Toronto-wide/);
  assert.throws(() => normalizeWatch({ ...fixtureWatch, radiusKm: null }), /Invalid watch/);
  assert.throws(() => normalizeWatch(null), /Invalid watch/);
});

test("geographic matching includes a point immediately inside the boundary", () => {
  assert.equal(watchMatchesIncident(fixtureWatch, fixtureIncidents.inside), true);
  assert.equal(watchMatchesIncident(fixtureWatch, fixtureIncidents.nearBoundary), true);
  assert.equal(watchMatchesIncident(fixtureWatch, fixtureIncidents.outside), false);
});

test("service and category filters use existing SirenTO semantics", () => {
  assert.equal(evaluateWatchMatch(fixtureWatch, fixtureIncidents.wrongService).reason, "service-filter");
  assert.equal(evaluateWatchMatch(fixtureWatch, fixtureIncidents.wrongCategory).reason, "category-filter");
  assert.equal(watchMatchesIncident({ ...fixtureWatch, service: "all", category: "all" }, fixtureIncidents.wrongService), true);
  assert.equal(watchMatchesIncident({ ...fixtureWatch, category: "ongoing" }, fixtureIncidents.inside), true);
  assert.equal(watchMatchesIncident({ ...fixtureWatch, category: "ongoing" }, { ...fixtureIncidents.inside, isOngoing: false }), false);
  const withoutPrecomputedCategory = { ...fixtureIncidents.inside };
  delete withoutPrecomputedCategory.eventCategory;
  assert.equal(watchMatchesIncident(fixtureWatch, withoutPrecomputedCategory), true);
});

test("lifecycle eligibility distinguishes new, meaningful updates, and routine refreshes", () => {
  assert.equal(incidentNotificationKind(null), null);
  assert.equal(incidentNotificationKind({ firstSeenAt: undefined, lastMeaningfulUpdateAt: '2026-09-25T12:06:00.000Z' }), "updated:2026-09-25T12:06:00.000Z");
  assert.equal(incidentNotificationKind(fixtureIncidents.inside), "new:v1");
  assert.equal(incidentNotificationKind(fixtureIncidents.refreshed), "new:v1");
  assert.equal(incidentNotificationKind(fixtureIncidents.updated), "updated:2026-09-25T12:06:00.000Z");
  assert.equal(incidentNotificationKind({ ...fixtureIncidents.inside, firstSeenAt: undefined }), null);
  assert.equal(evaluateWatchMatch(fixtureWatch, { ...fixtureIncidents.inside, firstSeenAt: undefined }).reason, "ineligible-lifecycle");
});

test("dedupe keys are stable across refreshes and change for meaningful updates", () => {
  const first = evaluateWatchMatch(fixtureWatch, fixtureIncidents.inside);
  const refreshed = evaluateWatchMatch(fixtureWatch, fixtureIncidents.refreshed);
  const updated = evaluateWatchMatch(fixtureWatch, fixtureIncidents.updated);
  assert.equal(first.dedupeKey, refreshed.dedupeKey);
  assert.notEqual(first.dedupeKey, updated.dedupeKey);
  assert.equal(notificationDedupeKey("watch/a", "incident 1", "new:v1"), "watch:v1:watch%2Fa:incident:incident%201:notification:new%3Av1");
  assert.throws(() => notificationDedupeKey('', 'incident', 'new:v1'), /watchId/);
  assert.equal(evaluateWatchMatch(fixtureWatch, fixtureIncidents.inside, { notifiedKeys: [first.dedupeKey] }).reason, "duplicate");
});

test("stale and unavailable sources suppress matching without invalidating the watch", () => {
  for (const sourceState of ["stale", "unavailable"]) {
    const result = evaluateWatchMatch(fixtureWatch, fixtureIncidents.inside, { sourceState });
    assert.equal(result.matches, false);
    assert.equal(result.reason, `${sourceState}-source`);
    assert.equal(validateWatch(fixtureWatch).valid, true);
    assert.equal(sourceAllowsNotification(sourceState), false);
  }
  assert.equal(sourceAllowsNotification("fresh"), true);
});

test("test-only fixtures exercise invalid and unsupported matcher paths deterministically", () => {
  assert.equal(evaluateWatchMatch({ ...fixtureWatch, schema: "test-invalid" }, fixtureIncidents.inside).reason, "invalid-watch");
  assert.equal(evaluateWatchMatch({ ...fixtureWatch, radiusKm: null }, fixtureIncidents.inside).reason, "invalid-watch");
  assert.equal(evaluateWatchMatch(fixtureWatch, fixtureIncidents.inside, { sourceState: "unknown" }).reason, "invalid-source-state");
  assert.equal(evaluateWatchMatch({ ...fixtureWatch, active: false }, fixtureIncidents.inside).reason, "inactive-watch");
  assert.equal(evaluateWatchMatch(fixtureWatch, null).reason, "invalid-incident");
  assert.equal(evaluateWatchMatch(fixtureWatch, { ...fixtureIncidents.inside, id: '' }).reason, "invalid-incident");
  assert.equal(evaluateWatchMatch(fixtureWatch, { ...fixtureIncidents.inside, eventCategory: 'unknown' }).reason, "invalid-category");
});
