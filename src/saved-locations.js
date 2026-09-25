export const SAVED_LOCATIONS_STORAGE_KEY = 'sirento.saved-locations.v1';
export const MAX_SAVED_LOCATIONS = 5;

const currentLocationContext = () => ({ type: 'current' });

function validCoordinate(value, minimum, maximum) {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function normalizeLocation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const label = typeof value.label === 'string' ? value.label.trim() : '';
  if (!id || !label || !validCoordinate(value.latitude, -90, 90) || !validCoordinate(value.longitude, -180, 180)) return null;
  return { id, label, latitude: value.latitude, longitude: value.longitude };
}

function normalizeState(value) {
  const locations = [];
  const ids = new Set();
  const coordinates = new Set();
  const records = Array.isArray(value?.locations) ? value.locations : [];
  for (const record of records) {
    const location = normalizeLocation(record);
    if (!location || ids.has(location.id)) continue;
    const coordinateKey = `${location.latitude},${location.longitude}`;
    if (coordinates.has(coordinateKey)) continue;
    ids.add(location.id);
    coordinates.add(coordinateKey);
    locations.push(location);
    if (locations.length === MAX_SAVED_LOCATIONS) break;
  }
  const selectedId = value?.locationContext?.type === 'saved' && typeof value.locationContext.id === 'string'
    ? value.locationContext.id
    : null;
  const locationContext = selectedId && ids.has(selectedId)
    ? { type: 'saved', id: selectedId }
    : currentLocationContext();
  return { locations, locationContext };
}

function newId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `saved-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function loadSavedLocationState(storage) {
  try {
    return normalizeState(JSON.parse(storage.getItem(SAVED_LOCATIONS_STORAGE_KEY)));
  } catch {
    return normalizeState(null);
  }
}

export function saveSavedLocationState(storage, state) {
  const normalized = normalizeState(state);
  try { storage.setItem(SAVED_LOCATIONS_STORAGE_KEY, JSON.stringify(normalized)); } catch { /* State remains usable when storage is blocked. */ }
  return normalized;
}

export function addSavedLocation(storage, state, input, createId = newId) {
  const label = typeof input?.label === 'string' ? input.label.trim() : '';
  if (!label) throw new TypeError('Saved location label is required.');
  if (!validCoordinate(input?.latitude, -90, 90) || !validCoordinate(input?.longitude, -180, 180)) {
    throw new TypeError('Saved location coordinates are invalid.');
  }
  const current = normalizeState(state);
  if (current.locations.length >= MAX_SAVED_LOCATIONS) throw new RangeError('A maximum of 5 saved locations is allowed.');
  if (current.locations.some(location => location.latitude === input.latitude && location.longitude === input.longitude)) {
    throw new TypeError('That location is already saved.');
  }
  const location = normalizeLocation({ id: createId(), label, latitude: input.latitude, longitude: input.longitude });
  if (!location || current.locations.some(saved => saved.id === location.id)) throw new TypeError('Saved location ID is invalid or duplicated.');
  return saveSavedLocationState(storage, { ...current, locations: [...current.locations, location] });
}

export function renameSavedLocation(storage, state, id, label) {
  const nextLabel = typeof label === 'string' ? label.trim() : '';
  if (!nextLabel) throw new TypeError('Saved location label is required.');
  const current = normalizeState(state);
  if (!current.locations.some(location => location.id === id)) return current;
  return saveSavedLocationState(storage, {
    ...current,
    locations: current.locations.map(location => location.id === id ? { ...location, label: nextLabel } : location)
  });
}

export function deleteSavedLocation(storage, state, id) {
  const current = normalizeState(state);
  const locations = current.locations.filter(location => location.id !== id);
  const locationContext = current.locationContext.type === 'saved' && current.locationContext.id === id
    ? currentLocationContext()
    : current.locationContext;
  return saveSavedLocationState(storage, { locations, locationContext });
}

export function selectSavedLocation(storage, state, id) {
  const current = normalizeState(state);
  if (!current.locations.some(location => location.id === id)) {
    return saveSavedLocationState(storage, { ...current, locationContext: currentLocationContext() });
  }
  return saveSavedLocationState(storage, { ...current, locationContext: { type: 'saved', id } });
}

export function selectCurrentLocation(storage, state) {
  return saveSavedLocationState(storage, { ...normalizeState(state), locationContext: currentLocationContext() });
}

export function savedLocationForContext(state) {
  if (state?.locationContext?.type !== 'saved') return null;
  return (state.locations || []).find(location => location.id === state.locationContext.id) || null;
}

export function referenceCoordinates(state, liveCoordinates = null) {
  const saved = savedLocationForContext(state);
  return saved ? [saved.latitude, saved.longitude] : liveCoordinates;
}
