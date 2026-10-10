import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPoliceBoundaryLifecycleScheduler } from '../src/police-boundary-lifecycle.js';

function controlledScheduler() {
  const frames=[];
  const timers=[];
  const canceledFrames=[];
  const canceledTimers=[];
  const scheduler=createPoliceBoundaryLifecycleScheduler({
    requestFrame:callback=>{frames.push(callback);return frames.length;},
    cancelFrame:id=>canceledFrames.push(id),
    setTimer:callback=>{timers.push(callback);return timers.length;},
    clearTimer:id=>canceledTimers.push(id)
  });
  return {scheduler,frames,timers,canceledFrames,canceledTimers};
}

test('sheet transition work waits for settle and two paints', () => {
  const {scheduler,frames,timers}=controlledScheduler();
  let runs=0;
  scheduler.afterLayoutTransition(()=>{runs+=1;});
  assert.equal(scheduler.pending(),true);
  assert.equal(frames.length,0);
  timers[0]();
  assert.equal(runs,0);
  frames[0]();
  assert.equal(runs,0);
  frames[1]();
  assert.equal(runs,1);
  assert.equal(scheduler.pending(),false);
});

test('a rapid transition cancels stale redraw work', () => {
  const {scheduler,frames,timers,canceledTimers}=controlledScheduler();
  const runs=[];
  const record=state=>runs.push(state);
  scheduler.afterLayoutTransition(record.bind(null,'half'));
  scheduler.afterLayoutTransition(record.bind(null,'collapsed'));
  assert.deepEqual(canceledTimers,[1]);
  timers[0]();
  assert.equal(frames.length,1);
  frames[0]();
  frames[1]();
  assert.deepEqual(runs,[]);
  timers[1]();
  frames[2]();
  frames[3]();
  assert.deepEqual(runs,['collapsed']);
});

test('a new after-paint redraw cancels the stale animation frame', () => {
  const {scheduler,frames,canceledFrames}=controlledScheduler();
  const runs=[];
  const record=state=>runs.push(state);
  const firstGeneration=scheduler.afterPaint(record.bind(null,'first'));
  const secondGeneration=scheduler.afterPaint(record.bind(null,'second'));
  assert.equal(secondGeneration,firstGeneration + 1);
  assert.equal(scheduler.generation(),secondGeneration);
  assert.deepEqual(canceledFrames,[1]);
  assert.equal(scheduler.pending(),true);
  frames[1]();
  frames[2]();
  assert.deepEqual(runs,['second']);
  assert.equal(scheduler.pending(),false);
});

test('Story 38G suppresses police redraw until final invalidation without rebuilding roads', () => {
  const app=readFileSync(new URL('../src/app/app.js',import.meta.url),'utf8');
  const sheet=app.slice(app.indexOf('function setMobileSheetState('),app.indexOf('\nmobileSheetToggle?.addEventListener'));
  assert.match(sheet,/afterLayoutTransition/);
  assert.match(sheet,/layout-settled[\s\S]*?invalidateSize[\s\S]*?invalidate-size-complete[\s\S]*?queuePoliceBoundaryWork/);
  assert.doesNotMatch(sheet,/recreate/);
  assert.match(app,/pane: 'policeBoundaryPane'/);
  assert.doesNotMatch(sheet,/setRoadOverlayVisibility|renderDisruptions/);
});

test('physical debug export is explicit and omits user location data', () => {
  const app=readFileSync(new URL('../src/app/app.js',import.meta.url),'utf8');
  assert.match(app,/initialParams\.get\('policeBoundaryDebug'\) === '1'/);
  assert.match(app,/userLocationIncluded: false/);
  assert.match(app,/navigator\.clipboard\.writeText/);
  assert.match(app,/sirento-boundary-debug-/);
  assert.doesNotMatch(app.slice(app.indexOf('function boundaryDiagnosticExport('),app.indexOf('\nfunction installBoundaryDebugExport')),/liveLocation|state\.nearby|savedLocations/);
});
