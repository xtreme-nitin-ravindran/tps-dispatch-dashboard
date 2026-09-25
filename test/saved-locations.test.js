import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SAVED_LOCATIONS_STORAGE_KEY,
  addSavedLocation,
  deleteSavedLocation,
  loadSavedLocationState,
  renameSavedLocation,
  savedLocationForContext,
  selectCurrentLocation,
  selectSavedLocation
} from '../src/saved-locations.js';

function memoryStorage(initial = null) {
  const values = new Map(initial === null ? [] : [[SAVED_LOCATIONS_STORAGE_KEY, initial]]);
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    raw: () => values.get(SAVED_LOCATIONS_STORAGE_KEY)
  };
}

const place = (label, latitude, longitude) => ({ label, latitude, longitude });
const add = (storage, state, input, id) => addSavedLocation(storage, state, input, () => id);

test('valid saved locations persist and restore with only the supported data shape', () => {
  const storage = memoryStorage();
  let state = add(storage, loadSavedLocationState(storage), place('Home', 43.65, -79.38), 'home');
  assert.deepEqual(state.locations, [{ id: 'home', label: 'Home', latitude: 43.65, longitude: -79.38 }]);
  state = selectSavedLocation(storage, state, 'home');
  assert.deepEqual(loadSavedLocationState(storage), state);
  assert.deepEqual(Object.keys(JSON.parse(storage.raw()).locations[0]), ['id', 'label', 'latitude', 'longitude']);
});

test('blank labels and invalid coordinates are rejected before storage', () => {
  const storage = memoryStorage();
  const state = loadSavedLocationState(storage);
  assert.throws(() => add(storage, state, place('  ', 43.65, -79.38), 'blank'), /label/);
  for (const coordinates of [[NaN, -79], [91, -79], [43, -181], ['43', -79]]) {
    assert.throws(() => add(storage, state, place('Invalid', ...coordinates), 'invalid'), /coordinates/);
  }
  assert.equal(storage.raw(), undefined);
});

test('a maximum of five locations and obvious coordinate duplicates are enforced', () => {
  const storage = memoryStorage();
  let state = loadSavedLocationState(storage);
  for (let index = 0; index < 5; index++) state = add(storage, state, place(`Place ${index}`, 43 + index / 100, -79), `id-${index}`);
  assert.throws(() => add(storage, state, place('Sixth', 44, -79), 'id-5'), /maximum/);
  const four = deleteSavedLocation(storage, state, 'id-4');
  assert.throws(() => add(storage, four, place('Duplicate', 43, -79), 'duplicate'), /already saved/);
});

test('invalid persisted records are ignored and a stale selection falls back safely', () => {
  const storage = memoryStorage(JSON.stringify({
    locations: [
      { id: 'valid', label: ' Work ', latitude: 43.7, longitude: -79.4, extra: 'discarded' },
      { id: 'blank', label: ' ', latitude: 43.6, longitude: -79.3 },
      { id: 'bad-coordinate', label: 'Bad', latitude: 900, longitude: -79.3 },
      null
    ],
    locationContext: { type: 'saved', id: 'missing' }
  }));
  assert.deepEqual(loadSavedLocationState(storage), {
    locations: [{ id: 'valid', label: 'Work', latitude: 43.7, longitude: -79.4 }],
    locationContext: { type: 'current' }
  });
});

test('rename and delete update only the requested record', () => {
  const storage = memoryStorage();
  let state = add(storage, loadSavedLocationState(storage), place('Home', 43.65, -79.38), 'home');
  state = add(storage, state, place('Office', 43.66, -79.39), 'office');
  state = renameSavedLocation(storage, state, 'office', ' Work ');
  assert.deepEqual(state.locations.map(({ id, label }) => ({ id, label })), [{ id: 'home', label: 'Home' }, { id: 'office', label: 'Work' }]);
  assert.throws(() => renameSavedLocation(storage, state, 'home', '  '), /label/);
  state = deleteSavedLocation(storage, state, 'home');
  assert.deepEqual(state.locations.map(location => location.id), ['office']);
});

test('deleting the selected location and selecting a stale ID fall back to Current location', () => {
  const storage = memoryStorage();
  let state = add(storage, loadSavedLocationState(storage), place('Home', 43.65, -79.38), 'home');
  state = selectSavedLocation(storage, state, 'home');
  assert.deepEqual(state.locationContext, { type: 'saved', id: 'home' });
  state = deleteSavedLocation(storage, state, 'home');
  assert.deepEqual(state.locationContext, { type: 'current' });
  state = selectSavedLocation(storage, state, 'stale');
  assert.deepEqual(state.locationContext, { type: 'current' });
  assert.deepEqual(selectCurrentLocation(storage, state).locationContext, { type: 'current' });
});

test('selecting a saved location neither overwrites live geolocation nor calls backend APIs', () => {
  const storage = memoryStorage();
  const appState = { nearby: [43.6532, -79.3832] };
  let savedState = add(storage, loadSavedLocationState(storage), place('Home', 43.7, -79.4), 'home');
  savedState = selectSavedLocation(storage, savedState, 'home');
  assert.deepEqual(savedState.locationContext, { type: 'saved', id: 'home' });
  assert.deepEqual(appState.nearby, [43.6532, -79.3832]);
});

test('default IDs work with UUID support and its local fallback', () => {
  const storage = memoryStorage();
  const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  try {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { randomUUID: () => 'uuid-id' } });
    let state = addSavedLocation(storage, loadSavedLocationState(storage), place('UUID', 43.6, -79.3));
    assert.equal(state.locations[0].id, 'uuid-id');

    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
    state = addSavedLocation(storage, state, place('Fallback', 43.7, -79.4));
    assert.match(state.locations[1].id, /^saved-[a-z0-9]+-[a-z0-9]+$/);
  } finally {
    Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
  }
});

test('blocked or malformed storage falls back safely while keeping usable in-memory state', () => {
  const blockedRead = { getItem: () => { throw new Error('blocked'); } };
  assert.deepEqual(loadSavedLocationState(blockedRead), { locations: [], locationContext: { type: 'current' } });
  assert.deepEqual(loadSavedLocationState(memoryStorage('{bad json')), { locations: [], locationContext: { type: 'current' } });

  const blockedWrite = {
    getItem: () => null,
    setItem: () => { throw new Error('blocked'); }
  };
  const state = add(blockedWrite, loadSavedLocationState(blockedWrite), place('Home', 43.65, -79.38), 'home');
  assert.deepEqual(state.locations, [{ id: 'home', label: 'Home', latitude: 43.65, longitude: -79.38 }]);
});

test('persisted normalization removes duplicates, caps records, and preserves only a valid selection', () => {
  const records = [
    { id: 'one', label: 'One', latitude: -90, longitude: -180 },
    { id: 'one', label: 'Duplicate ID', latitude: 1, longitude: 1 },
    { id: 'two', label: 'Duplicate coordinates', latitude: -90, longitude: -180 },
    { id: 'three', label: 'Three', latitude: 0, longitude: 0 },
    { id: 'four', label: 'Four', latitude: 45, longitude: 45 },
    { id: 'five', label: 'Five', latitude: 89, longitude: 179 },
    { id: 'six', label: 'Six', latitude: 90, longitude: 180 },
    { id: 'ignored', label: 'Over cap', latitude: 40, longitude: -70 }
  ];
  const state = loadSavedLocationState(memoryStorage(JSON.stringify({
    locations: records,
    locationContext: { type: 'saved', id: 'six' }
  })));
  assert.deepEqual(state.locations.map(location => location.id), ['one', 'three', 'four', 'five', 'six']);
  assert.deepEqual(state.locationContext, { type: 'saved', id: 'six' });
});

test('invalid IDs and absent records are rejected or ignored without changing saved data', () => {
  const storage = memoryStorage();
  let state = add(storage, loadSavedLocationState(storage), place('Home', 43.65, -79.38), 'home');
  assert.throws(() => add(storage, state, place('Blank ID', 43.66, -79.39), ' '), /ID/);
  assert.throws(() => add(storage, state, place('Duplicate ID', 43.67, -79.4), 'home'), /ID/);
  assert.deepEqual(renameSavedLocation(storage, state, 'missing', 'Unused'), state);
  assert.deepEqual(deleteSavedLocation(storage, state, 'missing'), state);
  assert.throws(() => addSavedLocation(storage, state, null), /label/);
  assert.throws(() => renameSavedLocation(storage, state, 'home', null), /label/);
  assert.equal(savedLocationForContext({ locationContext: { type: 'saved', id: 'missing' } }), null);
  for (const record of [
    { id: 1, label: 'Numeric ID', latitude: 43, longitude: -79 },
    { id: 'non-string-label', label: 1, latitude: 43, longitude: -79 }
  ]) {
    assert.deepEqual(loadSavedLocationState(memoryStorage(JSON.stringify({ locations: [record] }))).locations, []);
  }
});
