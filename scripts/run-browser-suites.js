#!/usr/bin/env node
// Aggregate rendered-browser regression runner.
//
// One command starts the deterministic static site on 127.0.0.1:8765, waits
// until that exact server is ready, runs every supported `test:*:browser`
// package script in deterministic order, propagates failures, and always tears
// the server and every child process down.
//
//   npm run test:browser
//
// Design notes:
// - Suite discovery has a single source of truth: package.json. Every script
//   whose name matches `test:*:browser` is included, except the aggregate
//   `test:browser` itself. A new browser script therefore cannot be silently
//   omitted; it joins the aggregate run automatically.
// - The server is started by this runner and is owned by it. Readiness is
//   confirmed by polling a known repository resource over HTTP, never by a
//   fixed sleep. An already-occupied port fails clearly instead of reusing or
//   terminating an unrelated listener.
// - Suites run sequentially through their package scripts. The runner stops
//   after the first failure and preserves that suite's exit status.
// - Cleanup runs on success, suite failure, server startup failure, and on
//   SIGINT/SIGTERM/SIGHUP. Only processes started by this runner (and their
//   descendants) are signalled; broad commands such as `pkill node` are never
//   used.
//
// Node standard library only. No orchestration dependency is added.

import { spawn, execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import http from "node:http";
import { createBrowserTiming, resolveTimingFormat } from "./lib/browser-timing.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// The deterministic loopback server contract. Port 8080 must never be used.
const HOST = "127.0.0.1";
const PORT = 8765;
const BASE_URL = `http://${HOST}:${PORT}/`;

// A known repository resource used to confirm the started server is alive and
// serving the repository root. It is small and always present.
const READINESS_PATH = "/package.json";

// Bounded readiness timeout. Polling starts immediately; the server is given
// this long to answer before the run fails clearly.
const READINESS_TIMEOUT_MS = 15000;
const READINESS_POLL_INTERVAL_MS = 100;

// Bounded grace period before escalating from SIGTERM to SIGKILL.
const TERMINATE_GRACE_MS = 5000;

// The aggregate script name, excluded from discovery.
const AGGREGATE_SCRIPT = "test:browser";

// The TTC suite retains a deliberate 61-second wait; surface that expectation
// so a long run is not mistaken for a hang.
const LONG_SUITE_HINT = "test:ttc-ui:browser";

// --- Suite discovery -------------------------------------------------------

// Discover every `test:*:browser` package script except the aggregate itself.
// Returns a deterministically sorted list of { name, command }.
export function discoverBrowserSuites(pkg) {
  const scripts = (pkg && pkg.scripts) || {};
  const names = Object.keys(scripts)
    .filter(name => /^test:.*:browser$/.test(name))
    .filter(name => name !== AGGREGATE_SCRIPT)
    .sort();
  return names.map(name => ({ name, command: scripts[name] }));
}

// --- Readiness -------------------------------------------------------------

// Poll the started server until it answers with a successful response for the
// known resource. Resolves once ready; rejects on timeout or early exit.
export function waitForServerReady({
  url = BASE_URL,
  path = READINESS_PATH,
  timeoutMs = READINESS_TIMEOUT_MS,
  intervalMs = READINESS_POLL_INTERVAL_MS,
  isAlive = () => true,
  request = httpRequest
} = {}) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (!isAlive()) {
        reject(new Error("server process exited before becoming ready"));
        return;
      }
      request(url, path)
        .then(ok => {
          if (ok) {
            resolve();
            return;
          }
          schedule();
        })
        .catch(() => schedule());
    };
    const schedule = () => {
      if (Date.now() >= deadline) {
        reject(new Error(`server did not become ready within ${timeoutMs}ms`));
        return;
      }
      setTimeout(attempt, intervalMs);
    };
    attempt();
  });
}

// One HTTP GET against the loopback server. Resolves true only for a 2xx
// response, false otherwise. Never throws.
export function httpRequest(baseUrl, path) {
  return new Promise(resolve => {
    const target = new URL(path, baseUrl);
    const req = http.get(
      { host: target.hostname, port: target.port, path: target.pathname, timeout: 2000 },
      res => {
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 300);
      }
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

// --- Port ownership --------------------------------------------------------

// Confirm the port is free before starting our server. If something already
// answers, fail clearly: the runner must not reuse or terminate an unrelated
// listener, and must not run suites against an unidentified server.
export async function assertPortFree({ url = BASE_URL, request = httpRequest } = {}) {
  const occupied = await request(url, "/");
  if (occupied) {
    throw new Error(
      `port ${PORT} is already in use by another process; ` +
      "stop it before running npm run test:browser"
    );
  }
}

// --- Process management ----------------------------------------------------

// Collect every descendant PID of `root` (transitively) using `ps`. Only
// descendants of a PID this runner started are ever returned, so unrelated
// processes are never signalled.
export function descendantsOf(root, { psOutput } = {}) {
  const rows = psOutput !== undefined ? psOutput : readPsTable();
  const childrenByParent = new Map();
  for (const row of rows) {
    if (!childrenByParent.has(row.ppid)) childrenByParent.set(row.ppid, []);
    childrenByParent.get(row.ppid).push(row.pid);
  }
  const seen = new Set();
  const queue = [root];
  while (queue.length > 0) {
    const parent = queue.shift();
    for (const child of childrenByParent.get(parent) || []) {
      if (!seen.has(child)) {
        seen.add(child);
        queue.push(child);
      }
    }
  }
  return [...seen];
}

export function readPsTable() {
  // Synchronous `ps` snapshot; portable across macOS and Linux.
  const out = execFileSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" });
  return out
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [pid, ppid] = line.split(/\s+/).map(Number);
      return { pid, ppid };
    });
}

// Terminate a process and its descendants: SIGTERM first, then SIGKILL after a
// bounded grace period. Only the given PID tree is touched.
export async function terminateTree(pid, { graceMs = TERMINATE_GRACE_MS, kill = process.kill } = {}) {
  if (!pid) return;
  const tree = [pid, ...descendantsOf(pid)];
  for (const target of tree) {
    try {
      kill(target, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (!isRunning(pid, kill)) return;
    await delay(50);
  }
  for (const target of tree) {
    try {
      kill(target, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

function isRunning(pid, kill) {
  try {
    kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Orchestration ---------------------------------------------------------

// Run one suite through its package script, inheriting stdio so output is
// presented directly. Resolves with the exit status.
export function runSuite(name, { spawnFn = spawn, cwd = ROOT, env = process.env } = {}) {
  return new Promise(resolve => {
    const child = spawnFn("npm", ["run", name], { cwd, env, stdio: "inherit" });
    child.on("error", () => resolve(1));
    child.on("exit", code => resolve(code === null ? 1 : code));
  });
}

// Start the deterministic static server. Returns the child process.
export function startServer({ spawnFn = spawn, cwd = ROOT } = {}) {
  return spawnFn(
    "python3",
    ["-m", "http.server", String(PORT), "--bind", HOST],
    { cwd, stdio: "inherit" }
  );
}

// Install SIGINT/SIGTERM/SIGHUP handlers that run `onSignal` and return a
// function that removes them. Exported so the signal path is directly testable
// without delivering a real signal to the test process.
export function installSignalHandlers(onSignal, { target = process } = {}) {
  const handlers = {
    SIGINT: () => onSignal("SIGINT"),
    SIGTERM: () => onSignal("SIGTERM"),
    SIGHUP: () => onSignal("SIGHUP")
  };
  for (const [signal, handler] of Object.entries(handlers)) {
    target.on(signal, handler);
  }
  return () => {
    for (const [signal, handler] of Object.entries(handlers)) {
      target.removeListener(signal, handler);
    }
  };
}

// The default process-exit used by the runner and CLI. Exported so it can be
// tested without terminating the test process.
export function defaultExit(code) {
  process.exit(code);
}

// The full aggregate run. Injectable for deterministic tests.
export async function runBrowserSuites({
  pkg,
  spawnFn = spawn,
  request = httpRequest,
  log = console.log,
  errorLog = console.error,
  cwd = ROOT,
  env = process.env,
  readinessTimeoutMs = READINESS_TIMEOUT_MS,
  kill = process.kill,
  exit = defaultExit,
  timing = createBrowserTiming(),
  timingFormat = resolveTimingFormat(env)
} = {}) {
  const suites = discoverBrowserSuites(pkg);
  if (suites.length === 0) {
    errorLog("test:browser: no test:*:browser suites found in package.json");
    return 1;
  }

  // Fail clearly if the port is already occupied by an unrelated listener.
  try {
    await assertPortFree({ request });
  } catch (error) {
    errorLog(`test:browser: ${error.message}`);
    return 2;
  }

  log(`==> Starting deterministic server on ${BASE_URL}`);
  const server = startServer({ spawnFn, cwd });
  let serverExited = false;
  server.on("exit", () => {
    serverExited = true;
  });

  const cleanup = async () => {
    if (server && server.pid) {
      await terminateTree(server.pid, { kill });
    }
  };

  // Signal handling: terminate the server tree and exit with conventional
  // signal-related status.
  const onSignal = signal => {
    errorLog(`\ntest:browser: received ${signal}; shutting down`);
    cleanup().finally(() => {
      exit(signal === "SIGINT" ? 130 : 143);
    });
  };
  const removeHandlers = installSignalHandlers(onSignal);

  try {
    await timing.time("server-ready", () => waitForServerReady({
      timeoutMs: readinessTimeoutMs,
      isAlive: () => !serverExited,
      request
    }));
    log(`==> Server ready at ${BASE_URL}`);
  } catch (error) {
    errorLog(`test:browser: ${error.message}`);
    errorLog(timing.format({ format: timingFormat, label: "test:browser" }));
    await cleanup();
    removeHandlers();
    return 3;
  }

  const total = suites.length;
  let index = 0;
  for (const suite of suites) {
    index += 1;
    log(`==> [${index}/${total}] ${suite.name}`);
    if (suite.name === LONG_SUITE_HINT) {
      log("    note: this suite retains a deliberate ~61s wait and may take over a minute");
    }
    // A suite that exits nonzero is a failed span even though the call itself
    // resolved, so the timing summary identifies the failing stage.
    timing.start(`suite:${suite.name}`);
    const status = await runSuite(suite.name, { spawnFn, cwd, env });
    timing.end(`suite:${suite.name}`, { failed: status !== 0 });
    if (status !== 0) {
      errorLog(`test:browser: suite failed: ${suite.name} (exit ${status})`);
      errorLog(timing.format({ format: timingFormat, label: "test:browser" }));
      await cleanup();
      removeHandlers();
      return status;
    }
  }

  await cleanup();
  removeHandlers();
  log(timing.format({ format: timingFormat, label: "test:browser" }));
  log(`==> All ${total} browser suite(s) passed`);
  return 0;
}

// --- CLI -------------------------------------------------------------------

export async function main({
  root = ROOT,
  runFn = runBrowserSuites,
  exit = defaultExit
} = {}) {
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const status = await runFn({ pkg });
  exit(status);
}

// CLI bootstrap: run `main` and report a thrown error clearly. Exported so the
// error path is directly testable without spawning a subprocess.
export async function runCli({
  mainFn = main,
  errorLog = console.error,
  exit = defaultExit
} = {}) {
  try {
    await mainFn();
  } catch (error) {
    errorLog(`test:browser: ${error.message}`);
    exit(1);
  }
}

// Canonicalize a filesystem path so two spellings of the same file compare
// equal. macOS exposes the same temporary directory through both `/var` and
// `/private/var`, and Node resolves `import.meta.url` to the real path while
// `process.argv[1]` keeps the spelling the caller used. Comparing the raw
// strings therefore fails on a symlinked path even though both refer to this
// module. `realpathSync` resolves symlinks; a path that does not exist (for
// example a synthetic test value) is returned unchanged.
export function canonicalPath(path) {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

// Determine whether this module is the process entry point. Exported so the
// detection is directly testable. Both sides are canonicalized so a symlinked
// invocation path (macOS `/var` vs `/private/var`) is still recognized.
export function isDirectInvocation({ argv1 = process.argv[1], moduleUrl = import.meta.url } = {}) {
  return Boolean(argv1) && canonicalPath(fileURLToPath(moduleUrl)) === canonicalPath(argv1);
}

// Run the CLI only when this module is the process entry point. Exported so the
// bootstrap decision is directly testable.
export function bootstrap({
  isDirect = isDirectInvocation,
  cli = runCli
} = {}) {
  if (isDirect()) {
    cli();
  }
}

// Only run the CLI when invoked directly, so tests can import the helpers.
bootstrap();
