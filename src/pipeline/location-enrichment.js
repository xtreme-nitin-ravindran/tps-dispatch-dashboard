import { locationDisplay } from '../location-display.js';

export const LOCATION_SCHEMA_VERSION = 1;

// Cache is carried inside the published snapshot, so either updater can reuse it.
// The resolver must use a source that permits persistent/public results.
export async function enrichLocations(snapshot, previous, {
  resolveLocation,
  now = new Date(),
  maxLookups = 20,
  retryMs = 60 * 60 * 1000,
  refreshMs = 30 * 24 * 60 * 60 * 1000,
  source
}) {
  const prior = previous?.locationCache || {};
  const cache = {};
  let lookups = 0;
  for (const location of new Set(snapshot.incidents.map(row => row.location).filter(Boolean))) {
    const saved = prior[location];
    const compatible = saved?.version === LOCATION_SCHEMA_VERSION && saved.source === source;
    const age = now.getTime() - Date.parse(saved?.checkedAt);
    const fresh = compatible && age >= 0 && age < (saved.coordinates ? refreshMs : retryMs);
    let result = compatible ? saved : null;
    if (!fresh && lookups < maxLookups) {
      lookups++;
      try {
        const resolved = await resolveLocation(location);
        result = { ...resolved, version: LOCATION_SCHEMA_VERSION, source, checkedAt: now.toISOString() };
      } catch {
        // An outage must not erase a previously usable result or block the feed.
        result = result ? { ...result, checkedAt: now.toISOString() } : null;
      }
    }
    cache[location] = result || {
      ...locationDisplay(location), coordinates: null, division: 'Unknown',
      version: LOCATION_SCHEMA_VERSION, source,
      // Pending items remain eligible on the next update.
      checkedAt: null
    };
  }
  snapshot.locationCache = cache;
  for (const row of snapshot.incidents) {
    row.geography = cache[row.location] || {
      ...locationDisplay(row.location), coordinates: null, division: 'Unknown'
    };
  }
  return snapshot;
}
