import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileAuditFixtureFilters, mobileAuditFixtureOptions, mobileAuditFixtureSnapshot, mobileAuditFixtureState } from '../src/mobile-audit-fixture.js';

test('mobile audit fixture is explicit and loopback-only', () => {
  assert.equal(mobileAuditFixtureState(),null);
  assert.equal(mobileAuditFixtureState(null),null);
  assert.equal(mobileAuditFixtureState({hostname:'localhost'}),null);
  assert.equal(mobileAuditFixtureState({hostname:'localhost',search:'?mobileAuditFixture=many'}),'many');
  assert.equal(mobileAuditFixtureState({hostname:'127.0.0.1',search:'?mobileAuditFixture=zero'}),'zero');
  assert.equal(mobileAuditFixtureState({hostname:'::1',search:'?mobileAuditFixture=stale'}),'stale');
  assert.equal(mobileAuditFixtureState({hostname:'localhost',search:'?mobileAuditFixture=unavailable'}),'unavailable');
  assert.equal(mobileAuditFixtureState({hostname:'sirento.ca',search:'?mobileAuditFixture=many'}),null);
  assert.equal(mobileAuditFixtureState({hostname:'localhost',search:'?mobileAuditFixture=unknown'}),null);
});

test('fixture options expose deterministic mobile view and sheet states', () => {
  assert.equal(mobileAuditFixtureOptions(),null);
  assert.deepEqual(mobileAuditFixtureOptions({hostname:'localhost',search:'?mobileAuditFixture=many&mobileAuditView=calls&mobileAuditSheet=expanded'}),{
    state:'many',view:'calls',sheet:'expanded',location:'none',filters:'none',radius:null
  });
  assert.deepEqual(mobileAuditFixtureOptions({hostname:'localhost',search:'?mobileAuditFixture=many&mobileAuditView=nope&mobileAuditSheet=nope&mobileAuditLocation=denied'}),{
    state:'many',view:'map',sheet:'collapsed',location:'denied',filters:'none',radius:null
  });
});

test('fixture exposes every radius and rejects arbitrary values', () => {
  for (const radius of ['0.5','1','2','5','toronto']) {
    assert.equal(mobileAuditFixtureOptions({hostname:'localhost',search:`?mobileAuditFixture=many&mobileAuditRadius=${radius}`}).radius,radius);
  }
  assert.equal(mobileAuditFixtureOptions({hostname:'localhost',search:'?mobileAuditFixture=many&mobileAuditRadius=50'}).radius,null);
  assert.equal(mobileAuditFixtureOptions({hostname:'sirento.ca',search:'?mobileAuditFixture=many&mobileAuditRadius=2'}),null);
});

test('fixture exposes deterministic secondary filter states with safe defaults', () => {
  for (const filters of ['none','one','multiple','long','service','event','division','history','search','zero']) {
    assert.equal(mobileAuditFixtureOptions({hostname:'localhost',search:`?mobileAuditFixture=many&mobileAuditFilters=${filters}`}).filters,filters);
  }
  assert.deepEqual(mobileAuditFixtureFilters('none'),{});
  assert.deepEqual(mobileAuditFixtureFilters(),{});
  assert.deepEqual(mobileAuditFixtureFilters('one'),{serviceFilter:'TFS'});
  assert.equal(mobileAuditFixtureFilters('multiple').division,'Division 14');
  assert.ok(mobileAuditFixtureFilters('search').search.length > 50);
  assert.deepEqual(mobileAuditFixtureFilters('unknown'),{});
  assert.equal(mobileAuditFixtureOptions({hostname:'sirento.ca',search:'?mobileAuditFixture=many&mobileAuditFilters=multiple'}),null);
});

test('fixture exposes every compact Nearby location state without enabling arbitrary values', () => {
  for (const location of ['none','current','unavailable','denied','saved','manual']) {
    assert.equal(mobileAuditFixtureOptions({hostname:'localhost',search:`?mobileAuditFixture=many&mobileAuditLocation=${location}`}).location,location);
  }
  assert.equal(mobileAuditFixtureOptions({hostname:'localhost',search:'?mobileAuditFixture=many&mobileAuditLocation=other'}).location,'none');
});

test('fixture covers multiple, zero, stale, unavailable, unresolved, and long TTC states', () => {
  const now=Date.UTC(2026,8,26,12);
  assert.ok(mobileAuditFixtureSnapshot().incidents.length >= 10);
  const many=mobileAuditFixtureSnapshot('many',now);
  assert.ok(many.incidents.length >= 10);
  assert.ok(many.incidents.some(item=>item.id==='mobile-audit-selected'));
  assert.equal(many.incidents.find(item=>item.id==='mobile-audit-police').isOngoing,false);
  assert.ok(many.incidents.some(item=>item.location.length > 80));
  assert.equal(many.disruptions.roads.items.length,1);
  assert.equal(many.disruptions.transit.items.length,2);
  assert.ok(many.disruptions.transit.items.some(item => item.affectedEntities.some(entity => entity.coordinates)));
  assert.ok(many.disruptions.transit.items.some(item => item.affectedEntities.some(entity => !entity.coordinates)));
  assert.ok(many.disruptions.transit.items.some(item => item.description.length > 120));
  const zero=mobileAuditFixtureSnapshot('zero',now);
  assert.equal(zero.incidents.length,0);
  assert.equal(zero.disruptions.roads.items.length,0);
  assert.equal(zero.disruptions.transit.items.length,0);
  const stale=mobileAuditFixtureSnapshot('stale',now);
  assert.equal(stale.feeds.TFS.status,'stale');
  assert.equal(stale.feeds.TPS.status,'unavailable');
  assert.equal(stale.disruptions.roads.status,'stale');
  assert.equal(stale.disruptions.transit.status,'stale');
  assert.equal(stale.disruptions.transit.items.length,2);
  const unavailable=mobileAuditFixtureSnapshot('unavailable',now);
  assert.equal(unavailable.disruptions.transit.status,'unavailable');
  assert.equal(unavailable.disruptions.transit.items.length,2);
});
