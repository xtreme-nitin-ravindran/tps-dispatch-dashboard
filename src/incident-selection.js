export function reconcileIncidentSelection(selectedId, incidents) {
  if (selectedId === null) return null;
  return incidents.some(incident => incident.id === selectedId) ? selectedId : null;
}

export function restoreSharedIncident(selectedId, incidents) {
  if (selectedId === null) return { id: null, found: false };
  const incident = incidents.find(item => item.id === selectedId);
  return incident ? { id: incident.id, found: true } : { id: null, found: false };
}
