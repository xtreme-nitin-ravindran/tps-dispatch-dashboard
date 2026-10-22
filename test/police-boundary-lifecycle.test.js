import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('[STORY-38G] suppresses police redraw until final invalidation without rebuilding roads', () => {
  const app=readFileSync(new URL('../src/app/app.js',import.meta.url),'utf8');
  const sheet=app.slice(app.indexOf('function setMobileSheetState('),app.indexOf('\nmobileSheetToggle?.addEventListener'));
  assert.match(sheet,/afterLayoutTransition/);
  assert.match(sheet,/layout-settled[\s\S]*?invalidateSize[\s\S]*?invalidate-size-complete[\s\S]*?queuePoliceBoundaryWork/);
  assert.doesNotMatch(sheet,/recreate/);
  assert.match(app,/pane: 'policeBoundaryPane'/);
  assert.doesNotMatch(sheet,/setRoadOverlayVisibility|renderDisruptions/);
});

test('[STORY-38E] physical debug export is explicit and omits user location data', () => {
  const app=readFileSync(new URL('../src/app/app.js',import.meta.url),'utf8');
  assert.match(app,/initialParams\.get\('policeBoundaryDebug'\) === '1'/);
  assert.match(app,/userLocationIncluded: false/);
  assert.match(app,/navigator\.clipboard\.writeText/);
  assert.match(app,/sirento-boundary-debug-/);
  assert.doesNotMatch(app.slice(app.indexOf('function boundaryDiagnosticExport('),app.indexOf('\nfunction installBoundaryDebugExport')),/liveLocation|state\.nearby|savedLocations/);
});
