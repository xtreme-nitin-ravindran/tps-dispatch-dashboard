import test from 'node:test';
import assert from 'node:assert/strict';
import { options, response } from './helpers/live-source.js';

test('live OpenStreetMap sample tile is a PNG', options, async () => {
  const result = await response('https://tile.openstreetmap.org/0/0/0.png');
  assert.match(result.headers.get('content-type'), /image\/png/);
  const bytes = Buffer.from(await result.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 8)], [137,80,78,71,13,10,26,10]);
});
