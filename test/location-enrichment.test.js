import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichLocations } from '../src/pipeline/location-enrichment.js';
const now = new Date('2026-09-19T04:00:00Z');
const options = { now, source: 'test-open-data', resolveLocation: async () => ({
  text: 'Example Street', coordinates: [43.7,-79.4], approximate: true, division: 'Division 51'
}) };
const snapshot = (...locations) => ({ incidents: locations.map(location => ({location})) });
test('resolves duplicate locations once and reuses published cache across updaters', async () => {
  let count = 0;
  const first = await enrichLocations(snapshot('A','A'), null, {
    ...options, resolveLocation: async value => { count++; return options.resolveLocation(value); }
  });
  assert.equal(count, 1);
  const next = await enrichLocations(snapshot('A'), first, {
    ...options, resolveLocation: assert.fail
  });
  assert.deepEqual(next.incidents[0].geography, first.incidents[0].geography);
});
test('bounds lookups and retries pending locations on the next run', async () => {
  const first = await enrichLocations(snapshot('A','B'), null, {...options, maxLookups:1});
  assert.equal(first.incidents[1].geography.coordinates, null);
  const next = await enrichLocations(snapshot('A','B'), first, {...options, maxLookups:1});
  assert.deepEqual(next.incidents[1].geography.coordinates, [43.7,-79.4]);
});
test('expired cached results survive resolver outages and unused cache is removed', async () => {
  const first = await enrichLocations(snapshot('A','B'), null, options);
  const next = await enrichLocations(snapshot('A'), first, {
    ...options, now: new Date('2026-11-19T04:00:00Z'), resolveLocation: async () => { throw new Error('offline'); }
  });
  assert.deepEqual(next.incidents[0].geography.coordinates, [43.7,-79.4]);
  assert.equal(next.locationCache.B, undefined);
});
