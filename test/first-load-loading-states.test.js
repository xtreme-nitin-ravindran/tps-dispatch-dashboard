import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mobileAuditFixtureSnapshot } from '../src/mobile-audit-fixture.js';
import { uxReliabilityFixtureOptions } from '../src/ux-reliability-audit.js';

const [html, css, app] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../assets/css/styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/app.js', import.meta.url), 'utf8')
]);

test('map has an immediate non-blocking status until the first tile is usable', () => {
  assert.match(html, /id="dispatchMap"[^>]*aria-busy="true"/);
  assert.match(html, /id="mapLoadStatus"[^>]*role="status"[^>]*aria-live="polite"[\s\S]*?Loading map…/);
  assert.match(css, /\.map-load-status \{[\s\S]*?position: absolute;[\s\S]*?pointer-events: none/);
  assert.match(app, /tileLayer\.once\('tileload', \(\) => setMapLoadPhase\('ready'\)\)/);
  assert.match(app, /tileLayer\.once\('tileerror',[\s\S]*?Map tiles are temporarily unavailable/);
});

test('initial incident surface is one status, never blank incident shells', () => {
  const initialList = html.match(/<div class="call-list" id="callList"[\s\S]*?<\/div>\s*<\/div>\s*<aside/)[0];
  assert.match(initialList, /aria-busy="true"/);
  assert.match(initialList, /class="loading-state" role="status" aria-live="polite"/);
  assert.match(initialList, /Loading calls…/);
  assert.doesNotMatch(initialList, /incident-card/);
  assert.match(app, /fragment\.appendChild\(createIncidentCard/);
  assert.match(app, /list\.replaceChildren\(fragment\)/);
});

test('interactive startup controls cannot replace loading with an unavailable result', () => {
  const renderCalls = app.slice(app.indexOf('function renderCalls()'), app.indexOf('\nfunction currentIncidentListKey()'));
  assert.match(renderCalls, /loadPhases\.incidents === 'loading' && !snapshotLoaded/);
  assert.match(renderCalls, /els\.resultCount\.textContent = 'LOADING'/);
  assert.ok(renderCalls.indexOf("loadPhases.incidents === 'loading'") < renderCalls.indexOf('renderIncidentFeedStatus()'));
});

test('first populated commit yields for a loading paint without delaying refreshes', () => {
  assert.match(app, /function yieldForLoadingPaint\(\)[\s\S]*?requestAnimationFrame\(\(\) => requestAnimationFrame\(resolve\)\)/);
  assert.match(app, /const firstSnapshot = !snapshotLoaded;\s*if \(firstSnapshot\) await yieldForLoadingPaint\(\)/);
  assert.match(app, /applyFilters\(\);[\s\S]*?const availability = incidentAvailability\(\);[\s\S]*?setIncidentLoadPhase\(/);
});

test('collapsed sheet and Quick Look expose loading while actions remain enabled', () => {
  assert.match(html, /id="mobileSheetSummary"[^>]*>Loading nearby calls…<\/span>/);
  assert.match(html, /<button id="nearMe"[^>]*>What's happening near me\?<\/button>|<button id="nearMe"[^>]*>What’s happening near me\?<\/button>/);
  assert.match(html, /id="quickLookDataStatus"[^>]*role="status"[^>]*>Loading calls… Location controls are ready\.<\/p>/);
  assert.doesNotMatch(html.match(/<button id="nearMe"[^>]*>/)[0], /disabled/);
});

test('loading, zero, unavailable, and stale incident states stay distinct', () => {
  const zero = mobileAuditFixtureSnapshot('zero', Date.UTC(2026, 8, 28));
  const unavailable = mobileAuditFixtureSnapshot('unavailable', Date.UTC(2026, 8, 28));
  const stale = mobileAuditFixtureSnapshot('stale', Date.UTC(2026, 8, 28));
  assert.equal(zero.incidents.length, 0);
  assert.equal(zero.feeds.TFS.status, 'ok');
  assert.equal(unavailable.incidents.length, 0);
  assert.equal(unavailable.feeds.TFS.status, 'unavailable');
  assert.ok(stale.incidents.length > 0);
  assert.equal(stale.feeds.TFS.status, 'stale');
  assert.match(app, /This is not a zero-call result/);
  assert.match(app, /setIncidentLoadPhase\('error'\)/);
});

test('success and errors always supersede the initial incident loader', () => {
  assert.match(app, /setIncidentLoadPhase\(!availability\.hasRelevantCachedData[\s\S]*?'unavailable' : 'ready'\)/);
  assert.match(app, /if \(!snapshotLoaded\) \{\s*setIncidentLoadPhase\('error'\)/);
  assert.match(app, /els\.callList\.innerHTML = `[\s\S]*?error-state/);
  assert.match(app, /quickLookDataStatus\.hidden = phase === 'ready'/);
  assert.match(app, /\['error', 'unavailable'\]\.includes\(loadPhases\.incidents\)/);
});

test('a previous service worker cannot leave new static loaders stuck over an older app module', () => {
  assert.match(css, /html:not\(\[data-map-load-state\]\) #dispatchMap\.leaflet-container \+ \.map-load-status \{ display: none; \}/);
  assert.match(css, /html:not\(\[data-incident-load-state\]\):has\(#callList > :not\(\.loading-state\)\) \.quick-look-data-status \{ display: none; \}/);
});

test('reliability delays remain explicit and loopback-only', () => {
  const query = '?mobileAuditUx=reliability&mobileAuditDelay=incident,secondary,map';
  assert.equal(uxReliabilityFixtureOptions({hostname:'sirento.ca',search:query}), null);
  assert.deepEqual(
    [...uxReliabilityFixtureOptions({hostname:'127.0.0.1',search:query}).delays],
    ['incident', 'secondary', 'map']
  );
});
