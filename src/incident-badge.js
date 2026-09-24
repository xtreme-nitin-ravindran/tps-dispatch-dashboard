export const INCIDENT_BADGE_CONFIG = Object.freeze({
  newWindowMs: 5 * 60 * 1000
});

function timestamp(value) {
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function incidentBadge(incident, now = Date.now(), config = INCIDENT_BADGE_CONFIG) {
  const firstSeenAt = timestamp(incident.firstSeenAt);
  const changedAt = timestamp(incident.lastMeaningfulUpdateAt);
  if (changedAt !== null && (firstSeenAt === null || changedAt > firstSeenAt)) return "UPDATED";
  if (firstSeenAt !== null && now >= firstSeenAt && now < firstSeenAt + config.newWindowMs) return "NEW";
  return null;
}

export function incidentBadgeExpiry(incident, now = Date.now(), config = INCIDENT_BADGE_CONFIG) {
  if (incidentBadge(incident, now, config) !== "NEW") return null;
  return timestamp(incident.firstSeenAt) + config.newWindowMs;
}
