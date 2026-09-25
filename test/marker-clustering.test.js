import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clusterPoints, focusGroup, spreadPoint } from '../src/map-clusters.js';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const disruptions = readFileSync(new URL('../src/disruptions/ui.js', import.meta.url), 'utf8');

const item = (id, coordinates, properties = {}) => ({
  call: { id, source: 'TFS', eventCategory: 'fire', description: id, ...properties },
  coordinates
});

const projectAtZoom = zoom => ([lat, lng]) => {
  const scale = 2 ** zoom;
  return { x: lng * scale, y: lat * scale };
};

test('dense incidents cluster at wide zoom and split as zoom increases', () => {
  const incidents = [
    item('a', [1, 1]),
    item('b', [1.01, 1.01]),
    item('c', [1.02, 1.02])
  ];

  assert.deepEqual(clusterPoints(incidents, projectAtZoom(5)).map(group => group.length), [3]);
  assert.deepEqual(clusterPoints(incidents, projectAtZoom(14)).map(group => group.length), [1, 1, 1]);
});

test('cluster counts contain only the current filtered incident set', () => {
  const calls = [
    item('fire', [1, 1], { source: 'TFS', eventCategory: 'fire' }),
    item('medical', [1.01, 1.01], { source: 'TFS', eventCategory: 'medical' }),
    item('police', [1.02, 1.02], { source: 'TPS', eventCategory: 'other' })
  ];
  const project = projectAtZoom(5);

  const tfs = calls.filter(({ call }) => call.source === 'TFS');
  const fireSearch = calls.filter(({ call }) => call.eventCategory === 'fire' && call.description.includes('fire'));
  const inRadius = calls.filter(({ coordinates }) => coordinates[0] < 1.015);

  assert.equal(clusterPoints(calls, project)[0].length, 3);
  assert.equal(clusterPoints(tfs, project)[0].length, 2);
  assert.equal(clusterPoints(fireSearch, project)[0].length, 1);
  assert.equal(clusterPoints(inRadius, project)[0].length, 2);
});

test('expanded clusters preserve incident identity and individual marker selection', () => {
  const incidents = [item('a', [1, 1]), item('b', [1.01, 1.01])];
  const group = focusGroup(incidents, 'b', projectAtZoom(5));
  const expanded = group.map((incident, index) => ({
    id: incident.call.id,
    point: spreadPoint(index, group.length, { x: 100, y: 100 })
  }));

  assert.deepEqual(expanded.map(({ id }) => id), ['a', 'b']);
  assert.notDeepEqual(expanded[0].point, expanded[1].point);
  assert.match(app, /addMarker\(item,position,layers\)/);
  assert.match(app, /\.on\("click", event => \{[\s\S]*?selectCall\(call\.id, \{ pan: false, revealRow: true \}\)/);
});

test('incident clustering excludes road closures, user location, and unrelated overlays', () => {
  assert.match(app, /const locatedCalls = state\.filtered[\s\S]*?clusterPoints\(locatedCalls/);
  assert.match(app, /callLayer = L\.layerGroup\(\)\.addTo\(dispatchMap\);[\s\S]*?nearbyOriginLayer = L\.layerGroup\(\)\.addTo\(dispatchMap\)/);
  assert.match(app, /L\.circleMarker\(state\.nearby[\s\S]*?\.addTo\(nearbyOriginLayer\)/);
  assert.doesNotMatch(disruptions, /clusterPoints/);
  assert.match(disruptions, /roadLayer=L\.layerGroup\(\)/);
});

test('filter, search, radius, and Toronto-wide changes rebuild clusters from state.filtered', () => {
  assert.match(app, /function applyFilters[\s\S]*?withinGeographicScope\(state\.nearby, state\.radiusKm/);
  assert.match(app, /state\.serviceFilter !== "all"/);
  assert.match(app, /state\.eventFilter !== "all"/);
  assert.match(app, /incidentMatchesSearch\(call, state\.search/);
  assert.match(app, /state\.filtered = eligibleCalls\.filter[\s\S]*?render\(map\)/);
  assert.match(app, /const groups = clusterPoints\(locatedCalls/);
});

test('cluster click zooms before expanding and redraws reconcile incident layers', () => {
  assert.doesNotMatch(app, /callLayer\.clearLayers\(\)/);
  assert.match(app, /reconcileIncidentLayers\(renderedIncidentLayers, desiredKeys\)/);
  assert.match(app, /dispatchMap\.on\("zoomend",[\s\S]*?expandedCluster\.clear\(\);[\s\S]*?scheduleMapMarkerRender\(\)/);
  assert.match(app, /if \(dispatchMap\.getZoom\(\) < 18\) dispatchMap\.setView\(center,Math\.min\(18,dispatchMap\.getZoom\(\)\+2\)\)/);
  assert.match(app, /else \{ expandedCluster = new Set\(group\.map\(item => item\.call\.id\)\); renderMapMarkers\(\); \}/);
  assert.match(app, /title:clusterLabel, alt:clusterLabel/);
});
