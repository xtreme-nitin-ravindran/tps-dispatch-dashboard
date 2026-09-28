import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPoliceBoundaryLayer, validatePoliceBoundaryGeoJSON } from '../src/police-boundary-overlay.js';

const bundled = JSON.parse(readFileSync(new URL('../data/police-divisions.geojson', import.meta.url)));

test('bundled boundaries contain only valid closed Polygon and MultiPolygon rings', () => {
  const totals = validatePoliceBoundaryGeoJSON(bundled);
  assert.deepEqual(totals, { features: 16, polygons: 18, rings: 19, coordinates: 24459 });
});

test('validation rejects malformed nesting, open rings, invalid positions, and reversed coordinates', () => {
  const collection = coordinates => ({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates } }]
  });
  assert.throws(() => validatePoliceBoundaryGeoJSON(collection([[[-79.4, 43.6], [-79.3, 43.6], [-79.3, 43.7], [-79.4, 43.7]]])), /closed ring/);
  assert.throws(() => validatePoliceBoundaryGeoJSON(collection([[[-79.4, 43.6], null, [-79.3, 43.7], [-79.4, 43.6]]])), /array|position/);
  assert.throws(() => validatePoliceBoundaryGeoJSON(collection([[[43.6, -79.4], [43.7, -79.4], [43.7, -79.3], [43.6, -79.4]]])), /longitude\/latitude/);
  assert.throws(() => validatePoliceBoundaryGeoJSON({ type: 'FeatureCollection', features: [{ geometry: { type: 'LineString', coordinates: [] } }] }), /Polygon or MultiPolygon/);
  assert.throws(() => validatePoliceBoundaryGeoJSON(null), /GeoJSON FeatureCollection/);
  assert.throws(() => validatePoliceBoundaryGeoJSON({ type: 'FeatureCollection', features: null }), /GeoJSON FeatureCollection/);
});

test('unfilled clipped SVG overlay preserves separate rings and does not mutate source geometry', () => {
  const source = structuredClone(bundled);
  let received;
  const leaflet = {
    geoJSON(boundaries, options) {
      received = { boundaries, options };
      return { kind: 'layer' };
    }
  };
  const result = createPoliceBoundaryLayer(leaflet, source, { color: '#123456' });
  assert.deepEqual(result, { kind: 'layer' });
  assert.equal(received.boundaries, source);
  assert.equal(received.options.noClip, undefined, 'Leaflet viewport clipping remains enabled');
  assert.equal(received.options.style.fill, false);
  assert.equal(received.options.style.className, 'police-boundary');
  assert.equal(received.options.style.color, '#123456');
  createPoliceBoundaryLayer(leaflet, source);
  assert.equal(received.options.style.color, '#93c5fd', 'default styling remains available');
  assert.equal(received.options.onEachFeature, undefined);
  assert.equal(source.features[5].geometry.coordinates.length, 2, 'separate rings are not joined');
  assert.deepEqual(source, bundled);
});

test('the boundary class cannot override Leaflet and fill the map', () => {
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.police-boundary\s*{[^}]*fill:\s*none\s*!important/s);
  assert.doesNotMatch(css, /\.police-boundary\s*{[^}]*fill:\s*var\(--boundary-marker\)/s);
});

test('application creates one reusable boundary layer across view changes and native toggles', () => {
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.equal([...app.matchAll(/createPoliceBoundaryLayer\(/g)].length, 1);
  assert.match(app, /if \(boundaryVisible\) divisionLayer\.addTo\(dispatchMap\)/);
  assert.match(app, /event\.layer !== divisionLayer/);
  const viewSetter = app.slice(app.indexOf('function setMobileView('), app.indexOf('\nmobileViewToggles.forEach'));
  assert.doesNotMatch(viewSetter, /createPoliceBoundaryLayer|removeLayer|clearLayers/);
});
