import { distanceKm } from "./nearby.js";

export const SIREN_RADIUS_KM = 2;
export const SIREN_RESULT_LIMIT = 5;

export function rankSirenMatches(calls, origin, {
  radiusKm = SIREN_RADIUS_KM,
  limit = SIREN_RESULT_LIMIT,
  now = Date.now(),
  maxAgeHours = 24
} = {}) {
  const oldest = now - maxAgeHours * 60 * 60 * 1000;

  return calls
    .map(call => ({ call, distanceKm: distanceKm(origin, call.geography?.coordinates) }))
    .filter(({ call, distanceKm: distance }) => (
      Number.isFinite(call.timestamp) && call.timestamp >= oldest && call.timestamp <= now && distance <= radiusKm
    ))
    .sort((a, b) => b.call.timestamp - a.call.timestamp || a.distanceKm - b.distanceKm || String(a.call.id).localeCompare(String(b.call.id)))
    .slice(0, limit);
}
