import { distanceKm, withinGeographicScope } from "./nearby.js";
import { incidentCategory } from "./tfs/category.js";

export const WATCH_SCHEMA = "sirento.watch";
export const WATCH_SCHEMA_VERSION = 1;
export const WATCH_RADII_KM = Object.freeze([0.5, 1, 2, 5]);
export const WATCH_SERVICES = Object.freeze(["all", "TFS", "TPS"]);
export const WATCH_CATEGORIES = Object.freeze(["all", "medical", "fire", "ongoing", "other"]);
export const SOURCE_STATES = Object.freeze(["fresh", "stale", "unavailable"]);

const coordinateIsValid = (value, limit) => Number.isFinite(value) && Math.abs(value) <= limit;

export function validateWatch(watch) {
  const errors = [];
  if (!watch || typeof watch !== "object" || Array.isArray(watch)) {
    return { valid: false, errors: ["watch must be an object"] };
  }
  if (watch.schema !== WATCH_SCHEMA) errors.push(`schema must be ${WATCH_SCHEMA}`);
  if (watch.version !== WATCH_SCHEMA_VERSION) errors.push(`version must be ${WATCH_SCHEMA_VERSION}`);
  if (typeof watch.id !== "string" || !watch.id.trim() || watch.id.length > 128) errors.push("id must be a non-empty string of at most 128 characters");
  if (!watch.centre || typeof watch.centre !== "object" || Array.isArray(watch.centre)) {
    errors.push("centre must contain latitude and longitude");
  } else {
    if (!coordinateIsValid(watch.centre.latitude, 90)) errors.push("centre.latitude must be between -90 and 90");
    if (!coordinateIsValid(watch.centre.longitude, 180)) errors.push("centre.longitude must be between -180 and 180");
  }
  if (!WATCH_RADII_KM.includes(watch.radiusKm)) errors.push(`radiusKm must be one of ${WATCH_RADII_KM.join(", ")}; Toronto-wide watches are unsupported`);
  if (!WATCH_SERVICES.includes(watch.service)) errors.push(`service must be one of ${WATCH_SERVICES.join(", ")}`);
  if (!WATCH_CATEGORIES.includes(watch.category)) errors.push(`category must be one of ${WATCH_CATEGORIES.join(", ")}`);
  if (typeof watch.active !== "boolean") errors.push("active must be a boolean");
  return { valid: errors.length === 0, errors };
}

export function normalizeWatch(watch) {
  const normalized = {
    schema: watch?.schema,
    version: watch?.version,
    id: typeof watch?.id === "string" ? watch.id.trim() : watch?.id,
    centre: watch?.centre && {
      latitude: watch.centre.latitude,
      longitude: watch.centre.longitude
    },
    radiusKm: watch?.radiusKm,
    service: watch?.service,
    category: watch?.category,
    active: watch?.active
  };
  const validation = validateWatch(normalized);
  if (!validation.valid) throw new TypeError(`Invalid watch: ${validation.errors.join("; ")}`);
  return normalized;
}

export function sourceAllowsNotification(sourceState) {
  return sourceState === "fresh";
}

export function incidentNotificationKind(incident) {
  if (!incident || typeof incident !== "object") return null;
  const firstSeen = Date.parse(incident.firstSeenAt);
  const meaningfulUpdate = Date.parse(incident.lastMeaningfulUpdateAt);
  if (Number.isFinite(meaningfulUpdate) && (!Number.isFinite(firstSeen) || meaningfulUpdate > firstSeen)) {
    return `updated:${new Date(meaningfulUpdate).toISOString()}`;
  }
  return Number.isFinite(firstSeen) ? "new:v1" : null;
}

export function notificationDedupeKey(watchId, incidentId, notificationKind) {
  for (const [name, value] of Object.entries({ watchId, incidentId, notificationKind })) {
    if (typeof value !== "string" || !value) throw new TypeError(`${name} must be a non-empty string`);
  }
  return `watch:v1:${encodeURIComponent(watchId)}:incident:${encodeURIComponent(incidentId)}:notification:${encodeURIComponent(notificationKind)}`;
}

function normalizedIncidentCategory(incident) {
  if (incident.eventCategory !== undefined) {
    return ["medical", "fire", "other"].includes(incident.eventCategory) ? incident.eventCategory : null;
  }
  return incidentCategory(incident.description);
}

function incidentCoordinates(incident) {
  return incident?.geography?.coordinates;
}

export function evaluateWatchMatch(watch, incident, { sourceState = "fresh", notifiedKeys = [] } = {}) {
  const validation = validateWatch(watch);
  if (!validation.valid) return { matches: false, reason: "invalid-watch", errors: validation.errors };
  if (!SOURCE_STATES.includes(sourceState)) return { matches: false, reason: "invalid-source-state" };
  if (!sourceAllowsNotification(sourceState)) return { matches: false, reason: `${sourceState}-source` };
  if (!watch.active) return { matches: false, reason: "inactive-watch" };
  if (!incident || typeof incident !== "object" || typeof incident.id !== "string" || !incident.id) return { matches: false, reason: "invalid-incident" };
  const kind = incidentNotificationKind(incident);
  if (!kind) return { matches: false, reason: "ineligible-lifecycle" };
  const incidentDistanceKm = distanceKm(
    [watch.centre.latitude, watch.centre.longitude], incidentCoordinates(incident)
  );
  if (!withinGeographicScope([watch.centre.latitude, watch.centre.longitude], watch.radiusKm,
    incidentCoordinates(incident))) return { matches: false, reason: "outside-radius" };
  if (watch.service !== "all" && incident.source !== watch.service) return { matches: false, reason: "service-filter" };
  const category = normalizedIncidentCategory(incident);
  if (!category) return { matches: false, reason: "invalid-category" };
  if (watch.category === "ongoing" ? incident.isOngoing !== true : watch.category !== "all" && category !== watch.category) {
    return { matches: false, reason: "category-filter" };
  }
  const dedupeKey = notificationDedupeKey(watch.id, incident.id, kind);
  if (new Set(notifiedKeys).has(dedupeKey)) return { matches: false, reason: "duplicate", kind, dedupeKey };
  return { matches: true, reason: "match", kind, dedupeKey, distanceKm: incidentDistanceKm };
}

export function watchMatchesIncident(watch, incident, options) {
  return evaluateWatchMatch(watch, incident, options).matches;
}
