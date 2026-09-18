import { policeDivision } from './police-divisions.js';

export function intersectionQueries(location) {
  const parts = String(location || '').split('/').map(part => part
    .replace(/,\s*(TT|NY|EY|ET|SC|YK)\b/gi, '').trim().replace(/\s+/g, ' '));
  const [street, ...crosses] = parts;
  if (!street || !/[a-z]/i.test(street)) return [];
  return [...new Set(crosses.filter(cross => /[a-z]/i.test(cross) && cross.toUpperCase() !== street.toUpperCase())
    .map(cross => `${street} & ${cross}, Toronto, Ontario`))];
}

export async function lookupIntersection(query, fetchImpl = fetch) {
  const url = new URL('https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates');
  url.search = new URLSearchParams({ SingleLine: query, f: 'json', outSR: '4326',
    outFields: 'Country,Addr_type', countryCode: 'CA', maxLocations: '1',
    searchExtent: '-79.64,43.58,-79.12,43.86' });
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    const candidate = (await response.json()).candidates?.[0];
    if (candidate?.attributes?.Addr_type !== 'StreetInt' || candidate.attributes.Country !== 'CAN' ||
        !Number.isFinite(candidate.score) || candidate.score < 95) return null;
    const { x, y } = candidate.location || {};
    return Number.isFinite(x) && Number.isFinite(y) && x >= -79.65 && x <= -79.12 && y >= 43.58 && y <= 43.86 ? [y,x] : null;
  } catch { return null; }
}

export function intersectionDivision(location, coordinates, boundaries) {
  const queries = intersectionQueries(location);
  if (!queries.length || coordinates?.length !== queries.length) return 'Unknown';
  const divisions = coordinates.map(point => policeDivision('Intersection', point, boundaries));
  // A missing endpoint must not silently turn a street segment into a single point.
  if (divisions.includes('Unknown')) return 'Unknown';
  const unique = [...new Set(divisions)].sort();
  return unique.length === 1 ? unique[0] : `Possible divisions ${unique.map(d => d.replace('Division ', '')).join(' / ')}`;
}
