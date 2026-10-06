// Story 51A deterministic baseline for the production gap between official TTC
// Service Changes and Story 30 observed geometry.
//
// Production evidence (2026-10-05): `disruptions.transit` contained 62 official
// Service Changes, including the eastbound-only 94 Wellesley detour, while the
// separate Story 30 GTFS-RT alert set (`ttcAlerts`) was successfully empty and
// `data/ttc-diversions.json` contained zero paths. The Story 30 detector can
// infer geometry without an alert, but the UI only iterates GTFS-RT alerts and
// only attaches a path when `relatedAlertIds` contains that GTFS-RT alert ID.
// Official website detours therefore cannot receive observed geometry.
//
// This fixture freezes that exact shape without touching the live TTC site:
//   - an active official Service Change for route 94 that applies eastbound in
//     its text (route-only, no structured stop coordinates)
//   - a healthy but empty Story 30 GTFS-RT alert set
//   - direction-specific vehicle evidence that produces a confirmed observed
//     diversion for route 94 eastbound (direction 0)
//   - an empty public geometry artifact
//
// It is test-only and never imported by production code.
import bindings from 'gtfs-realtime-bindings';
import { buildStaticIndex } from '../../../src/ttc/static-gtfs.js';
import { normalizeTransit } from '../../../src/disruptions/source.js';
import { parseTtcVehicles } from '../../../src/ttc/vehicle-feed.js';
import { detectVehicles } from '../../../src/ttc/vehicle-detector.js';
import { inferDiversions } from '../../../src/ttc/diversion-inference.js';
import { publicTtcGeometry } from '../../../scripts/publish-ttc-geometry.js';

// Fixed reference instant so every derived timestamp is deterministic.
export const BASELINE_EPOCH = Date.parse('2026-10-05T19:40:00.000Z');
export const baselineAt = seconds => new Date(BASELINE_EPOCH + seconds * 1000);

// Route 94 Wellesley: a straight eastbound shape (direction 0) and its reverse
// westbound shape (direction 1). The official advisory text says "eastbound",
// but the structured GTFS direction is the only authority for the path.
const STATIC_FILES = {
  'routes.txt': 'route_id,route_short_name,route_long_name,route_type\n94,94,Wellesley,3\n',
  'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon\nW1,Wellesley-Jarvis,43.665,-79.376\nW2,Wellesley-Church,43.665,-79.383\nW3,Wellesley-Yonge,43.665,-79.386\nW4,Wellesley-Bay,43.665,-79.389\n',
  'trips.txt': 'route_id,service_id,trip_id,direction_id,shape_id\n94,weekday,e1,0,s94e\n94,weekday,w1,1,s94w\n',
  'stop_times.txt': 'trip_id,stop_id,stop_sequence\ne1,W1,1\ne1,W2,2\ne1,W3,3\ne1,W4,4\nw1,W4,1\nw1,W3,2\nw1,W2,3\nw1,W1,4\n',
  'shapes.txt': 'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\ns94e,43.665,-79.376,1\ns94e,43.665,-79.389,2\ns94w,43.665,-79.389,1\ns94w,43.665,-79.376,2\n',
  'calendar.txt': 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nweekday,1,1,1,1,1,0,0,20260101,20261231\n',
  'calendar_dates.txt': 'service_id,date,exception_type\n'
};

export function baselineStaticIndex() {
  return buildStaticIndex(name => STATIC_FILES[name], 'story-51a-baseline');
}

// The official Service Change as it appears in `disruptions.transit`: route-only
// scope, no structured stop coordinates, and "eastbound" only in prose.
export function officialServiceChangeText(now = BASELINE_EPOCH) {
  const seconds = Math.floor(now / 1000);
  return `header { gtfs_realtime_version: "2.0" timestamp: ${seconds} }
entity { id: "102" alert {
  header_text { translation { text: "94 Wellesley – Temporary route change due to Wellesley Street project" language: "en" } }
  description_text { translation { text: "94 Wellesley buses will divert eastbound via south on Jarvis Street, east on Carlton Street and north on Parliament Street, to regular route. Stops not served: eastbound Wellesley Street East between Jarvis and Parliament streets." language: "en" } }
  effect: MODIFIED_SERVICE
  informed_entity { route_id: "94" }
  active_period { start: ${seconds - 1000} end: ${seconds + 100000} }
} }`;
}

// The normalized `disruptions.transit` feed object as published in the snapshot.
export function officialServiceChangeFeed(now = BASELINE_EPOCH) {
  const normalized = normalizeTransit(officialServiceChangeText(now), now);
  return {
    items: normalized.items,
    status: 'ok',
    checkedAt: new Date(now).toISOString(),
    fetchedAt: new Date(now).toISOString(),
    sourceUpdatedAt: normalized.sourceUpdatedAt
  };
}

// A healthy but empty Story 30 GTFS-RT alert set: `status: 'ok'` with no items.
export function emptyGtfsAlerts(now = BASELINE_EPOCH) {
  return {
    schemaVersion: 1,
    items: [],
    sourceUpdatedAt: new Date(now).toISOString(),
    status: 'ok',
    fetchedAt: new Date(now).toISOString(),
    checkedAt: new Date(now).toISOString()
  };
}

// Eastbound (direction 0) vehicle evidence: start on-route, divert south, then
// rejoin on-route with enough consecutive samples to complete the episode.
const EASTBOUND_PATH = [
  [43.665, -79.376], [43.665, -79.379],
  [43.663, -79.381], [43.661, -79.384], [43.661, -79.386],
  [43.663, -79.388], [43.665, -79.389],
  [43.665, -79.389], [43.665, -79.389]
];

export function protobuf(vehicles, seconds) {
  return bindings.transit_realtime.FeedMessage.encode({
    header: { gtfsRealtimeVersion: '2.0', timestamp: Math.floor(+baselineAt(seconds) / 1000) },
    entity: vehicles.map((v, i) => ({ id: String(i), vehicle: v }))
  }).finish();
}

export function vehicle(seconds, overrides = {}) {
  return {
    vehicle: { id: '001' },
    trip: { tripId: 'e1', routeId: '94', directionId: 0, startDate: '20261005', startTime: '12:00:00' },
    position: { latitude: 43.665, longitude: -79.38 },
    timestamp: Math.floor(+baselineAt(seconds) / 1000),
    ...overrides
  };
}

// Run the real Story 30D/30E pipeline over the deterministic eastbound evidence
// and return the confirmed observed diversion state plus its public projection.
export function observedEastboundDiversion(index = baselineStaticIndex(), advisories) {
  let vehicles, inferred;
  for (const [i, [latitude, longitude]] of EASTBOUND_PATH.entries()) {
    const feed = parseTtcVehicles(
      protobuf([0, 1].map(j => vehicle(i * 30, { vehicle: { id: `v${j}` }, position: { latitude, longitude } })), i * 30),
      baselineAt(i * 30)
    );
    vehicles = detectVehicles(vehicles, feed, index, baselineAt(i * 30)).state;
    inferred = inferDiversions(inferred?.state, vehicles, index, baselineAt(i * 30), undefined, { advisories });
  }
  return { state: inferred.state, output: inferred.output, public: publicTtcGeometry(inferred.output), report: inferred.report };
}

// The full production-shaped snapshot for the route 94 case.
export function baselineSnapshot(now = BASELINE_EPOCH) {
  const index = baselineStaticIndex();
  const observed = observedEastboundDiversion(index);
  return {
    index,
    now,
    // Official Service Changes path (visible to users today).
    disruptions: { transit: officialServiceChangeFeed(now) },
    // Story 30 GTFS-RT alert path (healthy but empty in production).
    ttcAlerts: emptyGtfsAlerts(now),
    // Story 30 observed geometry (confirmed, but with no GTFS-RT alert to attach to).
    ttcDiversions: observed.public,
    observed
  };
}
