import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHealthServer } from '../src/ttc/service.js';
import {
  structuredLog,
  buildEnvironment,
  composeCollector,
  composeProcessor,
  composeCleanup,
  runService,
  resolveService,
  handleResult,
  handleFatal,
  runCli,
  bootstrap,
  isDirectInvocation
} from '../scripts/ttc-service.js';

test('[STORY-64] createHealthServer serves GET /health with the snapshot body', async () => {
  let handled;
  createHealthServer({
    getHealth: async () => ({ capture: { status: 'ok' }, processing: { status: 'ok' }, publication: { status: 'ok' } }),
    createServerImpl: listener => {
      handled = listener;
      return { once() { }, listen(port, host, cb) { cb(); }, close(cb) { cb(); } };
    }
  });
  const response = {
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = body; }
  };
  await handled({ method: 'GET', url: '/health' }, response);
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), { capture: { status: 'ok' }, processing: { status: 'ok' }, publication: { status: 'ok' } });
});

test('[STORY-64] createHealthServer rejects non-health requests with a 404', async () => {
  let handled;
  createHealthServer({
    getHealth: async () => ({}),
    createServerImpl: listener => { handled = listener; return { once() { }, listen(port, host, cb) { cb(); }, close(cb) { cb(); } }; }
  });
  const response = { writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = body; } };
  await handled({ method: 'POST', url: '/health' }, response);
  assert.equal(response.status, 404);
  await handled({ method: 'GET', url: '/metrics' }, response);
  assert.equal(response.status, 404);
});

test('[STORY-64] createHealthServer requires a getHealth function', () => {
  assert.throws(() => createHealthServer({}), /getHealth/);
});

test('[STORY-64] createHealthServer listen and close bind and release the port', async () => {
  let listened = false;
  let closed = false;
  const health = createHealthServer({
    getHealth: async () => ({}),
    host: '127.0.0.1',
    port: 9999,
    createServerImpl: () => ({
      once() { },
      listen(port, host, cb) { listened = true; cb(); },
      close(cb) { closed = true; cb(); }
    })
  });
  const bound = await health.listen();
  assert.deepEqual(bound, { host: '127.0.0.1', port: 9999 });
  assert.equal(listened, true);
  await health.close();
  assert.equal(closed, true);
});

test('[STORY-64] resolveService selects the processor owners and run for the processor role', () => {
  const envCtx = { feedId: 'ttc-vehicles', staticCache: '/tmp/z', checkpointPath: '/tmp/cp', sink: { getBytes() { } }, publishSink: { publish() { return { changed: false }; } } };
  const store = { };
  const { ownerId, run, cleanup } = resolveService({ role: 'processor', envCtx, store, signal: undefined });
  assert.equal(ownerId, 'ttc-processor-1');
  assert.equal(typeof run, 'function');
  assert.equal(typeof cleanup, 'function');
});

test('[STORY-64] resolveService selects the collector run and owner for the collector role', () => {
  const envCtx = { feedId: 'ttc-vehicles', intervalMs: 30000, spoolLimit: 720, sink: { getBytes() { }, publish() { return { changed: false }; } } };
  const store = { };
  const { ownerId, run } = resolveService({ role: 'collector', envCtx, store, signal: undefined });
  assert.equal(ownerId, 'ttc-collector-1');
  assert.equal(typeof run, 'function');
});

test('[STORY-64] handleResult sets a non-zero exit code on a denied lease', async () => {
  let code;
  await handleResult({ acquired: false }, { setExitCode: c => { code = c; } });
  assert.equal(code, 1);
});

test('[STORY-64] handleResult returns the result unchanged on an acquired lease', async () => {
  const result = { acquired: true, role: 'collector' };
  const returned = await handleResult(result, { setExitCode: () => {} });
  assert.equal(returned, result);
});

test('[STORY-64] handleFatal logs the error and sets a non-zero exit code', () => {
  let logged = '';
  let code;
  handleFatal(new Error('boom'), { log: line => { logged = line; }, setExitCode: c => { code = c; } });
  assert.equal(JSON.parse(logged).status, 'fatal');
  assert.equal(JSON.parse(logged).error, 'boom');
  assert.equal(code, 1);
});

test('[STORY-64] runCli selects the collector role by default and runs the service', async () => {
  let roleSeen;
  const env = {
    R2_ENDPOINT: 'https://e', R2_BUCKET: 'b', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's'
  };
  const envCtx = {
    feedId: 'ttc-vehicles', ownershipPrefix: 'ttc-ownership', ttlMs: 100, intervalMs: 30000, spoolLimit: 720,
    sink: { put() { }, get() { }, list() { return []; }, delete() { }, getBytes() { }, publish() { return { changed: false }; } },
    spool: { write() { }, read() { }, list() { return []; }, remove() { }, depth() { return 0; } }
  };
  const result = await runCli({
    argv: [], env, envCtx, signal: undefined,
    runServiceImpl: async ({ role }) => { roleSeen = role; return { acquired: true, role }; },
    handleResultImpl: async () => {}
  });
  assert.equal(roleSeen, 'collector');
  assert.equal(result.role, 'collector');
});

test('[STORY-64] runCli selects the processor role from argv and installs signal handlers', async () => {
  let sigterm = 0;
  let sigint = 0;
  let roleSeen;
  const envCtx = {
    feedId: 'ttc-vehicles', ownershipPrefix: 'ttc-ownership', ttlMs: 100, staticCache: '/tmp/z', checkpointPath: '/tmp/cp',
    sink: { put() { }, get() { }, list() { return []; }, delete() { }, getBytes() { } },
    publishSink: { publish() { return { changed: false }; } },
    spool: { write() { }, read() { }, list() { return []; }, remove() { }, depth() { return 0; } }
  };
  await runCli({
    argv: ['processor'], env: {}, envCtx, signal: undefined,
    onSigterm: () => { sigterm++; },
    onSigint: () => { sigint++; },
    runServiceImpl: async ({ role }) => { roleSeen = role; return { acquired: true, role }; },
    handleResultImpl: async () => {}
  });
  assert.equal(roleSeen, 'processor');
  assert.equal(sigterm, 1);
  assert.equal(sigint, 1);
});

test('[STORY-64] bootstrap wires SIGTERM/SIGINT to the abort signal and runs the CLI', () => {
  const handlers = {};
  let aborted = false;
  let cliArgs;
  const controller = { signal: { aborted: false }, abort() { aborted = true; } };
  bootstrap({
    isDirect: () => true,
    abort: () => controller,
    once: (name, handler) => { handlers[name] = handler; },
    argv: ['collector'],
    env: {},
    cli: args => { cliArgs = args; return Promise.resolve({ acquired: true }); },
    onFatal: () => {}
  });
  assert.equal(cliArgs.argv[0], 'collector');
  assert.equal(handlers.SIGTERM, handlers.SIGINT);
  handlers.SIGTERM();
  assert.equal(aborted, true);
});

test('[STORY-64] bootstrap does nothing when this module is not the entry point', () => {
  let ran = false;
  bootstrap({
    isDirect: () => false,
    cli: () => { ran = true; return Promise.resolve({}); }
  });
  assert.equal(ran, false);
});

test('[STORY-64] bootstrap routes a rejected CLI to the fatal handler', async () => {
  let fatal;
  bootstrap({
    isDirect: () => true,
    abort: () => ({ signal: {}, abort() { } }),
    once: () => {},
    argv: [],
    env: {},
    cli: () => Promise.reject(new Error('boom')),
    onFatal: error => { fatal = error; }
  });
  // The rejection is handled asynchronously via the promise chain.
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(fatal.message, 'boom');
});

test('[STORY-64] isDirectInvocation is true only for the entrypoint itself', () => {
  assert.equal(isDirectInvocation({ argv1: undefined, moduleUrl: 'file:///x/ttc-service.js' }), false);
  assert.equal(isDirectInvocation({ argv1: '/other.js', moduleUrl: 'file:///x/ttc-service.js' }), false);
});

test('[STORY-64] buildEnvironment reads the R2 and prefix values from the environment', () => {
  const env = {
    R2_ENDPOINT: 'https://e', R2_BUCKET: 'b', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's',
    OWNERSHIP_PREFIX: 'dev/ttc-ownership', TTC_SPOOL_DIR: '/tmp/spool', TTC_CHECKPOINT_PATH: '/tmp/cp',
    TTC_INTERVAL_MS: '40000', TTC_SPOOL_LIMIT: '100', TTC_OWNERSHIP_TTL_MS: '90000'
  };
  const ctx = buildEnvironment({ env });
  assert.equal(ctx.feedId, 'ttc-vehicles');
  assert.equal(ctx.ownershipPrefix, 'dev/ttc-ownership');
  assert.equal(ctx.checkpointPath, '/tmp/cp');
  assert.equal(ctx.intervalMs, 40000);
  assert.equal(ctx.spoolLimit, 100);
  assert.equal(ctx.ttlMs, 90000);
  // The publication sink is a separate collaborator from the capture sink.
  assert.equal(typeof ctx.publishSink, 'function');
  assert.equal(typeof ctx.sink.put, 'function');
  assert.equal(ctx.buildVersion, 'unversioned');
  assert.equal(ctx.advisorySnapshot, '');
  assert.equal(ctx.healthPort, 8764);
  assert.equal(ctx.drainIntervalMs, 30000);
  assert.equal(typeof ctx.diagnosticSpool.write, 'function');
});

test('[STORY-64] buildEnvironment falls back to the production defaults for omitted optional values', () => {
  const env = {
    R2_ENDPOINT: 'https://e', R2_BUCKET: 'b', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's'
  };
  const ctx = buildEnvironment({ env });
  assert.equal(ctx.ownershipPrefix, 'ttc-ownership');
  assert.equal(ctx.checkpointPath, '/app/state/ttc-checkpoint.json');
  assert.equal(ctx.staticCache, '/app/state/surface.zip');
  assert.equal(ctx.intervalMs, 30000);
  assert.equal(ctx.spoolLimit, 720);
  assert.equal(ctx.ttlMs, 60000);
});

test('[STORY-64] runService reports denied when another writer holds the lease', async () => {
  const result = await runService({
    role: 'processor',
    ownerId: 'proc-a',
    envCtx: { feedId: 'ttc-vehicles', ownershipPrefix: 'ttc-ownership', ttlMs: 100, spool: { write() { }, list() { return []; }, remove() { }, depth() { return 0; }, read() { } }, sink: { put() { }, get() { }, list() { return []; }, delete() { }, getBytes() { } } },
    acquire: async () => ({ acquired: false, holder: 'other' }),
    run: async () => ({ processed: 0 }),
    healthServer: () => ({ listen: async () => {}, close: async () => {} })
  });
  assert.deepEqual(result, { acquired: false, role: 'processor' });
});

test('[STORY-64] runService releases ownership after the run even on success', async () => {
  let released = false;
  const result = await runService({
    role: 'collector',
    ownerId: 'col-a',
    envCtx: { feedId: 'ttc-vehicles', ownershipPrefix: 'ttc-ownership', ttlMs: 100, spool: { write() { }, list() { return []; }, remove() { }, depth() { return 0; }, read() { } }, sink: { put() { }, get() { }, list() { return []; }, delete() { }, getBytes() { } } },
    acquire: async () => ({ acquired: true, release: async () => { released = true; } }),
    run: async () => ({ polls: 1 }),
    healthServer: () => ({ listen: async () => {}, close: async () => {} })
  });
  assert.deepEqual(result, { acquired: true, role: 'collector', summary: { polls: 1 } });
  assert.equal(released, true);
});

test('[STORY-64] runService defaults its log and threads it to the run collaborator', async () => {
  let logInvoked = false;
  await runService({
    role: 'collector',
    ownerId: 'col-a',
    envCtx: { feedId: 'ttc-vehicles', ownershipPrefix: 'ttc-ownership', ttlMs: 100, spool: { write() { }, list() { return []; }, remove() { }, depth() { return 0; }, read() { } }, sink: { put() { }, get() { }, list() { return []; }, delete() { }, getBytes() { } } },
    acquire: async () => ({ acquired: true, release: async () => {} }),
    run: async ({ log }) => { log({ status: 'ok' }); logInvoked = true; return { polls: 1 }; },
    healthServer: () => ({ listen: async () => {}, close: async () => {} })
  });
  assert.equal(logInvoked, true);
});

test('[STORY-64] runService runs a cleanup loop concurrently under the same lease', async () => {
  let cleanupRan = false;
  const result = await runService({
    role: 'processor',
    ownerId: 'proc-a',
    envCtx: { feedId: 'ttc-vehicles', ownershipPrefix: 'ttc-ownership', ttlMs: 100, spool: { write() { }, list() { return []; }, remove() { }, depth() { return 0; }, read() { } }, sink: { put() { }, get() { }, list() { return []; }, delete() { }, getBytes() { } } },
    acquire: async () => ({ acquired: true, release: async () => {} }),
    run: async () => ({ processed: 1 }),
    cleanup: async () => { cleanupRan = true; },
    healthServer: () => ({ listen: async () => {}, close: async () => {} })
  });
  assert.deepEqual(result, { acquired: true, role: 'processor', summary: { processed: 1 } });
  assert.equal(cleanupRan, true);
});

test('[STORY-64] composeCleanup reads the checkpoint cursor and runs the retention loop', async () => {
  let captured;
  const cleanup = composeCleanup({
    envCtx: { checkpointPath: '/tmp/cp', feedId: 'ttc-vehicles' },
    signal: undefined,
    loop: async ({ getCursor, signal, feedId }) => { captured = { cursor: await getCursor(), feedId, signal }; }
  });
  await cleanup({ store: {}, spool: {} });
  assert.equal(captured.feedId, 'ttc-vehicles');
  assert.equal(captured.cursor, -1);
});

test('[STORY-64] composeCleanup surfaces a present checkpoint cursor and defaults its log', async () => {
  let cursor;
  let logInvoked = false;
  const cleanup = composeCleanup({
    envCtx: { checkpointPath: '/tmp/absent', feedId: 'ttc-vehicles' },
    signal: undefined,
    readCheckpointImpl: async () => ({ cursor: 7, staticVersion: 'v1' }),
    loop: async ({ getCursor, log }) => { cursor = await getCursor(); log({ status: 'ok' }); logInvoked = true; }
  });
  await cleanup({ store: {}, spool: {} });
  assert.equal(cursor, 7);
  assert.equal(logInvoked, true);
});

test('[STORY-64] composeCollector wires the environment collaborators into runCollector', async () => {
  let captured;
  const run = composeCollector({
    envCtx: { feedId: 'ttc-vehicles', intervalMs: 30000, spoolLimit: 720 },
    store: { commit() { }, list() { }, spoolDepth() { return 0; }, pending() { return []; }, flush() { }, remove() { } },
    fetchFeed: async () => ({ bytes: null, outcome: 'empty' }),
    run: async args => { captured = args; return { polls: 0, gaps: [], spoolDepth: 0 }; },
    signal: undefined,
    log: () => { }
  });
  const result = await run();
  assert.equal(captured.feedId, 'ttc-vehicles');
  assert.equal(result.polls, 0);
});

test('[STORY-64] composeProcessor wires replay, publish, static load and inference', async () => {
  let captured;
  const controller = new AbortController();
  const run = composeProcessor({
    envCtx: { staticCache: '/tmp/surface.zip', checkpointPath: '/tmp/cp', publishSink: { publish() { return { changed: false }; } } },
    store: { list() { return []; } },
    sink: { getBytes() { } },
    loadStatic: async () => ({ index: { version: 'v1' } }),
    infer: () => ({ state: {}, report: {} }),
    complete: () => ({ state: {}, output: { diversions: [] } }),
    run: async args => { captured = args; controller.abort(); return { processed: 0, rejected: 0, cursor: -1, windows: 0, reset: false }; },
    signal: controller.signal,
    log: () => { }
  });
  const result = await run();
  assert.equal(typeof captured.replay, 'function');
  assert.equal(typeof captured.publish, 'function');
  assert.equal(captured.checkpointPath, '/tmp/cp');
  assert.equal(result.processed, 0);
});

test('[STORY-64] composeProcessor passes a static loader that threads the cache path', async () => {
  let passedPath;
  const controller = new AbortController();
  const run = composeProcessor({
    envCtx: { staticCache: '/tmp/z.zip', checkpointPath: '/tmp/cp', publishSink: { publish() { return { changed: false }; } } },
    store: { list() { return []; } },
    sink: { getBytes() { } },
    loadStatic: async ({ cachePath }) => { passedPath = cachePath; return { index: { version: 'v1' } }; },
    infer: () => ({ state: {} }),
    complete: () => ({ state: {}, output: { diversions: [] } }),
    run: async args => { await args.loadStatic(); controller.abort(); return { processed: 0, rejected: 0, cursor: -1, windows: 0, reset: false }; },
    signal: controller.signal,
    log: () => { }
  });
  await run();
  assert.equal(passedPath, '/tmp/z.zip');
});

test('[STORY-64] composeCollector and composeProcessor default their log', async () => {
  let collectorLogInvoked = false;
  const collectorRun = composeCollector({
    envCtx: { feedId: 'ttc-vehicles', intervalMs: 30000, spoolLimit: 720 },
    store: {},
    run: async args => { args.log({}); collectorLogInvoked = true; return { polls: 0, gaps: [], spoolDepth: 0 }; },
    signal: undefined
  });
  await collectorRun();
  assert.equal(collectorLogInvoked, true);

  let processorPublishInvoked = false;
  const controller = new AbortController();
  const processorRun = composeProcessor({
    envCtx: { staticCache: '/tmp/z.zip', checkpointPath: '/tmp/cp', publishSink: { publish() { return { changed: false }; } } },
    store: {},
    sink: { getBytes() { } },
    loadStatic: () => ({ index: { version: 'v1' } }),
    infer: () => ({ state: {} }),
    complete: () => ({ state: {}, output: { diversions: [] } }),
    run: async args => {
      await args.publish({ status: 'ok', schemaVersion: 1, staticVersion: 'v1', checkedAt: new Date().toISOString(), diversions: [] });
      processorPublishInvoked = true;
      controller.abort();
      return { processed: 0, rejected: 0, cursor: -1, windows: 0, reset: false };
    },
    signal: controller.signal
  });
  await processorRun();
  assert.equal(processorPublishInvoked, true);
});

test('[STORY-64] handleResult and handleFatal default their setExitCode and log', async () => {
  const saved = process.exitCode;
  try {
    process.exitCode = 0;
    await handleResult({ acquired: false }); // default setExitCode
    assert.equal(process.exitCode, 1);
    process.exitCode = 0;
    handleFatal(new Error('boom')); // default log + setExitCode
    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = saved;
  }
});

test('[STORY-64] runCli falls back to building the environment from env when none is passed', async () => {
  let roleSeen;
  const env = {
    R2_ENDPOINT: 'https://e', R2_BUCKET: 'b', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's'
  };
  await runCli({
    argv: ['collector'], env,
    signal: undefined,
    onSigterm: () => {},
    onSigint: () => {},
    runServiceImpl: async ({ role }) => { roleSeen = role; return { acquired: true, role }; },
    handleResultImpl: async () => {}
  });
  assert.equal(roleSeen, 'collector');
});

test('[STORY-64] bootstrap defaults its abort and once hooks when not injected', () => {
  // This exercises the default `abort`/`once` arrows by running bootstrap with
  // a non-direct `isDirect` so the body short-circuits; the defaults are still
  // instantiated when the branch is reached. To reach them, `isDirect` is true
  // but `cli` is a resolving no-op and `onFatal` is injected.
  let called = false;
  bootstrap({
    isDirect: () => true,
    argv: [], env: {},
    cli: () => { called = true; return Promise.resolve({ acquired: true }); },
    onFatal: () => {}
  });
  assert.equal(called, true);
});

test('[STORY-64] runCli rejects an unknown role instead of silently becoming the collector', async () => {
  await assert.rejects(runCli({
    argv: ['watcher'], env: {}, signal: undefined,
    runServiceImpl: async () => ({ acquired: true }),
    handleResultImpl: async () => {}
  }), /Unknown service role: watcher/);
});

test('[STORY-64] composeProcessor drains continuously until the signal aborts, waiting one drain interval', async () => {
  const controller = new AbortController();
  let drains = 0;
  const waits = [];
  const run = composeProcessor({
    envCtx: { staticCache: '/tmp/surface.zip', checkpointPath: '/tmp/cp', publishSink: { publish() { return { changed: false }; } } },
    store: { list() { return []; } },
    sink: { getBytes() { } },
    loadStatic: async () => ({ index: { version: 'v1' } }),
    loadAdvisories: async () => ({ schemaVersion: 1, source: 'ttc-service-change', status: 'not-loaded', checkedAt: null, sourceUpdatedAt: null, fetchedAt: null, advisories: [] }),
    run: async () => { drains++; if (drains >= 3) controller.abort(); return { processed: drains, rejected: 0, cursor: drains - 1, windows: 0, reset: false, alerts: undefined }; },
    signal: controller.signal,
    wait: async ms => waits.push(ms),
    drainIntervalMs: 5000,
    log: () => { }
  });
  const summary = await run();
  assert.equal(drains, 3);
  assert.equal(summary.processed, 3);
  assert.deepEqual(waits, [5000, 5000]);
});

test('[STORY-64] composeProcessor loads official advisories per drain and threads alerts through the run', async () => {
  const controller = new AbortController();
  const advisory = { schemaVersion: 1, source: 'ttc-service-change', status: 'ok', checkedAt: null, sourceUpdatedAt: null, fetchedAt: null, advisories: [{ ref: 'r1', sourceId: 'a1', routeIds: ['504'] }] };
  const captured = [];
  const alertState = { schemaVersion: 1, items: [], status: 'ok', fetchedAt: new Date(0).toISOString(), checkedAt: new Date(0).toISOString() };
  const updateAlerts = async previous => { captured.push({ type: 'updateAlerts', previous }); return alertState; };
  const run = composeProcessor({
    envCtx: { staticCache: '/tmp/surface.zip', checkpointPath: '/tmp/cp', publishSink: { publish() { return { changed: false }; } }, buildVersion: 'build-9' },
    store: { list() { return []; } },
    sink: { getBytes() { } },
    loadStatic: async () => ({ index: { version: 'v1' } }),
    loadAdvisories: async () => { captured.push({ type: 'loadAdvisories' }); return advisory; },
    updateAlerts,
    run: async args => { captured.push({ advisories: args.advisories, hasOnReject: typeof args.onReject, alerts: args.alerts, updateAlerts: args.updateAlerts }); controller.abort(); return { processed: 0, rejected: 0, cursor: -1, windows: 0, reset: false, alerts: alertState }; },
    signal: controller.signal,
    log: () => { }
  });
  await run();
  assert.ok(captured.some(c => c.type === 'loadAdvisories'));
  const drained = captured.find(c => c.hasOnReject);
  assert.equal(drained.advisories, advisory);
  assert.equal(drained.alerts, undefined);
  assert.equal(drained.updateAlerts, updateAlerts);
  assert.equal(drained.hasOnReject, 'function');
});

test('[STORY-64] composeProcessor rejection seam archives the diagnostic bundle with replay inputs', async () => {
  const controller = new AbortController();
  const archived = [];
  const advisory = { schemaVersion: 1, source: 'ttc-service-change', status: 'ok', checkedAt: null, sourceUpdatedAt: null, fetchedAt: null, advisories: [{ ref: 'r1', sourceId: 'a1', routeIds: ['504'] }] };
  const run = composeProcessor({
    envCtx: { staticCache: '/tmp/surface.zip', checkpointPath: '/tmp/cp', publishSink: { publish() { return { changed: false }; } }, buildVersion: 'build-9', diagnosticSpool: { write() { } } },
    store: { list() { return []; } },
    sink: { getBytes: async () => Buffer.from('raw') },
    loadStatic: async () => ({ index: { version: 'v1' } }),
    loadAdvisories: async () => advisory,
    archiveFailure: async args => { archived.push(args); controller.abort(); },
    run: async args => {
      const error = new Error('Invalid TTC diversion output');
      error.rejectedState = { records: [] };
      await args.onReject({ error, capture: { feedId: 'ttc-vehicles', sequence: 4, payload: 'k' }, index: { version: 'v1' }, checkpoint: { cursor: 3, staticVersion: 'v1', state: {} }, now: new Date('2026-10-14T12:00:00.000Z'), logicalClock: 0 });
      return { processed: 0, rejected: 1, cursor: 3, windows: 0, reset: false, alerts: undefined };
    },
    signal: controller.signal,
    log: () => { }
  });
  await run();
  assert.equal(archived.length, 1);
  assert.equal(archived[0].buildVersion, 'build-9');
  assert.equal(archived[0].staticVersion, 'v1');
  assert.equal(archived[0].logicalClock, 0);
  assert.deepEqual(archived[0].advisoryRefs, ['a1']);
  assert.equal(archived[0].capture.sequence, 4);
  assert.equal(archived[0].checkpoint.cursor, 3);
});

test('[STORY-64] runService serves a private health endpoint fed by onHealth and closes it on exit', async () => {
  let healthFn;
  let closed = false;
  const seen = [];
  const result = await runService({
    role: 'collector',
    ownerId: 'col-a',
    envCtx: { feedId: 'ttc-vehicles', ownershipPrefix: 'ttc-ownership', ttlMs: 100, healthPort: 8764, spool: { write() { }, list() { return []; }, remove() { }, depth() { return 0; }, read() { } }, sink: { put() { }, get() { }, list() { return []; }, delete() { }, getBytes() { } } },
    acquire: async () => ({ acquired: true, release: async () => {} }),
    run: async ({ onHealth }) => { onHealth('capture', { status: 'ok', outcome: 'ok' }); return { polls: 1 }; },
    healthServer: ({ getHealth, port }) => { healthFn = getHealth; assert.equal(port, 8764); return { listen: async () => {}, close: async () => { closed = true; } }; }
  });
  assert.equal(result.acquired, true);
  assert.equal(closed, true);
  const report = healthFn();
  assert.equal(report.capture.status, 'ok');
  assert.equal(report.processing.status, 'unavailable');
  assert.equal(report.publication.status, 'unavailable');
  assert.equal(report.capture.spoolDepth, 0);
  void seen;
});

test('[STORY-64] runService hands the ownership-loss callback an abort that stops the service', async () => {
  let onLost;
  let aborted = false;
  await runService({
    role: 'processor',
    ownerId: 'proc-a',
    envCtx: { feedId: 'ttc-vehicles', ownershipPrefix: 'ttc-ownership', ttlMs: 100, spool: { write() { }, list() { return []; }, remove() { }, depth() { return 0; }, read() { } }, sink: { put() { }, get() { }, list() { return []; }, delete() { }, getBytes() { } } },
    acquire: async options => { onLost = options.onLost; return { acquired: true, release: async () => {} }; },
    abort: () => { aborted = true; },
    run: async () => ({ processed: 0 }),
    healthServer: () => ({ listen: async () => {}, close: async () => {} })
  });
  assert.equal(typeof onLost, 'function');
  onLost();
  assert.equal(aborted, true);
});

test('[STORY-64] runService passes the signal to the ownership acquire', async () => {
  const controller = new AbortController();
  let seenSignal;
  await runService({
    role: 'collector',
    ownerId: 'col-a',
    envCtx: { feedId: 'ttc-vehicles', ownershipPrefix: 'ttc-ownership', ttlMs: 100, spool: { write() { }, list() { return []; }, remove() { }, depth() { return 0; }, read() { } }, sink: { put() { }, get() { }, list() { return []; }, delete() { }, getBytes() { } } },
    signal: controller.signal,
    acquire: async options => { seenSignal = options.signal; return { acquired: true, release: async () => {} }; },
    run: async () => ({ polls: 0 }),
    healthServer: () => ({ listen: async () => {}, close: async () => {} })
  });
  assert.equal(seenSignal, controller.signal);
});

test('[STORY-64] composeProcessor memoizes the static load across drains and falls back on a rejected advisory load', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ttc-static-'));
  try {
    const cachePath = join(dir, 'surface.zip');
    await writeFile(cachePath, 'zip-bytes');
    const controller = new AbortController();
    let staticLoads = 0;
    let drains = 0;
    let defaultAlertsInvoked = false;
    const run = composeProcessor({
      envCtx: { staticCache: cachePath, checkpointPath: join(dir, 'cp'), publishSink: { publish() { return { changed: false }; } } },
      store: { list() { return []; } },
      sink: { getBytes() { } },
      loadStatic: async () => { staticLoads++; return { index: { version: 'v1' } }; },
      loadAdvisories: async () => { throw new Error('advisory file corrupt'); },
      run: async args => {
        await args.loadStatic();
        await args.updateAlerts();
        defaultAlertsInvoked = true;
        drains++;
        if (drains === 2) controller.abort();
        return { processed: drains, rejected: 0, cursor: drains - 1, windows: 0, reset: false, alerts: undefined };
      },
      signal: controller.signal,
      wait: async () => {},
      log: () => {}
    });
    await run();
    assert.equal(drains, 2);
    // The static index is parsed once; the second drain reuses the memo.
    assert.equal(staticLoads, 1);
    // The default updateAlerts collaborator is inert and invocable.
    assert.equal(defaultAlertsInvoked, true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('[STORY-64] composeProcessor default wait sleeps one drain interval between drains', async () => {
  const controller = new AbortController();
  let drains = 0;
  const run = composeProcessor({
    envCtx: { staticCache: '/tmp/nope.zip', checkpointPath: '/tmp/cp', publishSink: { publish() { return { changed: false }; } } },
    store: { list() { return []; } },
    sink: { getBytes() { } },
    loadStatic: async () => ({ index: { version: 'v1' } }),
    loadAdvisories: async () => ({ schemaVersion: 1, source: 'ttc-service-change', status: 'not-loaded', checkedAt: null, sourceUpdatedAt: null, fetchedAt: null, advisories: [] }),
    run: async () => { drains++; if (drains === 2) controller.abort(); return { processed: drains, rejected: 0, cursor: drains - 1, windows: 0, reset: false, alerts: undefined }; },
    signal: controller.signal,
    drainIntervalMs: 5,
    log: () => { }
  });
  await run();
  assert.equal(drains, 2);
});

test('[STORY-64] composeProcessor runs one final drain when the signal is already aborted', async () => {
  const controller = new AbortController();
  controller.abort();
  let drains = 0;
  const run = composeProcessor({
    envCtx: { staticCache: '/tmp/nope.zip', checkpointPath: '/tmp/cp', publishSink: { publish() { return { changed: false }; } } },
    store: { list() { return []; } },
    sink: { getBytes() { } },
    loadStatic: async () => ({ index: { version: 'v1' } }),
    loadAdvisories: async () => ({ schemaVersion: 1, source: 'ttc-service-change', status: 'not-loaded', checkedAt: null, sourceUpdatedAt: null, fetchedAt: null, advisories: [] }),
    run: async () => { drains++; return { processed: drains, rejected: 0, cursor: -1, windows: 0, reset: false, alerts: undefined }; },
    signal: controller.signal,
    drainIntervalMs: 5,
    log: () => { }
  });
  await run();
  // The shutdown drain closes the in-flight window even when nothing is pending.
  assert.equal(drains, 1);
});

test('[STORY-64] composeProcessor treats an AbortError from the wait as a shutdown signal', async () => {
  const controller = new AbortController();
  let drains = 0;
  const run = composeProcessor({
    envCtx: { staticCache: '/tmp/nope.zip', checkpointPath: '/tmp/cp', publishSink: { publish() { return { changed: false }; } } },
    store: { list() { return []; } },
    sink: { getBytes() { } },
    loadStatic: async () => ({ index: { version: 'v1' } }),
    loadAdvisories: async () => ({ schemaVersion: 1, source: 'ttc-service-change', status: 'not-loaded', checkedAt: null, sourceUpdatedAt: null, fetchedAt: null, advisories: [] }),
    run: async () => { drains++; return { processed: drains, rejected: 0, cursor: drains - 1, windows: 0, reset: false, alerts: undefined }; },
    signal: controller.signal,
    wait: async () => { controller.abort(); throw new DOMException('aborted', 'AbortError'); },
    drainIntervalMs: 5,
    log: () => { }
  });
  await run();
  // One drain, an aborted wait, then the shutdown drain.
  assert.equal(drains, 2);
});

test('[STORY-64] composeProcessor propagates a non-abort wait failure', async () => {
  const run = composeProcessor({
    envCtx: { staticCache: '/tmp/nope.zip', checkpointPath: '/tmp/cp', publishSink: { publish() { return { changed: false }; } } },
    store: { list() { return []; } },
    sink: { getBytes() { } },
    loadStatic: async () => ({ index: { version: 'v1' } }),
    loadAdvisories: async () => ({ schemaVersion: 1, source: 'ttc-service-change', status: 'not-loaded', checkedAt: null, sourceUpdatedAt: null, fetchedAt: null, advisories: [] }),
    run: async () => ({ processed: 0, rejected: 0, cursor: -1, windows: 0, reset: false, alerts: undefined }),
    signal: new AbortController().signal,
    wait: async () => { throw new Error('timer down'); },
    drainIntervalMs: 5,
    log: () => { }
  });
  await assert.rejects(run(), /timer down/);
});

test('[STORY-64] composeProcessor rejection seam falls back to empty advisory refs without advisory context', async () => {
  const controller = new AbortController();
  const archived = [];
  const run = composeProcessor({
    envCtx: { staticCache: '/tmp/nope.zip', checkpointPath: '/tmp/cp', publishSink: { publish() { return { changed: false }; } }, buildVersion: 'build-9', diagnosticSpool: { write() { } } },
    store: { list() { return []; } },
    sink: { getBytes: async () => null },
    loadStatic: async () => ({ index: { version: 'v1' } }),
    loadAdvisories: async () => ({ status: 'not-loaded' }),
    archiveFailure: async args => { archived.push(args); controller.abort(); },
    run: async args => {
      const error = new Error('Invalid TTC diversion output');
      error.rejectedState = { records: [] };
      await args.onReject({ error, capture: { feedId: 'ttc-vehicles', sequence: 1, payload: null }, index: { version: 'v1' }, checkpoint: { cursor: 0, staticVersion: 'v1', state: {} }, now: new Date('2026-10-14T12:00:00.000Z'), logicalClock: 0 });
      return { processed: 0, rejected: 1, cursor: 0, windows: 0, reset: false, alerts: undefined };
    },
    signal: controller.signal,
    log: () => { }
  });
  await run();
  assert.equal(archived.length, 1);
  assert.deepEqual(archived[0].advisoryRefs, []);
});

test('[STORY-64] structuredLog emits one JSON line per entry', () => {
  const saved = console.log;
  let line;
  try {
    console.log = value => { line = value; };
    structuredLog({ status: 'ok' });
  } finally { console.log = saved; }
  assert.equal(JSON.parse(line).status, 'ok');
});
