const CACHE_VERSION = "sirento-shell-v21";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./favicon.png",
  "./icon-192.png",
  "./icon-512.png",
  "./brand-dog.jpg",
  "./brand-doberman.jpg",
  "./data/police-divisions.geojson",
  "./src/call-presentation.js",
  "./src/cta-copy.js",
  "./src/dispatch-glossary.js",
  "./src/disruptions/source.js",
  "./src/disruptions/ttc-nearby-fixture.js",
  "./src/mobile-audit-fixture.js",
  "./src/disruptions/ui.js",
  "./src/disruptions/view.js",
  "./src/disruptions/ttc-stops.js",
  "./src/incident-badge.js",
  "./src/incident-search.js",
  "./src/incident-selection.js",
  "./src/incident-layer-diff.js",
  "./src/location-display.js",
  "./src/map-clusters.js",
  "./src/marker-age.js",
  "./src/mobile-bottom-sheet.js",
  "./src/mobile-nearby-summary.js",
  "./src/nearby-empty-state.js",
  "./src/nearby-sort.js",
  "./src/nearby-summary.js",
  "./src/nearby.js",
  "./src/offline-status.js",
  "./src/postal-lookup.js",
  "./src/refresh-freshness.js",
  "./src/saved-locations.js",
  "./src/siren-matches.js",
  "./src/source-status.js",
  "./src/theme.js",
  "./src/tfs/category.js",
  "./src/tfs/time.js",
  "./src/tps/unit-label.js",
  "./src/view-controls.js",
  "./src/watch-config.js",
  "./src/watch-matcher.js",
  "./src/push-subscription.js"
];

const shellUrls = new Set(APP_SHELL.map(asset => new URL(asset, self.registration.scope).pathname));

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_VERSION).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => key.startsWith("sirento-shell-") && key !== CACHE_VERSION)
        .map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("./index.html")));
    return;
  }

  if (!shellUrls.has(url.pathname)) return;
  event.respondWith(caches.match(request, { ignoreSearch: true }).then(cached => cached || fetch(request)));
});

function canonicalIncidentUrl(value, expectedIncidentId = null) {
  try {
    const scope = new URL(self.registration.scope);
    const destination = new URL(value, scope);
    const incidentId = destination.searchParams.get("incident");
    const keys = [...destination.searchParams.keys()];
    if (destination.origin !== scope.origin || destination.pathname !== scope.pathname || destination.hash ||
      destination.searchParams.get("view") !== "1" || keys.length !== 2 ||
      !keys.includes("view") || !keys.includes("incident") ||
      !incidentId || incidentId.length > 300 || (expectedIncidentId !== null && incidentId !== expectedIncidentId)) return null;
    const canonical = new URL(scope.href);
    canonical.searchParams.set("view", "1");
    canonical.searchParams.set("incident", incidentId);
    return canonical.href;
  } catch {
    return null;
  }
}

function validPushPayload(value) {
  if (!value || value.schema !== "sirento.push" || value.version !== 1 || !value.incident) return null;
  const { id, title, body, url } = value.incident;
  const destination = canonicalIncidentUrl(url, id);
  if (typeof id !== "string" || !id || id.length > 300 || typeof title !== "string" || !title.trim() ||
    title.length > 80 || typeof body !== "string" || !body.trim() || body.length > 180 || !destination) return null;
  return { id, title: title.trim(), body: body.trim(), url: destination };
}

async function renderPushNotification(data) {
  let payload;
  try {
    payload = validPushPayload(data?.json());
  } catch {
    return false;
  }
  if (!payload) return false;
  await self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: "./icon-192.png",
    badge: "./favicon.png",
    tag: `sirento-incident-${payload.id}`,
    data: { url: payload.url, incidentId: payload.id }
  });
  return true;
}

async function openNotificationDestination(notification) {
  const incidentId = notification?.data?.incidentId;
  const destination = typeof incidentId === "string"
    ? canonicalIncidentUrl(notification?.data?.url, incidentId)
    : null;
  notification?.close();
  if (!destination) return false;
  const scope = new URL(self.registration.scope);
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const eligible = windows.filter(client => {
    try {
      const url = new URL(client.url);
      return url.origin === scope.origin && url.pathname === scope.pathname;
    } catch {
      return false;
    }
  });
  const existing = eligible.find(client => client.url === destination) || eligible[0];
  if (existing) {
    if (existing.url === destination) {
      existing.postMessage?.({ type: "sirento.notification.navigate", url: destination, incidentId });
      await existing.focus();
      return true;
    }
    const navigated = typeof existing.navigate !== "function" ? existing : await existing.navigate(destination);
    await (navigated || existing).focus();
    return true;
  }
  await self.clients.openWindow(destination);
  return true;
}

self.addEventListener("push", event => {
  event.waitUntil(renderPushNotification(event.data));
});

self.addEventListener("notificationclick", event => {
  event.waitUntil(openNotificationDestination(event.notification));
});

self.addEventListener("pushsubscriptionchange", event => {
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true })
    .then(windows => Promise.all(windows.map(client => client.postMessage({ type: "sirento.pushsubscriptionchange" })))));
});

self.addEventListener("message", event => {
  const hostname = new URL(self.registration.scope).hostname;
  if (!new Set(["localhost", "127.0.0.1", "::1"]).has(hostname) || event.data?.type !== "sirento.fixture.push") return;
  const fixture = event.data.fixture;
  const fixtureIncidentId = event.data.arrival === "missing" ? "fixture-expired-incident" : "fixture-incident-1";
  const definitions = {
    "new-tfs": [fixtureIncidentId, "SirenTO — New incident nearby", "Residential Fire Alarm · 0.8 km away · Toronto Fire Services"],
    "new-tps": [fixtureIncidentId, "SirenTO — New incident nearby", "Robbery · 0.8 km away · Toronto Police Service"],
    "update": [fixtureIncidentId, "SirenTO — Incident update nearby", "Residential Fire Alarm · 0.8 km away · Toronto Fire Services"],
    "no-distance": [fixtureIncidentId, "SirenTO — New incident nearby", "Residential Fire Alarm · Toronto Fire Services"]
  };
  const definition = definitions[fixture] || definitions[fixture === "sample" ? "new-tfs" : ""];
  const payload = definition ? {
    schema: "sirento.push", version: 1,
    incident: {
      id: definition[0], title: definition[1], body: definition[2],
      url: new URL(`?view=1&incident=${definition[0]}`, self.registration.scope).href
    }
  } : fixture === "external" ? {
    schema: "sirento.push", version: 1,
    incident: { id: "fixture-incident-1", title: "Rejected", body: "Rejected", url: "https://example.invalid/?view=1&incident=fixture-incident-1" }
  } : { malformed: true };
  event.waitUntil(renderPushNotification({ json: () => payload }));
});
