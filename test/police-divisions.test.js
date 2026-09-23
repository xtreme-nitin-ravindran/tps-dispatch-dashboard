import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { policeDivision } from '../src/police-divisions.js';
const ring = [[0,0],[10,0],[10,10],[0,10],[0,0]];
const feature = { properties: { AREA_NAME: '51' }, geometry: { type: 'Polygon', coordinates: [ring] } };
const boundaries = { features: [feature] };
test('matches polygon and rejects missing, invalid, outside and postal-area locations', () => {
  assert.equal(policeDivision('King St', [5,5], boundaries), 'Division 51');
  for (const coords of [null, [NaN,5], [null,5], [20,20]]) assert.equal(policeDivision('King St', coords, boundaries), 'Unknown');
  assert.equal(policeDivision('/', [5,5], boundaries), 'Unknown');
  assert.equal(policeDivision('Location not published', [5,5], boundaries), 'Unknown');
  assert.equal(policeDivision('M5A', [5,5], boundaries), 'Unknown');
  assert.equal(policeDivision('King St', [5,5], null), 'Unknown');
  assert.equal(policeDivision('King St', [0,5], boundaries), 'Unknown');
});
test('accepts postal estimates and ignores unsupported boundary geometry', () => {
  assert.equal(policeDivision('M5A', [5,5], boundaries, { postalEstimate: true }), 'Division 51');
  const unsupported = { properties: { AREA_NAME: 'X' }, geometry: { type: 'Point', coordinates: [5,5] } };
  assert.equal(policeDivision('King St', [5,5], { features: [unsupported] }), 'Unknown');
});
test('supports multipolygons, excludes holes and ambiguous overlaps', () => {
  const hole = [[2,2],[8,2],[8,8],[2,8],[2,2]];
  const multi = { ...feature, geometry: { type: 'MultiPolygon', coordinates: [[ring, hole]] } };
  assert.equal(policeDivision('King St', [5,5], { features: [multi] }), 'Unknown');
  assert.equal(policeDivision('King St', [1,1], { features: [multi] }), 'Division 51');
  assert.equal(policeDivision('King St', [5,5], { features: [feature,feature] }), 'Unknown');
});
test('bundled Toronto boundaries match downtown location, not fire beat', () => {
  const data = JSON.parse(readFileSync(new URL('../data/police-divisions.geojson', import.meta.url)));
  assert.ok(data.features.length >= 16);
  assert.equal(policeDivision('Toronto City Hall', [43.6534,-79.3841], data), 'Division 52');
  assert.equal(policeDivision('Outside Toronto', [45,-80], data), 'Unknown');
});
