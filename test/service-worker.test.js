import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const source = await readFile(new URL("service-worker.js", root), "utf8");

function loadWorker({ cachedResponse = { source: "cache" }, networkResponse = { source: "network" }, windowClients = [] } = {}) {
  const listeners = {};
  const calls = { added: [], deleted: [], fetched: [], matched: [], notifications: [], opened: [] };
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
      registration: {
        scope: "https://example.test/sirento/",
        async showNotification(title, options) { calls.notifications.push({ title, options }); }
      },
      location: { origin: "https://example.test" },
      clients: {
        claim: () => Promise.resolve(),
        matchAll: async () => windowClients,
        openWindow: async url => { calls.opened.push(url); }
      },
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
  assert.ok(calls.added.includes("./src/disruptions/ttc-nearby-fixture.js"));
  assert.ok(calls.added.includes("./src/disruptions/ttc-stops.js"));
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

test("valid versioned push payload renders a concise user-visible notification", async () => {
  const { listeners, calls } = loadWorker();
  let work;
  listeners.push({
    data: { json: () => ({
      schema: "sirento.push", version: 1,
      incident: {
        id: "TFS-123", title: "Nearby fire call", body: "A new incident matched your watch.",
        url: "https://example.test/sirento/?view=1&incident=TFS-123"
      }
    }) },
    waitUntil(value) { work = value; }
  });
  assert.equal(await work, true);
  assert.equal(calls.notifications.length, 1);
  assert.equal(calls.notifications[0].title, "Nearby fire call");
  assert.deepEqual(Object.keys(calls.notifications[0].options.data), ["url", "incidentId"]);
});

test("malformed, cross-origin, and coordinate-only push payloads are ignored", async () => {
  for (const value of [
    () => { throw new Error("bad json"); },
    () => ({ schema: "sirento.push", version: 1, incident: { id: "1", title: "Title", body: "Body", url: "https://evil.test/?incident=1" } }),
    () => ({ latitude: 43.65, longitude: -79.38 })
  ]) {
    const { listeners, calls } = loadWorker();
    let work;
    listeners.push({ data: { json: value }, waitUntil(result) { work = result; } });
    assert.equal(await work, false);
    assert.equal(calls.notifications.length, 0);
  }
});

test("notification click focuses and navigates an existing SirenTO client", async () => {
  const events = [];
  const existing = {
    url: "https://example.test/sirento/",
    async navigate(url) { events.push(`navigate:${url}`); return this; },
    async focus() { events.push("focus"); }
  };
  const worker = loadWorker({ windowClients: [existing] });
  let work;
  const url = "https://example.test/sirento/?view=1&incident=TFS-2";
  worker.listeners.notificationclick({
    notification: {
      data: { url, incidentId: "TFS-2" },
      close() { events.push("close"); }
    },
    waitUntil(value) { work = value; }
  });
  assert.equal(await work, true);
  assert.deepEqual(events, ["close", `navigate:${url}`, "focus"]);
  assert.equal(worker.calls.opened.length, 0);
});

test("notification click opens the canonical incident URL when no client exists", async () => {
  const { listeners, calls } = loadWorker();
  let work;
  let closed = false;
  const url = "https://example.test/sirento/?view=1&incident=TPS-9";
  listeners.notificationclick({
    notification: { data: { url, incidentId: "TPS-9" }, close() { closed = true; } },
    waitUntil(value) { work = value; }
  });
  assert.equal(await work, true);
  assert.equal(closed, true);
  assert.deepEqual(calls.opened, [url]);
});

test("notification click reselects an incident in an already canonical client without a duplicate window", async () => {
  const events = [];
  const url = "https://example.test/sirento/?view=1&incident=TFS-2";
  const existing = {
    url,
    postMessage(message) { events.push(message); },
    async focus() { events.push("focus"); }
  };
  const worker = loadWorker({ windowClients: [existing] });
  let work;
  worker.listeners.notificationclick({
    notification: { data: { url, incidentId: "TFS-2" }, close() { events.push("close"); } },
    waitUntil(value) { work = value; }
  });
  assert.equal(await work, true);
  assert.deepEqual(JSON.parse(JSON.stringify(events)), ["close", {
    type: "sirento.notification.navigate", url, incidentId: "TFS-2"
  }, "focus"]);
  assert.deepEqual(worker.calls.opened, []);
});

test("notification click closes but rejects malformed and non-allowlisted destinations", async () => {
  for (const data of [
    { url: "https://evil.test/?view=1&incident=x", incidentId: "x" },
    { url: "https://example.test/sirento/?view=1&incident=x&token=private", incidentId: "x" },
    { url: "https://example.test/sirento/?view=1&incident=x", incidentId: "different" }
  ]) {
    const worker = loadWorker();
    let work;
    let closed = false;
    worker.listeners.notificationclick({
      notification: { data, close() { closed = true; } }, waitUntil(value) { work = value; }
    });
    assert.equal(await work, false);
    assert.equal(closed, true);
    assert.deepEqual(worker.calls.opened, []);
  }
});
