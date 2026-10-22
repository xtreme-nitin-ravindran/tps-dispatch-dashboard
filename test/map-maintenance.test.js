import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapMaintenance } from '../src/map-maintenance.js';

// [STORY-40][STORY-44] Behavioral coverage of the extracted maintenance block:
// the measured mobile chrome (sheet overlap, layer-row offsets, focus-mode
// boundaries) and the coalesced maintenance/invalidation scheduling, with
// injectable elements, frames, and timers.

function fakeElement({ top = 0, bottom = 0, left = 0, right = 0, width = 0, height = 0 } = {}) {
  const style = new Map();
  return {
    rect: { top, bottom, left, right, width, height },
    style: {
      setProperty(name, value) { style.set(name, value); },
      getPropertyValue(name) { return style.get(name) || ''; }
    },
    getBoundingClientRect() { return this.rect; },
    getClientRects() { return [{ width: 1 }]; },
    closest() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    reads: () => Object.fromEntries(style)
  };
}

function fakeDocument(rootElement) {
  const elements = new Map();
  return {
    documentElement: rootElement,
    querySelector(selector) { return elements.get(selector) || null; },
    register(selector, element) { elements.set(selector, element); }
  };
}

function fakeAudit() {
  const marks = [];
  const begins = [];
  let finishes = 0;
  return {
    marks,
    begins,
    finishes: () => finishes,
    mark(name, detail) { marks.push({ name, detail }); },
    begin(name) { begins.push(name); return () => { finishes++; }; }
  };
}

function frameQueue() {
  const frames = [];
  const canceled = [];
  return {
    request(callback) { frames.push(callback); return frames.length; },
    cancel(id) { canceled.push(id); },
    flush() { while (frames.length) frames.shift()(); },
    size: () => frames.length,
    canceled: () => canceled
  };
}

function schedulerFake({ pending = false } = {}) {
  const jobs = [];
  let generation = 0;
  return {
    jobs,
    pending() { return pending; },
    afterPaint(callback) { generation += 1; jobs.push({ callback, generation }); return generation; }
  };
}

function harness(overrides = {}) {
  const mapElement = fakeElement({ bottom: 460, height: 460 });
  const bottomSheet = fakeElement({ top: 400, bottom: 460, height: 60 });
  const documentRef = fakeDocument(fakeElement());
  const audit = fakeAudit();
  const frames = frameQueue();
  const diagnostics = [];
  const boundaryWork = [];
  const selected = [];
  const persisted = [];
  const maintenance = createMapMaintenance({
    mapElement,
    bottomSheet,
    documentRef,
    windowRef: { innerWidth: 390, innerHeight: 844 },
    requestFrame: frames.request,
    cancelFrame: frames.cancel,
    audit,
    captureBoundaryDiagnostic: entry => diagnostics.push(entry),
    queuePoliceBoundaryWork: entry => boundaryWork.push(entry),
    selectFocusedCall: () => selected.push(true),
    persistPreferences: () => persisted.push(true),
    ...overrides
  });
  return { maintenance, mapElement, bottomSheet, documentRef, audit, frames, diagnostics, boundaryWork, selected, persisted };
}

test('[STORY-40] sheet overlap writes the map variable and the actual sheet height', () => {
  const { maintenance, mapElement, documentRef } = harness();
  maintenance.syncMapSheetOverlap();
  assert.match(mapElement.reads()['--mobile-map-sheet-overlap'], /px$/);
  assert.equal(documentRef.documentElement.reads()['--mobile-sheet-height-actual'], '60px');
});

test('[STORY-40] sheet overlap skips a missing map or sheet and a zero-height sheet', () => {
  const { maintenance, documentRef } = harness({ mapElement: null });
  maintenance.syncMapSheetOverlap();
  assert.equal(documentRef.documentElement.reads()['--mobile-sheet-height-actual'], undefined);
  const zero = harness({ bottomSheet: fakeElement({ top: 400, bottom: 400, height: 0 }) });
  zero.maintenance.syncMapSheetOverlap();
  assert.equal(zero.documentRef.documentElement.reads()['--mobile-sheet-height-actual'], undefined);
});

test('[STORY-44] focus chrome metrics measure only while focus mode is active on mobile', () => {
  const { maintenance, documentRef, mapElement, frames } = harness({ isMobileLayout: () => true, isFocusMode: () => false });
  const layerRow = fakeElement({ bottom: 44, height: 44 });
  const wrap = { getBoundingClientRect: () => ({ top: 0 }), querySelector: s => s === '.map-layer-toggle' ? layerRow : null, querySelectorAll: () => [layerRow] };
  mapElement.closest = () => wrap;
  maintenance.scheduleMaintenance();
  frames.flush();
  assert.equal(documentRef.documentElement.reads()['--mobile-focus-height'], undefined);
});

test('[STORY-44] focus chrome metrics write each boundary only when present and non-zero', () => {
  const focusToggle = fakeElement({ height: 48 });
  const focusFilterSummary = fakeElement({ bottom: 640, height: 40 });
  const documentRef = fakeDocument(fakeElement());
  documentRef.register('.radius-controls', fakeElement({ bottom: 600, height: 44 }));
  const mapElement = fakeElement({ bottom: 460, height: 460 });
  const layerRow = fakeElement({ bottom: 44, height: 44 });
  mapElement.closest = () => ({
    getBoundingClientRect: () => ({ top: 0 }),
    querySelector(selector) {
      if (selector === '.map-layer-toggle') return layerRow;
      const rects = {
        '.leaflet-control-zoom': { left: 340, width: 34, height: 0 },
        '.leaflet-control-attribution': { top: 800, height: 20, width: 0 }
      };
      return fakeElement(rects[selector]);
    },
    querySelectorAll: () => [layerRow]
  });
  const { maintenance, frames } = harness({
    mapElement, focusToggle, focusFilterSummary, documentRef,
    isMobileLayout: () => true, isFocusMode: () => true
  });
  maintenance.scheduleMaintenance();
  frames.flush();
  const root = documentRef.documentElement.reads();
  assert.equal(root['--mobile-focus-height'], '48px');
  assert.equal(root['--mobile-nav-bottom'], '600px');
  assert.equal(root['--mobile-summary-bottom'], '640px');
  assert.equal(root['--mobile-zoom-clearance'], '50px');
  assert.equal(root['--mobile-attribution-clearance'], '44px');
});

test('[STORY-44] setRootMetric writes only when the value changes', () => {
  const focusToggle = fakeElement({ height: 48 });
  const documentRef = fakeDocument(fakeElement());
  const focusWrites = [];
  const original = documentRef.documentElement.style.setProperty;
  documentRef.documentElement.style.setProperty = (name, value) => {
    if (name === '--mobile-focus-height') focusWrites.push(value);
    original.call(documentRef.documentElement.style, name, value);
  };
  const mapElement = fakeElement({ bottom: 460, height: 460 });
  const layerRow = fakeElement({ bottom: 44, height: 44 });
  const wrap = { getBoundingClientRect: () => ({ top: 0 }), querySelector: s => s === '.map-layer-toggle' ? layerRow : null, querySelectorAll: () => [layerRow] };
  mapElement.closest = () => wrap;
  const { maintenance, frames } = harness({
    mapElement, focusToggle, documentRef, isMobileLayout: () => true, isFocusMode: () => true
  });
  maintenance.scheduleMaintenance();
  frames.flush();
  maintenance.scheduleMaintenance();
  frames.flush();
  assert.deepEqual(focusWrites, ['48px']);
});

test('[STORY-41] layer row offsets anchor to measured edges and the visible stack', () => {
  const policeControl = fakeElement({ top: 100, bottom: 150, height: 50 });
  const layerRow = fakeElement({ bottom: 200, height: 44 });
  const hiddenToggle = fakeElement({ bottom: 0, height: 0 });
  hiddenToggle.getClientRects = () => [];
  const wrap = {
    getBoundingClientRect: () => ({ top: 80 }),
    querySelector: selector => selector === '.map-layer-toggle' ? layerRow : selector === '.leaflet-top.leaflet-right .leaflet-control-layers' ? policeControl : null,
    querySelectorAll: () => [layerRow, hiddenToggle]
  };
  const mapElement = fakeElement({ bottom: 460, height: 460 });
  mapElement.closest = () => wrap;
  const { maintenance, documentRef, frames } = harness({ mapElement });
  maintenance.scheduleMaintenance();
  frames.flush();
  const root = documentRef.documentElement.reads();
  assert.equal(root['--police-control-bottom'], '70px');
  assert.equal(root['--road-control-bottom'], '120px');
  assert.equal(root['--mobile-layer-row-bottom'], '120px');
  assert.equal(root['--mobile-layer-stack-center'], '70px');
});

test('[STORY-41] layer row offsets fall back without a police control and skip a missing wrap', () => {
  const layerRow = fakeElement({ bottom: 200, height: 44 });
  const hiddenToggle = fakeElement({ bottom: 0, height: 0 });
  hiddenToggle.getClientRects = () => [];
  const wrap = {
    getBoundingClientRect: () => ({ top: 80 }),
    querySelector: selector => selector === '.map-layer-toggle' ? layerRow : null,
    querySelectorAll: () => [hiddenToggle]
  };
  const mapElement = fakeElement({ bottom: 460, height: 460 });
  mapElement.closest = () => wrap;
  const { maintenance, documentRef, frames } = harness({ mapElement });
  maintenance.scheduleMaintenance();
  frames.flush();
  const root = documentRef.documentElement.reads();
  assert.equal(root['--police-control-bottom'], undefined);
  assert.equal(root['--mobile-layer-stack-center'], undefined);
  assert.equal(root['--road-control-bottom'], '120px');
  const detached = harness({ mapElement: fakeElement({ bottom: 460, height: 460 }) });
  detached.maintenance.scheduleMaintenance();
  detached.frames.flush();
  assert.equal(detached.documentRef.documentElement.reads()['--road-control-bottom'], undefined);
});

test('[STORY-40F] attribution stays bottomright only when the corner differs', () => {
  let positioned = 0;
  const attributionControl = { getPosition: () => 'bottomright', setPosition: () => { positioned++; } };
  const { maintenance } = harness({ getMap: () => ({ attributionControl }) });
  maintenance.syncMapAttributionPosition();
  assert.equal(positioned, 0);
  const off = harness({ getMap: () => ({ attributionControl: { getPosition: () => 'topleft', setPosition: () => { positioned++; } } }) });
  off.maintenance.syncMapAttributionPosition();
  assert.equal(positioned, 1);
  const missing = harness({ getMap: () => ({}) });
  missing.maintenance.syncMapAttributionPosition();
  assert.equal(positioned, 1);
});

test('[STORY-37B] maintenance coalesces frames and invalidates only when requested', () => {
  const map = { invalidateSize: () => {}, invalidations: 0 };
  map.invalidateSize = () => { map.invalidations++; };
  const scheduler = schedulerFake();
  const h = harness({ scheduler, getMap: () => map, isMobileLayout: () => false });
  h.maintenance.scheduleMaintenance();
  assert.equal(h.frames.size(), 1);
  h.frames.flush();
  assert.equal(map.invalidations, 0);
  assert.deepEqual(h.diagnostics, []);
  h.maintenance.scheduleMaintenance({ invalidateSize: true });
  h.frames.flush();
  assert.equal(map.invalidations, 1);
  assert.deepEqual(h.diagnostics, ['invalidate-size:before', 'invalidate-size:after']);
  assert.deepEqual(h.boundaryWork, ['map-size-invalidated']);
  // A second call while the frame is pending coalesces instead of stacking.
  h.maintenance.scheduleMaintenance({ invalidateSize: true });
  h.maintenance.scheduleMaintenance({ invalidateSize: true });
  assert.equal(h.frames.size(), 1);
});

test('[STORY-37B] maintenance defers when the scheduler is pending or the mobile view is not the map', () => {
  const busy = harness({ scheduler: schedulerFake({ pending: true }) });
  busy.maintenance.scheduleMaintenance();
  assert.equal(busy.frames.size(), 0);
  const calls = harness({ scheduler: schedulerFake(), isMobileLayout: () => true, getMobileView: () => 'calls' });
  calls.maintenance.scheduleMaintenance();
  assert.equal(calls.frames.size(), 0);
  const noScheduler = harness({ scheduler: undefined });
  noScheduler.maintenance.scheduleMaintenance();
  assert.equal(noScheduler.frames.size(), 1);
});

test('[STORY-37B] view maintenance is stale-safe and drives invalidation, selection, and persistence', () => {
  const map = { invalidations: 0, invalidateSize() { this.invalidations++; } };
  const scheduler = schedulerFake();
  const h = harness({
    scheduler, getMap: () => map,
    viewStillCurrent: () => true,
    getFocusedCallId: () => 'call-1'
  });
  h.maintenance.scheduleViewMaintenance({ view: 'map', mobile: true, focusSelection: true, persist: true });
  assert.equal(scheduler.jobs.length, 1);
  scheduler.jobs[0].callback(1);
  assert.equal(map.invalidations, 1);
  assert.deepEqual(h.boundaryWork, ['map-revealed-after-invalidation']);
  assert.deepEqual(h.selected, [true]);
  assert.deepEqual(h.persisted, [true]);
  assert.deepEqual(h.audit.begins, ['view-toggle:deferred-maintenance', 'view-toggle:leaflet-invalidate-size', 'view-toggle:selected-incident-sync', 'view-toggle:preference-persistence']);
  assert.ok(h.audit.marks.some(mark => mark.name === 'view-toggle:maintenance-scheduled'));
  assert.ok(h.audit.marks.some(mark => mark.name === 'view-toggle:maintenance-complete'));
});

test('[STORY-37B] omitted optional dependencies keep the module usable through their no-op defaults', () => {
  const map = { invalidations: 0, invalidateSize() { this.invalidations++; } };
  const scheduler = schedulerFake();
  const mapElement = fakeElement({ bottom: 460, height: 460 });
  const documentRef = fakeDocument(fakeElement());
  const audit = fakeAudit();
  const frames = frameQueue();
  const maintenance = createMapMaintenance({
    mapElement,
    documentRef,
    windowRef: { innerWidth: 390, innerHeight: 844 },
    requestFrame: frames.request,
    cancelFrame: frames.cancel,
    audit,
    scheduler,
    getMap: () => map,
    viewStillCurrent: () => true,
    getFocusedCallId: () => 'call-1'
  });
  // The default getMap path: attribution sync without a map object.
  createMapMaintenance({}).syncMapAttributionPosition();
  maintenance.scheduleMaintenance({ invalidateSize: true });
  frames.flush();
  assert.equal(map.invalidations, 1);
  maintenance.scheduleViewMaintenance({ view: 'map', mobile: true, focusSelection: true, persist: true });
  scheduler.jobs[0].callback(1);
  assert.ok(audit.marks.some(mark => mark.name === 'view-toggle:maintenance-complete'));
  // The default viewStillCurrent guard rejects every transition, so deferred
  // maintenance is inert until the app supplies a current-view predicate.
  const noGuardScheduler = schedulerFake();
  const noGuardAudit = fakeAudit();
  const unguarded = createMapMaintenance({ scheduler: noGuardScheduler, audit: noGuardAudit, requestFrame: frames.request, cancelFrame: frames.cancel });
  unguarded.scheduleViewMaintenance({ view: 'map', mobile: true, focusSelection: false, persist: false });
  noGuardScheduler.jobs[0].callback(1);
  assert.ok(!noGuardAudit.marks.some(mark => mark.name === 'view-toggle:maintenance-complete'));
  // The default focused-call getter returns null, so a focus selection without
  // an injected getter never re-selects a call.
  const noIdScheduler = schedulerFake();
  const noIdAudit = fakeAudit();
  const noId = createMapMaintenance({ scheduler: noIdScheduler, audit: noIdAudit, requestFrame: frames.request, cancelFrame: frames.cancel, viewStillCurrent: () => true });
  noId.scheduleViewMaintenance({ view: 'map', mobile: true, focusSelection: true, persist: false });
  noIdScheduler.jobs[0].callback(1);
  assert.ok(!noIdAudit.begins.includes('view-toggle:selected-incident-sync'));
});

test('[STORY-37B] view maintenance drops stale work and cancels a pending maintenance frame', () => {
  const scheduler = schedulerFake();
  const h = harness({ scheduler, viewStillCurrent: () => false });
  h.maintenance.scheduleViewMaintenance({ view: 'map', mobile: true, focusSelection: false, persist: false });
  scheduler.jobs[0].callback(1);
  assert.deepEqual(h.boundaryWork, []);
  assert.deepEqual(h.persisted, []);
  const withFrame = harness({ scheduler, viewStillCurrent: () => true });
  withFrame.maintenance.scheduleMaintenance();
  assert.equal(withFrame.frames.size(), 1);
  withFrame.maintenance.scheduleViewMaintenance({ view: 'map', mobile: false, focusSelection: false, persist: false });
  assert.equal(withFrame.frames.canceled().length, 1);
});
