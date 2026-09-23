import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchDisruptionSource } from '../src/disruptions/source.js';
import { options } from './helpers/live-source.js';

test('live transit feed satisfies production parser', options, async () => {
  const data = await fetchDisruptionSource('transit');
  assert.ok(Array.isArray(data.items));
  for (const item of data.items) {
    assert.ok(item.id);
    assert.ok(item.title);
  }
  assert.ok(Number.isFinite(Date.parse(data.sourceUpdatedAt)));
});
