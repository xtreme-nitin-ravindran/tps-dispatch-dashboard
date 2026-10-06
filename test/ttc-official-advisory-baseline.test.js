// Story 51A — Production Contract & Deterministic Regression Baseline.
//
// This suite freezes the real production failure before any behavior change:
// an active official TTC Service Change (route 94, eastbound in prose) is
// visible in `disruptions.transit`, the Story 30 GTFS-RT alert set is healthy
// but empty, and a confirmed direction-specific observed diversion exists in
// the public geometry artifact yet cannot attach to the official advisory.
//
// It asserts the current contracts and stable IDs across:
//   - `disruptions.transit` (official Service Changes)
//   - `ttcAlerts` (Story 30 GTFS-RT alerts)
//   - detector/inference state and the public geometry artifact
//   - the frontend presentation contract (`ttcPresentation`)
//
// No production behavior is changed by this increment.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BASELINE_EPOCH,
  baselineSnapshot,
  baselineStaticIndex,
  officialServiceChangeFeed,
  emptyGtfsAlerts,
  observedEastboundDiversion
} from './fixtures/ttc-official-advisory/baseline.js';
import { currentDisruptions, transitGeographicMatch } from '../src/disruptions/view.js';
import { ttcPresentation } from '../src/ttc/presentation.js';
import { activeTtcAlerts } from '../src/ttc/presentation.js';
import { validateDiversionOutput } from '../src/ttc/diversion-inference.js';

const snapshot = baselineSnapshot();

test('official Service Change for route 94 is active and visible in disruptions.transit', () => {
  const items = currentDisruptions(snapshot.disruptions.transit, 'transit', BASELINE_EPOCH);
  assert.equal(items.length, 1);
  const [item] = items;
  // Stable official identity and provenance.
  assert.equal(item.id, '102');
  assert.equal(item.url, 'https://www.ttc.ca/service-advisories/all-service-alerts');
  assert.deepEqual(item.routes, ['94']);
  assert.equal(item.effect, 'MODIFIED SERVICE');
  // The advisory is route-only: no structured stop coordinates exist.
  assert.deepEqual(item.affectedEntities, [{ routeId: '94', stopId: null }]);
  assert.deepEqual(item.stopIds, []);
  // The direction is expressed only in free-form prose.
  assert.match(item.description, /eastbound/i);
});

test('official advisory text is preserved verbatim and never converted into geometry', () => {
  const [item] = currentDisruptions(snapshot.disruptions.transit, 'transit', BASELINE_EPOCH);
  // The official text remains TTC-provided and unmodified.
  assert.equal(item.title, '94 Wellesley – Temporary route change due to Wellesley Street project');
  assert.match(item.description, /south on Jarvis Street, east on Carlton Street and north on Parliament Street/);
  // No geometry field is invented from the prose.
  assert.equal(item.geometry, undefined);
  assert.equal(item.line, undefined);
  assert.equal(item.coordinates, undefined);
  // The normalized record carries no direction id derived from "eastbound".
  assert.equal(item.directionId, undefined);
  assert.equal(item.affectedEntities[0].directionId, undefined);
});

test('route-only official geography cannot be resolved to a nearby match', () => {
  const [item] = currentDisruptions(snapshot.disruptions.transit, 'transit', BASELINE_EPOCH);
  // No structured coordinates means the advisory cannot be classified as nearby.
  const match = transitGeographicMatch(item, [43.665, -79.38], 1);
  assert.equal(match.relevant, false);
  assert.equal(match.geographicStatus, 'unknown');
  assert.equal(match.nearestDistanceKm, null);
  assert.equal(match.matchedEntity, null);
});

test('Story 30 GTFS-RT alert set is healthy but empty and distinct from unavailable', () => {
  assert.equal(snapshot.ttcAlerts.status, 'ok');
  assert.deepEqual(snapshot.ttcAlerts.items, []);
  // A successful empty feed is not the same as an unavailable source.
  assert.equal(activeTtcAlerts(snapshot.ttcAlerts, BASELINE_EPOCH).length, 0);
  const unavailable = { ...snapshot.ttcAlerts, status: 'unavailable' };
  assert.equal(activeTtcAlerts(unavailable, BASELINE_EPOCH).length, 0);
  assert.notEqual(snapshot.ttcAlerts.status, unavailable.status);
});

test('confirmed direction-specific observed geometry exists for route 94 eastbound', () => {
  const { output, public: published } = snapshot.observed;
  assert.equal(output.diversions.length, 1);
  const [diversion] = output.diversions;
  assert.equal(diversion.routeId, '94');
  assert.equal(diversion.directionId, 0);
  assert.equal(diversion.status, 'confirmed');
  assert.equal(diversion.geometrySource, 'sirento-observed');
  // No GTFS-RT alert exists to attach to, so the association is empty.
  assert.deepEqual(diversion.relatedAlertIds, []);
  // The public artifact carries the confirmed path with no raw fleet evidence.
  assert.equal(published.diversions.length, 1);
  assert.equal(published.diversions[0].routeId, '94');
  assert.equal(published.diversions[0].directionId, 0);
  assert.equal(published.diversions[0].geometrySource, 'sirento-observed');
  assert.doesNotMatch(JSON.stringify(published), /vehicleId|episodeIds|rawEvidence|confidence|identityAnchor/);
});

test('public geometry artifact validates against the Story 30 output contract', () => {
  // The published artifact is a valid diversion output for the baseline index.
  assert.doesNotThrow(() => validateDiversionOutput(snapshot.observed.output, snapshot.index));
});

test('the GTFS-only presentation contract is why geometry cannot appear under the Service Change', () => {
  // The frontend iterates only active GTFS-RT alerts. With a healthy-empty feed
  // there are no items, so the confirmed observed path has nowhere to attach.
  const model = ttcPresentation(snapshot.ttcAlerts, snapshot.ttcDiversions, BASELINE_EPOCH);
  assert.equal(model.items.length, 0);
  assert.equal(model.status, 'ok');
  // The official advisory is not part of this model at all.
  assert.equal(model.items.some(item => item.id === '102'), false);
});

test('the observed path is suppressed even when a GTFS-RT alert exists without a matching id', () => {
  // A GTFS-RT alert for a different route/id must not adopt the route 94 path.
  const unrelated = {
    ...emptyGtfsAlerts(),
    items: [{
      id: 'unrelated-alert',
      header: 'Unrelated detour',
      description: '',
      routes: ['501'],
      stops: [],
      activePeriods: [],
      informedEntities: [],
      source: 'ttc-gtfs-rt',
      fetchedAt: new Date(BASELINE_EPOCH).toISOString(),
      correlation: { status: 'unmatched', routes: [], stops: [], trips: [], routeResults: [], candidates: [] }
    }]
  };
  const model = ttcPresentation(unrelated, snapshot.ttcDiversions, BASELINE_EPOCH);
  assert.equal(model.items.length, 1);
  assert.equal(model.items[0].id, 'unrelated-alert');
  assert.equal(model.items[0].diversions.length, 0);
});

test('the observed path attaches only when relatedAlertIds names the GTFS-RT alert', () => {
  // This documents the current attachment contract: geometry is keyed by the
  // GTFS-RT alert id, not by the official Service Change id.
  const alert = {
    id: 'gtfs-detour',
    header: '94 Wellesley detour',
    description: '',
    routes: ['94'],
    stops: [],
    activePeriods: [],
    informedEntities: [],
    source: 'ttc-gtfs-rt',
    fetchedAt: new Date(BASELINE_EPOCH).toISOString(),
    correlation: { status: 'unmatched', routes: [], stops: [], trips: [], routeResults: [], candidates: [] }
  };
  const feed = { ...emptyGtfsAlerts(), items: [alert] };
  const attached = {
    ...snapshot.ttcDiversions,
    diversions: snapshot.ttcDiversions.diversions.map(d => ({ ...d, relatedAlertIds: ['gtfs-detour'] }))
  };
  const model = ttcPresentation(feed, attached, BASELINE_EPOCH);
  assert.equal(model.items.length, 1);
  assert.equal(model.items[0].diversions.length, 1);
  assert.equal(model.items[0].diversions[0].label, 'Observed by SirenTO');
  // The official Service Change id ('102') is never consulted by this contract.
  assert.equal(model.items[0].id, 'gtfs-detour');
});

test('baseline fixture is deterministic across repeated construction', () => {
  const a = baselineSnapshot();
  const b = baselineSnapshot();
  assert.deepEqual(a.disruptions, b.disruptions);
  assert.deepEqual(a.ttcAlerts, b.ttcAlerts);
  assert.deepEqual(a.ttcDiversions, b.ttcDiversions);
  assert.equal(a.observed.output.diversions[0].id, b.observed.output.diversions[0].id);
});

test('baseline static index exposes both route 94 directions with distinct patterns', () => {
  const index = baselineStaticIndex();
  const patterns = [...index.patterns.values()].filter(p => p.routeId === '94');
  assert.equal(patterns.length, 2);
  assert.deepEqual(patterns.map(p => p.directionId).sort(), [0, 1]);
  assert.equal(new Set(patterns.map(p => p.patternId)).size, 2);
});

test('observed diversion is reproducible from the fixture pipeline alone', () => {
  const direct = observedEastboundDiversion();
  assert.equal(direct.output.diversions.length, 1);
  assert.equal(direct.output.diversions[0].status, 'confirmed');
  assert.equal(direct.output.diversions[0].directionId, 0);
  assert.deepEqual(direct.public.diversions[0].relatedAlertIds, []);
});

test('official feed and empty GTFS-RT feed are independent sources with distinct status', () => {
  const official = officialServiceChangeFeed();
  const gtfs = emptyGtfsAlerts();
  assert.equal(official.status, 'ok');
  assert.equal(official.items.length, 1);
  assert.equal(gtfs.status, 'ok');
  assert.equal(gtfs.items.length, 0);
  // The two sources use different identity namespaces.
  assert.equal(official.items[0].id, '102');
  assert.equal(gtfs.items.length, 0);
});
