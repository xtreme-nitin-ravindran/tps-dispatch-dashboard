import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, writeFile, rm, readdir, symlink, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  discoverBrowserSuites,
  waitForServerReady,
  assertPortFree,
  descendantsOf,
  terminateTree,
  runBrowserSuites,
  httpRequest,
  readPsTable,
  runSuite,
  startServer,
  installSignalHandlers,
  runCli,
  main,
  isDirectInvocation,
  canonicalPath,
  bootstrap,
  defaultExit
} from "../scripts/run-browser-suites.js";

// Deterministic regression coverage for the aggregate rendered-browser runner
// (scripts/run-browser-suites.js) and the `npm run test:browser` wiring.
//
// These tests never launch real Chromium or a real server. They import the
// runner's exported helpers and inject stub spawn/network behavior so suite
// discovery, server readiness, execution order, failure propagation, and
// cleanup can be asserted precisely.

const root = fileURLToPath(new URL("../", import.meta.url)).replace(/\/$/, "");
const runnerPath = join(root, "scripts", "run-browser-suites.js");

// --- Suite inventory -------------------------------------------------------

test("discovers every test:*:browser script and excludes the aggregate", () => {
  const pkg = {
    scripts: {
      test: "sh scripts/run-unit-tests.sh",
      "test:browser": "node scripts/run-browser-suites.js",
      "test:story-39a:browser": "node scripts/cluster-connectors-browser.js",
      "test:story-43:browser": "node scripts/mobile-map-info-browser.js",
      "test:road-closure-count:browser": "node scripts/road-closure-count-browser.js",
      "test:ttc-ui:browser": "node scripts/ttc-ui-browser.js"
    }
  };
  const suites = discoverBrowserSuites(pkg);
  const names = suites.map(s => s.name);
  assert.deepEqual(names, [
    "test:road-closure-count:browser",
    "test:story-39a:browser",
    "test:story-43:browser",
    "test:ttc-ui:browser"
  ]);
  assert.ok(!names.includes("test:browser"), "the aggregate script must be excluded");
  assert.ok(!names.includes("test"), "non-browser scripts must be excluded");
});

test("discovery is deterministic and sorted", () => {
  const pkg = {
    scripts: {
      "test:zeta:browser": "node z.js",
      "test:alpha:browser": "node a.js",
      "test:mid:browser": "node m.js"
    }
  };
  const first = discoverBrowserSuites(pkg).map(s => s.name);
  const second = discoverBrowserSuites(pkg).map(s => s.name);
  assert.deepEqual(first, second, "discovery must be deterministic");
  assert.deepEqual(first, [...first].sort(), "discovery must be sorted");
});

test("a new browser script cannot be silently omitted", () => {
  const pkg = {
    scripts: {
      "test:story-39a:browser": "node a.js",
      "test:brand-new:browser": "node b.js"
    }
  };
  const names = discoverBrowserSuites(pkg).map(s => s.name);
  assert.ok(names.includes("test:brand-new:browser"), "a new browser script must be discovered");
});

test("discovery tolerates a missing package or scripts object", () => {
  assert.deepEqual(discoverBrowserSuites(null), [], "a null package must yield no suites");
  assert.deepEqual(discoverBrowserSuites(undefined), [], "an undefined package must yield no suites");
  assert.deepEqual(discoverBrowserSuites({}), [], "a package without scripts must yield no suites");
});

test("the real package.json exposes every supported browser suite", async () => {
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const names = discoverBrowserSuites(pkg).map(s => s.name);
  // Every real test:*:browser script (except the aggregate) must be discovered.
  const realBrowserScripts = Object.keys(pkg.scripts)
    .filter(name => /^test:.*:browser$/.test(name) && name !== "test:browser")
    .sort();
  assert.deepEqual(names, realBrowserScripts);
  // The standalone TTC suite must be exposed and included.
  assert.ok(names.includes("test:ttc-ui:browser"), "the TTC suite must be exposed and included");
});

test("the aggregate script is not itself a test:*:browser suite", async () => {
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.equal(pkg.scripts["test:browser"], "node scripts/run-browser-suites.js");
  assert.ok(
    !/^test:.*:browser$/.test("test:browser"),
    "the aggregate name must not match the discovery pattern"
  );
});

// --- Server readiness ------------------------------------------------------

test("readiness polls the loopback server and resolves once it responds", async () => {
  let calls = 0;
  const request = async () => {
    calls += 1;
    return calls >= 3; // ready on the third poll
  };
  await waitForServerReady({ request, intervalMs: 1, timeoutMs: 1000 });
  assert.equal(calls, 3, "readiness must poll until the server responds");
});

test("readiness does not use a fixed sleep: it resolves as soon as the server answers", async () => {
  const start = Date.now();
  const request = async () => true; // ready immediately
  await waitForServerReady({ request, intervalMs: 100, timeoutMs: 5000 });
  assert.ok(Date.now() - start < 1000, "readiness must not wait a fixed interval when already up");
});

test("readiness times out clearly when the server never responds", async () => {
  const request = async () => false;
  await assert.rejects(
    () => waitForServerReady({ request, intervalMs: 1, timeoutMs: 30 }),
    /did not become ready/
  );
});

test("readiness rejects when the server exits early", async () => {
  const request = async () => false;
  await assert.rejects(
    () => waitForServerReady({ request, intervalMs: 1, timeoutMs: 1000, isAlive: () => false }),
    /exited before becoming ready/
  );
});

test("readiness keeps polling when the request rejects", async () => {
  let calls = 0;
  const request = async () => {
    calls += 1;
    if (calls < 3) throw new Error("connection refused");
    return true;
  };
  await waitForServerReady({ request, intervalMs: 1, timeoutMs: 1000 });
  assert.equal(calls, 3, "a rejected request must be retried, not fatal");
});

test("defaultExit calls process.exit with the given code", () => {
  const original = process.exit;
  const seen = [];
  process.exit = code => {
    seen.push(code);
    // Do not actually exit the test process.
  };
  try {
    defaultExit(7);
  } finally {
    process.exit = original;
  }
  assert.deepEqual(seen, [7]);
});

test("an occupied port fails clearly without reusing the listener", async () => {
  const request = async () => true; // something already answers
  await assert.rejects(() => assertPortFree({ request }), /already in use/);
});

test("a free port passes the occupancy check", async () => {
  const request = async () => false;
  await assert.doesNotReject(() => assertPortFree({ request }));
});

// --- Process-tree helpers --------------------------------------------------

test("descendantsOf returns the full transitive tree of a PID", () => {
  const psOutput = [
    { pid: 10, ppid: 1 },
    { pid: 11, ppid: 10 },
    { pid: 12, ppid: 11 },
    { pid: 99, ppid: 1 } // unrelated
  ];
  const tree = descendantsOf(10, { psOutput }).sort((a, b) => a - b);
  assert.deepEqual(tree, [11, 12]);
  assert.ok(!tree.includes(99), "unrelated processes must never be returned");
});

test("terminateTree signals only the given tree and escalates after the grace period", async () => {
  const signals = [];
  const kill = (pid, signal) => {
    signals.push([pid, signal]);
    // Simulate a process that ignores SIGTERM so escalation is exercised.
    if (signal === "SIGKILL") return;
    if (signal === 0) return; // still running
  };
  await terminateTree(10, { graceMs: 20, kill });
  const pids = new Set(signals.map(([pid]) => pid));
  assert.ok(pids.has(10), "the root PID must be signalled");
  assert.ok(signals.some(([, s]) => s === "SIGTERM"), "SIGTERM must be sent first");
  assert.ok(signals.some(([, s]) => s === "SIGKILL"), "SIGKILL must escalate after the grace period");
});

// --- Aggregate orchestration (stubbed) -------------------------------------

// A stub spawn that records invocations and returns a fake child process.
// Also returns a `kill` stub so cleanup never signals a real PID.
function makeStubSpawn({ suiteStatus = {}, serverExits = false } = {}) {
  const calls = [];
  const spawnFn = (cmd, args) => {
    const child = new EventEmitter();
    child.pid = 1000 + calls.length;
    child.kill = () => { };
    calls.push({ cmd, args });
    if (cmd === "python3") {
      // The server child. Optionally exit early.
      if (serverExits) {
        setImmediate(() => child.emit("exit", 1));
      }
      return child;
    }
    // A suite child: emit its configured exit status.
    const name = args[args.length - 1];
    const status = suiteStatus[name] ?? 0;
    setImmediate(() => child.emit("exit", status));
    return child;
  };
  // Treat every PID as already gone so terminateTree returns immediately.
  const kill = (pid, signal) => {
    if (signal === 0) throw new Error("ESRCH");
  };
  return { spawnFn, kill, calls };
}

function silentLog() {
  const lines = [];
  return { log: (...a) => lines.push(a.join(" ")), lines };
}

// A request stub that reports the port free (the "/" probe fails) but the
// server ready (the readiness probe succeeds). This mirrors a real run where
// nothing answers before our server starts and our server answers afterwards.
function freeThenReady() {
  return async (baseUrl, path) => path !== "/";
}

test("runs every included suite exactly once in deterministic order", async () => {
  const pkg = {
    scripts: {
      "test:browser": "node scripts/run-browser-suites.js",
      "test:zeta:browser": "node z.js",
      "test:alpha:browser": "node a.js"
    }
  };
  const { spawnFn, kill, calls } = makeStubSpawn();
  const { log, lines } = silentLog();
  const status = await runBrowserSuites({
    pkg,
    spawnFn,
    kill,
    request: freeThenReady(), // port free, then ready
    log,
    errorLog: () => { }
  });
  assert.equal(status, 0);
  const suiteCalls = calls.filter(c => c.cmd === "npm").map(c => c.args[c.args.length - 1]);
  assert.deepEqual(suiteCalls, ["test:alpha:browser", "test:zeta:browser"]);
  assert.equal(new Set(suiteCalls).size, suiteCalls.length, "each suite must run exactly once");
  assert.ok(lines.some(l => l.includes("[1/2]")), "progress must show [current/total]");
  assert.ok(lines.some(l => l.includes("[2/2]")), "progress must show [current/total]");
});

test("records and prints a timing span for server readiness and each suite", async () => {
  const pkg = {
    scripts: {
      "test:browser": "node scripts/run-browser-suites.js",
      "test:alpha:browser": "node a.js",
      "test:zeta:browser": "node z.js"
    }
  };
  const { spawnFn, kill } = makeStubSpawn();
  const { log, lines } = silentLog();
  const status = await runBrowserSuites({
    pkg,
    spawnFn,
    kill,
    request: freeThenReady(),
    log,
    errorLog: () => { }
  });
  assert.equal(status, 0);
  // The summary is printed and names the readiness span and every suite span.
  const summary = lines.find(l => l.includes("test:browser timing:"));
  assert.ok(summary, "the runner must print a timing summary");
  assert.match(summary, /server-ready: \d/);
  assert.match(summary, /suite:test:alpha:browser: \d/);
  assert.match(summary, /suite:test:zeta:browser: \d/);
});

test("prints the timing summary when the server never becomes ready", async () => {
  const pkg = {
    scripts: {
      "test:browser": "node scripts/run-browser-suites.js",
      "test:alpha:browser": "node a.js"
    }
  };
  const { spawnFn, kill } = makeStubSpawn();
  const errors = [];
  const status = await runBrowserSuites({
    pkg,
    spawnFn,
    kill,
    request: async () => false,
    readinessTimeoutMs: 30,
    log: () => { },
    errorLog: (...a) => errors.push(a.join(" "))
  });
  assert.equal(status, 3);
  // The failed readiness span is reported so the failing stage is identifiable.
  assert.ok(
    errors.some(l => /server-ready: \d+ms \(failed\)/.test(l)),
    "a readiness failure must report the failed server-ready span"
  );
});

test("prints the timing summary when a suite fails", async () => {
  const pkg = {
    scripts: {
      "test:browser": "node scripts/run-browser-suites.js",
      "test:alpha:browser": "node a.js"
    }
  };
  const { spawnFn, kill } = makeStubSpawn({ suiteStatus: { "test:alpha:browser": 5 } });
  const errors = [];
  const status = await runBrowserSuites({
    pkg,
    spawnFn,
    kill,
    request: freeThenReady(),
    log: () => { },
    errorLog: (...a) => errors.push(a.join(" "))
  });
  assert.equal(status, 5);
  assert.ok(
    errors.some(l => /suite:test:alpha:browser: \d+ms \(failed\)/.test(l)),
    "a suite failure must report the failed suite span"
  );
});

test("honors the JSON timing format when requested", async () => {
  const pkg = {
    scripts: {
      "test:browser": "node scripts/run-browser-suites.js",
      "test:alpha:browser": "node a.js"
    }
  };
  const { spawnFn, kill } = makeStubSpawn();
  const { log, lines } = silentLog();
  const status = await runBrowserSuites({
    pkg,
    spawnFn,
    kill,
    request: freeThenReady(),
    log,
    errorLog: () => { },
    timingFormat: "json"
  });
  assert.equal(status, 0);
  const jsonLine = lines.find(l => l.startsWith("{") && l.includes("\"spans\""));
  assert.ok(jsonLine, "the JSON timing summary must be printed");
  const parsed = JSON.parse(jsonLine);
  assert.equal(parsed.label, "test:browser");
  assert.ok(parsed.spans.some(s => s.name === "server-ready"));
  assert.ok(parsed.spans.some(s => s.name === "suite:test:alpha:browser"));
});

test("stops on the first suite failure and preserves its exit status", async () => {
  const pkg = {
    scripts: {
      "test:browser": "node scripts/run-browser-suites.js",
      "test:alpha:browser": "node a.js",
      "test:beta:browser": "node b.js",
      "test:gamma:browser": "node c.js"
    }
  };
  const { spawnFn, kill, calls } = makeStubSpawn({ suiteStatus: { "test:beta:browser": 7 } });
  const errors = [];
  const status = await runBrowserSuites({
    pkg,
    spawnFn,
    kill,
    request: freeThenReady(),
    log: () => { },
    errorLog: (...a) => errors.push(a.join(" "))
  });
  assert.equal(status, 7, "the failing suite's exit status must be preserved");
  const suiteCalls = calls.filter(c => c.cmd === "npm").map(c => c.args[c.args.length - 1]);
  assert.deepEqual(suiteCalls, ["test:alpha:browser", "test:beta:browser"]);
  assert.ok(!suiteCalls.includes("test:gamma:browser"), "no suite may run after a failure");
  assert.ok(errors.some(l => l.includes("test:beta:browser")), "the failing suite must be reported");
});

test("passes environment overrides through to suite children", async () => {
  const pkg = {
    scripts: {
      "test:browser": "node scripts/run-browser-suites.js",
      "test:alpha:browser": "node a.js"
    }
  };
  const seen = [];
  const spawnFn = (cmd, args, opts) => {
    const child = new EventEmitter();
    child.pid = cmd === "python3" ? 4242 : 1;
    child.kill = () => { };
    if (cmd === "npm") seen.push(opts.env);
    setImmediate(() => child.emit("exit", 0));
    return child;
  };
  const kill = (pid, signal) => {
    if (signal === 0) throw new Error("ESRCH");
  };
  const env = { ...process.env, PLAYWRIGHT_MODULE: "custom-playwright", CHROMIUM_EXECUTABLE: "/x" };
  await runBrowserSuites({ pkg, spawnFn, kill, request: freeThenReady(), env, log: () => { }, errorLog: () => { } });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].PLAYWRIGHT_MODULE, "custom-playwright");
  assert.equal(seen[0].CHROMIUM_EXECUTABLE, "/x");
});

test("fails clearly when the port is already occupied", async () => {
  const pkg = {
    scripts: {
      "test:browser": "node scripts/run-browser-suites.js",
      "test:alpha:browser": "node a.js"
    }
  };
  const { spawnFn, kill, calls } = makeStubSpawn();
  const errors = [];
  const status = await runBrowserSuites({
    pkg,
    spawnFn,
    kill,
    request: async () => true, // occupied
    log: () => { },
    errorLog: (...a) => errors.push(a.join(" "))
  });
  assert.equal(status, 2, "an occupied port must use a distinct failure code");
  assert.ok(errors.some(l => /already in use/.test(l)));
  assert.equal(calls.length, 0, "no server or suite may start when the port is occupied");
});

test("fails clearly when the server never becomes ready", async () => {
  const pkg = {
    scripts: {
      "test:browser": "node scripts/run-browser-suites.js",
      "test:alpha:browser": "node a.js"
    }
  };
  const { spawnFn, kill, calls } = makeStubSpawn();
  const errors = [];
  const status = await runBrowserSuites({
    pkg,
    spawnFn,
    kill,
    request: async () => false, // never ready
    readinessTimeoutMs: 30,
    log: () => { },
    errorLog: (...a) => errors.push(a.join(" "))
  });
  assert.equal(status, 3, "a readiness timeout must use a distinct failure code");
  assert.ok(errors.some(l => /did not become ready/.test(l)));
  assert.ok(!calls.some(c => c.cmd === "npm"), "no suite may run when the server is not ready");
});

test("fails clearly when the server exits early", async () => {
  const pkg = {
    scripts: {
      "test:browser": "node scripts/run-browser-suites.js",
      "test:alpha:browser": "node a.js"
    }
  };
  const { spawnFn, kill } = makeStubSpawn({ serverExits: true });
  const errors = [];
  const status = await runBrowserSuites({
    pkg,
    spawnFn,
    kill,
    request: async () => false,
    readinessTimeoutMs: 200,
    log: () => { },
    errorLog: (...a) => errors.push(a.join(" "))
  });
  assert.equal(status, 3);
  assert.ok(errors.some(l => /exited before becoming ready/.test(l)));
});

test("fails clearly when no browser suites are discovered", async () => {
  const pkg = { scripts: { "test:browser": "node scripts/run-browser-suites.js" } };
  const { spawnFn, kill } = makeStubSpawn();
  const errors = [];
  const status = await runBrowserSuites({
    pkg,
    spawnFn,
    kill,
    request: async () => false,
    log: () => { },
    errorLog: (...a) => errors.push(a.join(" "))
  });
  assert.notEqual(status, 0);
  assert.ok(errors.some(l => /no test:\*:browser suites/.test(l)));
});

test("the TTC suite is not subject to an invalid sub-61-second timeout and its wait is surfaced", async () => {
  const pkg = {
    scripts: {
      "test:browser": "node scripts/run-browser-suites.js",
      "test:ttc-ui:browser": "node scripts/ttc-ui-browser.js"
    }
  };
  const { spawnFn, kill } = makeStubSpawn();
  const { log, lines } = silentLog();
  const status = await runBrowserSuites({
    pkg,
    spawnFn,
    kill,
    request: freeThenReady(),
    log,
    errorLog: () => { }
  });
  assert.equal(status, 0);
  assert.ok(
    lines.some(l => /61s|over a minute/.test(l)),
    "the deliberate TTC wait must be surfaced in progress output"
  );
});

// --- Cleanup ---------------------------------------------------------------

test("stops the server after success", async () => {
  const pkg = {
    scripts: {
      "test:browser": "node scripts/run-browser-suites.js",
      "test:alpha:browser": "node a.js"
    }
  };
  const killed = [];
  const kill = (pid, signal) => {
    killed.push([pid, signal]);
    if (signal === 0) throw new Error("ESRCH"); // treat as already gone
  };
  const spawnFn = (cmd) => {
    const child = new EventEmitter();
    child.pid = cmd === "python3" ? 4242 : 1;
    child.kill = () => { };
    setImmediate(() => child.emit("exit", 0));
    return child;
  };
  await runBrowserSuites({ pkg, spawnFn, kill, request: freeThenReady(), log: () => { }, errorLog: () => { } });
  assert.ok(killed.some(([pid]) => pid === 4242), "the server must be terminated after success");
});

test("stops the server after a suite failure", async () => {
  const pkg = {
    scripts: {
      "test:browser": "node scripts/run-browser-suites.js",
      "test:alpha:browser": "node a.js"
    }
  };
  const killed = [];
  const kill = (pid, signal) => {
    killed.push([pid, signal]);
    if (signal === 0) throw new Error("ESRCH");
  };
  const spawnFn = (cmd) => {
    const child = new EventEmitter();
    child.pid = cmd === "python3" ? 4242 : 1;
    child.kill = () => { };
    setImmediate(() => child.emit("exit", cmd === "python3" ? 0 : 5));
    return child;
  };
  const status = await runBrowserSuites({
    pkg,
    spawnFn,
    kill,
    request: freeThenReady(),
    log: () => { },
    errorLog: () => { }
  });
  assert.equal(status, 5);
  assert.ok(killed.some(([pid]) => pid === 4242), "the server must be terminated after a failure");
});

test("stops the server after a readiness failure", async () => {
  const pkg = {
    scripts: {
      "test:browser": "node scripts/run-browser-suites.js",
      "test:alpha:browser": "node a.js"
    }
  };
  const killed = [];
  const kill = (pid, signal) => {
    killed.push([pid, signal]);
    if (signal === 0) throw new Error("ESRCH");
  };
  const spawnFn = (cmd) => {
    const child = new EventEmitter();
    child.pid = cmd === "python3" ? 4242 : 1;
    child.kill = () => { };
    return child; // never exits, never ready
  };
  const status = await runBrowserSuites({
    pkg,
    spawnFn,
    kill,
    request: async () => false,
    readinessTimeoutMs: 30,
    log: () => { },
    errorLog: () => { }
  });
  assert.equal(status, 3);
  assert.ok(killed.some(([pid]) => pid === 4242), "the server must be terminated after a readiness failure");
});

// --- Real implementations (exercised against harmless inputs) --------------

test("httpRequest resolves true for a 2xx response and false otherwise", async () => {
  const http = await import("node:http");
  const server = http.createServer((req, res) => {
    if (req.url === "/ok") {
      res.writeHead(200);
      res.end("ok");
    } else {
      res.writeHead(404);
      res.end("no");
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}/`;
  try {
    assert.equal(await httpRequest(base, "/ok"), true, "a 2xx response must resolve true");
    assert.equal(await httpRequest(base, "/missing"), false, "a non-2xx response must resolve false");
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("httpRequest resolves false when the connection fails", async () => {
  // Nothing listens on this port; the request must resolve false, never throw.
  const result = await httpRequest("http://127.0.0.1:1/", "/");
  assert.equal(result, false);
});

test("readPsTable returns numeric pid/ppid rows from the real process table", () => {
  const rows = readPsTable();
  assert.ok(Array.isArray(rows), "readPsTable must return an array");
  assert.ok(rows.length > 0, "the process table must not be empty");
  for (const row of rows) {
    assert.equal(typeof row.pid, "number");
    assert.equal(typeof row.ppid, "number");
  }
  // The current process must appear in the table.
  assert.ok(rows.some(r => r.pid === process.pid), "the current process must be present");
});

test("terminateTree returns immediately for a falsy PID", async () => {
  await assert.doesNotReject(() => terminateTree(0));
  await assert.doesNotReject(() => terminateTree(undefined));
});

test("terminateTree with the real kill returns for a nonexistent PID", async () => {
  // A very high PID is not running; the real kill throws and is handled.
  await assert.doesNotReject(() => terminateTree(999999, { graceMs: 0 }));
});

test("runSuite resolves with the child's exit status", async () => {
  const spawnFn = () => {
    const child = new EventEmitter();
    setImmediate(() => child.emit("exit", 3));
    return child;
  };
  assert.equal(await runSuite("test:x:browser", { spawnFn }), 3);
});

test("runSuite resolves 1 when the child emits an error", async () => {
  const spawnFn = () => {
    const child = new EventEmitter();
    setImmediate(() => child.emit("error", new Error("boom")));
    return child;
  };
  assert.equal(await runSuite("test:x:browser", { spawnFn }), 1);
});

test("runSuite resolves 1 when the child exits with a null code", async () => {
  const spawnFn = () => {
    const child = new EventEmitter();
    setImmediate(() => child.emit("exit", null));
    return child;
  };
  assert.equal(await runSuite("test:x:browser", { spawnFn }), 1);
});

test("startServer spawns python3 http.server on the loopback port", () => {
  const calls = [];
  const spawnFn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return new EventEmitter();
  };
  startServer({ spawnFn, cwd: "/tmp" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, "python3");
  assert.deepEqual(calls[0].args, ["-m", "http.server", "8765", "--bind", "127.0.0.1"]);
  assert.equal(calls[0].opts.cwd, "/tmp");
});

test("httpRequest resolves false when the request times out", async () => {
  const http = await import("node:http");
  // A server that accepts the connection but never responds.
  const server = http.createServer(() => { /* never respond */ });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    // The request timeout is 2000ms; this test waits it out.
    const result = await httpRequest(`http://127.0.0.1:${port}/`, "/");
    assert.equal(result, false, "a timed-out request must resolve false");
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("installSignalHandlers registers and removes the three handlers", () => {
  const registered = new Map();
  const target = {
    on: (signal, handler) => registered.set(signal, handler),
    removeListener: (signal, handler) => {
      assert.equal(registered.get(signal), handler, "the same handler must be removed");
      registered.delete(signal);
    }
  };
  const seen = [];
  const remove = installSignalHandlers(signal => seen.push(signal), { target });
  assert.deepEqual([...registered.keys()].sort(), ["SIGHUP", "SIGINT", "SIGTERM"]);
  // Invoking each handler reports the signal.
  registered.get("SIGINT")();
  registered.get("SIGTERM")();
  registered.get("SIGHUP")();
  assert.deepEqual(seen, ["SIGINT", "SIGTERM", "SIGHUP"]);
  remove();
  assert.equal(registered.size, 0, "all handlers must be removed");
});

test("a signal during a run terminates the server and exits with a signal status", async () => {
  const pkg = {
    scripts: {
      "test:browser": "node scripts/run-browser-suites.js",
      "test:alpha:browser": "node a.js"
    }
  };
  const killed = [];
  const kill = (pid, signal) => {
    killed.push([pid, signal]);
    if (signal === 0) throw new Error("ESRCH");
  };
  const exits = [];
  const spawnFn = (cmd) => {
    const child = new EventEmitter();
    child.pid = cmd === "python3" ? 4242 : 1;
    child.kill = () => { };
    if (cmd === "npm") {
      // Emit the signal shortly after the suite starts, then let the suite
      // finish so the run can return.
      setTimeout(() => process.emit("SIGINT"), 20);
      setTimeout(() => child.emit("exit", 0), 60);
    }
    return child;
  };
  await runBrowserSuites({
    pkg,
    spawnFn,
    kill,
    request: freeThenReady(),
    log: () => { },
    errorLog: () => { },
    exit: code => exits.push(code)
  });
  // The injected exit records the signal status.
  assert.ok(exits.includes(130), "SIGINT must exit with status 130");
  assert.ok(killed.some(([pid]) => pid === 4242), "the server must be terminated on signal");
});

test("a signal uses the default exit when none is injected", async () => {
  const pkg = {
    scripts: {
      "test:browser": "node scripts/run-browser-suites.js",
      "test:alpha:browser": "node a.js"
    }
  };
  const kill = (pid, signal) => {
    if (signal === 0) throw new Error("ESRCH");
  };
  const spawnFn = (cmd) => {
    const child = new EventEmitter();
    child.pid = cmd === "python3" ? 4242 : 1;
    child.kill = () => { };
    if (cmd === "npm") {
      setTimeout(() => process.emit("SIGTERM"), 20);
      setTimeout(() => child.emit("exit", 0), 60);
    }
    return child;
  };
  const original = process.exit;
  const seen = [];
  process.exit = code => { seen.push(code); };
  try {
    await runBrowserSuites({
      pkg,
      spawnFn,
      kill,
      request: freeThenReady(),
      log: () => { },
      errorLog: () => { }
    });
  } finally {
    process.exit = original;
  }
  assert.ok(seen.includes(143), "SIGTERM must exit with status 143 via the default exit");
});

test("runCli reports a thrown error and exits 1", async () => {
  const errors = [];
  const exits = [];
  await runCli({
    mainFn: async () => {
      throw new Error("kaboom");
    },
    errorLog: (...a) => errors.push(a.join(" ")),
    exit: code => exits.push(code)
  });
  assert.ok(errors.some(l => /kaboom/.test(l)), "the error must be reported");
  assert.deepEqual(exits, [1], "the CLI must exit 1 on error");
});

test("runCli resolves without exiting when main succeeds", async () => {
  const exits = [];
  await runCli({ mainFn: async () => { }, errorLog: () => { }, exit: code => exits.push(code) });
  assert.deepEqual(exits, [], "a successful main must not exit");
});

test("runCli uses the default exit on error when none is injected", async () => {
  const original = process.exit;
  const seen = [];
  process.exit = code => { seen.push(code); };
  try {
    await runCli({
      mainFn: async () => { throw new Error("boom"); },
      errorLog: () => { }
    });
  } finally {
    process.exit = original;
  }
  assert.deepEqual(seen, [1], "the default exit must be called with 1");
});

test("isDirectInvocation is true only when argv[1] is this module", () => {
  const moduleUrl = "file:///repo/scripts/run-browser-suites.js";
  assert.equal(
    isDirectInvocation({ argv1: "/repo/scripts/run-browser-suites.js", moduleUrl }),
    true,
    "a matching argv[1] must be a direct invocation"
  );
  assert.equal(
    isDirectInvocation({ argv1: "/repo/test/other.test.js", moduleUrl }),
    false,
    "a different argv[1] must not be a direct invocation"
  );
  assert.equal(
    isDirectInvocation({ argv1: undefined, moduleUrl }),
    false,
    "a missing argv[1] must not be a direct invocation"
  );
});

test("canonicalPath resolves a symlinked path to its real target", async () => {
  // macOS exposes the same temporary directory through both `/var` and
  // `/private/var`; a symlink reproduces that aliasing deterministically on
  // every platform.
  const scratch = await mkdtemp(join(tmpdir(), "browser-canonical-"));
  try {
    const real = join(scratch, "real.js");
    const link = join(scratch, "link.js");
    await writeFile(real, "// real\n");
    await symlink(real, link);
    assert.equal(canonicalPath(link), canonicalPath(real), "a symlink must canonicalize to its target");
    // The canonical form is the fully resolved path, which on macOS differs
    // from the `/var` spelling the scratch directory was created under.
    assert.equal(canonicalPath(real), await realpath(real), "a real path must resolve to its canonical form");
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("canonicalPath returns a nonexistent path unchanged", () => {
  const missing = join(tmpdir(), "browser-canonical-missing-does-not-exist.js");
  assert.equal(canonicalPath(missing), missing, "a missing path must be returned unchanged");
});

test("isDirectInvocation recognizes a symlinked invocation path", async () => {
  // Regression: on macOS the scratch directory is reached through `/var` while
  // Node resolves `import.meta.url` to `/private/var`, so the raw string
  // comparison failed and the CLI never ran (exit 0 instead of a clear
  // failure). A symlinked argv[1] must still be recognized as this module.
  const scratch = await mkdtemp(join(tmpdir(), "browser-symlink-"));
  try {
    const real = join(scratch, "run-browser-suites.js");
    const link = join(scratch, "linked-runner.js");
    await writeFile(real, "// runner\n");
    await symlink(real, link);
    const moduleUrl = new URL(`file://${real}`).href;
    assert.equal(
      isDirectInvocation({ argv1: link, moduleUrl }),
      true,
      "a symlinked argv[1] pointing at this module must be a direct invocation"
    );
    assert.equal(
      isDirectInvocation({ argv1: join(scratch, "other.js"), moduleUrl }),
      false,
      "a different symlinked path must not be a direct invocation"
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("bootstrap runs the CLI only on a direct invocation", () => {
  let cliCalls = 0;
  const cli = () => { cliCalls += 1; };
  bootstrap({ isDirect: () => true, cli });
  assert.equal(cliCalls, 1, "a direct invocation must run the CLI");
  bootstrap({ isDirect: () => false, cli });
  assert.equal(cliCalls, 1, "an import must not run the CLI");
});

test("main reads package.json from the given root and exits with the run status", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "browser-main-"));
  try {
    await writeFile(
      join(scratch, "package.json"),
      JSON.stringify({ scripts: { "test:browser": "x", "test:alpha:browser": "node a.js" } })
    );
    let receivedPkg = null;
    const exits = [];
    await main({
      root: scratch,
      runFn: async ({ pkg }) => {
        receivedPkg = pkg;
        return 0;
      },
      exit: code => exits.push(code)
    });
    assert.ok(receivedPkg, "main must pass the parsed package.json to the run");
    assert.ok(receivedPkg.scripts["test:alpha:browser"], "the parsed scripts must be present");
    assert.deepEqual(exits, [0], "main must exit with the run status");
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("main uses the default exit when none is injected", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "browser-main-default-"));
  const original = process.exit;
  const seen = [];
  process.exit = code => { seen.push(code); };
  try {
    await writeFile(
      join(scratch, "package.json"),
      JSON.stringify({ scripts: { "test:browser": "x" } })
    );
    await main({ root: scratch, runFn: async () => 0 });
  } finally {
    process.exit = original;
    await rm(scratch, { recursive: true, force: true });
  }
  assert.deepEqual(seen, [0], "the default exit must be called with the run status");
});

// --- CLI -------------------------------------------------------------------

test("the CLI exits nonzero when no browser suites are configured", async () => {
  // Run the real CLI in a scratch directory whose package.json has no
  // test:*:browser scripts. It must fail fast without starting a server.
  const scratch = await mkdtemp(join(tmpdir(), "browser-cli-"));
  try {
    await mkdir(join(scratch, "scripts", "lib"), { recursive: true });
    await writeFile(
      join(scratch, "scripts", "run-browser-suites.js"),
      await readFile(runnerPath, "utf8")
    );
    // The runner imports its shared timing helper from scripts/lib, so the
    // scratch copy must include it for the module graph to resolve.
    await writeFile(
      join(scratch, "scripts", "lib", "browser-timing.js"),
      await readFile(join(root, "scripts", "lib", "browser-timing.js"), "utf8")
    );
    await writeFile(
      join(scratch, "package.json"),
      JSON.stringify({ scripts: { "test:browser": "node scripts/run-browser-suites.js" } })
    );
    const result = spawnSync("node", [join(scratch, "scripts", "run-browser-suites.js")], {
      cwd: scratch,
      encoding: "utf8"
    });
    assert.notEqual(result.status, 0, "the CLI must fail when no suites are configured");
    assert.match(result.stderr, /no test:\*:browser suites/);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

// --- Package wiring --------------------------------------------------------

test("npm run test:browser invokes the aggregate runner", async () => {
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.equal(pkg.scripts["test:browser"], "node scripts/run-browser-suites.js");
});

test("every standalone browser script is exposed and included or documented", async () => {
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const scriptsDir = join(root, "scripts");
  const entries = await readdir(scriptsDir);
  const browserScripts = entries.filter(
    name => /browser.*\.js$/.test(name) && name !== "run-browser-suites.js"
  );
  const exposed = new Set(
    Object.values(pkg.scripts)
      .map(cmd => (cmd.match(/scripts\/([\w-]+\.js)/) || [])[1])
      .filter(Boolean)
  );
  for (const script of browserScripts) {
    assert.ok(
      exposed.has(script),
      `standalone browser script must be exposed through a package script: ${script}`
    );
  }
});

test("the runner is Node standard library only and does not add an orchestration dependency", async () => {
  const source = await readFile(runnerPath, "utf8");
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  // No third-party orchestration imports. Local relative imports (its own
  // scripts/lib helpers) are allowed; bare package specifiers are not.
  assert.doesNotMatch(source, /from\s+["'](?!node:|\.)[^"']+["']/, "the runner must import only node: builtins and local helpers");
  // No new runtime dependency was added for orchestration.
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const name of ["concurrently", "npm-run-all", "wait-on", "start-server-and-test"]) {
    assert.ok(!(name in deps), `the runner must not add the ${name} dependency`);
  }
});

// Strip line and block comments so negative assertions test executable code,
// not explanatory prose that may legitimately mention a forbidden token.
function codeOnly(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter(line => !line.trimStart().startsWith("//"))
    .join("\n");
}

test("the runner never uses broad process-killing commands", async () => {
  const source = codeOnly(await readFile(runnerPath, "utf8"));
  assert.doesNotMatch(source, /pkill/, "the runner must not use pkill");
  assert.doesNotMatch(source, /killall/, "the runner must not use killall");
  assert.doesNotMatch(source, /lsof\s+-ti/, "the runner must not kill by port");
});

test("the runner uses port 8765 and loopback binding, never 8080", async () => {
  const source = codeOnly(await readFile(runnerPath, "utf8"));
  assert.match(source, /8765/, "the runner must use port 8765");
  assert.match(source, /127\.0\.0\.1/, "the runner must bind loopback");
  assert.doesNotMatch(source, /8080/, "the runner must not use port 8080");
});

test("the runner serves the repository root", async () => {
  const source = await readFile(runnerPath, "utf8");
  assert.match(source, /http\.server/, "the runner must start python3 -m http.server");
  assert.match(source, /cwd/, "the server must run from the repository root");
});

// --- No leftover artifacts -------------------------------------------------

test("the runner leaves no temporary artifact from the harness", async () => {
  // The runner itself writes nothing to disk; assert it does not create files.
  const source = await readFile(runnerPath, "utf8");
  assert.doesNotMatch(source, /writeFile|mkdtemp|createWriteStream/, "the runner must not write files");
});

// --- Real package.json sanity ----------------------------------------------

test("the real package.json has no recursive aggregate definition", async () => {
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  // The aggregate must not invoke itself.
  assert.doesNotMatch(pkg.scripts["test:browser"], /test:browser/, "the aggregate must not recurse");
  // No test:*:browser script may invoke the aggregate runner.
  for (const [name, cmd] of Object.entries(pkg.scripts)) {
    if (/^test:.*:browser$/.test(name)) {
      assert.doesNotMatch(cmd, /run-browser-suites/, `${name} must not invoke the aggregate runner`);
    }
  }
});
