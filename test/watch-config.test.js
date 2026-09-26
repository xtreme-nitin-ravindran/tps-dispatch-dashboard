import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  WATCH_FIXTURE_STATES,
  WATCH_STORAGE_KEY,
  createLocalWatch,
  defaultWatchRadius,
  loadLocalWatch,
  saveLocalWatch,
  watchFixtureState,
  watchLocationContext,
  watchSupportState
} from '../src/watch-config.js';
import { validateWatch } from '../src/watch-matcher.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const moduleSource = readFileSync(new URL('../src/watch-config.js', import.meta.url), 'utf8');
const memoryStorage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};

test('watch surface has an entry point, close control, exact matcher choices, and no Toronto-wide option', () => {
  assert.match(html, /id="openWatch"[^>]*>Watch this area</);
  assert.match(html, /id="watchDialog"/);
  assert.match(html, /id="closeWatch"/);
  const dialog = html.slice(html.indexOf('id="watchDialog"'), html.indexOf('</dialog>', html.indexOf('id="watchDialog"')));
  assert.deepEqual([...dialog.matchAll(/<option value="(0\.5|1|2|5)">/g)].map(match => Number(match[1])), [0.5, 1, 2, 5]);
  assert.doesNotMatch(dialog, /Toronto-wide/);
  for (const value of ['all', 'TFS', 'TPS', 'medical', 'fire', 'ongoing', 'other']) assert.match(dialog, new RegExp(`value="${value}"`));
});

test('watch object maps UI values to the exact Story 33B schema and persists locally', () => {
  const watch = createLocalWatch({
    id: 'local-watch', location: { label: 'Home', latitude: 43.65, longitude: -79.38 },
    radiusKm: 0.5, service: 'TFS', category: 'medical'
  });
  assert.equal(validateWatch(watch).valid, true);
  assert.deepEqual(watch, {
    schema: 'sirento.watch', version: 1, id: 'local-watch',
    centre: { latitude: 43.65, longitude: -79.38 }, radiusKm: 0.5,
    service: 'TFS', category: 'medical', active: true
  });
  assert.equal('label' in watch, false);
  const storage = memoryStorage();
  assert.equal(loadLocalWatch(storage), null);
  saveLocalWatch(storage, watch);
  assert.deepEqual(loadLocalWatch(storage), watch);
  assert.ok(storage.getItem(WATCH_STORAGE_KEY));
  storage.setItem(WATCH_STORAGE_KEY, '{broken');
  assert.equal(loadLocalWatch(storage), null);
  storage.setItem(WATCH_STORAGE_KEY, JSON.stringify({ invalid: true }));
  assert.equal(loadLocalWatch(storage), null);
});

test('selected current, saved, map, and missing location contexts are deterministic', () => {
  assert.deepEqual(watchLocationContext({ fixture: 'current' }), { label: 'Current location', latitude: 43.7001, longitude: -79.42 });
  assert.deepEqual(watchLocationContext({ fixture: 'saved' }), { label: 'Home', latitude: 43.6532, longitude: -79.3832 });
  assert.equal(watchLocationContext({ fixture: 'none', coordinates: [43.7, -79.4] }), null);
  assert.deepEqual(watchLocationContext({ savedLocation: { label: 'Work', latitude: 43.64, longitude: -79.4 } }), { label: 'Work', latitude: 43.64, longitude: -79.4 });
  assert.deepEqual(watchLocationContext({ locationContext: { type: 'current' }, coordinates: [43.7, -79.4], originKind: 'device' }), { label: 'Current location', latitude: 43.7, longitude: -79.4 });
  assert.deepEqual(watchLocationContext({ coordinates: [43.7, -79.4], originKind: 'map' }), { label: 'Selected map area', latitude: 43.7, longitude: -79.4 });
  assert.deepEqual(watchLocationContext({ coordinates: [43.7, -79.4], originKind: 'saved' }), { label: 'Selected location', latitude: 43.7, longitude: -79.4 });
  assert.equal(watchLocationContext({ coordinates: null }), null);
  assert.equal(watchLocationContext({ coordinates: [43.7] }), null);
  assert.equal(watchLocationContext({ coordinates: [43.7, 'west'] }), null);
});

test('radius defaults only to matcher-supported values', () => {
  assert.equal(defaultWatchRadius(0.5), 0.5);
  assert.equal(defaultWatchRadius(5), 5);
  assert.equal(defaultWatchRadius(null), 2);
  assert.equal(defaultWatchRadius('toronto'), 2);
  assert.throws(() => createLocalWatch({ id: 'bad', location: null, radiusKm: 1, service: 'all', category: 'all' }), /Invalid watch/);
});

test('support states cover supported, unsupported, denied, and iOS installation guidance', () => {
  const fixtureEnvironment = value => ({ location: { hostname: 'localhost', search: `?watchFixture=${value}` } });
  assert.equal(watchSupportState(fixtureEnvironment('supported')).kind, 'supported');
  assert.equal(watchSupportState(fixtureEnvironment('unsupported')).kind, 'unsupported');
  assert.equal(watchSupportState(fixtureEnvironment('denied')).kind, 'denied');
  assert.equal(watchSupportState(fixtureEnvironment('ios')).kind, 'ios-install');
  const supported = { Notification: { permission: 'default' }, PushManager: class {}, navigator: { serviceWorker: {} }, location: { hostname: 'example.com', search: '' } };
  assert.equal(watchSupportState(supported).kind, 'supported');
  assert.equal(watchSupportState({ ...supported, Notification: { permission: 'denied' } }).kind, 'denied');
  assert.equal(watchSupportState({ ...supported, Notification: undefined, navigator: { userAgent: 'Desktop' } }).kind, 'unsupported');
  const ios = { ...supported, Notification: undefined, navigator: { userAgent: 'iPhone' }, matchMedia: () => ({ matches: false }) };
  assert.equal(watchSupportState(ios).kind, 'ios-install');
  assert.equal(watchSupportState({ ...ios, matchMedia: () => ({ matches: true }) }).kind, 'unsupported');
  assert.equal(watchSupportState({ ...ios, navigator: { userAgent: 'iPhone', standalone: true } }).kind, 'unsupported');
  assert.equal(watchSupportState({ ...supported, PushManager: undefined }).kind, 'unsupported');
  assert.equal(watchSupportState({ Notification: { permission: 'default' }, PushManager: class {} }).kind, 'unsupported');
});

test('fixtures require an explicit valid state on a loopback hostname', () => {
  for (const fixture of WATCH_FIXTURE_STATES) assert.equal(watchFixtureState({ hostname: 'localhost', search: `?watchFixture=${fixture}` }), fixture);
  assert.equal(watchFixtureState({ hostname: '127.0.0.1', search: '?watchFixture=current' }), 'current');
  assert.equal(watchFixtureState({ hostname: '::1', search: '?watchFixture=saved' }), 'saved');
  assert.equal(watchFixtureState({ hostname: 'sirento.ca', search: '?watchFixture=supported' }), null);
  assert.equal(watchFixtureState({ hostname: 'localhost', search: '?watchFixture=unknown' }), null);
  assert.equal(watchFixtureState({ hostname: 'localhost', search: '' }), null);
  assert.equal(watchFixtureState(null), null);
  assert.equal(watchFixtureState({ hostname: 'localhost' }), null);
});

test('watch implementation requests permission and subscribes only through the explicit submit flow', () => {
  const source = `${app}\n${moduleSource}`;
  assert.doesNotMatch(source, /fetch\s*\([^)]*watch/i);
  assert.match(app, /watchDialog\.showModal\(\)/);
  assert.match(app, /watchDialog\.close\(\)/);
  assert.match(app, /pushController\.activate\(watch, \{ explicitUserAction: true \}\)/);
  assert.match(html, /Save and enable notifications/);
});
