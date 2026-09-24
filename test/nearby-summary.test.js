import test from "node:test";
import assert from "node:assert/strict";
import { nearbySummary } from "../src/nearby-summary.js";

const now = Date.UTC(2026, 8, 23, 18);
const call = (source, eventCategory, minutesAgo) => ({
  source,
  eventCategory,
  timestamp: now - minutesAgo * 60_000
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

test("nearby summary formats hour, day, plural-day, and future ages", () => {
  assert.match(nearbySummary([call("TFS", "medical", 60)], 10, now), /Latest 1 hr ago\.$/);
  assert.match(nearbySummary([call("TFS", "fire", 1_440)], 10, now), /Latest 1 day ago\.$/);
  assert.match(nearbySummary([call("TFS", "other", 2_880)], 10, now), /Latest 2 days ago\.$/);
  assert.match(nearbySummary([call("TPS", "other", -5)], 10, now), /Latest just now\.$/);
});
