// TFS responds to more than fires; classify the incident, not the service.
export function incidentCategory(description) {
    const text = String(description ?? "");
    if (/\bmedical\b/i.test(text)) return "medical";
    if (/\b(?:fire|alarm)\b/i.test(text)) return "fire";
    return "other";
}
