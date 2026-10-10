import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { capturePoliceBoundaryRenderState, createPoliceBoundaryLayer, diagnosePoliceBoundaryGeometry, policeBoundaryRingCount, validatePoliceBoundaryGeoJSON, validateProjectedBoundaryParts } from '../src/police-boundary-overlay.js';

const bundled = JSON.parse(readFileSync(new URL('../data/police-divisions.geojson', import.meta.url)));

test('bundled boundaries contain only valid closed Polygon and MultiPolygon rings', () => {
  const totals = validatePoliceBoundaryGeoJSON(bundled);
  assert.deepEqual(totals, { features: 16, polygons: 18, rings: 19, coordinates: 24459 });
});

test('geometry diagnostic proves bundled rings are stable and contain no cross-city joins', () => {
  const report = diagnosePoliceBoundaryGeometry(bundled);
  assert.equal(report.features, 16);
  assert.equal(report.polygons, 18);
  assert.equal(report.rings, 19);
  assert.equal(report.invalidRings, 0);
  assert.equal(report.invalidCoordinates, 0);
  assert.equal(report.impossibleCrossCitySegments, 0);
  assert.match(report.checksum, /^[0-9a-f]{8}$/);
  const before = report.checksum;
  createPoliceBoundaryLayer({ geoJSON: value => ({ value }) }, bundled);
  assert.equal(diagnosePoliceBoundaryGeometry(bundled).checksum, before);
});

test('geometry diagnostic flags open rings, invalid coordinates, and implausible joins', () => {
  const malformed = {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[
      [-79.4, 43.6], [-78.6, 43.9], null, [-79.4, 43.6]
    ]] } }]
  };
  const report = diagnosePoliceBoundaryGeometry(malformed);
  assert.equal(report.invalidCoordinates, 1);
  assert.ok(report.suspiciousSegments >= 1);
  assert.equal(diagnosePoliceBoundaryGeometry(null).invalidRings, 1);
  assert.equal(diagnosePoliceBoundaryGeometry({type:'FeatureCollection',features:[{geometry:{type:'LineString'}}]}).invalidRings, 1);
  assert.equal(diagnosePoliceBoundaryGeometry({type:'FeatureCollection',features:[{geometry:{type:'Polygon'}}]}).polygons, 1);
  assert.equal(diagnosePoliceBoundaryGeometry({type:'FeatureCollection',features:[{geometry:{type:'Polygon',coordinates:[null]}}]}).invalidRings, 1);
  assert.equal(diagnosePoliceBoundaryGeometry({type:'FeatureCollection',features:[{geometry:{type:'MultiPolygon'}}]}).polygons, 0);
  assert.equal(diagnosePoliceBoundaryGeometry({type:'FeatureCollection',features:[{geometry:{type:'MultiPolygon',coordinates:[null]}}]}).polygons, 1);
});

test('validation rejects malformed nesting, open rings, invalid positions, and reversed coordinates', () => {
  const collection = coordinates => ({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates } }]
  });
  assert.throws(() => validatePoliceBoundaryGeoJSON(collection([[[-79.4, 43.6], [-79.3, 43.6], [-79.3, 43.7], [-79.4, 43.7]]])), /closed ring/);
  assert.throws(() => validatePoliceBoundaryGeoJSON(collection([[[-79.4, 43.6], null, [-79.3, 43.7], [-79.4, 43.6]]])), /array|position/);
  assert.throws(() => validatePoliceBoundaryGeoJSON(collection([[[43.6, -79.4], [43.7, -79.4], [43.7, -79.3], [43.6, -79.4]]])), /longitude\/latitude/);
  assert.throws(() => validatePoliceBoundaryGeoJSON({ type: 'FeatureCollection', features: [{ geometry: { type: 'LineString', coordinates: [] } }] }), /Polygon or MultiPolygon/);
  assert.throws(() => validatePoliceBoundaryGeoJSON(null), /GeoJSON FeatureCollection/);
  assert.throws(() => validatePoliceBoundaryGeoJSON({ type: 'FeatureCollection', features: null }), /GeoJSON FeatureCollection/);
  assert.throws(() => validatePoliceBoundaryGeoJSON({ type: 'FeatureCollection', features: [{}] }), /Polygon or MultiPolygon/);
  for (const invalid of [[-79.4], [Number.NaN,43.6], [-81,43.6], [-78,43.6], [-79.4,42], [-79.4,45]]) {
    assert.throws(() => validatePoliceBoundaryGeoJSON(collection([[
      [-79.4,43.6], invalid, [-79.3,43.7], [-79.4,43.6]
    ]])), /position/);
  }
  assert.throws(() => validatePoliceBoundaryGeoJSON(collection([[[-79.4,43.6],[-79.3,43.7],[-79.4,43.6]]])), /closed ring/);
});

test('unfilled clipped SVG overlay preserves separate rings and does not mutate source geometry', () => {
  const source = structuredClone(bundled);
  let received;
  const leaflet = {
    geoJSON(boundaries, options) {
      received = { boundaries, options };
      return { kind: 'layer' };
    }
  };
  const renderer = { kind: 'dedicated' };
  const result = createPoliceBoundaryLayer(leaflet, source, { color: '#123456', renderer });
  assert.deepEqual(result, { kind: 'layer' });
  assert.equal(received.boundaries, source);
  assert.equal(received.options.noClip, undefined, 'Leaflet viewport clipping remains enabled');
  assert.equal(received.options.renderer, renderer);
  assert.equal(received.options.style.fill, false);
  assert.equal(received.options.style.className, 'police-boundary');
  assert.equal(received.options.style.color, '#123456');
  createPoliceBoundaryLayer(leaflet, source);
  assert.equal(received.options.style.color, '#93c5fd', 'default styling remains available');
  assert.equal(received.options.onEachFeature, undefined);
  assert.equal(source.features[5].geometry.coordinates.length, 2, 'separate rings are not joined');
  assert.deepEqual(source, bundled);
  const featureHandler = () => {};
  createPoliceBoundaryLayer(leaflet, source, {onEachFeature:featureHandler});
  assert.equal(received.options.onEachFeature, featureHandler);
  received.options.onEachFeature();
});

test('projected validator reports non-finite and viewport-spanning segments without changing them', () => {
  const parts = [[{x:10,y:10},{x:20,y:20},{x:390,y:20},{x:Number.NaN,y:30}]];
  const before = structuredClone(parts);
  const issues = validateProjectedBoundaryParts(parts, {x:390,y:844});
  assert.deepEqual(issues.map(issue => issue.type), ['non-finite-point']);
  assert.deepEqual(parts, before);
  assert.equal(validateProjectedBoundaryParts([[{x:0,y:0},{x:800,y:0}]], {x:390,y:844})[0].type, 'viewport-spanning-segment');
  assert.deepEqual(validateProjectedBoundaryParts(undefined, undefined), []);
  assert.deepEqual(validateProjectedBoundaryParts([null, [[{x:0,y:0}], {x:1,y:1}]], {x:0,y:0}, {viewportRatio:1}), []);
  assert.deepEqual(validateProjectedBoundaryParts([[{x:Number.NaN,y:0},{x:1,y:1}]], {x:10,y:10}), [
    {type:'non-finite-point',partIndex:0,pointIndex:0}
  ]);
});

test('projected validator reports points outside the active renderer bounds', () => {
  const issues=validateProjectedBoundaryParts([[{x:10,y:10},{x:401,y:10}]],{x:390,y:844},{
    rendererBounds:{min:{x:0,y:0},max:{x:390,y:844}}
  });
  assert.equal(issues[0].type,'point-outside-renderer-bounds');
});

test('Canvas capture detects CSS and backing-store dimension mismatches', () => {
  const previous=globalThis.devicePixelRatio;
  const previousComputedStyle=globalThis.getComputedStyle;
  globalThis.devicePixelRatio=2;
  globalThis.getComputedStyle=()=>({width:'390px',height:'844px'});
  try {
    const container={
      tagName:'canvas',width:390,height:844,style:{},
      getBoundingClientRect:()=>({width:390,height:844}),getAttribute:()=>null
    };
    const capture=capturePoliceBoundaryRenderState({
      map:{getSize:()=>({x:390,y:844}),getPane:()=>({style:{}})},
      layer:{options:{renderer:{_container:container,_ctx:{}}}}
    });
    assert.deepEqual(capture.dimensionIssues,[
      'canvas-width-backing-store-mismatch','canvas-height-backing-store-mismatch'
    ]);
    globalThis.devicePixelRatio=0;
    const fallback=capturePoliceBoundaryRenderState({
      map:{getSize:()=>({x:390,y:844})},
      layer:{options:{renderer:{_container:{...container,width:390,height:844},_ctx:{}}}}
    });
    assert.equal(fallback.devicePixelRatio,1);
    assert.deepEqual(fallback.dimensionIssues,[]);
  } finally {
    globalThis.devicePixelRatio=previous;
    globalThis.getComputedStyle=previousComputedStyle;
  }
});

test('debug capture identifies feature/ring ownership and records Leaflet lifecycle state', () => {
  const featureLayer = {
    _leaflet_id: 42,
    __policeBoundaryFeatureIndex: 3,
    __policeBoundaryRingCount: 2,
    feature: { geometry: { type: 'MultiPolygon' } },
    _parts: [[{x:0,y:0},{x:900,y:0}]],
    _pxBounds:{min:{x:0,y:0},max:{x:900,y:1}},
    _path: { getAttribute: name => name === 'd' ? 'M0 0L900 0' : name === 'transform' ? 'translate(1 2)' : null }
  };
  const renderer = {
    options:{pane:'policeBoundaryPane'},
    _ctx: {},
    _bounds: {min:{x:0,y:1},max:{x:Number.NaN,y:3}},
    _center: {x:4,y:5},
    _zoom: 12
  };
  const layer = { eachLayer: callback => callback(featureLayer), options: { renderer } };
  const map = {
    getSize: () => ({x:390,y:844}), getZoom: () => 12, getCenter:()=>({lat:43.70012,lng:-79.42012}),
    getPane: pane => ({style:{transform:pane === 'policeBoundaryPane' ? 'translate3d(3px, 4px, 0)' : 'translate3d(1px, 2px, 0)'}}),
    _pixelOrigin: {x:100,y:200}
  };
  const capture = capturePoliceBoundaryRenderState({map,layer,lifecycleEvent:'zoomend'});
  assert.equal(capture.lifecycleEvent, 'zoomend');
  assert.equal(capture.renderer.kind, 'canvas');
  assert.deepEqual(capture.renderer.bounds, {min:{x:0,y:1},max:null});
  assert.deepEqual(capture.renderer.center, {x:4,y:5});
  assert.equal(capture.renderer.zoom, 12);
  assert.equal(capture.layers[0].featureIndex, 3);
  assert.equal(capture.layers[0].sourceRingCount, 2);
  assert.equal(capture.layers[0].path, 'M0 0L900 0');
  assert.equal(capture.layers[0].pathTransform, 'translate(1 2)');
  assert.equal(featureLayer._path.getAttribute('missing'), null);
  assert.deepEqual(capture.layers[0].layerBounds, {min:{x:0,y:0},max:{x:900,y:1}});
  assert.equal(capture.issues[0].type, 'viewport-spanning-segment');
  assert.deepEqual(capture.map.center, {lat:43.7,lng:-79.42});
  assert.equal(capture.map.paneTransform, 'translate3d(3px, 4px, 0)');
  assert.deepEqual(capture.map.pixelOrigin, {x:100,y:200});
});

test('debug capture tolerates missing optional Leaflet internals and snapshots SVG state', () => {
  const empty = capturePoliceBoundaryRenderState({});
  assert.equal(empty.lifecycleEvent, 'manual');
  assert.deepEqual(empty.map, {zoom:null,size:null,center:null,pixelOrigin:null,paneTransform:null});
  assert.deepEqual(empty.renderer, {leafletId:null,kind:'unknown',dimensions:null,bounds:null,center:null,zoom:null,viewBox:null,transform:null});
  assert.deepEqual(empty.dimensionIssues, []);
  assert.deepEqual(empty.layers, []);
  const container = {
    tagName:'svg',
    style:{transform:'style-transform'},
    getAttribute: name => ({viewBox:'0 0 390 844',transform:'attribute-transform'}[name] || null)
  };
  const svg = capturePoliceBoundaryRenderState({
    map:{getSize:()=>({x:390,y:844}),getZoom:()=>undefined,getPane:()=>({style:{}}),_pixelOrigin:{x:0,y:0}},
    layer:{eachLayer: callback => callback(null), _renderer:{_container:container,_center:{x:null,y:1},_zoom:null}}
  });
  assert.equal(svg.renderer.kind, 'svg');
  assert.equal(svg.renderer.viewBox, '0 0 390 844');
  assert.equal(svg.renderer.transform, 'attribute-transform');
  assert.equal(svg.layers[0].projectedPartCount, 0);
  assert.equal(svg.layers[0].leafletId, null);
  assert.equal(container.getAttribute('missing'), null);
  const styled = capturePoliceBoundaryRenderState({
    map:{getSize:()=>({x:1,y:2}),getPane:()=>null},
    layer:{options:{renderer:{
      _container:{tagName:'svg',style:{transform:'style-transform'},getAttribute:()=>null},
      _bounds:{min:{x:null,y:0},max:{x:1,y:2}}
    }}}
  });
  assert.deepEqual(styled.renderer.bounds, {min:null,max:{x:1,y:2}});
  assert.equal(styled.renderer.transform, 'style-transform');
  const malformedParts = capturePoliceBoundaryRenderState({
    map:{getSize:()=>({x:1,y:2})},
    layer:{eachLayer:callback=>callback({_parts:{not:'an array'}})}
  });
  assert.equal(malformedParts.layers[0].projectedPartCount, 0);
});

test('geometry and projected diagnostics cover malformed edge shapes without mutation', () => {
  const impossible = {type:'FeatureCollection',features:[{geometry:{type:'Polygon',coordinates:[[
    null, [-80.4,42.6], [-78.6,44.4], [-80.4,42.6], [-80.3,42.7]
  ]]}}]};
  const report = diagnosePoliceBoundaryGeometry(impossible);
  assert.equal(report.invalidRings, 1);
  assert.equal(report.invalidCoordinates, 1);
  assert.ok(report.impossibleCrossCitySegments >= 1);
  const mixed = [null, 2, {}, {x:1}, {y:1}, [{x:0,y:0},{x:1,y:1}]];
  assert.deepEqual(validateProjectedBoundaryParts([mixed], {x:'bad',y:'bad'}), []);
});

test('debug capture flags projected parts that cannot map back to source rings', () => {
  const featureLayer = {
    __policeBoundaryFeatureIndex: 7,
    __policeBoundaryRingCount: 1,
    feature: {geometry:{type:'Polygon'}},
    _parts: [[{x:0,y:0},{x:1,y:1}],[{x:2,y:2},{x:3,y:3}]]
  };
  const capture = capturePoliceBoundaryRenderState({
    map:{getSize:()=>({x:390,y:844}),getZoom:()=>10,getPane:()=>null},
    layer:{eachLayer:callback=>callback(featureLayer)}
  });
  assert.equal(capture.issues[0].type, 'projected-parts-exceed-source-rings');
  assert.equal(capture.issues[0].featureIndex, 7);
});

test('debug capture preserves malformed projected points without inventing bounds', () => {
  const capture=capturePoliceBoundaryRenderState({
    map:{getSize:()=>({x:390,y:844})},
    layer:{eachLayer:callback=>callback({_parts:[[{x:Number.NaN,y:0}]]})}
  });
  assert.equal(capture.layers[0].projectedParts[0].bounds,null);
  assert.equal(capture.layers[0].issues[0].type,'non-finite-point');
});

test('ring counts remain isolated for Polygon and MultiPolygon features', () => {
  assert.equal(policeBoundaryRingCount({geometry:{type:'Polygon',coordinates:[[],[]]}}), 2);
  assert.equal(policeBoundaryRingCount({geometry:{type:'MultiPolygon',coordinates:[[[]],[[],[]]]}}), 3);
  assert.equal(policeBoundaryRingCount({geometry:{type:'Polygon'}}), 0);
  assert.equal(policeBoundaryRingCount({geometry:{type:'MultiPolygon',coordinates:[null]}}), 0);
  assert.equal(policeBoundaryRingCount({geometry:{type:'MultiPolygon'}}), 0);
  assert.equal(policeBoundaryRingCount({geometry:{type:'LineString',coordinates:[]}}), 0);
  assert.equal(policeBoundaryRingCount(), 0);
});

test('the boundary class cannot override Leaflet and fill the map', () => {
  const css = readFileSync(new URL('../assets/css/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.police-boundary\s*{[^}]*fill:\s*none\s*!important/s);
  assert.doesNotMatch(css, /\.police-boundary\s*{[^}]*fill:\s*var\(--boundary-marker\)/s);
});

test('application lazily creates and reuses an isolated Canvas boundary layer after visible-map paint', () => {
  const app = readFileSync(new URL('../src/app/app.js', import.meta.url), 'utf8');
  assert.equal([...app.matchAll(/createPoliceBoundaryLayer\(/g)].length, 1);
  assert.match(app, /L\.svg\(\{ padding: 0\.5, pane: 'policeBoundaryPane' \}\)/);
  assert.match(app, /L\.canvas\(\{ padding: 0\.5, pane: 'policeBoundaryPane' \}\)/);
  assert.match(app, /divisionDataPromise \|\|= fetch/);
  assert.match(app, /requestAnimationFrame\(\(\) => \{[\s\S]*?requestAnimationFrame/);
  assert.match(app, /if \(boundaryVisible\) \{[\s\S]*?divisionLayer\.addTo\(dispatchMap\)/);
  assert.match(app, /event\.layer !== divisionLayer/);
  assert.match(app, /if \(!mapAllowsBoundaryWork\(\) \|\| generation !== boundaryRenderGeneration\) return/);
  assert.match(app, /queuePoliceBoundaryWork\('map-revealed-after-invalidation'\)/);
  assert.match(app, /constructionDeferred: boundaryVisible && !divisionGeometryLayer/);
  assert.match(app, /if \(!dispatchMap\.hasLayer\(divisionGeometryLayer\)\) divisionGeometryLayer\.addTo\(dispatchMap\)/);
  assert.match(app, /dispatchMap\.removeLayer\(divisionGeometryLayer\)/);
  assert.doesNotMatch(app, /divisionLayer\.addLayer\(divisionGeometryLayer\)/);
  const viewSetter = app.slice(app.indexOf('function setMobileView('), app.indexOf('\nmobileViewToggles.forEach'));
  assert.doesNotMatch(viewSetter, /createPoliceBoundaryLayer|removeLayer|clearLayers/);
  assert.match(viewSetter, /view === 'calls'[\s\S]*?boundaryDirty = true;[\s\S]*?boundaryRenderGeneration \+= 1;[\s\S]*?cancelAnimationFrame/);
});
