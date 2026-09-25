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
        respondingUnitCount: 19,
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
    assert.equal(normalizeTfsIncident({ timestamp: "2026-09-22T00:00:00Z", units: "" }).respondingUnitCount, undefined);
});

test("normalizes reliable TFS apparatus assignments without deriving severity", () => {
    const result = normalizeTfsIncident({
        timestamp: "2026-09-22T00:00:00Z",
        units: "P213, R214, C20"
    });
    assert.equal(result.respondingUnitCount, 3);
    assert.equal(result.alarmLevel, null);
    assert.equal("severity" in result, false);
});

test("ignores unusable TFS unit values instead of reporting zero", () => {
    for (const units of [undefined, null, "", "  ", 42, {}, [], "Pumper, , Cmd. unit-"]) {
        const result = normalizeTfsIncident({ timestamp: "2026-09-22T00:00:00Z", units });
        assert.equal(result.respondingUnitCount, undefined);
        assert.equal("respondingUnitCount" in result, false);
    }
});

test("preserves unknown apparatus as an Other Unit", () => {
    assert.deepEqual(parseDispatchedUnits("Foobar-9"), [
        { type: "Other Unit", numbers: ["Foobar-9"] }
    ]);
});

test('normalization rejects non-records and handles missing fields and unit identifiers', () => {
 for (const value of [null,undefined,'bad']) assert.throws(()=>normalizeTfsIncident(value), /must be an object/);
 const result=normalizeTfsIncident({timestamp:'2026-09-22T00:00:00Z',division:'D1',alarm_level:'bad',isOngoing:false,cad:1});
 assert.equal(result.description,'Fire incident');assert.equal(result.location,'Location not published');assert.equal(result.division,'D1');assert.equal(result.alarmLevel,null);assert.equal(result.isOngoing,false);
 assert.deepEqual(parseDispatchedUnits('Pumper, , REHAB, Z99'),[{type:'Rehab Unit',numbers:['unit']},{type:'Other Unit',numbers:['Z99']}]);
});

test('TFS fetch propagates HTTP failures and the supplied abort signal', async () => {
 const {fetchTfsSource}=await import('../src/tfs/source.js');
 const signal=new AbortController().signal;
 await assert.rejects(fetchTfsSource({signal,fetchImpl:async(url,options)=>{
  assert.equal(options.signal,signal);return {ok:false,status:503};
 }}), /HTTP 503/);
 const result=await fetchTfsSource({fetchImpl:async()=>({ok:true,text:async()=>'<tfs_active_incidents><update_from_db_time>2026-09-22T00:00:00Z</update_from_db_time><event><event_num>F1</event_num><prime_street>A &amp; B &#35; &#x43;</prime_street></event><event><event_num></event_num></event></tfs_active_incidents>'})});
 assert.equal(result.incidents.length,1);
 assert.equal(result.incidents[0].location,'A & B # C');
});
