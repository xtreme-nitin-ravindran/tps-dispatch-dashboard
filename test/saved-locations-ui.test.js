import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  SAVED_LOCATIONS_STORAGE_KEY,
  addSavedLocation,
  deleteSavedLocation,
  loadSavedLocationState,
  renameSavedLocation,
  selectSavedLocation
} from '../src/saved-locations.js';

const [html, css, app] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../app.js', import.meta.url), 'utf8')
]);

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    raw: () => values.get(SAVED_LOCATIONS_STORAGE_KEY)
  };
}

test('save action opens a compact, labelled dialog with save and cancel controls', () => {
  assert.match(html, /<button id="saveLocation"[^>]*>Save location<\/button>/);
  assert.match(html, /<dialog id="savedLocationsDialog"[^>]*aria-labelledby="savedLocationsTitle"/);
  assert.match(html, /id="savedLocationLabel"[^>]*maxlength="60"/);
  assert.match(html, /id="submitSavedLocation" type="submit">Save<\/button>/);
  assert.match(html, /id="cancelSavedLocation" type="button">Cancel<\/button>/);
  assert.match(app, /saveLocationButton\.addEventListener\('click', \(\) => openSavedLocations\('save'\)\)/);
  assert.match(app, /savedLocationsDialog\.showModal\(\)/);
});

test('valid save is immediate, blank labels show helper validation, and cancel does not persist', () => {
  const storage = memoryStorage();
  let state = loadSavedLocationState(storage);
  state = addSavedLocation(storage, state, { label: 'Home', latitude: 43.65, longitude: -79.38 }, () => 'home');
  assert.equal(JSON.parse(storage.raw()).locations[0].label, 'Home');
  assert.throws(() => addSavedLocation(storage, state, { label: '  ', latitude: 43.66, longitude: -79.39 }), /label/);
  assert.match(html, /id="savedLocationError"[^>]*role="alert"[^>]*hidden/);
  assert.match(app, /showSavedLocationError\(error\)/);
  const cancelHandler = app.slice(app.indexOf("document.querySelector('#cancelSavedLocation')"), app.indexOf("savedLocationForm.addEventListener('submit'"));
  assert.doesNotMatch(cancelHandler, /addSavedLocation|renameSavedLocation|deleteSavedLocation|setItem/);
});

test('five-location maximum is visible and prevents another save', () => {
  assert.match(app, /state\.savedLocations\.length >= MAX_SAVED_LOCATIONS/);
  assert.match(app, /saveLocationButton\.disabled = !state\.nearby \|\| atLimit/);
  assert.match(app, /You can save up to \$\{MAX_SAVED_LOCATIONS\} locations\./);
});

test('rename preserves identity and coordinates, delete targets one entry, and active deletion falls back', () => {
  const storage = memoryStorage();
  let state = addSavedLocation(storage, loadSavedLocationState(storage), { label: 'Home', latitude: 43.65, longitude: -79.38 }, () => 'home');
  state = addSavedLocation(storage, state, { label: 'Office', latitude: 43.66, longitude: -79.39 }, () => 'office');
  const before = state.locations[1];
  state = renameSavedLocation(storage, state, 'office', 'Work');
  assert.deepEqual(state.locations[1], { ...before, label: 'Work' });
  state = selectSavedLocation(storage, state, 'home');
  state = deleteSavedLocation(storage, state, 'home');
  assert.deepEqual(state.locations.map(({ id, label }) => ({ id, label })), [{ id: 'office', label: 'Work' }]);
  assert.deepEqual(state.locationContext, { type: 'current' });
  assert.match(app, /button\.textContent = 'Confirm delete'/);
});

test('management renders labels only, preserves stable order, and never displays coordinates', () => {
  const renderBlock = app.slice(app.indexOf('function renderSavedLocations()'), app.indexOf('function openSavedLocations'));
  assert.match(renderBlock, /state\.savedLocations\.map\(location =>/);
  assert.match(renderBlock, /label\.textContent = location\.label/);
  assert.doesNotMatch(renderBlock, /latitude|longitude|coordinates/);
  assert.match(html, /id="manageSavedLocations"[^>]*hidden>Manage saved locations/);
});

test('desktop and mobile controls remain usable without changing map toolbar controls', () => {
  assert.match(css, /\.saved-locations-dialog \{ width: min\(92vw, 460px\)/);
  assert.match(css, /@media \(max-width: 480px\)[^{]*\{[^}]*\.saved-locations-dialog/);
  assert.match(css, /\.saved-location-item-actions button \{ min-height: 44px; \}/);
  assert.match(html, /id="chooseArea"[^>]*>Choose an area on the map<\/button>/);
  assert.match(html, /id="clearNearby"[^>]*>Clear nearby filter<\/button>/);
  assert.equal([...html.matchAll(/data-radius-km=/g)].length, 5);
});
