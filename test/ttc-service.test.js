import test from 'node:test';
import assert from 'node:assert/strict';
import { createHealthServer } from '../src/ttc/service.js';
import {
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
  const envCtx = { feedId: 'ttc-vehicles', staticCache: '/tmp/z', checkpointPath: '/tmp/cp', sink: { getBytes() { }, publish() { return { changed: false }; } } };
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
    sink: { put() { }, get() { }, list() { return []; }, delete() { }, getBytes() { }, publish() { return { changed: false }; } },
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
    run: async () => ({ processed: 0 })
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
    run: async () => ({ polls: 1 })
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
    run: async ({ log }) => { log({ status: 'ok' }); logInvoked = true; return { polls: 1 }; }
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
    cleanup: async () => { cleanupRan = true; }
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
  const run = composeProcessor({
    envCtx: { staticCache: '/tmp/surface.zip', checkpointPath: '/tmp/cp' },
    store: { list() { return []; } },
    sink: { getBytes() { }, publish() { return { changed: false }; } },
    loadStatic: async () => ({ index: { version: 'v1' } }),
    infer: () => ({ state: {}, report: {} }),
    complete: () => ({ state: {}, output: { diversions: [] } }),
    run: async args => { captured = args; return { processed: 0, rejected: 0, cursor: -1, windows: 0, reset: false }; },
    signal: undefined,
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
  const run = composeProcessor({
    envCtx: { staticCache: '/tmp/z.zip', checkpointPath: '/tmp/cp' },
    store: { list() { return []; } },
    sink: { getBytes() { }, publish() { return { changed: false }; } },
    loadStatic: async ({ cachePath }) => { passedPath = cachePath; return { index: { version: 'v1' } }; },
    infer: () => ({ state: {} }),
    complete: () => ({ state: {}, output: { diversions: [] } }),
    run: async args => { await args.loadStatic(); return { processed: 0, rejected: 0, cursor: -1, windows: 0, reset: false }; },
    signal: undefined,
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
  const processorRun = composeProcessor({
    envCtx: { staticCache: '/tmp/z.zip', checkpointPath: '/tmp/cp' },
    store: {},
    sink: { getBytes() { }, publish() { return { changed: false }; } },
    loadStatic: () => ({ index: { version: 'v1' } }),
    infer: () => ({ state: {} }),
    complete: () => ({ state: {}, output: { diversions: [] } }),
    run: async args => {
      await args.publish({ status: 'ok', schemaVersion: 1, staticVersion: 'v1', checkedAt: new Date().toISOString(), diversions: [] });
      processorPublishInvoked = true;
      return { processed: 0, rejected: 0, cursor: -1, windows: 0, reset: false };
    },
    signal: undefined
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
