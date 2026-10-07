import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [app, html, worker] = await Promise.all([
  readFile(new URL('../app.js', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../service-worker.js', import.meta.url), 'utf8')
]);

test('Story 39A app and cluster module asset versions cannot drift backwards', () => {
  assert.match(html, /app\.js\?v=story-55d-1/);
  assert.match(app, /map-clusters\.js\?v=story-39a-1/);
  assert.match(worker, /CACHE_VERSION = "sirento-shell-v58"/);
  assert.match(worker, /"\.\/app\.js"/);
  assert.match(worker, /"\.\/src\/map-clusters\.js"/);
  assert.match(worker, /key\.startsWith\("sirento-shell-"\) && key !== CACHE_VERSION/);
});
