import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const previousGlobals = {
  location: globalThis.location,
  document: globalThis.document,
  PerformanceObserver: globalThis.PerformanceObserver,
  setInterval: globalThis.setInterval
};
const browserReportNodes = [];
let browserReportInterval;
globalThis.location = {search:'?uxAudit=1'};
globalThis.document = {
  createElement: () => ({}),
  head: {append: node => browserReportNodes.push(node)}
};
globalThis.PerformanceObserver = null;
globalThis.setInterval = (callback, milliseconds) => {
  browserReportInterval = milliseconds;
  callback();
  return 1;
};
const {
  createUxAudit,
  runSynchronousAuditWork,
  uxAudit,
  uxAuditEnabled,
  uxReliabilityFixtureOptions,
  waitForAuditDelay
} = await import('../src/ux-reliability-audit.js');
globalThis.location = previousGlobals.location;
globalThis.document = previousGlobals.document;
globalThis.PerformanceObserver = previousGlobals.PerformanceObserver;
globalThis.setInterval = previousGlobals.setInterval;

const [app, html] = await Promise.all([
  readFile(new URL('../src/app/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8')
]);

test('audit recording requires an explicit switch but may inspect the production path', () => {
  assert.equal(uxAuditEnabled({ search: '?uxAudit=1' }), true);
  assert.equal(uxAuditEnabled({ search: '?uxAudit=0' }), false);
  assert.equal(uxAuditEnabled({ search: '' }), false);
  assert.equal(uxAuditEnabled(), false);
});

test('reliability delays are explicit, fixed, and loopback-only', () => {
  assert.equal(uxReliabilityFixtureOptions({ hostname: 'sirento.ca', search: '?mobileAuditUx=reliability&mobileAuditDelay=incident' }), null);
  assert.equal(uxReliabilityFixtureOptions({ hostname: 'localhost', search: '?mobileAuditDelay=incident' }), null);
  assert.equal(uxReliabilityFixtureOptions({hostname:'localhost'}), null);
  const options = uxReliabilityFixtureOptions({
    hostname: '127.0.0.1',
    search: '?mobileAuditUx=reliability&mobileAuditDelay=incident,secondary,map,lazy,unknown'
  });
  assert.deepEqual([...options.delays], ['incident', 'secondary', 'map', 'lazy']);
  assert.deepEqual({
    incident: options.incidentDelayMs,
    secondary: options.secondaryDelayMs,
    map: options.mapDelayMs,
    lazy: options.lazyWorkMs
  }, { incident: 1500, secondary: 1200, map: 1000, lazy: 180 });
  assert.deepEqual(uxReliabilityFixtureOptions({hostname:'::1',search:'?mobileAuditUx=reliability'}), {
    delays:new Set(),incidentDelayMs:0,secondaryDelayMs:0,mapDelayMs:0,lazyWorkMs:0
  });
  assert.equal(uxReliabilityFixtureOptions(), null);
});

test('structured audit captures marks, durations, occurrences, counters, and browser marks', async () => {
  let clock = 10;
  const browserMarks = [{ name: 'sirento:html-parsed', startTime: 4 }, { name: 'other', startTime: 1 }];
  const performanceLike = {
    now: () => clock,
    mark() {},
    measure() {},
    getEntriesByType: type => type === 'mark' ? browserMarks : []
  };
  const target = {};
  const audit = createUxAudit({ enabled: true, performanceLike, observerClass: null, target });
  const end = audit.begin('render', { calls: 12 });
  clock = 34;
  end({ cards: 12 });
  assert.equal(end(), null);
  const endAgain = audit.begin('render');
  clock = 36;
  endAgain();
  clock = 40;
  await audit.around('async-step', async () => { clock = 55; });
  audit.increment('passes');
  audit.increment('passes');
  assert.equal(audit.increment('weighted', 3), 3);
  audit.record('manual-record', { useful: true });
  const snapshot = audit.snapshot();
  assert.equal(target.__sirentoUxAudit, audit);
  assert.equal(snapshot.measures[0].duration, 24);
  assert.deepEqual(snapshot.measures[0].detail, { calls: 12, cards: 12 });
  assert.equal(snapshot.measures[1].occurrence, 2);
  assert.equal(snapshot.measures[2].duration, 15);
  assert.equal(snapshot.counters.passes, 2);
  assert.equal(snapshot.marks.at(-1).name, 'manual-record');
  assert.deepEqual(snapshot.browserMarks, [{ name: 'sirento:html-parsed', startTime: 4 }]);
});

test('disabled audit and zero delays have no observable work', async () => {
  const target = {};
  const audit = createUxAudit({ enabled: false, performanceLike: null, observerClass: null, target });
  const end = audit.begin('ignored');
  end();
  audit.mark('ignored');
  assert.equal(audit.increment('ignored'), 0);
  assert.equal(target.__sirentoUxAudit, undefined);
  assert.deepEqual(audit.snapshot().measures, []);
  let scheduled = 0;
  const schedule = resolve => { scheduled += 1; resolve(); };
  await waitForAuditDelay(0, schedule);
  assert.equal(scheduled, 0);
  await waitForAuditDelay(1, schedule);
  assert.equal(scheduled, 1);
  await waitForAuditDelay(1);
  let clockReads = 0;
  const ticks = [0, 0, 2];
  const clock = () => { clockReads += 1; return ticks.shift(); };
  runSynchronousAuditWork(0, clock);
  assert.equal(clockReads, 0);
  runSynchronousAuditWork(1, clock);
  assert.equal(clockReads, 3);
  runSynchronousAuditWork(0.01);
});

test('long-task observation retains browser attribution and associates measured work', () => {
  let observeOptions;
  let emitEntries;
  class Observer {
    constructor(callback) { emitEntries = callback; }
    observe(options) { observeOptions = options; }
  }
  let clock = 10;
  const audit = createUxAudit({
    enabled: true,
    observerClass: Observer,
    target: null,
    performanceLike: { now: () => clock, mark() {}, measure() {}, getEntriesByType: () => [] }
  });
  const end = audit.begin('render');
  clock = 80;
  end();
  emitEntries({ getEntries: () => [
    { startTime: 20, duration: 20, name: 'short' },
    { startTime: 20, duration: 60, name: 'self', attribution: [{name:'script'}, {containerType:'window'}, {}] }
  ] });
  assert.deepEqual(observeOptions, {type:'longtask', buffered:true});
  assert.deepEqual(audit.snapshot().longTasks, [{
    startTime:20,
    duration:60,
    name:'self',
    path:'render',
    attribution:['script','window','unknown']
  }]);
});

test('unsupported long-task observers fail open', () => {
  class BrokenObserver { constructor() { throw new Error('unsupported'); } }
  const audit = createUxAudit({enabled:true,observerClass:BrokenObserver,target:null,performanceLike:null});
  audit.mark('fallback-clock');
  assert.deepEqual(audit.snapshot().longTasks, []);
});

test('audit tolerates optional browser APIs, thrown marks, and unmatched long tasks', async () => {
  let emitEntries;
  class Observer {
    constructor(callback) { emitEntries = callback; }
    observe() {}
  }
  const navigation = {toJSON: () => ({type:'reload'})};
  const performanceLike = {
    now: () => 5,
    mark() { throw new Error('mark unavailable'); },
    measure() { throw new Error('measure unavailable'); },
    getEntriesByType: type => type === 'navigation'
      ? [navigation]
      : [{name:'sirento:kept',startTime:1},{name:'ignored',startTime:2}]
  };
  const audit = createUxAudit({enabled:true,observerClass:Observer,target:undefined,performanceLike});
  const end = audit.begin('throws');
  end();
  await assert.rejects(audit.around('rejected', async () => { throw new Error('expected'); }), /expected/);
  emitEntries({getEntries:()=>[{startTime:200,duration:50,name:'self'}]});
  const snapshot = audit.snapshot();
  assert.deepEqual(snapshot.navigation, {type:'reload'});
  assert.deepEqual(snapshot.browserMarks, [{name:'sirento:kept',startTime:1}]);
  assert.deepEqual(snapshot.longTasks[0], {
    startTime:200,duration:50,name:'self',path:'browser/main-thread',attribution:[]
  });
});

test('enabled browser audit publishes a hidden JSON report', async () => {
  assert.equal(uxAudit.enabled, true);
  uxAudit.mark('report-test');
  assert.equal(browserReportNodes.length, 1);
  assert.equal(browserReportNodes[0].id, 'sirentoUxAuditReport');
  assert.equal(browserReportNodes[0].type, 'application/json');
  assert.equal(browserReportNodes[0].hidden, true);
  assert.equal(JSON.parse(browserReportNodes[0].textContent).enabled, true);
  assert.equal(browserReportInterval, 250);
});

test('production lifecycle and required interactions expose named audit boundaries', () => {
  for (const name of [
    'app-bootstrap-begins', 'incident-snapshot-fetch', 'incident-normalization',
    'filter-sort-calculation', 'first-incident-render', 'first-map-creation',
    'first-leaflet-tile-ready', 'marker-cluster-creation',
    'secondary-feed-preparation', 'road-closure-layer-initialized',
    'police-boundary-layer-initialization', 'first-usable-ui', 'first-fully-rendered-ui'
  ]) assert.match(app, new RegExp(name));
  for (const name of ['view:', 'radius:', 'filters', 'police-boundaries', 'road-closures', 'incident-selection', 'bottom-sheet']) {
    assert.match(app, new RegExp(name));
  }
  assert.match(html, /sirento:html-parsed/);
  assert.match(html, /sirento:service-worker-registration-begins/);
  assert.match(html, /sirento:cached-shell-assets-ready/);
});

test('Map and Calls instrumentation separates ownership, presentation, maintenance, persistence, and paint', () => {
  const setter = app.slice(app.indexOf('function setMobileView('), app.indexOf('\nmobileViewToggles.forEach'));
  for (const name of [
    'view-toggle:state-update', 'view-toggle:list-ownership', 'view-toggle:presentation',
    'view-toggle:visual-state-committed'
  ]) assert.match(setter, new RegExp(name));
  for (const name of [
    'view-toggle:maintenance-scheduled', 'view-toggle:first-frame-after-switch',
    'view-toggle:deferred-maintenance', 'view-toggle:leaflet-invalidate-size',
    'view-toggle:preference-persistence', 'view-toggle:selected-incident-sync',
    'view-toggle:maintenance-complete'
  ]) assert.match(app, new RegExp(name));
  assert.match(app, /visual-response:\$\{name\}/);
});
