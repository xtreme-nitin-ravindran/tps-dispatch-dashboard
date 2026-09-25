import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { offlineStatus } from '../src/offline-status.js';

test('offline state displays a live-data warning', () => {
  assert.deepEqual(offlineStatus({ online: false }), {
    hidden: false,
    text: "You’re offline. Live incident data is unavailable."
  });
});

test('offline state marks previously loaded incident data as potentially stale', () => {
  const status = offlineStatus({ online: false, hasPreviouslyLoadedData: true });
  assert.match(status.text, /Previously loaded incident data remains visible and may be stale\./);
  assert.doesNotMatch(status.text, /active/);
});

test('offline state preserves the last successful update when available', () => {
  const status = offlineStatus({
    online: false,
    hasPreviouslyLoadedData: true,
    lastSuccessfulUpdate: 'Sep 24 · 14:05 Toronto time'
  });
  assert.match(status.text, /Last successful update: Sep 24 · 14:05 Toronto time\./);
});

test('online state removes the offline warning and leaves live behavior unchanged', () => {
  assert.deepEqual(offlineStatus({
    online: true,
    hasPreviouslyLoadedData: true,
    lastSuccessfulUpdate: 'Sep 24 · 14:05 Toronto time'
  }), { hidden: true, text: '' });
});

test('app reacts to connectivity changes and exposes one shared responsive warning', async () => {
  const [app, html, css] = await Promise.all([
    readFile(new URL('../app.js', import.meta.url), 'utf8'),
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../styles.css', import.meta.url), 'utf8')
  ]);
  assert.match(app, /window\.addEventListener\('offline',[\s\S]*renderOfflineStatus\(\)[\s\S]*render\(\)/);
  assert.match(app, /window\.addEventListener\('online',[\s\S]*renderOfflineStatus\(\)/);
  assert.match(app, /navigator\.onLine \? callStatus\(call\) : null/);
  assert.equal(html.match(/id="offlineStatus"/g).length, 1);
  assert.match(css, /\.offline-status\s*\{/);
});
