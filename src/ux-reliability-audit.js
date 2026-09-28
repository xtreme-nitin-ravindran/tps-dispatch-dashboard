const AUDIT_PARAM = 'uxAudit';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const DELAY_NAMES = new Set(['incident', 'secondary', 'map', 'lazy']);

export function uxAuditEnabled(locationLike = globalThis.location) {
  return new URLSearchParams(locationLike?.search || '').get(AUDIT_PARAM) === '1';
}

export function uxReliabilityFixtureOptions(locationLike = globalThis.location) {
  if (!LOOPBACK_HOSTS.has(locationLike?.hostname)) return null;
  const params = new URLSearchParams(locationLike?.search || '');
  if (params.get('mobileAuditUx') !== 'reliability') return null;
  const delays = new Set((params.get('mobileAuditDelay') || '').split(',').filter(name => DELAY_NAMES.has(name)));
  return {
    delays,
    incidentDelayMs: delays.has('incident') ? 1500 : 0,
    secondaryDelayMs: delays.has('secondary') ? 1200 : 0,
    mapDelayMs: delays.has('map') ? 1000 : 0,
    lazyWorkMs: delays.has('lazy') ? 180 : 0
  };
}

export function waitForAuditDelay(milliseconds, scheduler = globalThis.setTimeout) {
  return milliseconds > 0
    ? new Promise(resolve => scheduler(resolve, milliseconds))
    : Promise.resolve();
}

export function createUxAudit({
  enabled = false,
  performanceLike = globalThis.performance,
  observerClass = globalThis.PerformanceObserver,
  target = globalThis
} = {}) {
  const started = new Map();
  const marks = [];
  const measures = [];
  const longTasks = [];
  const counters = new Map();
  const now = () => Number(performanceLike?.now?.() || 0);

  function mark(name, detail = {}) {
    if (!enabled) return null;
    const entry = { name, startTime: now(), detail };
    marks.push(entry);
    try { performanceLike?.mark?.(`sirento:${name}`); } catch { /* Own records remain available. */ }
    return entry;
  }

  function begin(name, detail = {}) {
    if (!enabled) return () => null;
    const startTime = now();
    const occurrence = (counters.get(`measure:${name}`) || 0) + 1;
    counters.set(`measure:${name}`, occurrence);
    const key = `${name}:${occurrence}`;
    started.set(key, { startTime, detail });
    mark(`${name}:begin`, { ...detail, occurrence });
    return (endDetail = {}) => {
      const start = started.get(key);
      if (!start) return null;
      started.delete(key);
      const entry = {
        name,
        occurrence,
        startTime: start.startTime,
        duration: Math.max(0, now() - start.startTime),
        detail: { ...start.detail, ...endDetail }
      };
      measures.push(entry);
      mark(`${name}:end`, { occurrence, duration: entry.duration, ...endDetail });
      try { performanceLike?.measure?.(`sirento:${name}`, `sirento:${name}:begin`, `sirento:${name}:end`); } catch { /* Optional browser timeline entry. */ }
      return entry;
    };
  }

  async function around(name, callback, detail = {}) {
    const end = begin(name, detail);
    try { return await callback(); } finally { end(); }
  }

  function increment(name, amount = 1) {
    if (!enabled) return 0;
    const value = (counters.get(name) || 0) + amount;
    counters.set(name, value);
    return value;
  }

  function record(name, detail = {}) {
    return mark(name, detail);
  }

  if (enabled && observerClass) {
    try {
      const observer = new observerClass(list => {
        for (const entry of list.getEntries()) {
          if (entry.duration < 50) continue;
          longTasks.push({
            startTime: entry.startTime,
            duration: entry.duration,
            name: entry.name,
            path: 'browser/main-thread',
            attribution: [...(entry.attribution || [])].map(item => item.name || item.containerType || 'unknown')
          });
        }
      });
      observer.observe({ type: 'longtask', buffered: true });
    } catch { /* Long Tasks API is not supported by every browser. */ }
  }

  function snapshot() {
    const measuredLongTasks = longTasks.map(entry => {
      const taskEnd = entry.startTime + entry.duration;
      const paths = measures
        .filter(measure => measure.startTime < taskEnd && measure.startTime + measure.duration > entry.startTime)
        .map(measure => measure.name);
      return { ...entry, path: paths.length ? [...new Set(paths)].join(' + ') : entry.path };
    });
    return {
      enabled,
      generatedAt: new Date().toISOString(),
      navigation: performanceLike?.getEntriesByType?.('navigation')?.[0]?.toJSON?.() || null,
      browserMarks: (performanceLike?.getEntriesByType?.('mark') || [])
        .filter(entry => entry.name.startsWith('sirento:'))
        .map(entry => ({ name: entry.name, startTime: entry.startTime })),
      marks: marks.map(entry => ({ ...entry })),
      measures: measures.map(entry => ({ ...entry })),
      longTasks: measuredLongTasks,
      counters: Object.fromEntries(counters)
    };
  }

  const api = { enabled, mark, begin, around, increment, record, snapshot };
  if (enabled && target) target.__sirentoUxAudit = api;
  return api;
}

export function runSynchronousAuditWork(milliseconds, now = () => globalThis.performance.now()) {
  if (!(milliseconds > 0)) return;
  const deadline = now() + milliseconds;
  while (now() < deadline) { /* Deterministic localhost-only main-thread work. */ }
}

export const uxAudit = createUxAudit({ enabled: uxAuditEnabled() });

if (uxAudit.enabled && globalThis.document) {
  const report = document.createElement('script');
  report.id = 'sirentoUxAuditReport';
  report.type = 'application/json';
  report.hidden = true;
  document.head.append(report);
  const publish = () => { report.textContent = JSON.stringify(uxAudit.snapshot()); };
  publish();
  globalThis.setInterval(publish, 250);
}
