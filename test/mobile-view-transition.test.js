import test from 'node:test';
import assert from 'node:assert/strict';
import { createViewTransitionScheduler } from '../src/mobile-view-transition.js';

function frameHarness() {
  let nextId = 1;
  const frames = new Map();
  return {
    request(callback) {
      const id = nextId++;
      frames.set(id, callback);
      return id;
    },
    cancel(id) {
      frames.delete(id);
    },
    flush() {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach(callback => callback());
    },
    size() {
      return frames.size;
    }
  };
}

test('maintenance runs only after a frame has been available to paint', () => {
  const frames = frameHarness();
  const scheduler = createViewTransitionScheduler({
    requestFrame: frames.request,
    cancelFrame: frames.cancel
  });
  const completed = [];

  scheduler.schedule(({ generation }) => completed.push(generation));
  assert.equal(scheduler.pending(), true);
  frames.flush();
  assert.deepEqual(completed, []);
  frames.flush();
  assert.deepEqual(completed, [1]);
  assert.equal(scheduler.pending(), false);
});

test('rapid toggles cancel stale jobs and run only final maintenance', () => {
  const frames = frameHarness();
  const scheduler = createViewTransitionScheduler({
    requestFrame: frames.request,
    cancelFrame: frames.cancel
  });
  const completed = [];
  const record = value => () => completed.push(value);

  scheduler.schedule(record('calls'));
  frames.flush();
  scheduler.schedule(record('map'));
  scheduler.schedule(record('calls-final'));
  assert.equal(frames.size(), 1);
  frames.flush();
  frames.flush();

  assert.deepEqual(completed, ['calls-final']);
  assert.equal(scheduler.generation(), 3);
});

test('explicit cancellation invalidates a job already waiting for maintenance', () => {
  const frames = frameHarness();
  const scheduler = createViewTransitionScheduler({
    requestFrame: frames.request,
    cancelFrame: frames.cancel
  });
  let completed = false;

  const complete = () => { completed = true; };
  scheduler.schedule(complete);
  frames.flush();
  scheduler.cancel();
  frames.flush();

  assert.equal(completed, false);
  assert.equal(scheduler.pending(), false);
  scheduler.schedule(complete);
  frames.flush();
  frames.flush();
  assert.equal(completed, true, 'the scheduler remains usable after cancellation');
});

test('generation guard rejects stale frames even when cancellation is unavailable', () => {
  const frames = frameHarness();
  const completed = [];
  const scheduler = createViewTransitionScheduler({
    requestFrame: frames.request,
    cancelFrame: undefined
  });
  const complete = ({generation}) => completed.push(generation);
  scheduler.schedule(complete);
  frames.flush();
  scheduler.schedule(complete);
  frames.flush();
  frames.flush();
  assert.deepEqual(completed, [2]);
});
