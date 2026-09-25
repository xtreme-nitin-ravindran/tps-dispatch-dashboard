import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TTC_FIXTURE_ORIGIN,
  ttcNearbyFixtureAlerts,
  ttcNearbyFixtureEnabled,
  withTtcNearbyFixture
} from '../src/disruptions/ttc-nearby-fixture.js';
import { transitGeographicMatch } from '../src/disruptions/view.js';

test('fixture switch requires an explicit flag on a loopback host', () => {
  assert.equal(ttcNearbyFixtureEnabled({hostname:'localhost',search:'?ttcNearbyFixture=1'}),true);
  assert.equal(ttcNearbyFixtureEnabled({hostname:'127.0.0.1',search:'?ttcNearbyFixture=1'}),true);
  assert.equal(ttcNearbyFixtureEnabled({hostname:'localhost',search:''}),false);
  assert.equal(ttcNearbyFixtureEnabled({hostname:'sirento.ca',search:'?ttcNearbyFixture=1'}),false);
  assert.equal(ttcNearbyFixtureEnabled({hostname:'::1',search:'?ttcNearbyFixture=1'}),true);
  assert.equal(ttcNearbyFixtureEnabled({hostname:'localhost'}),false);
  assert.equal(ttcNearbyFixtureEnabled(null),false);
});

test('disabled fixture preserves the production disruptions object', () => {
  const disruptions={transit:{items:[{id:'real'}]}};
  assert.equal(withTtcNearbyFixture(disruptions,{hostname:'example.com',search:'?ttcNearbyFixture=1'}),disruptions);
  assert.equal(withTtcNearbyFixture(disruptions,{hostname:'localhost',search:''}),disruptions);
});

test('fixture alerts use normalized shape and merge without replacing real alerts', () => {
  const real={id:'real',title:'Real alert'};
  const result=withTtcNearbyFixture(
    {roads:{items:[]},transit:{items:[real],status:'ok'}},
    {hostname:'localhost',search:'?ttcNearbyFixture=1'},
    Date.UTC(2026,8,25)
  );
  assert.equal(result.transit.items[0],real);
  assert.equal(result.transit.items.length,5);
  assert.equal(result.transit.fetchedAt,'2026-09-25T00:00:00.000Z');
  for (const item of result.transit.items.slice(1)) {
    assert.ok(Array.isArray(item.routes));
    assert.ok(Array.isArray(item.stopIds));
    assert.ok(Array.isArray(item.affectedEntities));
    assert.ok(Array.isArray(item.periods));
  }
  const fixtureOnly=withTtcNearbyFixture(null,{hostname:'localhost',search:'?ttcNearbyFixture=1'},Date.UTC(2026,8,25));
  assert.equal(fixtureOnly.transit.items.length,4);
  const repeated=withTtcNearbyFixture(result,{hostname:'localhost',search:'?ttcNearbyFixture=1'},Date.UTC(2026,8,25));
  assert.equal(repeated.transit.items.length,5);
});

test('fixture exercises TTC radius boundaries, closest entity, unresolved, and citywide behavior', () => {
  const [nearby,mid,multi,unresolved]=ttcNearbyFixtureAlerts();
  const relevantAt = (alert, radius) => transitGeographicMatch(alert,TTC_FIXTURE_ORIGIN,radius).relevant;
  assert.deepEqual([0.5,1,2,5].map(radius => relevantAt(nearby,radius)),[false,true,true,true]);
  assert.deepEqual([0.5,1,2,5].map(radius => relevantAt(mid,radius)),[false,false,true,true]);

  const multiMatch=transitGeographicMatch(multi,TTC_FIXTURE_ORIGIN,0.5);
  assert.equal(multiMatch.relevant,true);
  assert.equal(multiMatch.matchedEntity.stopId,'test-multi-near');
  assert.ok(multiMatch.nearestDistanceKm > 0.29 && multiMatch.nearestDistanceKm < 0.31);

  assert.equal(relevantAt(unresolved,5),false);
  for (const alert of [nearby,mid,multi,unresolved]) {
    const citywide=transitGeographicMatch(alert,null,null);
    assert.equal(citywide.relevant,true);
    assert.notEqual(citywide.geographicStatus,'nearby');
  }
});
