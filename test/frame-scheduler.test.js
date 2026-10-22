import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameScheduler } from '../src/frame-scheduler.js';

// [STORY-38D][STORY-38E] The consolidated frame scheduler carries the
// contracts of the two schedulers it replaced: the Story 38D view-transition
// double-RAF coalescer and the Story 38E police-boundary settle delay.

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

function controlledScheduler() {
  const frames = [];
  const timers = [];
  const canceledFrames = [];
  const canceledTimers = [];
  const scheduler = createFrameScheduler({
    requestFrame: callback => { frames.push(callback); return frames.length; },
    cancelFrame: id => canceledFrames.push(id),
    setTimer: callback => { timers.push(callback); return timers.length; },
    clearTimer: id => canceledTimers.push(id)
  });
  return { scheduler, frames, timers, canceledFrames, canceledTimers };
}

test('[STORY-38D] maintenance runs only after a frame has been available to paint', () => {
  const frames = frameHarness();
  const scheduler = createFrameScheduler({ requestFrame: frames.request, cancelFrame: frames.cancel });
  const completed = [];

  scheduler.afterPaint(generation => completed.push(generation));
  assert.equal(scheduler.pending(), true);
  frames.flush();
  assert.deepEqual(completed, []);
  frames.flush();
  assert.deepEqual(completed, [1]);
  assert.equal(scheduler.pending(), false);
});

test('[STORY-38D] rapid toggles cancel stale jobs and run only final maintenance', () => {
  const frames = frameHarness();
  const scheduler = createFrameScheduler({ requestFrame: frames.request, cancelFrame: frames.cancel });
  const completed = [];
  const record = value => () => completed.push(value);

  scheduler.afterPaint(record('calls'));
  frames.flush();
  scheduler.afterPaint(record('map'));
  scheduler.afterPaint(record('calls-final'));
  assert.equal(frames.size(), 1);
  frames.flush();
  frames.flush();

  assert.deepEqual(completed, ['calls-final']);
  assert.equal(scheduler.generation(), 3);
});

test('[STORY-38D] explicit cancellation invalidates a job already waiting for maintenance', () => {
  const frames = frameHarness();
  const scheduler = createFrameScheduler({ requestFrame: frames.request, cancelFrame: frames.cancel });
  let completed = false;

  const complete = () => { completed = true; };
  scheduler.afterPaint(complete);
  frames.flush();
  scheduler.cancel();
  frames.flush();

  assert.equal(completed, false);
  assert.equal(scheduler.pending(), false);
  scheduler.afterPaint(complete);
  frames.flush();
  frames.flush();
  assert.equal(completed, true, 'the scheduler remains usable after cancellation');
});

test('[STORY-38D] generation guard rejects stale frames even when cancellation is unavailable', () => {
  const frames = frameHarness();
  const completed = [];
  const scheduler = createFrameScheduler({ requestFrame: frames.request, cancelFrame: undefined });
  const complete = generation => completed.push(generation);
  scheduler.afterPaint(complete);
  frames.flush();
  scheduler.afterPaint(complete);
  frames.flush();
  frames.flush();
  assert.deepEqual(completed, [2]);
});

test('[STORY-38E] sheet transition work waits for settle and two paints', () => {
  const { scheduler, frames, timers } = controlledScheduler();
  let runs = 0;
  scheduler.afterLayoutTransition(() => { runs += 1; });
  assert.equal(scheduler.pending(), true);
  assert.equal(frames.length, 0);
  timers[0]();
  assert.equal(runs, 0);
  frames[0]();
  assert.equal(runs, 0);
  frames[1]();
  assert.equal(runs, 1);
  assert.equal(scheduler.pending(), false);
});

test('[STORY-38E] a rapid transition cancels stale redraw work', () => {
  const { scheduler, frames, timers, canceledTimers } = controlledScheduler();
  const runs = [];
  const record = state => runs.push(state);
  scheduler.afterLayoutTransition(record.bind(null, 'half'));
  scheduler.afterLayoutTransition(record.bind(null, 'collapsed'));
  assert.deepEqual(canceledTimers, [1]);
  timers[0]();
  assert.equal(frames.length, 1);
  frames[0]();
  frames[1]();
  assert.deepEqual(runs, []);
  timers[1]();
  frames[2]();
  frames[3]();
  assert.deepEqual(runs, ['collapsed']);
});

test('[STORY-38E] transition cancellation tolerates an unavailable clearTimer', () => {
  const frames = [];
  const timers = [];
  const scheduler = createFrameScheduler({
    requestFrame: callback => { frames.push(callback); return frames.length; },
    cancelFrame: () => {},
    setTimer: callback => { timers.push(callback); return timers.length; },
    clearTimer: undefined
  });
  scheduler.afterLayoutTransition(() => {});
  scheduler.cancel();
  assert.equal(scheduler.pending(), false);
});

test('[STORY-38E] a new after-paint redraw cancels the stale animation frame', () => {
  const { scheduler, frames, canceledFrames } = controlledScheduler();
  const runs = [];
  const record = state => runs.push(state);
  const firstGeneration = scheduler.afterPaint(record.bind(null, 'first'));
  const secondGeneration = scheduler.afterPaint(record.bind(null, 'second'));
  assert.equal(secondGeneration, firstGeneration + 1);
  assert.equal(scheduler.generation(), secondGeneration);
  assert.deepEqual(canceledFrames, [1]);
  assert.equal(scheduler.pending(), true);
  frames[1]();
  frames[2]();
  assert.deepEqual(runs, ['second']);
  assert.equal(scheduler.pending(), false);
});
