import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const boundarySrc = readFileSync(new URL('../src/police-boundary-map.js', import.meta.url), 'utf8');

test('[STORY-38G] suppresses police redraw until final invalidation without rebuilding roads', () => {
  const app=readFileSync(new URL('../src/app/app.js',import.meta.url),'utf8');
  const sheet=app.slice(app.indexOf('function setMobileSheetState('),app.indexOf('\nmobileSheetToggle?.addEventListener'));
  assert.match(sheet,/afterLayoutTransition/);
  assert.match(sheet,/layout-settled[\s\S]*?invalidateSize[\s\S]*?invalidate-size-complete[\s\S]*?queuePoliceBoundaryWork/);
  assert.doesNotMatch(sheet,/recreate/);
  assert.match(boundarySrc,/pane: 'policeBoundaryPane'/);
  assert.doesNotMatch(sheet,/setRoadOverlayVisibility|renderDisruptions/);
});

test('[STORY-38E] physical debug export is explicit and omits user location data', () => {
  const app=readFileSync(new URL('../src/app/app.js',import.meta.url),'utf8');
  assert.match(app,/initialParams\.get\('policeBoundaryDebug'\) === '1'/);
  assert.match(boundarySrc,/userLocationIncluded: false/);
  assert.match(boundarySrc,/navigator\.clipboard\.writeText/);
  assert.match(boundarySrc,/sirento-boundary-debug-/);
  assert.doesNotMatch(boundarySrc.slice(boundarySrc.indexOf('function boundaryDiagnosticExport('),boundarySrc.indexOf('function installBoundaryDebugExport')),/liveLocation|state\.nearby|savedLocations/);
});
test('[STORY-75] the police boundary legend and map outline carry a badge glyph', () => {
  assert.match(boundarySrc, /police-key-wrap/);
  assert.match(boundarySrc, /sign\.className = 'police-sign'/);
  assert.match(boundarySrc, /sign\.textContent = '🚔'/);
  assert.match(boundarySrc, /input\.setAttribute\('aria-label', 'Police Divisions'\)/);
  assert.match(boundarySrc, /input\.after\(keyWrap\)/);
  assert.doesNotMatch(boundarySrc, /label\.setAttribute\('aria-label'/);
  const css = readFileSync(new URL('../assets/css/styles.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /\.police-sign::before/);
  assert.match(boundarySrc, /className: 'police-boundary-symbol'/);
  assert.match(boundarySrc, /policeBoundarySymbolPositions\(boundaryGeojson, map\)/);
  assert.match(boundarySrc, /renderBoundaryGlyphs\(reason\)/);
  assert.match(boundarySrc, /renderBoundaryGlyphs\(eventName\)/);
});
