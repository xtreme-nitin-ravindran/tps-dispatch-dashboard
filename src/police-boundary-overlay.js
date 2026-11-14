const GEOMETRY_DEPTH = { Polygon: 3, MultiPolygon: 4 };
const SUSPICIOUS_SEGMENT_KM = 25;
const IMPOSSIBLE_SEGMENT_KM = 100;

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

function geometryChecksum(collection) {
  const input = JSON.stringify(collection?.features?.map(feature => feature?.geometry) || []);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function segmentDistanceKm(left, right) {
  if (!validPosition(left) || !validPosition(right)) return Number.NaN;
  const meanLatitude = ((left[1] + right[1]) / 2) * Math.PI / 180;
  const x = (right[0] - left[0]) * 111.32 * Math.cos(meanLatitude);
  const y = (right[1] - left[1]) * 110.57;
  return Math.hypot(x, y);
}

export function diagnosePoliceBoundaryGeometry(collection) {
  const report = {
    features: Array.isArray(collection?.features) ? collection.features.length : 0,
    polygons: 0,
    rings: 0,
    invalidRings: 0,
    invalidCoordinates: 0,
    suspiciousSegments: 0,
    impossibleCrossCitySegments: 0,
    maximumSegmentKm: 0,
    checksum: geometryChecksum(collection)
  };
  if (collection?.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
    report.invalidRings += 1;
    return report;
  }
  const inspectRing = ring => {
    report.rings += 1;
    if (!Array.isArray(ring) || ring.length < 4 ||
      ring[0]?.[0] !== ring.at(-1)?.[0] || ring[0]?.[1] !== ring.at(-1)?.[1]) report.invalidRings += 1;
    if (!Array.isArray(ring)) return;
    ring.forEach(position => { if (!validPosition(position)) report.invalidCoordinates += 1; });
    for (let index = 1; index < ring.length; index += 1) {
      const distance = segmentDistanceKm(ring[index - 1], ring[index]);
      if (!Number.isFinite(distance)) continue;
      report.maximumSegmentKm = Math.max(report.maximumSegmentKm, distance);
      if (distance > SUSPICIOUS_SEGMENT_KM) report.suspiciousSegments += 1;
      if (distance > IMPOSSIBLE_SEGMENT_KM) report.impossibleCrossCitySegments += 1;
    }
  };
  collection.features.forEach(feature => {
    const geometry = feature?.geometry;
    if (geometry?.type === 'Polygon') {
      report.polygons += 1;
      geometry.coordinates?.forEach(inspectRing);
    } else if (geometry?.type === 'MultiPolygon') {
      report.polygons += Array.isArray(geometry.coordinates) ? geometry.coordinates.length : 0;
      geometry.coordinates?.forEach(polygon => polygon?.forEach(inspectRing));
    } else {
      report.invalidRings += 1;
    }
  });
  report.maximumSegmentKm = Number(report.maximumSegmentKm.toFixed(3));
  return report;
}

export function createPoliceBoundaryLayer(leaflet, boundaries, options = {}) {
  validatePoliceBoundaryGeoJSON(boundaries);
  const layer = leaflet.geoJSON(boundaries, {
    renderer: options.renderer,
    style: {
      className: 'police-boundary',
      color: options.color || '#93c5fd',
      weight: 1.5,
      opacity: 0.65,
      fill: false
    },
    onEachFeature: options.onEachFeature
  });
  return layer;
}

function finitePoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

function plainBounds(bounds) {
  if (!bounds) return null;
  return {
    min: finitePoint(bounds.min) ? { x: bounds.min.x, y: bounds.min.y } : null,
    max: finitePoint(bounds.max) ? { x: bounds.max.x, y: bounds.max.y } : null
  };
}

function pointArray(part) {
  if (!Array.isArray(part)) return [];
  return part.flat(Infinity).filter(point => point && typeof point === 'object' && 'x' in point && 'y' in point);
}

export function validateProjectedBoundaryParts(parts, mapSize, { viewportRatio = 0.85, rendererBounds = null } = {}) {
  const width = Number(mapSize?.x) || 0;
  const height = Number(mapSize?.y) || 0;
  const threshold = Math.max(width, height) * viewportRatio;
  const issues = [];
  (parts || []).forEach((part, partIndex) => {
    const points = pointArray(part);
    points.forEach((point, pointIndex) => {
      if (!finitePoint(point)) {
        issues.push({ type: 'non-finite-point', partIndex, pointIndex });
        return;
      }
      if (rendererBounds?.min && rendererBounds?.max && (
        point.x < rendererBounds.min.x - 1 || point.x > rendererBounds.max.x + 1 ||
        point.y < rendererBounds.min.y - 1 || point.y > rendererBounds.max.y + 1
      )) {
        issues.push({type:'point-outside-renderer-bounds',partIndex,pointIndex,x:point.x,y:point.y});
      }
      if (pointIndex === 0 || !finitePoint(points[pointIndex - 1])) return;
      const previous = points[pointIndex - 1];
      const length = Math.hypot(point.x - previous.x, point.y - previous.y);
      if (threshold > 0 && length > threshold) {
        issues.push({ type: 'viewport-spanning-segment', partIndex, segmentIndex: pointIndex - 1,
          length: Number(length.toFixed(2)), threshold: Number(threshold.toFixed(2)) });
      }
    });
  });
  return issues;
}

function elementDimensions(container) {
  if (!container) return null;
  const rect = container.getBoundingClientRect?.();
  const style = globalThis.getComputedStyle?.(container);
  return {
    css: {
      width: rect?.width ?? null,
      height: rect?.height ?? null,
      declaredWidth: style?.width || container.style?.width || null,
      declaredHeight: style?.height || container.style?.height || null
    },
    backingStore: {
      width: Number.isFinite(container.width) ? container.width : null,
      height: Number.isFinite(container.height) ? container.height : null
    }
  };
}

function rendererSnapshot(renderer) {
  const container = renderer?._container;
  return {
    leafletId: renderer?._leaflet_id ?? null,
    kind: container?.tagName?.toLowerCase?.() || (renderer?._ctx ? 'canvas' : 'unknown'),
    dimensions: elementDimensions(container),
    bounds: plainBounds(renderer?._bounds),
    center: finitePoint(renderer?._center) ? { x: renderer._center.x, y: renderer._center.y } : null,
    zoom: Number.isFinite(renderer?._zoom) ? renderer._zoom : null,
    viewBox: container?.getAttribute?.('viewBox') || null,
    transform: container?.getAttribute?.('transform') || container?.style?.transform || null
  };
}

function projectedPartSnapshot(part) {
  const points = pointArray(part);
  const calculatedBounds = points.reduce((bounds, point) => {
    if (!finitePoint(point)) return bounds;
    bounds.min.x = Math.min(bounds.min.x, point.x);
    bounds.min.y = Math.min(bounds.min.y, point.y);
    bounds.max.x = Math.max(bounds.max.x, point.x);
    bounds.max.y = Math.max(bounds.max.y, point.y);
    return bounds;
  }, {min:{x:Infinity,y:Infinity},max:{x:-Infinity,y:-Infinity}});
  let checksum = 0x811c9dc5;
  for (const point of points) {
    const value = `${point.x},${point.y};`;
    for (let index = 0; index < value.length; index += 1) {
      checksum ^= value.charCodeAt(index);
      checksum = Math.imul(checksum, 0x01000193);
    }
  }
  return {
    pointCount: points.length,
    bounds: Number.isFinite(calculatedBounds.min.x) ? calculatedBounds : null,
    firstPoints: points.slice(0, 4).map(point => ({x:point.x,y:point.y})),
    lastPoints: points.slice(-4).map(point => ({x:point.x,y:point.y})),
    checksum: (checksum >>> 0).toString(16).padStart(8, '0')
  };
}

export function capturePoliceBoundaryRenderState({ map, layer, lifecycleEvent = 'manual', scheduling = null }) {
  const mapSize = map?.getSize?.() || null;
  const renderer = layer?.options?.renderer || layer?._renderer;
  const rendererBounds = plainBounds(renderer?._bounds);
  const layers = [];
  layer?.eachLayer?.(featureLayer => {
    const parts = Array.isArray(featureLayer?._parts) ? featureLayer._parts : [];
    const featureIndex = featureLayer?.__policeBoundaryFeatureIndex ?? null;
    const sourceRingCount = featureLayer?.__policeBoundaryRingCount ?? null;
    const issues = validateProjectedBoundaryParts(parts, mapSize, {rendererBounds}).map(issue => ({ ...issue, featureIndex }));
    if (Number.isFinite(sourceRingCount) && parts.length > sourceRingCount) {
      issues.push({ type: 'projected-parts-exceed-source-rings', featureIndex,
        projectedPartCount: parts.length, sourceRingCount });
    }
    layers.push({
      leafletId: featureLayer?._leaflet_id ?? null,
      featureIndex,
      geometryType: featureLayer?.feature?.geometry?.type || null,
      sourceRingCount,
      projectedPartCount: parts.length,
      projectedPointCounts: parts.map(part => pointArray(part).length),
      projectedParts: parts.map(projectedPartSnapshot),
      layerBounds: featureLayer?._pxBounds ? plainBounds(featureLayer._pxBounds) : null,
      path: featureLayer?._path?.getAttribute?.('d') || null,
      pathTransform: featureLayer?._path?.getAttribute?.('transform') || null,
      issues
    });
  });
  const pane = map?.getPane?.('overlayPane');
  const rendererPane = renderer?.options?.pane ? map?.getPane?.(renderer.options.pane) : pane;
  const size = mapSize ? { x: mapSize.x, y: mapSize.y } : null;
  const pixelOrigin = map?._pixelOrigin;
  const center = map?.getCenter?.();
  const roundedCenter = Number.isFinite(center?.lat) && Number.isFinite(center?.lng)
    ? {lat:Number(center.lat.toFixed(3)),lng:Number(center.lng.toFixed(3))} : null;
  const rendererState = rendererSnapshot(renderer);
  const canvasDimensions = rendererState.kind === 'canvas' ? rendererState.dimensions : null;
  const expectedBackingWidth = canvasDimensions?.css?.width == null ? null : Math.round(canvasDimensions.css.width * (Number(globalThis.devicePixelRatio) || 1));
  const expectedBackingHeight = canvasDimensions?.css?.height == null ? null : Math.round(canvasDimensions.css.height * (Number(globalThis.devicePixelRatio) || 1));
  const dimensionIssues = [];
  if (expectedBackingWidth !== null && canvasDimensions.backingStore.width !== expectedBackingWidth) dimensionIssues.push('canvas-width-backing-store-mismatch');
  if (expectedBackingHeight !== null && canvasDimensions.backingStore.height !== expectedBackingHeight) dimensionIssues.push('canvas-height-backing-store-mismatch');
  return {
    capturedAt: new Date().toISOString(),
    lifecycleEvent,
    map: {
      zoom: map?.getZoom?.() ?? null,
      size,
      center: roundedCenter,
      pixelOrigin: finitePoint(pixelOrigin) ? { x: pixelOrigin.x, y: pixelOrigin.y } : null,
      paneTransform: rendererPane?.style?.transform || null
    },
    renderer: rendererState,
    devicePixelRatio: Number(globalThis.devicePixelRatio) || 1,
    dimensionIssues,
    scheduling,
    layers,
    issues: layers.flatMap(item => item.issues)
  };
}

export function policeBoundaryRingCount(feature) {
  const geometry = feature?.geometry;
  if (geometry?.type === 'Polygon') return geometry.coordinates?.length || 0;
  if (geometry?.type === 'MultiPolygon') {
    return geometry.coordinates?.reduce((total, polygon) => total + (polygon?.length || 0), 0) || 0;
  }
  return 0;
}
