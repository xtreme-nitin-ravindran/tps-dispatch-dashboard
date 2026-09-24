import { distanceKm } from "./nearby.js";

export const NEARBY_SORT_DEFAULT = "newest";

function timestamp(call) {
  const value = call?.time instanceof Date ? call.time.getTime() : new Date(call?.time ?? call?.timestamp).getTime();
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

function stableId(call) {
  return String(call?.id ?? "");
}

export function sortNearbyCalls(calls, mode = NEARBY_SORT_DEFAULT, origin = null, coordinatesForCall = call => call?.coordinates) {
  const entries = calls.map((call, index) => ({
    call,
    index,
    time: timestamp(call),
    distance: origin ? distanceKm(origin, coordinatesForCall(call)) : null
  }));

  entries.sort((a, b) => {
    if (mode === "nearest" && origin) {
      const aDistance = Number.isFinite(a.distance) ? a.distance : Number.POSITIVE_INFINITY;
      const bDistance = Number.isFinite(b.distance) ? b.distance : Number.POSITIVE_INFINITY;
      if (aDistance !== bDistance) return aDistance - bDistance;
    }
    if (a.time !== b.time) return b.time - a.time;
    const idOrder = stableId(a.call).localeCompare(stableId(b.call));
    return idOrder || a.index - b.index;
  });

  return entries.map(entry => entry.call);
}
