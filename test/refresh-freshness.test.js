import test from 'node:test';
import assert from 'node:assert/strict';
import { createRefreshFreshnessTracker } from '../src/refresh-freshness.js';

function trackerHarness(start = 1_000_000) {
  let current = start;
  let tick;
  let cancelled;
  const labels = [];
  const tracker = createRefreshFreshnessTracker({
    now: () => current,
    onChange: label => labels.push(label),
    schedule: callback => { tick = callback; return 1; },
    cancel: timer => { cancelled = timer; }
  });
  return {
    tracker,
    latest: () => labels.at(-1),
    tick: () => tick(),
    cancelled: () => cancelled,
    advance(ms) { current += ms; tick(); }
  };
}

test('freshness stays hidden before success and stops its timer on cleanup', () => {
  const harness = trackerHarness();
  harness.tick();
  assert.equal(harness.latest(), '');
  harness.tracker.destroy();
  assert.equal(harness.cancelled(), 1);
});

test('successful refresh records its completion time', () => {
  const harness = trackerHarness();
  harness.tracker.complete(true);
  assert.equal(harness.tracker.lastSuccessfulAt, 1_000_000);
  assert.equal(harness.latest(), 'Updated just now');
});

test('freshness progresses without another refresh request', () => {
  const harness = trackerHarness();
  harness.tracker.complete(true);
  harness.advance(18_000);
  assert.equal(harness.latest(), 'Updated 18 sec ago');
  harness.advance(42_000);
  assert.equal(harness.latest(), 'Updated 1 min ago');
});

test('a later successful refresh resets freshness', () => {
  const harness = trackerHarness();
  harness.tracker.complete(true);
  harness.advance(18_000);
  harness.tracker.complete(true);
  assert.equal(harness.tracker.lastSuccessfulAt, 1_018_000);
  assert.equal(harness.latest(), 'Updated just now');
});

test('a failed refresh preserves the previous successful timestamp', () => {
  const harness = trackerHarness();
  harness.tracker.complete(true);
  harness.advance(18_000);
  harness.tracker.complete(false);
  assert.equal(harness.tracker.lastSuccessfulAt, 1_000_000);
  assert.equal(harness.latest(), 'Updated 18 sec ago');
});
