const CACHE_VERSION = "sirento-shell-v3";
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
  "./src/disruptions/ui.js",
  "./src/disruptions/view.js",
  "./src/incident-badge.js",
  "./src/incident-search.js",
  "./src/incident-selection.js",
  "./src/incident-layer-diff.js",
  "./src/location-display.js",
  "./src/map-clusters.js",
  "./src/marker-age.js",
  "./src/mobile-bottom-sheet.js",
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
  "./src/view-controls.js"
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
