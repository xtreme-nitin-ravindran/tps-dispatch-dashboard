import test from "node:test";
import assert from "node:assert/strict";
import { fetchTfsSource } from "../src/tfs/source.js";
import { normalizeTfsIncident } from "../src/tfs/normalize.js";

test("normalizes one random incident from the official TFS live source", { timeout: 30_000 }, async () => {
    const source = await fetchTfsSource({ signal: AbortSignal.timeout(25000) });
    assert.match(source.updatedAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    assert.ok(Array.isArray(source.incidents));
    if (!source.incidents.length) return; // A valid feed may have no active calls.

    const rawIncident = source.incidents[Math.floor(Math.random() * source.incidents.length)];
    const incident = normalizeTfsIncident(rawIncident);

    assert.equal(incident.source, "TFS");
    assert.equal(incident.eventType, "fire");
    assert.match(incident.id, /^F\d+$/);
    assert.ok(incident.description.length > 0);
    assert.ok(incident.location.length > 0);
    assert.match(incident.timestamp, /^\d{4}-\d{2}-\d{2}T/);
    assert.ok(Array.isArray(incident.vehicles));
});
