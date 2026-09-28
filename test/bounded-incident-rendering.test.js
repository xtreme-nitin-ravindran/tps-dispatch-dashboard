import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [app, css, worker] = await Promise.all([
  readFile(new URL('../app.js', import.meta.url), 'utf8'),
  readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../service-worker.js', import.meta.url), 'utf8')
]);

test('the incident list renders a bounded initial batch and explicit increments', () => {
  assert.match(app, /nextIncidentBatch\(sortedIncidentCalls, renderedIncidentCount\)/);
  assert.match(app, /appendIncidentLoadMoreControl\(list, batch\.remaining\)/);
  assert.match(app, /requestAnimationFrame\(\(\) => appendNextIncidentBatch\(list\)\)/);
  assert.match(app, /incident-list-initial-batch/);
  assert.match(app, /incident-list-next-batch/);
  assert.match(css, /\.incident-list-more button \{[\s\S]*?min-height: 44px/);
});

test('a selected incident outside the window is surfaced without duplicating it', () => {
  assert.match(app, /function surfaceSelectedIncident\(call\)/);
  assert.match(app, /if \(renderedIncidentIds\.has\(call\.id\)\) return/);
  assert.match(app, /row\.classList\.add\('incident-card--surfaced'\)/);
  assert.match(app, /surfaceSelectedIncident\(call\)/);
});

test('unchanged radius, sort, view, and filters return before expensive work', () => {
  assert.match(app, /if \(nextFilterKey === appliedIncidentFilterKey\) return false/);
  assert.match(app, /if \(nextSort === state\.nearbySort\) return/);
  assert.match(app, /if \(view === mobileView && view === presentedMobileView && mobile === presentedMobileLayout\) return/);
  assert.match(app, /if \(value === state\.radiusKm \|\| value === requestedRadiusKm\)/);
  assert.match(app, /if \(nextListKey === renderedIncidentListKey\) return/);
});

test('the progressive-render helper is available offline', () => {
  assert.match(worker, /\.\/src\/incident-list-window\.js/);
});
