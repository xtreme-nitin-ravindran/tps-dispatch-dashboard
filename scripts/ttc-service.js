// Story 64 — TTC capture service entrypoint (collector · processor).
//
// Thin CLI over `src/ttc` that selects a role and runs the corresponding service
// loop under the single-writer ownership lease, exposing a loopback `/health`
// endpoint. The real collaborators are supplied by `src/ttc/runtime.js`; this
// file only assembles them from the environment and hands them to the library
// `runCollector`/`runProcessor` functions.
//
// Roles: `collector` polls the TTC vehicle feed and commits spool-first captures;
// `processor` replays committed captures, checkpoints state, and publishes the
// confirmed geometry. The ownership lease (`<OWNERSHIP_PREFIX>/<role>.json`) and
// the R2 sink are built from the environment, so a development stack with an
// isolated prefix/bucket can never contend with the production writer.

import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { runCollector } from '../src/ttc/collector.js';
import { runProcessor, readCheckpoint } from '../src/ttc/processor.js';
import { createCaptureSinkFromEnv, createCaptureStore, createFileSpool } from '../src/ttc/capture-store.js';
import { loadStaticGtfs } from '../src/ttc/static-source.js';
import { inferDiversions, completeDiversionCapture } from '../src/ttc/diversion-inference.js';
import { ownershipKey } from '../src/ttc/ownership.js';
import { buildReplay, buildTtcPublish, withOwnership } from '../src/ttc/runtime.js';
import { runCleanupLoop } from '../src/ttc/retention.js';

const FEED_ID = 'ttc-vehicles';

// Build the environment-derived collaborators. Exported for direct testing; no
// default depends on ambient credentials (the sink factory fails loudly without
// the four R2 values).
export function buildEnvironment({ env = process.env } = {}) {
  return {
    feedId: FEED_ID,
    ownershipPrefix: env.OWNERSHIP_PREFIX || 'ttc-ownership',
    sink: createCaptureSinkFromEnv({ env }),
    spool: createFileSpool({ dir: env.TTC_SPOOL_DIR || '/app/spool' }),
    checkpointPath: env.TTC_CHECKPOINT_PATH || '/app/state/ttc-checkpoint.json',
    staticCache: env.TTC_STATIC_CACHE || '/app/state/surface.zip',
    intervalMs: Number(env.TTC_INTERVAL_MS || 30000),
    spoolLimit: Number(env.TTC_SPOOL_LIMIT || 720),
    ttlMs: Number(env.TTC_OWNERSHIP_TTL_MS || 60000)
  };
}

// Compose the collector run function from its collaborators. Extracted so the
// wiring is directly testable without a real feed or bucket.
export function composeCollector({
  envCtx,
  store,
  run = runCollector,
  fetchFeed,
  signal,
  log = () => { }
}) {
  return () => run({
    feedId: envCtx.feedId,
    intervalMs: envCtx.intervalMs,
    fetchFeed,
    store,
    spoolLimit: envCtx.spoolLimit,
    signal,
    log
  });
}

// Compose the processor run function from its collaborators. Extracted so the
// wiring (replay/getBytes, publish, static load, inference) is directly testable.
export function composeProcessor({
  envCtx,
  store,
  sink,
  run = runProcessor,
  loadStatic = loadStaticGtfs,
  infer = inferDiversions,
  complete = completeDiversionCapture,
  signal,
  log = () => { }
}) {
  const replay = buildReplay({ getBytes: sink.getBytes, log });
  const publish = buildTtcPublish({ sink, log });
  return () => run({
    store,
    loadStatic: () => loadStatic({ cachePath: envCtx.staticCache, log }),
    replay,
    infer,
    complete,
    publish,
    checkpointPath: envCtx.checkpointPath,
    signal,
    log
  });
}

// Compose the processor's hourly retention cleanup loop. `getCursor` reads the
// durable checkpoint so cleanup never expires an object the processor has not yet
// consumed; it defaults to `-1` (consume nothing) when the checkpoint is absent or
// unreadable. The loop runs until `signal` aborts. `readCheckpoint` is injectable
// so both the absent- and present-checkpoint paths are testable.
export function composeCleanup({ envCtx, signal, loop = runCleanupLoop, log = () => { }, readCheckpointImpl = readCheckpoint }) {
  return ({ store, spool, signal: s }) => loop({
    store, spool,
    getCursor: async () => (await readCheckpointImpl(envCtx.checkpointPath))?.cursor ?? -1,
    signal: s || signal,
    feedId: envCtx.feedId,
    log
  });
}

// Resolve the role's run function and owner id from the environment. Extracted
// so both the collector and processor branches are directly testable without
// executing the CLI guard.
export function resolveService({ role, envCtx, store, signal }) {
  const ownerId = role === 'processor' ? 'ttc-processor-1' : 'ttc-collector-1';
  if (role === 'processor') {
    const run = composeProcessor({ envCtx, store, sink: envCtx.sink, signal });
    const cleanup = composeCleanup({ envCtx, signal });
    return { ownerId, run, cleanup };
  }
  const run = composeCollector({ envCtx, store, signal });
  return { ownerId, run };
}

// Handle the final run result for the CLI: a denied lease is a non-zero exit.
// `exitCode` is written to the injected target so it is testable in-process.
export async function handleResult(result, { setExitCode = code => { process.exitCode = code; } } = {}) {
  if (!result.acquired) setExitCode(1);
  else return result;
}

// Handle a fatal service error for the CLI: record it and exit non-zero. The
// error is logged as a single structured line and the exit code is written to
// the injected target so the branch is testable in-process.
export function handleFatal(error, { log = console.error, setExitCode = code => { process.exitCode = code; } } = {}) {
  log(JSON.stringify({ source: 'ttc-service', status: 'fatal', error: error.message }));
  setExitCode(1);
}

// True when this module is the process entry point.
export function isDirectInvocation({ argv1 = process.argv[1], moduleUrl = import.meta.url } = {}) {
  return Boolean(argv1) && moduleUrl === pathToFileURL(resolve(argv1)).href;
}

// Run one service under its ownership lease. Returns `{ acquired, role }` plus
// the run summary. The run loop is injected so the real `runCollector`/`runProcessor`
// are used in production while tests inject a stub. An optional `cleanup` loop
// (for example the processor's hourly retention cleanup) runs concurrently under
// the same lease and stops on the same `signal`; it is joined before ownership is
// released so a shutdown never leaks a running cleanup pass.
export async function runService({
  role,
  ownerId,
  envCtx = buildEnvironment(),
  acquire = withOwnership,
  run,
  cleanup,
  signal,
  log = () => { }
}) {
  const sink = envCtx.sink;
  const store = createCaptureStore({ spool: envCtx.spool, sink, feedId: envCtx.feedId });
  const key = ownershipKey({ role, prefix: envCtx.ownershipPrefix });
  const owned = await acquire({ sink, key, ownerId, ttlMs: envCtx.ttlMs, signal, log });
  if (!owned.acquired) return { acquired: false, role };
  try {
    const tasks = [run({ store, sink, signal, log })];
    if (cleanup) tasks.push(cleanup({ store, spool: envCtx.spool, sink, signal, log }));
    const [summary] = await Promise.all(tasks);
    return { acquired: true, role, summary };
  } finally {
    await owned.release();
  }
}

// Run the CLI body: resolve the role (argv → env → default), install shutdown
// handlers, build the environment, and run the service until it resolves. All
// dependencies are injectable so the role-selection and signal-handling branches
// are testable without executing the real services.
export async function runCli({
  argv = [],
  env = process.env,
  envCtx,
  signal,
  onSignal = () => { },
  onSigterm = onSignal,
  onSigint = onSignal,
  runServiceImpl = runService,
  handleResultImpl = handleResult
} = {}) {
  const role = argv[0] || env.ROLE || 'collector';
  const envContext = envCtx || buildEnvironment({ env });
  const store = createCaptureStore({ spool: envContext.spool, sink: envContext.sink, feedId: envContext.feedId });
  const ownerId = role === 'processor' ? 'ttc-processor-1' : 'ttc-collector-1';
  const resolved = resolveService({ role, envCtx: envContext, store, signal });
  onSigterm();
  onSigint();
  const result = await runServiceImpl({ role, ownerId, envCtx: envContext, signal, run: resolved.run, cleanup: resolved.cleanup });
  await handleResultImpl(result);
  return result;
}

// Bootstrap the process: when this module is the entry point, build an abort
// signal, wire it to SIGTERM/SIGINT, run the CLI, and route a fatal error to
// `handleFatal`. Exported with an injectable `isDirect` so the guard branch is
// testable without executing the real services; the top-level call below is the
// branch-free always-invoked entry.
export function bootstrap({
  isDirect = isDirectInvocation,
  abort = () => new AbortController(),
  once = (name, handler) => process.once(name, handler),
  argv = process.argv.slice(2),
  env = process.env,
  cli = runCli,
  onFatal = handleFatal
} = {}) {
  if (!isDirect()) return;
  const controller = abort();
  const shutdown = () => controller.abort();
  once('SIGTERM', shutdown);
  once('SIGINT', shutdown);
  cli({ argv, env, signal: controller.signal }).catch(onFatal);
}

bootstrap();
