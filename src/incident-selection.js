export function reconcileIncidentSelection(selectedId, incidents) {
  if (selectedId === null) return null;
  return incidents.some(incident => incident.id === selectedId) ? selectedId : null;
}
