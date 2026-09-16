import { parseTfsTimestamp } from "../tfs/time.js";
import { normalizeTfsIncident } from "../tfs/normalize.js";

export function buildTfsSnapshot(source, now = new Date(), previous = null) {
    if (!source || !Array.isArray(source.incidents)) {
        throw new TypeError("TFS source must contain an incidents array");
    }
    const sourceUpdatedAt = parseTfsTimestamp(source.updatedAt);
    if (!sourceUpdatedAt) throw new Error("Invalid TFS source update timestamp");
    if (previous && (!Array.isArray(previous.incidents) || previous.source !== 'TFS')) {
        throw new Error("Invalid previous TFS snapshot; refusing to discard history");
    }
    if (previous?.sourceUpdatedAt && Date.parse(sourceUpdatedAt) < Date.parse(parseTfsTimestamp(previous.sourceUpdatedAt))) {
        throw new Error("TFS source is older than the saved snapshot");
    }
    const incidents = new Map();
    for (const incident of previous?.incidents || []) {
        if (incident.id) incidents.set(incident.id, { ...incident, isOngoing: false });
    }
    for (const row of source.incidents) {
        const incident = normalizeTfsIncident(row);
        if (!incident.id) continue;
        const prior = incidents.get(incident.id);
        incidents.set(incident.id, {
            ...incident,
            firstSeenAt: prior?.firstSeenAt || now.toISOString(),
            lastSeenAt: now.toISOString()
        });
    }
    const cutoff = now.getTime() - 168 * 60 * 60 * 1000;
    return {
        schemaVersion: 1,
        source: "TFS",
        retentionHours: 168,
        historyStartedAt: previous?.historyStartedAt || previous?.fetchedAt || now.toISOString(),
        fetchedAt: now.toISOString(),
        sourceUpdatedAt,
        incidents: [...incidents.values()]
            .filter(incident => Date.parse(incident.timestamp) >= cutoff && Date.parse(incident.timestamp) <= now.getTime())
            .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    };
}
