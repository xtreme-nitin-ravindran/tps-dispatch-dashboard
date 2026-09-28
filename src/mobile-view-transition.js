export function createViewTransitionScheduler({
  requestFrame = globalThis.requestAnimationFrame,
  cancelFrame = globalThis.cancelAnimationFrame
} = {}) {
  let generation = 0;
  let paintFrame = null;
  let maintenanceFrame = null;

  function cancelPendingFrames() {
    if (paintFrame !== null) cancelFrame?.(paintFrame);
    if (maintenanceFrame !== null) cancelFrame?.(maintenanceFrame);
    paintFrame = null;
    maintenanceFrame = null;
  }

  return {
    schedule(callback) {
      generation += 1;
      const scheduledGeneration = generation;
      cancelPendingFrames();
      paintFrame = requestFrame(() => {
        paintFrame = null;
        maintenanceFrame = requestFrame(() => {
          maintenanceFrame = null;
          if (scheduledGeneration !== generation) return;
          callback({ generation: scheduledGeneration });
        });
      });
      return scheduledGeneration;
    },
    cancel() {
      generation += 1;
      cancelPendingFrames();
    },
    pending() {
      return paintFrame !== null || maintenanceFrame !== null;
    },
    generation() {
      return generation;
    }
  };
}
