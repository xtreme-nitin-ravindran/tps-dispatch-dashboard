import { distanceKm, distanceLabel } from "./nearby.js";
import { historyWindowLabel } from "./history-window.js";

const RADIUS_STEPS = new Map([
  [0.5, 1],
  [1, 2],
  [2, 5],
  [5, null]
]);

export function radiusLabel(radiusKm) {
  if (radiusKm === null) return "Toronto-wide";
  return radiusKm === 0.5 ? "500 m" : `${radiusKm} km`;
}

export function nextNearbyRadius(radiusKm) {
  return RADIUS_STEPS.has(radiusKm) ? RADIUS_STEPS.get(radiusKm) : undefined;
}

export function nearbyEmptyState({
  radiusKm,
  origin,
  matchingCalls = [],
  datasetIsEmpty = false,
  coordinatesForCall = call => call?.geography?.coordinates,
  hours = 24
}) {
  const window = historyWindowLabel(hours);
  if (datasetIsEmpty) {
    return { message: `No recent calls are currently available · ${window}.`, nextRadiusKm: undefined };
  }

  const nextRadiusKm = nextNearbyRadius(radiusKm);
  const message = radiusKm === null
    ? `No recent calls match the current filters across Toronto · ${window}.`
    : `No recent calls within ${radiusLabel(radiusKm)} · ${window}.`;

  if (!origin || radiusKm === null) return { message, nextRadiusKm };

  const closestKm = Math.min(...matchingCalls.map(call => distanceKm(origin, coordinatesForCall(call))));
  if (!Number.isFinite(closestKm) || closestKm <= radiusKm) return { message, nextRadiusKm };

  return {
    message: `${message} Closest recent call is ${distanceLabel(closestKm)}.`,
    nextRadiusKm
  };
}
