import { parseTfsTimestamp } from "../tfs/time.js";
import { normalizeTfsIncident } from "../tfs/normalize.js";

export function buildTfsSnapshot(source, now = new Date()) {
    if (!source || !Array.isArray(source.incidents)) {
        throw new TypeError("TFS source must contain an incidents array");
    }

    return {
        schemaVersion: 1,
        source: "TFS",
        fetchedAt: now.toISOString(),
        sourceUpdatedAt: parseTfsTimestamp(source.updatedAt),
        incidents: source.incidents
            .map(normalizeTfsIncident)
            .filter(incident => incident.id)
    };
}
