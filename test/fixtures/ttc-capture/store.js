// Deterministic in-memory collaborators for the Story 64 capture store.
//
// These are test-only helpers: an in-memory object sink (with an injectable
// failure mode) and an in-memory spool. They let the capture-store tests
// exercise R2 failure, late uploads and spool saturation without a network or a
// real bucket. They are never imported by production code.

// An in-memory object sink. `failPut` makes `put` throw so a test can simulate
// an R2 outage; `objects` is the backing map of key -> body.
export function memorySink({ failPut = false } = {}) {
  const objects = new Map();
  return {
    objects,
    failPut,
    async put(key, body) {
      if (this.failPut) throw new Error('R2 unavailable');
      objects.set(key, body);
    },
    async get(key) { return objects.get(key); },
    async list(prefix) { return [...objects.keys()].filter(key => key.startsWith(prefix)); }
  };
}

// An in-memory spool. `entries` is the backing map of sequence -> capture.
export function memorySpool() {
  const entries = new Map();
  return {
    entries,
    async write(capture, payload) { entries.set(capture.sequence, { capture, payload }); },
    async read(sequence) { return entries.get(sequence); },
    async list() { return [...entries.values()].sort((a, b) => a.capture.sequence - b.capture.sequence); },
    async remove(sequence) { entries.delete(sequence); },
    async depth() { return entries.size; }
  };
}
