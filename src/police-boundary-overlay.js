const GEOMETRY_DEPTH = { Polygon: 3, MultiPolygon: 4 };

function validPosition(position) {
  return Array.isArray(position) && position.length >= 2 &&
    position.slice(0, 2).every(Number.isFinite) &&
    position[0] >= -80.5 && position[0] <= -78.5 &&
    position[1] >= 42.5 && position[1] <= 44.5;
}

function validateCoordinates(value, depth, path, totals) {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
  if (depth === 1) {
    if (!validPosition(value)) throw new TypeError(`${path} must be a finite longitude/latitude position`);
    totals.coordinates += 1;
    return;
  }
  if (depth === 2 && (value.length < 4 || value[0][0] !== value.at(-1)[0] || value[0][1] !== value.at(-1)[1])) {
    throw new TypeError(`${path} must be a closed ring with at least four positions`);
  }
  if (depth === 2) totals.rings += 1;
  value.forEach((child, index) => validateCoordinates(child, depth - 1, `${path}[${index}]`, totals));
}

export function validatePoliceBoundaryGeoJSON(collection) {
  if (collection?.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
    throw new TypeError('Police boundaries must be a GeoJSON FeatureCollection');
  }
  const totals = { features: collection.features.length, polygons: 0, rings: 0, coordinates: 0 };
  collection.features.forEach((feature, featureIndex) => {
    const geometry = feature?.geometry;
    const depth = GEOMETRY_DEPTH[geometry?.type];
    if (!depth) throw new TypeError(`features[${featureIndex}] must contain Polygon or MultiPolygon geometry`);
    validateCoordinates(geometry.coordinates, depth, `features[${featureIndex}].geometry.coordinates`, totals);
    totals.polygons += geometry.type === 'Polygon' ? 1 : geometry.coordinates.length;
  });
  return totals;
}

export function createPoliceBoundaryLayer(leaflet, boundaries, options = {}) {
  validatePoliceBoundaryGeoJSON(boundaries);
  const layer = leaflet.geoJSON(boundaries, {
    style: {
      className: 'police-boundary',
      color: options.color || '#93c5fd',
      weight: 1.5,
      opacity: 0.65,
      fill: false
    },
    attribution: 'Division boundaries © Toronto Police Service',
    onEachFeature: options.onEachFeature
  });
  return layer;
}
