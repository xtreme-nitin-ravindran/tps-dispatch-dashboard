import test from 'node:test';
import assert from 'node:assert/strict';
import { TPS_ENDPOINT, normalizeTps } from '../src/tps/source.js';
import { options, json } from './helpers/live-source.js';

test('live TPS sample normalizes into police calls', options, async () => {
  const data = await json(`${TPS_ENDPOINT}/query?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=3&f=json`);
  assert.ok(Array.isArray(data.features));
  for (const feature of data.features) {
    const call = normalizeTps(feature.attributes);
    assert.equal(call.source, 'TPS');
    assert.ok(Number.isFinite(Date.parse(call.timestamp)));
    assert.ok(call.description);
  }
});
