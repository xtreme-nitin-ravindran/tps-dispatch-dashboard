export const MEANINGFUL_INCIDENT_FIELDS = Object.freeze([
  "description",
  "location",
  "division",
  "alarmLevel",
  "callTypeCode",
  "vehicles",
  "isOngoing"
]);

function comparableValue(field, value) {
  if (field !== "vehicles" || !Array.isArray(value)) return value ?? null;
  return value.map(vehicle => ({
    type: vehicle.type ?? null,
    numbers: [...(vehicle.numbers || [])].sort()
  })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

export function hasMeaningfulIncidentChange(previous, current) {
  return MEANINGFUL_INCIDENT_FIELDS.some(field =>
    JSON.stringify(comparableValue(field, previous?.[field])) !==
      JSON.stringify(comparableValue(field, current?.[field])));
}

export function applyIncidentLifecycle(current, previous, now = new Date()) {
  const observedAt = now.toISOString();
  const firstSeenAt = previous?.firstSeenAt || (previous ? previous.timestamp : observedAt);
  const changedAt = previous && hasMeaningfulIncidentChange(previous, current)
    ? observedAt
    : previous?.lastMeaningfulUpdateAt;

  return {
    ...current,
    firstSeenAt,
    ...(changedAt ? { lastMeaningfulUpdateAt: changedAt } : {})
  };
}
