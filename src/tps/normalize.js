export function normalizeTpsIncident(row) {
    if (!row || typeof row !== "object") {
        throw new TypeError("TPS incident must be an object");
    }

    return {
        id: String(row.OBJECTID ?? "").trim(),
        source: "TPS",
        eventType: "police",
        description: String(row.CALL_TYPE || "Call for Service").trim(),
        location: String(row.CROSS_STREETS || "Location not published").trim(),
        timestamp: parseTimestamp(row.OCCURRENCE_TIME),
        alarmLevel: null,
        isOngoing: false,
        vehicles: [],
        latitude: numberOrNull(row.LATITUDE),
        longitude: numberOrNull(row.LONGITUDE),
        division: String(row.DIVISION || "Unknown").trim(),
        callTypeCode: String(row.CALL_TYPE_CODE || "").trim()
    };
}

function parseTimestamp(value) {
    const timestamp = Number(value);
    return Number.isFinite(timestamp) && timestamp > 0
        ? new Date(timestamp).toISOString()
        : null;
}

function numberOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}
