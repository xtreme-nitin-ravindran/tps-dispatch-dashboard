export const INCIDENT_LIST_BATCH_SIZE = 40;

export function incidentFilterKey({
  datasetRevision = 0, radiusKm = null, nearby = null, serviceFilter = 'all',
  eventFilter = 'all', division = 'all', hours = 24, search = ''
} = {}) {
  const origin = Array.isArray(nearby) ? nearby.join(',') : '';
  return [datasetRevision, radiusKm ?? 'toronto', origin, serviceFilter,
    eventFilter, division, hours, search].join('|');
}

export function incidentListKey({
  filterKey = '', sort = 'newest', online = true, availability = ''
} = {}) {
  return [filterKey, sort, online ? 'online' : 'offline', availability].join('|');
}

export function nextIncidentBatch(items, renderedCount, batchSize = INCIDENT_LIST_BATCH_SIZE) {
  const start = Math.max(0, renderedCount);
  const end = Math.min(items.length, start + Math.max(1, batchSize));
  return { items: items.slice(start, end), start, end, remaining: items.length - end };
}
