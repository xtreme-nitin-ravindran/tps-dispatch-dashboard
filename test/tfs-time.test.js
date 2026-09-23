import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTfsTimestamp, snapshotIsStale } from '../src/tfs/time.js';
import { parseTfsXml } from '../src/tfs/source.js';
import { buildTfsSnapshot } from '../src/pipeline/tfs-snapshot.js';

for (const [input, expected] of [
    ['2026-09-16T00:43:33', '2026-09-16T04:43:33.000Z'],
    ['2026-01-16 00:43:33', '2026-01-16T05:43:33.000Z'],
    ['2026-03-08T01:59:59', '2026-03-08T06:59:59.000Z'],
    ['2026-03-08T03:00:00', '2026-03-08T07:00:00.000Z'],
    ['2026-03-08T02:30:00', null],
    ['2026-11-01T01:30:00', '2026-11-01T05:30:00.000Z'],
    ['2026-11-01T02:30:00', '2026-11-01T07:30:00.000Z'],
    ['2026-09-16T04:43:33Z', '2026-09-16T04:43:33.000Z'],
    ['2026-09-16T00:43:33-04:00', '2026-09-16T04:43:33.000Z'],
    [1789507683, '2026-09-15T21:28:03.000Z'],
    ['2026-02-30T01:00:00', null],
    ['', null], [null, null], ['invalid', null], ['invalidZ', null]
]) test(`Toronto timestamp: ${input}`, () => assert.equal(parseTfsTimestamp(input), expected));

test('official XML preserves beat and Toronto timestamps through snapshot generation', () => {
    const source = parseTfsXml(`<tfs_active_incidents><update_from_db_time>2026-09-16 01:15:01</update_from_db_time><event><event_num>F26146740</event_num><dispatch_time>2026-09-16T01:07:11</dispatch_time><event_type>MEDICAL</event_type><prime_street>M5M</prime_street><cross_streets/><beat>131</beat><units_disp>P131</units_disp></event></tfs_active_incidents>`);
    const snapshot = buildTfsSnapshot(source, new Date("2026-09-16T05:16:00Z"));
    assert.equal(snapshot.sourceUpdatedAt, '2026-09-16T05:15:01.000Z');
    assert.equal(snapshot.incidents[0].timestamp, '2026-09-16T05:07:11.000Z');
    assert.equal(snapshot.incidents[0].division, '131');
    assert.equal(snapshot.incidents[0].location, 'M5M');
});

test('freshness detects stalled source, stalled updater, and missing metadata', () => {
    const now = Date.parse('2026-09-16T05:20:00Z');
    assert.equal(snapshotIsStale('2026-09-16T05:15:01Z', '2026-09-16T05:16:00Z', now), false);
    assert.equal(snapshotIsStale('2026-09-16T05:00:00Z', '2026-09-16T05:19:00Z', now), true);
    assert.equal(snapshotIsStale('2026-09-16T05:19:00Z', '2026-09-16T05:00:00Z', now), true);
    assert.equal(snapshotIsStale(null, '2026-09-16T05:19:00Z', now), true);
});

test('history selections include the cutoff and exclude older or future calls', async () => {
    const { isWithinHistoryWindow } = await import('../src/tfs/time.js');
    const now = Date.parse('2026-09-16T12:00:00Z');
    for (const hours of [1, 3, 6, 12, 24, 72, 168]) {
        const cutoff = now - hours * 60 * 60 * 1000;
        assert.equal(isWithinHistoryWindow(new Date(cutoff).toISOString(), hours, now), true);
        assert.equal(isWithinHistoryWindow(new Date(cutoff - 1).toISOString(), hours, now), false);
        assert.equal(isWithinHistoryWindow(new Date(now).toISOString(), hours, now), true);
        assert.equal(isWithinHistoryWindow('invalid', hours, now), false);
        assert.equal(isWithinHistoryWindow(now + 1, hours, now), false);
    }
});
