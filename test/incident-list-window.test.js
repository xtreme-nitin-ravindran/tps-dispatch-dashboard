import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INCIDENT_LIST_BATCH_SIZE, incidentFilterKey, incidentListKey, nextIncidentBatch
} from '../src/incident-list-window.js';

test('incident batches are bounded, ordered, and exhaustive without overlap', () => {
  const calls = Array.from({length: 1212}, (_, id) => ({id}));
  const first = nextIncidentBatch(calls, 0);
  const second = nextIncidentBatch(calls, first.end);
  const last = nextIncidentBatch(calls, 1200);
  assert.equal(INCIDENT_LIST_BATCH_SIZE, 40);
  assert.deepEqual(first.items.map(call => call.id), Array.from({length: 40}, (_, id) => id));
  assert.deepEqual(second.items.map(call => call.id), Array.from({length: 40}, (_, id) => id + 40));
  assert.equal(last.items.length, 12);
  assert.equal(last.remaining, 0);
  assert.equal(new Set([...first.items, ...second.items]).size, 80);
  assert.deepEqual(nextIncidentBatch(calls, -4, 0).items.map(call => call.id), [0]);
});

test('filter and list keys change only for inputs that invalidate their work', () => {
  const filters = {datasetRevision: 3, radiusKm: null, nearby: [43.65, -79.38], search: 'alarm'};
  assert.equal(incidentFilterKey(filters), incidentFilterKey({...filters}));
  assert.notEqual(incidentFilterKey(filters), incidentFilterKey({...filters, radiusKm: 2}));
  assert.notEqual(incidentFilterKey(filters), incidentFilterKey({...filters, datasetRevision: 4}));
  const key = incidentFilterKey(filters);
  assert.equal(incidentListKey({filterKey:key}), incidentListKey({filterKey:key}));
  assert.notEqual(incidentListKey({filterKey:key}), incidentListKey({filterKey:key, sort:'nearest'}));
  assert.notEqual(incidentListKey({filterKey:key}), incidentListKey({filterKey:key, online:false}));
  assert.equal(incidentFilterKey(), '0|toronto||all|all|all|24|');
  assert.equal(incidentListKey(), '|newest|online|');
});
