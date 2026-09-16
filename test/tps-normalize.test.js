import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTpsIncident } from "../src/tps/normalize.js";

test("normalizes a TPS C4S record into the dashboard contract", () => {
    const incident = normalizeTpsIncident({
        OBJECTID: 56,
        OCCURRENCE_TIME: 1657832923000,
        DIVISION: "D32",
        LATITUDE: 43.73215885477184,
        LONGITUDE: -79.45181324619195,
        CALL_TYPE_CODE: "THEPR",
        CALL_TYPE: "THEFT IN PROGRESS",
        CROSS_STREETS: "WILSON AVE - DUFFERIN ST"
    });

    assert.deepEqual(incident, {
        id: "56",
        source: "TPS",
        eventType: "police",
        description: "THEFT IN PROGRESS",
        location: "WILSON AVE - DUFFERIN ST",
        timestamp: "2022-07-14T21:08:43.000Z",
        alarmLevel: null,
        isOngoing: false,
        vehicles: [],
        latitude: 43.73215885477184,
        longitude: -79.45181324619195,
        division: "D32",
        callTypeCode: "THEPR"
    });
});
