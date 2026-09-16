import test from "node:test";
import assert from "node:assert/strict";
import { assessTpsFreshness } from "../src/tps/freshness.js";

test("marks a TPS source fresh when its newest record is within 24 hours", () => {
    const now = new Date("2026-09-16T12:00:00.000Z");
    const result = assessTpsFreshness([
        { OCCURRENCE_TIME: Date.parse("2026-09-16T10:00:00.000Z") },
        { OCCURRENCE_TIME: Date.parse("2026-09-15T10:00:00.000Z") }
    ], now);

    assert.equal(result.newestOccurrenceAt, "2026-09-16T10:00:00.000Z");
    assert.equal(result.isFresh, true);
});

test("marks the historical TPS source stale", () => {
    const result = assessTpsFreshness([
        { OCCURRENCE_TIME: Date.parse("2022-07-14T21:08:43.000Z") }
    ], new Date("2026-09-16T12:00:00.000Z"));

    assert.equal(result.isFresh, false);
    assert.ok(result.ageMs > 24 * 60 * 60 * 1000);
});
