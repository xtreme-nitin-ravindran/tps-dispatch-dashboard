export function postalPrefix(location) {
  const value = String(location || '').trim().toUpperCase();
  return /^M[1-9][ABCEGHJKLMNPRSTVWXYZ]$/.test(value) ? value : null;
}

// Same public ArcGIS geocoder used by TPS My Neighbourhood. Do not persist results.
export async function lookupPostalCoordinates(prefix, fetchImpl = fetch) {
  if (!postalPrefix(prefix)) return null;
  const url = new URL('https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates');
  url.search = new URLSearchParams({ SingleLine: prefix, f: 'json', outSR: '4326',
    outFields: 'Postal,Country,Addr_type', countryCode: 'CA', maxLocations: '1',
    searchExtent: '-79.64,43.58,-79.12,43.86' });
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    const candidate = (await response.json()).candidates?.[0];
    if (candidate?.attributes?.Postal !== prefix || candidate.attributes.Country !== 'CAN' ||
        candidate.attributes.Addr_type !== 'Postal' || candidate.score < 95) return null;
    const { x, y } = candidate.location || {};
    return Number.isFinite(x) && Number.isFinite(y) && x >= -79.65 && x <= -79.12 && y >= 43.58 && y <= 43.86 ? [y, x] : null;
  } catch { return null; }
}
