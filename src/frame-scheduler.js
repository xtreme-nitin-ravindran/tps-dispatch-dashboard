// One coalescing frame scheduler for deferred map work.
//
// Consolidates the two near-identical double-RAF schedulers that Stories 38D
// and 38E introduced separately (view transitions and police-boundary
// geometry): a stale-generation guard, an optional settle delay for layout
// transitions, and a two-frame paint/maintenance cadence. Schedule, cancel,
// and coalesce through this single primitive.

export function createFrameScheduler({
  requestFrame = globalThis.requestAnimationFrame,
  cancelFrame = globalThis.cancelAnimationFrame,
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout,
  settleDelayMs = 220
} = {}) {
  let generation = 0;
  let frame = null;
  let timer = null;

  const cancel = () => {
    generation += 1;
    if (frame !== null) cancelFrame?.(frame);
    if (timer !== null) clearTimer?.(timer);
    frame = null;
    timer = null;
    return generation;
  };

  const run = (scheduledGeneration, callback) => {
    frame = requestFrame(() => {
      frame = requestFrame(() => {
        frame = null;
        if (scheduledGeneration === generation) callback(scheduledGeneration);
      });
    });
    return scheduledGeneration;
  };

  const afterPaint = callback => {
    cancel();
    const scheduledGeneration = generation;
    return run(scheduledGeneration, callback);
  };

  const afterLayoutTransition = callback => {
    cancel();
    const scheduledGeneration = generation;
    timer = setTimer(() => {
      timer = null;
      run(scheduledGeneration, callback);
    }, settleDelayMs);
    return scheduledGeneration;
  };

  return {
    afterPaint,
    afterLayoutTransition,
    cancel,
    pending: () => frame !== null || timer !== null,
    generation: () => generation
  };
}
