import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchTripModifications, decodePolyline } from '../src/ttc/trip-modifications.js';
import { options } from './helpers/live-source.js';

// The TTC's own detour map draws this feed; a silent shape change (for example
// dangling shape references or undecodable polylines) would otherwise publish
// broken geometry for weeks. This gate mirrors the production decode without a
// static index, so it stays a bounded, index-free source check.
test('[STORY-76] live trip-modifications feed publishes self-consistent detour shapes', options, async () => {
  const payload = await fetchTripModifications();
  assert.ok(Array.isArray(payload.entity));
  const shapes = new Map();
  let modifications = 0, decoded = 0;
  for (const entity of payload.entity) {
    const shape = entity?.shape;
    if (typeof shape?.shapeId === 'string' && typeof shape.encodedPolyline === 'string') shapes.set(shape.shapeId, shape.encodedPolyline);
    if (entity?.tripModifications?.selectedTrips?.length) modifications++;
  }
  assert.ok(modifications > 0, 'live feed carries trip modifications');
  assert.ok(shapes.size > 0, 'live feed carries detour shapes');
  for (const entity of payload.entity) {
    const tm = entity?.tripModifications;
    if (!tm?.selectedTrips?.length) continue;
    for (const selected of tm.selectedTrips) {
      if (typeof selected?.shapeId !== 'string') continue;
      const polyline = shapes.get(selected.shapeId);
      assert.ok(polyline, `live detour shape ${selected.shapeId} resolves`);
      if (polyline) { assert.ok(decodePolyline(polyline).length >= 2); decoded++; }
    }
  }
  assert.ok(decoded > 0, 'live feed decodes at least one published detour shape');
});
