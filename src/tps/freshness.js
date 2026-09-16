export const TPS_FRESHNESS_WINDOW_MS = 24 * 60 * 60 * 1000;

export function assessTpsFreshness(incidents, now = new Date(), maxAgeMs = TPS_FRESHNESS_WINDOW_MS) {
    const timestamps = incidents
        .map(incident => Number(incident.OCCURRENCE_TIME))
        .filter(timestamp => Number.isFinite(timestamp) && timestamp > 0);
    const newestTimestamp = timestamps.length ? Math.max(...timestamps) : null;
    const newestOccurrenceAt = newestTimestamp === null
        ? null
        : new Date(newestTimestamp).toISOString();
    const ageMs = newestTimestamp === null ? null : now.getTime() - newestTimestamp;

    return {
        newestOccurrenceAt,
        ageMs,
        isFresh: ageMs !== null && ageMs >= 0 && ageMs <= maxAgeMs
    };
}
