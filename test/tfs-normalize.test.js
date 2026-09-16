import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeTfsIncident, parseDispatchedUnits } from "../src/tfs/normalize.js";

const fixture = JSON.parse(await readFile(new URL("./fixtures/tfs-incident.json", import.meta.url)));

test("normalizes a TFS incident into the dashboard contract", () => {
    assert.deepEqual(normalizeTfsIncident(fixture), {
        id: "F26146546",
        source: "TFS",
        eventType: "fire",
        description: "Fire - Residential",
        location: "Pandora Crcl between Wantanopa Crescent & Sedgemount Drive",
        division: "231",
        timestamp: "2026-09-15T21:28:03.000Z",
        alarmLevel: 2,
        isOngoing: true,
        vehicles: [
            { type: "Aerial Truck", numbers: ["213", "221", "231"] },
            { type: "Command Unit", numbers: ["10", "20", "22", "23", "24"] },
            { type: "Hazmat Unit", numbers: ["323"] },
            { type: "Air/Light Unit", numbers: ["231"] },
            { type: "Fire Truck", numbers: ["212", "213", "221", "222", "231", "244", "245"] },
            { type: "Rescue Truck", numbers: ["223"] },
            { type: "Squad Unit", numbers: ["232"] }
        ]
    });
});

test("returns an empty vehicle list when TFS provides no assignments", () => {
    assert.deepEqual(parseDispatchedUnits(""), []);
});

test("preserves unknown apparatus as an Other Unit", () => {
    assert.deepEqual(parseDispatchedUnits("Foobar-9"), [
        { type: "Other Unit", numbers: ["Foobar-9"] }
    ]);
});
