const FIXTURE_PARAM = 'ttcNearbyFixture';

// Visual-test origin: Nathan Phillips Square. Select this point on the map before
// comparing the radius controls. This module is deliberately inert off loopback.
export const TTC_FIXTURE_ORIGIN = [43.65348, -79.38393];

const northOfOrigin = kilometres => [
  TTC_FIXTURE_ORIGIN[0] + kilometres / 111.195,
  TTC_FIXTURE_ORIGIN[1]
];

export function ttcNearbyFixtureEnabled(locationLike = globalThis.location) {
  const hostname = locationLike?.hostname;
  if (hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '::1') return false;
  return new URLSearchParams(locationLike?.search || '').get(FIXTURE_PARAM) === '1';
}

export function ttcNearbyFixtureAlerts() {
  const alert = (id, title, affectedEntities, routes = ['1']) => ({
    id: `test-ttc-nearby-${id}`,
    title,
    description: 'Local visual-test fixture. This is not a real TTC disruption.',
    effect: 'TEST ALERT',
    routes,
    stopIds: affectedEntities.map(entity => entity.stopId).filter(Boolean),
    affectedEntities,
    periods: [],
    url: 'https://www.ttc.ca/service-advisories/all-service-alerts'
  });

  return [
    alert('nearby', 'TEST — Nearby TTC Alert', [
      {routeId:'1', stopId:'test-nearby-600m', name:'TEST — Stop about 600 m away', coordinates:northOfOrigin(0.6)}
    ]),
    alert('mid-distance', 'TEST — Mid-distance TTC Alert', [
      {routeId:'2', stopId:'test-mid-1500m', name:'TEST — Stop about 1.5 km away', coordinates:northOfOrigin(1.5)}
    ], ['2']),
    alert('multi-stop', 'TEST — Multi-stop TTC Alert', [
      {routeId:'1', stopId:'test-multi-far', name:'TEST — Far affected stop', coordinates:northOfOrigin(3)},
      {routeId:'1', stopId:'test-multi-near', name:'TEST — Closest affected stop', coordinates:northOfOrigin(0.3)}
    ]),
    alert('unresolved', 'TEST — Unresolved TTC Alert', [
      {routeId:'504', stopId:'test-unresolved-stop'}
    ], ['504'])
  ];
}

export function withTtcNearbyFixture(disruptions, locationLike = globalThis.location, now = Date.now()) {
  if (!ttcNearbyFixtureEnabled(locationLike)) return disruptions;
  const base = disruptions || {};
  const transit = base.transit || {};
  const fixtureIds = new Set(ttcNearbyFixtureAlerts().map(alert => alert.id));
  const realItems = (transit.items || []).filter(item => !fixtureIds.has(item.id));
  return {
    ...base,
    transit: {
      ...transit,
      status: 'ok',
      fetchedAt: new Date(now).toISOString(),
      items: [...realItems, ...ttcNearbyFixtureAlerts()]
    }
  };
}
