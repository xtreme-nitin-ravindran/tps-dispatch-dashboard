import test from 'node:test';
import assert from 'node:assert/strict';
import { healthSnapshot, coerceStatus, HEALTH_STATUSES } from '../src/ttc/health.js';

test('[STORY-64] health status vocabulary is the three-value set', () => {
  assert.deepEqual(HEALTH_STATUSES, ['ok', 'degraded', 'unavailable']);
});

test('[STORY-64] coerceStatus passes ok/degraded through and degrades anything else', () => {
  assert.equal(coerceStatus('ok'), 'ok');
  assert.equal(coerceStatus('degraded'), 'degraded');
  assert.equal(coerceStatus('unavailable'), 'unavailable');
  assert.equal(coerceStatus('weird'), 'unavailable');
  assert.equal(coerceStatus(undefined), 'unavailable');
  assert.equal(coerceStatus(null), 'unavailable');
});

test('[STORY-64] healthSnapshot reports capture, processing and publication independently', () => {
  const health = healthSnapshot({
    collector: { status: 'ok', polls: 120, lastOutcome: 'ok' },
    processor: { status: 'ok', cursor: 119, processed: 120 },
    spool: { depth: 0 },
    r2: { status: 'ok', endpoint: 'https://example' }
  });
  assert.deepEqual(health.capture, { status: 'ok', polls: 120, lastOutcome: 'ok', spoolDepth: 0 });
  assert.deepEqual(health.processing, { status: 'ok', cursor: 119, processed: 120 });
  assert.deepEqual(health.publication, { status: 'ok', endpoint: 'https://example' });
});

test('[STORY-64] a degraded capture does not conceal a healthy processor or publication', () => {
  const health = healthSnapshot({
    collector: { status: 'degraded', polls: 3, lastOutcome: 'unavailable' },
    processor: { status: 'ok', cursor: 5, processed: 6 },
    spool: { depth: 0 },
    r2: { status: 'ok' }
  });
  assert.equal(health.capture.status, 'degraded');
  assert.equal(health.processing.status, 'ok');
  assert.equal(health.publication.status, 'ok');
});

test('[STORY-64] a failed publication is reported independently of healthy capture and processing', () => {
  const health = healthSnapshot({
    collector: { status: 'ok', polls: 10 },
    processor: { status: 'ok', cursor: 9 },
    spool: { depth: 0 },
    r2: { status: 'unavailable', lastError: 'R2 write failed' }
  });
  assert.equal(health.capture.status, 'ok');
  assert.equal(health.processing.status, 'ok');
  assert.equal(health.publication.status, 'unavailable');
  assert.equal(health.publication.lastError, 'R2 write failed');
});

test('[STORY-64] a non-empty spool degrades an otherwise-ok capture report only', () => {
  const health = healthSnapshot({
    collector: { status: 'ok', polls: 10 },
    processor: { status: 'ok', cursor: 9 },
    spool: { depth: 3 },
    r2: { status: 'ok' }
  });
  // Spool saturation degrades capture, never the independent concerns.
  assert.equal(health.capture.status, 'degraded');
  assert.equal(health.capture.spoolDepth, 3);
  assert.equal(health.processing.status, 'ok');
  assert.equal(health.publication.status, 'ok');
});

test('[STORY-64] a non-empty spool does not erase an already-degraded capture status', () => {
  const health = healthSnapshot({
    collector: { status: 'degraded', polls: 1 },
    processor: { status: 'ok' },
    spool: { depth: 5 },
    r2: { status: 'ok' }
  });
  assert.equal(health.capture.status, 'degraded');
  assert.equal(health.capture.spoolDepth, 5);
});

test('[STORY-64] missing or non-object components degrade to unavailable without throwing', () => {
  const health = healthSnapshot({});
  assert.deepEqual(health.capture, { status: 'unavailable' });
  assert.deepEqual(health.processing, { status: 'unavailable' });
  assert.deepEqual(health.publication, { status: 'unavailable' });
});
