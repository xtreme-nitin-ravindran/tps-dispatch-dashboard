import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { filterDefaults, loadPreferences, savePreferences } from '../src/view-controls.js';

function memoryStorage(initial = null) {
  let raw = initial;
  return {
    getItem: () => raw,
    setItem: (_, value) => { raw = value; },
    raw: () => raw
  };
}

test('saved radius, filters, history, and Map / Calls view are restored', () => {
  const storage = memoryStorage();
  savePreferences(storage, {
    ...filterDefaults,
    radiusKm: 2,
    hours: 72,
    serviceFilter: 'TPS',
    eventFilter: 'ongoing'
  }, { mobileView: 'calls' });

  const saved = loadPreferences(storage);
  assert.equal(saved.radiusKm, 2);
  assert.equal(saved.mobileView, 'calls');
  assert.deepEqual(saved.filters, {
    ...filterDefaults,
    hours: 72,
    serviceFilter: 'TPS',
    eventFilter: 'ongoing'
  });
});

test('invalid and stale stored options fall back to current defaults', () => {
  const storage = memoryStorage(JSON.stringify({
    radiusKm: 10,
    mobileView: 'globe',
    hours: 48,
    service: 'EMS',
    event: 'obsolete'
  }));
  const saved = loadPreferences(storage);
  assert.equal(saved.radiusKm, null);
  assert.equal(saved.mobileView, 'map');
  assert.deepEqual(saved.filters, filterDefaults);
});

test('missing preferences preserve existing defaults', () => {
  assert.equal(loadPreferences(memoryStorage()), null);
});

test('preference changes are written without exact coordinates or transient state', () => {
  const storage = memoryStorage();
  savePreferences(storage, {
    ...filterDefaults,
    radiusKm: 5,
    nearby: [43.6532, -79.3832],
    focusedCallId: 'incident-secret',
    isNew: true,
    isUpdated: true
  }, { mobileView: 'calls' });

  const record = JSON.parse(storage.raw());
  assert.equal(record.radiusKm, 5);
  assert.equal(record.mobileView, 'calls');
  assert.equal(record.nearby, undefined);
  assert.equal(record.focusedCallId, undefined);
  assert.equal(record.isNew, undefined);
  assert.equal(record.isUpdated, undefined);
  assert.ok(!storage.raw().includes('43.6532'));
  assert.ok(!storage.raw().includes('-79.3832'));
});

test('UI changes persist through the existing state update paths', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(app, /function setMobileView\([\s\S]*?if \(persist\) rememberPreferences\(\)/);
  assert.match(app, /state\.eventFilter = toggle\.dataset\.eventFilter;[\s\S]*?applyFilters\(\)/);
  assert.match(app, /state\.serviceFilter = event\.target\.value;[\s\S]*?applyFilters\(\)/);
  assert.match(app, /state\.hours = Number\(event\.target\.value\);[\s\S]*?applyFilters\(\)/);
  assert.match(app, /rememberPreferences\(\{ radiusKm \}\);[\s\S]*?requestLocation\(radiusKm\)/);
});
