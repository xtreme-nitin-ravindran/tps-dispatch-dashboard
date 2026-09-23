import test from "node:test";
import assert from "node:assert/strict";
import { fetchTfsSource } from "../src/tfs/source.js";
import { normalizeTfsIncident } from "../src/tfs/normalize.js";

test("normalizes one incident from the official TFS live source when active calls exist", { timeout: 30_000 }, async () => {
    const source = await fetchTfsSource({ signal: AbortSignal.timeout(25000) });
    assert.match(source.updatedAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    assert.ok(Array.isArray(source.incidents));
    for (const rawIncident of source.incidents.slice(0, 1)) {
        const incident = normalizeTfsIncident(rawIncident);
        assert.equal(incident.source, "TFS");
        assert.equal(incident.eventType, "fire");
        assert.match(incident.id, /^F\d+$/);
        assert.ok(incident.description.length > 0);
        assert.ok(incident.location.length > 0);
        assert.match(incident.timestamp, /^\d{4}-\d{2}-\d{2}T/);
        assert.ok(Array.isArray(incident.vehicles));
    }
});
