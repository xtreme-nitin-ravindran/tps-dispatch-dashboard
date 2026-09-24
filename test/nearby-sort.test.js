import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sortNearbyCalls } from '../src/nearby-sort.js';

const [app, html] = await Promise.all([
  readFile(new URL('../app.js', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8')
]);

const origin = [43.65, -79.38];
const call = (id, minutes, coordinates) => ({
  id,
  time: new Date(Date.UTC(2026, 8, 24, 12, minutes)),
  coordinates
});

test('Nearest orders calls by distance ascending with deterministic time and id ties', () => {
  const calls = [
    call('far', 59, [43.67, -79.38]),
    call('tie-b', 20, [43.651, -79.38]),
    call('tie-a', 20, [43.651, -79.38]),
    call('near-newer', 30, [43.651, -79.38])
  ];
  assert.deepEqual(sortNearbyCalls(calls, 'nearest', origin).map(item => item.id), ['near-newer', 'tie-a', 'tie-b', 'far']);
});

test('Newest orders calls by reported time descending with deterministic id ties', () => {
  const calls = [call('older', 10, origin), call('same-b', 30, origin), call('same-a', 30, origin)];
  assert.deepEqual(sortNearbyCalls(calls, 'newest', origin).map(item => item.id), ['same-a', 'same-b', 'older']);
});

test('sorting handles unavailable locations, timestamp fallbacks, and stable anonymous ties', () => {
  const timestampOnly = { id: 'timestamp', timestamp: '2026-09-24T12:30:00Z' };
  const invalidTime = { id: 'invalid', time: 'not-a-date' };
  const anonymousA = { timestamp: 'not-a-date' };
  const anonymousB = { timestamp: 'not-a-date' };

  assert.deepEqual(sortNearbyCalls([invalidTime, timestampOnly]).map(item => item.id), ['timestamp', 'invalid']);
  assert.deepEqual(sortNearbyCalls([anonymousA, anonymousB], 'nearest', origin), [anonymousA, anonymousB]);
  assert.deepEqual(
    sortNearbyCalls([timestampOnly, call('located', 0, origin)], 'nearest', origin, item => item.coordinates),
    [call('located', 0, origin), timestampOnly]
  );
  assert.deepEqual(sortNearbyCalls([invalidTime, timestampOnly], 'nearest'), [timestampOnly, invalidTime]);
});

test('sort control has only the requested modes and Nearest follows location availability', () => {
  const controlMatch = html.match(/<select id="nearbySort"[\s\S]*?<\/select>/);
  assert.ok(controlMatch);
  const control = controlMatch[0];
  assert.deepEqual([...control.matchAll(/value="([^"]+)"/g)].map(match => match[1]), ['nearest', 'newest']);
  assert.match(app, /querySelector\('\[value="nearest"\]'\)\.disabled = !state\.nearby/);
});

test('sort changes rerender loaded calls without fetching or changing filters, radius, or selection', () => {
  const start = app.indexOf("nearbySort.addEventListener('change'");
  const handler = app.slice(start, app.indexOf("\n});", start) + 4);
  assert.match(handler, /state\.nearbySort =/);
  assert.match(handler, /renderCalls\(\)/);
  assert.doesNotMatch(handler, /fetch|refreshLoop|applyFilters|radiusKm|focusedCallId/);
  assert.match(app, /focusedCallId = reconcileIncidentSelection\(focusedCallId, state\.filtered\)/);
});

test('mobile view switching preserves the session sort selection', () => {
  const start = app.indexOf('function setMobileView(');
  const setter = app.slice(start, app.indexOf('\nmobileViewToggles.forEach', start));
  assert.doesNotMatch(setter, /nearbySort/);
  assert.match(app, /sortNearbyCalls\(state\.filtered, state\.nearbySort, state\.nearby, coordinatesForCall\)/);
});
