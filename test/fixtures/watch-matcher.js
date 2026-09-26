import { WATCH_SCHEMA, WATCH_SCHEMA_VERSION } from "../../src/watch-matcher.js";

export const fixtureWatch = Object.freeze({
  schema: WATCH_SCHEMA,
  version: WATCH_SCHEMA_VERSION,
  id: "test-watch-downtown",
  centre: Object.freeze({ latitude: 43.65, longitude: -79.38 }),
  radiusKm: 1,
  service: "TFS",
  category: "fire",
  active: true
});

const firstSeenAt = "2026-09-25T12:00:00.000Z";
const latitudeDegreesPerKm = 180 / (Math.PI * 6371);
const incident = (id, distanceKm, overrides = {}) => ({
  id,
  source: "TFS",
  description: "Fire - Residential",
  eventCategory: "fire",
  isOngoing: true,
  firstSeenAt,
  lastSeenAt: "2026-09-25T12:05:00.000Z",
  geography: { coordinates: [fixtureWatch.centre.latitude + distanceKm * latitudeDegreesPerKm, fixtureWatch.centre.longitude] },
  ...overrides
});

export const fixtureIncidents = Object.freeze({
  inside: incident("test-incident-inside", 0.5),
  nearBoundary: incident("test-incident-near-boundary", 0.999999),
  outside: incident("test-incident-outside", 1.5),
  wrongService: incident("test-incident-tps", 0.5, { source: "TPS" }),
  wrongCategory: incident("test-incident-medical", 0.5, { description: "Medical", eventCategory: "medical" }),
  updated: incident("test-incident-inside", 0.5, { lastMeaningfulUpdateAt: "2026-09-25T12:06:00.000Z" }),
  refreshed: incident("test-incident-inside", 0.5, { lastSeenAt: "2026-09-25T12:30:00.000Z" })
});
