// Deterministic virtual clock for the Story 64 collector tests.
//
// `clock()` returns the current virtual time as a Date; `wait(ms)` advances the
// virtual time by `ms` without a real delay. This lets the collector's monotonic
// schedule, drift and gap detection be exercised deterministically. Test-only;
// never imported by production code.
export function virtualClock(startMs = Date.parse('2026-10-13T12:00:00.000Z')) {
  let now = startMs;
  return {
    clock: () => new Date(now),
    wait: async ms => { now += ms; },
    advance: ms => { now += ms; },
    now: () => now
  };
}
