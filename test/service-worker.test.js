import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const source = await readFile(new URL("service-worker.js", root), "utf8");

function loadWorker({ cachedResponse = { source: "cache" }, networkResponse = { source: "network" } } = {}) {
  const listeners = {};
  const calls = { added: [], deleted: [], fetched: [], matched: [] };
  const cache = {
    addAll(assets) {
      calls.added.push(...assets);
      return Promise.resolve();
    }
  };
  const context = {
    URL,
    Set,
    Promise,
    self: {
      registration: { scope: "https://example.test/sirento/" },
      location: { origin: "https://example.test" },
      clients: { claim: () => Promise.resolve() },
      addEventListener(type, listener) { listeners[type] = listener; },
      skipWaiting() {}
    },
    caches: {
      open: async () => cache,
      keys: async () => ["sirento-shell-old", "unrelated-cache"],
      delete: async key => { calls.deleted.push(key); },
      match: async (request, options) => {
        calls.matched.push({ request, options });
        return cachedResponse;
      }
    },
    fetch: async request => {
      calls.fetched.push(request);
      return networkResponse;
    }
  };
  vm.runInNewContext(source, context);
  return { listeners, calls };
}

function fetchEvent(url, { mode = "cors", method = "GET" } = {}) {
  let response;
  return {
    event: {
      request: { url, mode, method },
      respondWith(value) { response = value; }
    },
    response: () => response
  };
}

test("worker precaches the static app shell without live incident data", async () => {
  const { listeners, calls } = loadWorker();
  let installation;
  listeners.install({ waitUntil(value) { installation = value; } });
  await installation;

  assert.ok(calls.added.includes("./index.html"));
  assert.ok(calls.added.includes("./styles.css"));
  assert.ok(calls.added.includes("./app.js"));
  assert.ok(calls.added.includes("./icon-192.png"));
  assert.ok(calls.added.includes("./src/disruptions/ui.js"));
  assert.ok(!calls.added.some(asset => asset.includes("current.json")));
});

test("worker ignores live API and incident snapshot requests", () => {
  const { listeners, calls } = loadWorker();
  const liveUrls = [
    "https://raw.githubusercontent.com/example/data/current.json?ts=1",
    "https://services.arcgis.com/example/FeatureServer/0/query",
    "https://www.toronto.ca/data/fire/livecad.xml",
    "https://gtfsrt.ttc.ca/alerts/all",
    "https://secure.toronto.ca/opendata/cart/road_restrictions/v3?format=json"
  ];

  for (const url of liveUrls) {
    const request = fetchEvent(url);
    listeners.fetch(request.event);
    assert.equal(request.response(), undefined);
  }
  assert.deepEqual(calls.matched, []);
  assert.deepEqual(calls.fetched, []);
});

test("worker serves listed assets from cache and leaves other online requests alone", async () => {
  const { listeners, calls } = loadWorker();
  const asset = fetchEvent("https://example.test/sirento/app.js?v=deploy-2");
  listeners.fetch(asset.event);
  assert.deepEqual(await asset.response(), { source: "cache" });
  assert.equal(calls.matched[0].options.ignoreSearch, true);

  const ordinaryRequest = fetchEvent("https://example.test/sirento/data/current.json");
  listeners.fetch(ordinaryRequest.event);
  assert.equal(ordinaryRequest.response(), undefined);
});

test("navigations remain network-first and fall back to the cached shell", async () => {
  const online = loadWorker();
  const onlineNavigation = fetchEvent("https://example.test/sirento/", { mode: "navigate" });
  online.listeners.fetch(onlineNavigation.event);
  assert.deepEqual(await onlineNavigation.response(), { source: "network" });

  const navigation = fetchEvent("https://example.test/sirento/call/123", { mode: "navigate" });
  // A rejected network request exercises the installed app's shell fallback.
  const rejected = loadWorker({ networkResponse: Promise.reject(new Error("offline")) });
  rejected.listeners.fetch(navigation.event);
  assert.deepEqual(await navigation.response(), { source: "cache" });
});

test("activation removes old SirenTO shell versions only", async () => {
  const { listeners, calls } = loadWorker();
  let activation;
  listeners.activate({ waitUntil(value) { activation = value; } });
  await activation;
  assert.deepEqual(calls.deleted, ["sirento-shell-old"]);
});
