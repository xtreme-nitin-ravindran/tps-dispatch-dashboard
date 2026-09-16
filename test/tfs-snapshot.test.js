import test from "node:test";
import assert from "node:assert/strict";
import { buildTfsSnapshot } from "../src/pipeline/tfs-snapshot.js";

test("builds a dashboard-ready TFS snapshot with freshness metadata", () => {
    const snapshot = buildTfsSnapshot({
        updatedAt: "2026-09-16 12:00:00",
        incidents: [{
            event_id: "F123",
            time: "2026-09-16T11:59:00",
            description: "Fire - Residential",
            location: "Main Street / Queen Street",
            beat: "231",
            alarm_level: "2",
            cad: 1,
            units: "P213, R214"
        }]
    }, new Date("2026-09-16T12:01:00.000Z"));

    assert.equal(snapshot.schemaVersion, 1);
    assert.equal(snapshot.source, "TFS");
    assert.equal(snapshot.fetchedAt, "2026-09-16T12:01:00.000Z");
    assert.equal(snapshot.sourceUpdatedAt, "2026-09-16T16:00:00.000Z");
    assert.equal(snapshot.incidents.length, 1);
    assert.equal(snapshot.incidents[0].id, "F123");
    assert.equal(snapshot.incidents[0].division, "231");
    assert.equal(snapshot.incidents[0].isOngoing, true);
    assert.deepEqual(snapshot.incidents[0].vehicles, [
        { type: "Fire Truck", numbers: ["213"] },
        { type: "Rescue Truck", numbers: ["214"] }
    ]);
});
