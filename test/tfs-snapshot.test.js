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
    }, new Date("2026-09-16T16:01:00.000Z"));

    assert.equal(snapshot.schemaVersion, 1);
    assert.equal(snapshot.source, "TFS");
    assert.equal(snapshot.fetchedAt, "2026-09-16T16:01:00.000Z");
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

test('accumulates history, updates IDs, expires old calls and clears ongoing status', () => {
    const now = new Date('2026-09-16T12:00:00Z');
    const previous = {
        source: 'TFS', fetchedAt: '2026-09-16T11:00:00Z', sourceUpdatedAt: '2026-09-16T11:00:00Z',
        incidents: [
            { id: 'gone', timestamp: '2026-09-15T10:00:00Z', isOngoing: true },
            { id: 'updated', timestamp: '2026-09-16T10:00:00Z', description: 'Old', firstSeenAt: '2026-09-16T10:01:00Z' },
            { id: 'expired', timestamp: '2026-09-14T11:59:59Z' },
            { id: 'boundary', timestamp: '2026-09-14T12:00:00Z' }
        ]
    };
    const source = { updatedAt: '2026-09-16T12:00:00Z', incidents: [
        { event_id: 'updated', time: '2026-09-16T10:00:00Z', description: 'Revised', cad: 1 },
        { event_id: 'new', time: '2026-09-16T11:50:00Z', cad: 1 }
    ] };
    const result = buildTfsSnapshot(source, now, previous);
    assert.deepEqual(result.incidents.map(i => i.id), ['new', 'updated', 'gone', 'boundary']);
    assert.equal(result.incidents[1].description, 'Revised');
    assert.equal(result.incidents[1].firstSeenAt, '2026-09-16T10:01:00Z');
    assert.equal(result.incidents[1].isOngoing, true);
    assert.equal(result.incidents[2].isOngoing, false);
    assert.equal(result.historyStartedAt, previous.fetchedAt);
    assert.equal(result.retentionHours, 48);
    assert.deepEqual(buildTfsSnapshot(source, now, result), result);
    const empty = buildTfsSnapshot({ ...source, incidents: [] }, now, result);
    assert.equal(empty.incidents.length, 4);
    assert.ok(empty.incidents.every(i => !i.isOngoing));
    assert.throws(() => buildTfsSnapshot({ ...source, updatedAt: 'bad' }, now, result));
    assert.throws(() => buildTfsSnapshot({ ...source, updatedAt: '2026-09-16T09:00:00Z' }, now, result));
    assert.throws(() => buildTfsSnapshot(source, now, { source: 'TFS' }));
});

for (const [label, rows] of [
    ['absent from the new feed', []],
    ['marked inactive by cad', [{ cad: 0 }]],
    ['explicitly not ongoing despite cad', [{ cad: 1, isOngoing: false }]]
]) {
    test(`retained ongoing incident becomes inactive when ${label}`, () => {
        const now = new Date('2026-09-16T12:00:00Z');
        const row = { event_id: 'F123', time: '2026-09-16T10:00:00Z', cad: 1 };
        const previous = buildTfsSnapshot({ updatedAt: '2026-09-16T11:00:00Z', incidents: [row] }, new Date('2026-09-16T11:00:00Z'));
        assert.equal(previous.incidents[0].isOngoing, true);
        const result = buildTfsSnapshot({ updatedAt: now.toISOString(), incidents: rows.map(update => ({ ...row, ...update })) }, now, previous);
        assert.equal(result.incidents.length, 1);
        assert.equal(result.incidents[0].id, 'F123');
        assert.equal(result.incidents[0].isOngoing, false);
        assert.equal(previous.incidents[0].isOngoing, true, 'previous snapshot is not mutated');
        const reappeared = buildTfsSnapshot({ updatedAt: now.toISOString(), incidents: [row] }, now, result);
        assert.equal(reappeared.incidents.length, 1);
        assert.equal(reappeared.incidents[0].isOngoing, true);
    });
}
