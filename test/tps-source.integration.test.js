import test from "node:test";
import assert from "node:assert/strict";
import { fetchTpsSource } from "../src/tps/source.js";
import { normalizeTpsIncident } from "../src/tps/normalize.js";

test("normalizes one random record from the official TPS source", { timeout: 30_000 }, async () => {
    const source = await fetchTpsSource({ limit: 100 });
    assert.equal(source.source, "TPS");
    assert.ok(source.incidents.length > 0, "official TPS source returned no records");
    assert.match(source.freshness.newestOccurrenceAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(typeof source.freshness.isFresh, "boolean");
    if (!source.freshness.isFresh) {
        console.warn(`Official TPS source is stale; newest record: ${source.freshness.newestOccurrenceAt}`);
    }

    const rawIncident = source.incidents[Math.floor(Math.random() * source.incidents.length)];
    const incident = normalizeTpsIncident(rawIncident);

    assert.equal(incident.source, "TPS");
    assert.equal(incident.eventType, "police");
    assert.ok(incident.id.length > 0);
    assert.ok(incident.description.length > 0);
    assert.ok(incident.location.length > 0);
    assert.match(incident.timestamp, /^\d{4}-\d{2}-\d{2}T/);
    assert.ok(incident.latitude >= 43.4 && incident.latitude <= 44.0);
    assert.ok(incident.longitude >= -80.0 && incident.longitude <= -79.0);
});
