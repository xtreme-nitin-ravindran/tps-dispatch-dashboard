export function reconcileIncidentSelection(selectedId, incidents) {
  if (selectedId === null) return null;
  return incidents.some(incident => incident.id === selectedId) ? selectedId : null;
}

export function restoreSharedIncident(selectedId, incidents) {
  if (selectedId === null) return { id: null, found: false };
  const incident = incidents.find(item => item.id === selectedId);
  return incident ? { id: incident.id, found: true } : { id: null, found: false };
}

export const MISSING_INCIDENT_MESSAGE = 'This incident is no longer in the current SirenTO data.';

export function incidentArrivalState(selectedId, incidents, visibleIncidents, { mobile = false } = {}) {
  if (selectedId === null) return { id: null, found: false, missing: false, needsReveal: false };
  const incident = incidents.find(item => item.id === selectedId);
  if (!incident) {
    return { id: null, found: false, missing: true, needsReveal: false, message: MISSING_INCIDENT_MESSAGE };
  }
  return {
    id: incident.id,
    found: true,
    missing: false,
    needsReveal: !visibleIncidents.some(item => item.id === incident.id),
    mobileView: mobile ? 'map' : null,
    mobileSheetState: mobile ? 'half' : null
  };
}
