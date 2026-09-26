import test from "node:test";
import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";

const root = new URL("../", import.meta.url);
const html = await readFile(new URL("index.html", root), "utf8");
const manifest = JSON.parse(await readFile(new URL("manifest.webmanifest", root), "utf8"));

test("web app manifest contains SirenTO install metadata", () => {
  assert.equal(manifest.name, "SirenTO");
  assert.equal(manifest.short_name, "SirenTO");
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.display, "standalone");
  assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);
  assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i);
  assert.deepEqual(manifest.icons.map(({ sizes }) => sizes), ["192x192", "512x512"]);
});

test("manifest and declared icons are served as static app assets", async (t) => {
  const server = createServer(async (request, response) => {
    const assets = {
      "/manifest.webmanifest": ["manifest.webmanifest", "application/manifest+json"],
      "/icon-192.png": ["icon-192.png", "image/png"],
      "/icon-512.png": ["icon-512.png", "image/png"]
    };
    const asset = assets[request.url];
    if (!asset) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader("content-type", asset[1]);
    createReadStream(new URL(asset[0], root)).pipe(response);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/manifest.webmanifest`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /application\/manifest\+json/);
  assert.equal((await response.json()).name, "SirenTO");

  const missing = await fetch(`http://127.0.0.1:${address.port}/missing`);
  assert.equal(missing.status, 404);

  for (const icon of manifest.icons) {
    const iconPath = new URL(icon.src, new URL("manifest.webmanifest", root));
    assert.ok((await stat(iconPath)).size > 0);
  }
});

test("app shell links install metadata without changing its entry behavior", () => {
  assert.match(html, /<link rel="manifest" href="\.\/manifest\.webmanifest" \/>/);
  assert.match(html, /<link rel="apple-touch-icon" sizes="192x192" href="\.\/icon-192\.png" \/>/);
  assert.match(html, /<meta name="apple-mobile-web-app-title" content="SirenTO" \/>/);
  assert.match(html, /<main>/);
  assert.match(html, /<section class="map-stage" id="mapView">/);
  assert.match(html, /<script type="module" src="\.\/app\.js\?v=mobile-pre-map-2"><\/script>/);
  assert.match(html, /"serviceWorker" in navigator/);
  assert.match(html, /navigator\.serviceWorker\.register\("\.\/service-worker\.js"\)/);
});
