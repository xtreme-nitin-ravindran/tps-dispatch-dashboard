import test from 'node:test';
import assert from 'node:assert/strict';
import { options, json } from './helpers/live-source.js';

test('live Centreline sample exposes street and intersection fields', options, async () => {
  const base = 'https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/';
  const catalogue = await json(`${base}package_show?id=toronto-centreline-tcl`);
  assert.equal(catalogue.success, true);
  const resource = catalogue.result.resources.find(r => r.datastore_active && r.name === 'Centreline - Version 2');
  assert.ok(resource, 'Centreline datastore must be available');
  const data = await json(`${base}datastore_search?resource_id=${resource.id}&limit=1`);
  assert.equal(data.success, true);
  assert.equal(data.result.records.length, 1);
  const record = data.result.records[0];
  for (const field of ['LINEAR_NAME_FULL', 'FROM_INTERSECTION_ID', 'TO_INTERSECTION_ID']) assert.ok(field in record, `Missing ${field}`);
});

