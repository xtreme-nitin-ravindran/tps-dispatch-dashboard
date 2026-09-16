import { assessTpsFreshness } from "./freshness.js";

export const TPS_C4S_URL = "https://services.arcgis.com/S9th0jAJ7bqgIRjw/arcgis/rest/services/C4S_Public_NoGO_TPS_Website/FeatureServer/0/query";

export async function fetchTpsSource({ fetchImpl = fetch, signal, limit = 100 } = {}) {
    const params = new URLSearchParams({
        where: "1=1",
        outFields: "*",
        returnGeometry: "false",
        resultRecordCount: String(limit),
        orderByFields: "OCCURRENCE_TIME DESC",
        f: "json"
    });
    const response = await fetchImpl(`${TPS_C4S_URL}?${params}`, { signal });
    if (!response.ok) {
        throw new Error(`TPS source returned HTTP ${response.status}`);
    }

    const payload = await response.json();
    if (payload.error) throw new Error(`TPS source error: ${payload.error.message}`);
    const incidents = (payload.features || []).map(feature => feature.attributes);
    return {
        source: "TPS",
        incidents,
        freshness: assessTpsFreshness(incidents)
    };
}
