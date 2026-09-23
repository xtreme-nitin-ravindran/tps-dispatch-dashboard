import test from 'node:test';
import assert from 'node:assert/strict';
import { options, json } from './helpers/live-source.js';

test('live TPS boundaries contain polygon geometry', options, async () => {
  const item = await json('https://www.arcgis.com/sharing/rest/content/items/fdd36b8dd9544c97b926958f3eb8cb98?f=json');
  assert.match(item.url, /^https:\/\/services\.arcgis\.com\//);
  const data = await json(`${item.url}/0/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&resultRecordCount=1&f=json`);
  assert.equal(data.features?.length, 1);
  const rings = data.features[0].geometry?.rings;
  assert.ok(rings?.length && rings[0].length >= 4);
  assert.ok(rings.flat().every(p => Number.isFinite(p[0]) && Number.isFinite(p[1])));
});

