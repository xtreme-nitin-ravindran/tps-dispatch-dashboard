// Boundaries are [longitude, latitude] GeoJSON coordinates.
function inRing(point, ring) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [a, b] = ring[i], [c, d] = ring[j];
    if ((b > y) !== (d > y) && x < (c - a) * (y - b) / (d - b) + a) inside = !inside;
  }
  return inside;
}
function inPolygon(point, rings) {
  return rings.length && inRing(point, rings[0]) && !rings.slice(1).some(ring => inRing(point, ring));
}
function onRing(point, ring) {
  const [x, y] = point;
  return ring.some(([a, b], i) => {
    const [c, d] = ring[(i + 1) % ring.length];
    if (a === c && b === d) return false;
    return Math.abs((x-a)*(d-b)-(y-b)*(c-a)) < 1e-12 &&
      x >= Math.min(a,c) && x <= Math.max(a,c) && y >= Math.min(b,d) && y <= Math.max(b,d);
  });
}
export function policeDivision(location, coordinates, boundaries, { postalEstimate = false } = {}) {
  if (!location || (!postalEstimate && !/[a-z]{2}/i.test(location)) || /^(unknown|location not published)$/i.test(location.trim()) || (!postalEstimate && /\b[A-Z]\d[A-Z]\b/i.test(location)) || !coordinates ||
      coordinates.length !== 2 || !coordinates.every(Number.isFinite)) return 'Unknown';
  const point = [coordinates[1], coordinates[0]];
  if ((boundaries?.features || []).some(({ geometry }) => {
    const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
    return polygons.some(rings => rings.some(ring => onRing(point, ring)));
  })) return 'Unknown';
  const matches = (boundaries?.features || []).filter(({ geometry }) => {
    if (geometry?.type === 'Polygon') return inPolygon(point, geometry.coordinates);
    if (geometry?.type === 'MultiPolygon') return geometry.coordinates.some(rings => inPolygon(point, rings));
    return false;
  });
  return matches.length === 1 ? `Division ${matches[0].properties.AREA_NAME}` : 'Unknown';
}
