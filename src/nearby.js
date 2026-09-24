export function distanceKm(a, b) {
  if (![a, b].every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180)) return Infinity;
  const rad = n => n * Math.PI / 180;
  const h = Math.sin(rad(b[0] - a[0]) / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(rad(b[1] - a[1]) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

export function distanceLabel(kilometres) {
  return Number.isFinite(kilometres) && kilometres >= 0
    ? `${kilometres.toFixed(1)} km away`
    : '';
}

export function withinGeographicScope(origin, radiusKm, point) {
  if (radiusKm === null) return true;
  return distanceKm(origin, point) <= radiusKm;
}
