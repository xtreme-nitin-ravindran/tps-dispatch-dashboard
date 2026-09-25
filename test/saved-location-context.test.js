import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { distanceKm, withinGeographicScope } from '../src/nearby.js';
import { nearbyEmptyState } from '../src/nearby-empty-state.js';
import { nearbySummary } from '../src/nearby-summary.js';
import { sortNearbyCalls } from '../src/nearby-sort.js';
import { referenceCoordinates, savedLocationForContext } from '../src/saved-locations.js';

const [app, html] = await Promise.all([
  readFile(new URL('../app.js', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8')
]);
const home = { id: 'home', label: 'Home', latitude: 43.65, longitude: -79.38 };
const savedState = { locations: [home], locationContext: { type: 'saved', id: 'home' } };
const origin = referenceCoordinates(savedState, [43.8, -79.5]);
const call = (id, coordinates, timestamp = Date.now()) => ({ id, timestamp, geography: { coordinates } });
const coordinatesForCall = item => item.geography.coordinates;

test('saved context resolves its coordinates without replacing live coordinates', () => {
  const live = [43.8, -79.5];
  assert.deepEqual(origin, [43.65, -79.38]);
  assert.deepEqual(live, [43.8, -79.5]);
  assert.equal(savedLocationForContext(savedState), home);
  assert.deepEqual(referenceCoordinates({ ...savedState, locationContext: { type: 'current' } }, live), live);
});

test('radius, distance, nearest sort, summary, and empty fallback use the saved origin', () => {
  const near = call('near', [43.651, -79.38], Date.now() - 1_000);
  const far = call('far', [43.7, -79.4], Date.now());
  assert.equal(withinGeographicScope(origin, 2, near.geography.coordinates), true);
  assert.equal(withinGeographicScope(origin, 2, far.geography.coordinates), false);
  assert.ok(distanceKm(origin, near.geography.coordinates) < distanceKm(origin, far.geography.coordinates));
  assert.deepEqual(sortNearbyCalls([far, near], 'nearest', origin, coordinatesForCall).map(item => item.id), ['near', 'far']);
  assert.match(nearbySummary([near, far], 10, Date.now(), origin, coordinatesForCall), /closest/i);
  assert.match(nearbyEmptyState({ radiusKm: 0.5, origin, matchingCalls: [far], coordinatesForCall }).message, /Closest recent call/);
});

test('selector, recenter, current-location restoration, and preserved state use existing paths', () => {
  assert.match(html, /id="locationContext"[\s\S]*Current location/);
  assert.match(app, /locationContextStatus\.textContent = selected \? `Showing near \$\{selected\.label\}`/);
  assert.match(app, /state\.nearby = referenceCoordinates\(state, liveLocation\)/);
  assert.match(app, /mapHasFitted = false;[\s\S]*updateNearbyView\(\)/);
  assert.match(app, /dispatchMap\.setView\(state\.nearby,/);
  assert.match(app, /function useCurrentLocation\(\)[\s\S]*state\.nearby = null;[\s\S]*requestLocation\(state\.radiusKm/);
  assert.match(app, /function requestLocation[\s\S]*state\.locationContext\.type === 'saved'[\s\S]*state\.nearby = null/);
  assert.match(app, /liveLocation = \[\.\.\.state\.nearby\]/);
  assert.doesNotMatch(app.slice(app.indexOf('function useSavedLocation'), app.indexOf('function useCurrentLocation')), /radiusKm\s*=|serviceFilter\s*=|eventFilter\s*=|nearbySort\s*=|roadOverlay/);
});

test('selection reconciliation, clustering, road visibility, stale fallback, and privacy remain intact', () => {
  assert.match(app, /focusedCallId = reconcileIncidentSelection\(focusedCallId, state\.filtered\)/);
  assert.match(app, /const groups = clusterPoints\(locatedCalls,/);
  assert.match(app, /renderDisruptions\(state\.disruptions, radiusFilterOrigin\(\), state\.radiusKm, dispatchMap\)/);
  assert.match(app, /if \(!saved\) \{[\s\S]*useCurrentLocation\(\)/);
  const switchBlock = app.slice(app.indexOf('function useSavedLocation'), app.indexOf('function useCurrentLocation'));
  assert.doesNotMatch(switchBlock, /fetch\(|snapshotUrl|console\./);
});
