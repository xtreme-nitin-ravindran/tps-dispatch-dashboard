import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { filterDefaults, readSharedIncident, shareIncident, shareIncidentView } from '../src/view-controls.js';
import { restoreSharedIncident } from '../src/incident-selection.js';

test('incident share URL contains its stable identifier and no private nearby coordinates', () => {
  const state = {...filterDefaults, nearby:[43.6532,-79.3832], radiusKm:2};
  const url = new URL(shareIncidentView('https://sirento.example/?old=value#map', state, 'TFS-123/abc'));
  assert.equal(url.searchParams.get('incident'), 'TFS-123/abc');
  assert.equal(readSharedIncident(url.searchParams), 'TFS-123/abc');
  assert.equal(url.searchParams.get('view'), '1');
  assert.ok(!url.href.includes('43.6532'));
  assert.ok(!url.href.includes('-79.3832'));
  assert.equal(url.hash, '');
  assert.equal(readSharedIncident(new URLSearchParams()), null);
  assert.equal(readSharedIncident(new URLSearchParams({incident:''})), null);
  assert.equal(readSharedIncident(new URLSearchParams({incident:'x'.repeat(301)})).length, 300);
});

test('shared incident selection restores only an available matching incident', () => {
  assert.deepEqual(restoreSharedIncident('TPS-2', [{id:'TFS-1'}, {id:'TPS-2'}]), {id:'TPS-2', found:true});
  assert.deepEqual(restoreSharedIncident('expired', [{id:'TFS-1'}]), {id:null, found:false});
  assert.deepEqual(restoreSharedIncident(null, [{id:'TFS-1'}]), {id:null, found:false});
});

test('native Web Share is used when supported', async () => {
  let shared;
  const result = await shareIncident({share: async data => { shared = data; }, clipboard:{writeText:assert.fail}}, {title:'Incident', url:'https://example.com/?incident=1'});
  assert.equal(result, 'shared');
  assert.equal(shared.url, 'https://example.com/?incident=1');
});

test('copy-link fallback is used when Web Share is unavailable', async () => {
  let copied;
  const result = await shareIncident({clipboard:{writeText:async value => { copied = value; }}}, {url:'https://example.com/?incident=1'});
  assert.equal(result, 'copied');
  assert.equal(copied, 'https://example.com/?incident=1');
});

test('cancelled, failed and unsupported sharing use the expected fallbacks', async () => {
  const abort = Object.assign(new Error('cancelled'), {name:'AbortError'});
  assert.equal(await shareIncident({share:async () => { throw abort; }}, {url:'https://example.com'}), 'cancelled');
  assert.equal(await shareIncident({share:async () => { throw new Error('failed'); }, clipboard:{writeText:async () => {}}}, {url:'https://example.com'}), 'copied');
  assert.equal(await shareIncident({}, {url:'https://example.com'}), 'manual');
});

test('app restores the shared incident through the normal card and marker selection path', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(app, /incidentArrivalState\(requestedId, state\.calls, state\.filtered/);
  assert.match(app, /selectCall\(arrival\.id, \{ revealRow: true, panIfNeeded: true \}\)/);
  assert.match(app, /status\.textContent = arrival\.message/);
  assert.match(app, /shareIncidentView\(location\.href, state, call\.id\)/);
});
