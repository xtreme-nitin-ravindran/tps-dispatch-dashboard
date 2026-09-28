export function createPoliceBoundaryLifecycleScheduler({
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

  const afterPaint = callback => {
    cancel();
    const scheduledGeneration = generation;
    frame = requestFrame(() => {
      frame = requestFrame(() => {
        frame = null;
        if (scheduledGeneration === generation) callback(scheduledGeneration);
      });
    });
    return scheduledGeneration;
  };

  const afterLayoutTransition = callback => {
    cancel();
    const scheduledGeneration = generation;
    timer = setTimer(() => {
      timer = null;
      frame = requestFrame(() => {
        frame = requestFrame(() => {
          frame = null;
          if (scheduledGeneration === generation) callback(scheduledGeneration);
        });
      });
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
