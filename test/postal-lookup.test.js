import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { postalPrefix, lookupPostalCoordinates } from '../src/postal-lookup.js';
import { policeDivision } from '../src/police-divisions.js';
const candidate = { score: 100, attributes: { Postal: 'M5A', Country: 'CAN', Addr_type: 'Postal' }, location: { x: -79.363017243, y: 43.655195102 } };
const response = value => async () => ({ ok: true, json: async () => ({ candidates: value }) });
test('recognizes only standalone Toronto postal prefixes', () => {
  assert.equal(postalPrefix(' m5a '), 'M5A');
  for (const value of ['M5A 1A1','King St / M5A','K1A','M0A','M5D','/',null]) assert.equal(postalPrefix(value), null);
});
test('M5A ArcGIS result matches TPS Division 51 without using old map cache', async () => {
  const coords = await lookupPostalCoordinates('M5A', async url => {
    assert.equal(url.searchParams.get('countryCode'), 'CA');
    assert.equal(url.searchParams.get('SingleLine'), 'M5A');
    return response([candidate])();
  });
  const boundaries = JSON.parse(readFileSync(new URL('../data/police-divisions.geojson', import.meta.url)));
  assert.equal(policeDivision('M5A', coords, boundaries, { postalEstimate: true }), 'Division 51');
  assert.equal(policeDivision('M5A', coords, boundaries), 'Unknown');
  assert.equal(policeDivision('M5A', null, boundaries, { postalEstimate: true }), 'Unknown');
});
test('rejects failed, wrong-country, wrong-prefix, low-score and invalid coordinate results', async () => {
  for (const value of [[], [{...candidate, score: 20}], [{...candidate, attributes: {...candidate.attributes, Country:'USA'}}], [{...candidate, attributes: {...candidate.attributes, Postal:'M5B'}}], [{...candidate, location: { x: null, y: 43.65 }}], [{...candidate, location: { x:-120,y:50 }}]]) {
    assert.equal(await lookupPostalCoordinates('M5A', response(value)), null);
  }
  assert.equal(await lookupPostalCoordinates('M5A', async () => { throw Error('offline'); }), null);
  assert.equal(await lookupPostalCoordinates('M5A', async () => ({ ok:false })), null);
  assert.equal(await lookupPostalCoordinates('invalid', assert.fail), null);
});

test('postal candidates must identify a postal area and usable Toronto coordinates', async () => {
  for (const patch of [{attributes: undefined}, {attributes: {...candidate.attributes, Addr_type:'StreetAddress'}}, {location: undefined}, {location:{x:-79.4,y:44}}, {location:{x:-79.4,y:43}}, {location:{x:-79,y:43.7}}]) {
    assert.equal(await lookupPostalCoordinates('M5A', response([{...candidate,...patch}])), null);
  }
});

test('neighbourhood lookup returns Canadian area hints and requests longitude first', async () => {
  const { lookupNeighbourhood } = await import('../src/postal-lookup.js');
  assert.equal(await lookupNeighbourhood([43.65,-79.36], async url => {
    assert.equal(url.searchParams.get('location'), '-79.36,43.65');
    assert.equal(url.searchParams.get('featureTypes'), 'Neighborhood');
    return {ok:true,json:async()=>({address:{CountryCode:'CAN',Neighborhood:'Moss Park'}})};
  }), 'Moss Park');
  for (const address of [undefined, {CountryCode:'USA',Neighborhood:'Wrong area'}, {CountryCode:'CAN'}]) {
    assert.equal(await lookupNeighbourhood([43.65,-79.36], async()=>({ok:true,json:async()=>({address})})), '');
  }
  assert.equal(await lookupNeighbourhood(null, assert.fail), '');
  assert.equal(await lookupNeighbourhood([43.65,-79.36], async()=>({ok:false})), '');
  assert.equal(await lookupNeighbourhood([43.65,-79.36], async()=>{throw Error('offline');}), '');
});
