import test from "node:test";
import assert from "node:assert/strict";
import { incidentCategory } from "../src/tfs/category.js";

test("medical calls are classified separately", () => {
    assert.equal(incidentCategory("MEDICAL"), "medical");
    assert.equal(incidentCategory("Medical Assist"), "medical");
});

test("fires and alarms remain in Fire, including vehicle fires", () => {
    for (const description of ["Fire - Grass/Rubbish", "Fire - Residential", "Fire - Highrise Residential", "Fire - Commercial/Industrial", "Vehicle Accident with Fire", "Alarm Single Source", "Fire Alarm - Check Call"]) {
        assert.equal(incidentCategory(description), "fire", description);
    }
});

test("non-fire TFS calls populate Other", () => {
    for (const description of ["Vehicle - Personal Injury", "Vehicle - Personal Injury Highway", "Natural Gas Leak", "Rescue - Elevator", "Check Call", "Hazmat Level 1", "Hazmat Level 2", "Public Hazard", "Vehicle Accident - Trapped - Highway", "Rescue - Personal Entrapment", "Vehicle Accident - Trapped", "Vehicle Accident - Minor Fuel Leak", "Wires Down - Hydro", "Water Problem - Level 1", "Rescue - Ring Removal"]) {
        assert.equal(incidentCategory(description), "other", description);
    }
});

test("missing and unfamiliar descriptions safely fall back to Other", () => {
    for (const description of [undefined, null, "", "Unknown incident"]) {
        assert.equal(incidentCategory(description), "other");
    }
});
