import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ownershipKey,
  readOwnership,
  acquireOwnership,
  renewOwnership,
  releaseOwnership,
  OWNERSHIP_PREFIX
} from '../src/ttc/ownership.js';

// A deterministic in-memory ownership sink backed by a Map. `get` returns the
// stored body (or undefined), `put` stores, `delete` removes; this models the R2
// last-writer-wins object store without a network.
function ownershipSink() {
  const objects = new Map();
  return {
    objects,
    async get(key) { return objects.get(key); },
    async put(key, body) { objects.set(key, body); },
    async delete(key) { objects.delete(key); }
  };
}

// A controllable clock. `now` is the epoch-millisecond value `clock()` reports;
// advancing lets a test expire a TTL lease deterministically.
function manualClock(startMs) {
  let now = startMs;
  return { clock: () => new Date(now), now: () => now, advance: ms => { now += ms; } };
}

const EPOCH = Date.parse('2026-10-14T12:00:00.000Z');
const TTL = 30 * 1000;

test('[STORY-64] ownershipKey derives a private per-role key from the prefix', () => {
  assert.equal(ownershipKey({ role: 'processor', prefix: 'ttc-ownership' }), 'ttc-ownership/processor.json');
  assert.equal(ownershipKey({ role: 'collector', prefix: 'ttc-ownership/' }), 'ttc-ownership/collector.json');
  assert.equal(OWNERSHIP_PREFIX, 'ttc-ownership');
});

test('[STORY-64] ownershipKey rejects a missing role or prefix', () => {
  assert.throws(() => ownershipKey({ prefix: 'x' }), /role/);
  assert.throws(() => ownershipKey({ role: '', prefix: 'x' }), /role/);
  assert.throws(() => ownershipKey({ role: 'x', prefix: '' }), /prefix/);
  assert.throws(() => ownershipKey({ role: 'x', prefix: 42 }), /prefix/);
});

test('[STORY-64] a second processor cannot acquire ownership while the first holds it', async () => {
  const sink = ownershipSink();
  const key = ownershipKey({ role: 'processor' });
  const clock = manualClock(EPOCH);
  const first = await acquireOwnership({ sink, key, ownerId: 'proc-a', ttlMs: TTL, clock: clock.clock });
  assert.deepEqual(first, { acquired: true, holder: 'proc-a' });
  const second = await acquireOwnership({ sink, key, ownerId: 'proc-b', ttlMs: TTL, clock: clock.clock });
  assert.deepEqual(second, { acquired: false, holder: 'proc-a' });
  // The live lease is untouched by the failed take-over.
  const current = await readOwnership({ sink, key });
  assert.equal(current.holder, 'proc-a');
});

test('[STORY-64] ownership TTL expiry lets a stale holder be taken over', async () => {
  const sink = ownershipSink();
  const key = ownershipKey({ role: 'processor' });
  const clock = manualClock(EPOCH);
  await acquireOwnership({ sink, key, ownerId: 'proc-a', ttlMs: TTL, clock: clock.clock });
  // Advance past the TTL without any release: the first holder is stale.
  clock.advance(TTL + 1);
  const takeover = await acquireOwnership({ sink, key, ownerId: 'proc-b', ttlMs: TTL, clock: clock.clock });
  assert.deepEqual(takeover, { acquired: true, holder: 'proc-b' });
});

test('[STORY-64] an unexpired lease held by the same owner is re-acquired, not duplicated', async () => {
  const sink = ownershipSink();
  const key = ownershipKey({ role: 'processor' });
  const clock = manualClock(EPOCH);
  await acquireOwnership({ sink, key, ownerId: 'proc-a', ttlMs: TTL, clock: clock.clock });
  const again = await acquireOwnership({ sink, key, ownerId: 'proc-a', ttlMs: TTL, clock: clock.clock });
  assert.deepEqual(again, { acquired: true, holder: 'proc-a' });
});

test('[STORY-64] renewOwnership extends the lease only while the owner still holds it', async () => {
  const sink = ownershipSink();
  const key = ownershipKey({ role: 'collector' });
  const clock = manualClock(EPOCH);
  await acquireOwnership({ sink, key, ownerId: 'col-a', ttlMs: TTL, clock: clock.clock });
  assert.equal(await renewOwnership({ sink, key, ownerId: 'col-a', ttlMs: TTL, clock: clock.clock }), true);
  // A different owner cannot renew a lease it does not hold.
  assert.equal(await renewOwnership({ sink, key, ownerId: 'col-b', ttlMs: TTL, clock: clock.clock }), false);
  // After expiry, the original owner can no longer renew.
  clock.advance(TTL + 1);
  assert.equal(await renewOwnership({ sink, key, ownerId: 'col-a', ttlMs: TTL, clock: clock.clock }), false);
});

test('[STORY-64] graceful shutdown releases ownership for a successor', async () => {
  const sink = ownershipSink();
  const key = ownershipKey({ role: 'processor' });
  const clock = manualClock(EPOCH);
  await acquireOwnership({ sink, key, ownerId: 'proc-a', ttlMs: TTL, clock: clock.clock });
  await releaseOwnership({ sink, key, ownerId: 'proc-a' });
  assert.equal(await readOwnership({ sink, key }), null);
  const takeover = await acquireOwnership({ sink, key, ownerId: 'proc-b', ttlMs: TTL, clock: clock.clock });
  assert.deepEqual(takeover, { acquired: true, holder: 'proc-b' });
});

test('[STORY-64] release does not revoke a lease now held by another owner', async () => {
  const sink = ownershipSink();
  const key = ownershipKey({ role: 'processor' });
  const clock = manualClock(EPOCH);
  await acquireOwnership({ sink, key, ownerId: 'proc-a', ttlMs: TTL, clock: clock.clock });
  clock.advance(TTL + 1);
  await acquireOwnership({ sink, key, ownerId: 'proc-b', ttlMs: TTL, clock: clock.clock });
  // proc-a's late release must not delete proc-b's active lease.
  await releaseOwnership({ sink, key, ownerId: 'proc-a' });
  const current = await readOwnership({ sink, key });
  assert.equal(current.holder, 'proc-b');
});

test('[STORY-64] dev config points at an isolated prefix and cannot acquire production ownership', async () => {
  const prodSink = ownershipSink();
  const devSink = ownershipSink();
  const prodKey = ownershipKey({ role: 'processor', prefix: 'ttc-ownership' });
  const devKey = ownershipKey({ role: 'processor', prefix: 'dev/ttc-ownership' });
  // The two prefixes yield different keys even for the same role.
  assert.notEqual(prodKey, devKey);
  const clock = manualClock(EPOCH);
  // The production writer holds the production lease.
  await acquireOwnership({ sink: prodSink, key: prodKey, ownerId: 'prod', ttlMs: TTL, clock: clock.clock });
  // A dev writer acquiring its own isolated lease never contends with production.
  const dev = await acquireOwnership({ sink: devSink, key: devKey, ownerId: 'dev', ttlMs: TTL, clock: clock.clock });
  assert.deepEqual(dev, { acquired: true, holder: 'dev' });
  // And the production lease is undisturbed.
  const prod = await readOwnership({ sink: prodSink, key: prodKey });
  assert.equal(prod.holder, 'prod');
});

test('[STORY-64] rollback to the previous writer leaves exactly one writer after takeover', async () => {
  const sink = ownershipSink();
  const key = ownershipKey({ role: 'processor' });
  const clock = manualClock(EPOCH);
  // The new image holds the lease, then is rolled back (killed without release).
  await acquireOwnership({ sink, key, ownerId: 'new-image', ttlMs: TTL, clock: clock.clock });
  // The previous image starts after the new image's lease has expired.
  clock.advance(TTL + 1);
  const rollback = await acquireOwnership({ sink, key, ownerId: 'prev-image', ttlMs: TTL, clock: clock.clock });
  assert.deepEqual(rollback, { acquired: true, holder: 'prev-image' });
  // Exactly one live writer: the previous image holds, the new image cannot.
  const blocked = await acquireOwnership({ sink, key, ownerId: 'new-image', ttlMs: TTL, clock: clock.clock });
  assert.deepEqual(blocked, { acquired: false, holder: 'prev-image' });
});

test('[STORY-64] a corrupt or unreadable lease is treated as free, never wedging the writer', async () => {
  const sink = ownershipSink();
  const key = ownershipKey({ role: 'processor' });
  sink.objects.set(key, '{ not valid json ');
  const clock = manualClock(EPOCH);
  assert.equal(await readOwnership({ sink, key }), null);
  const acquired = await acquireOwnership({ sink, key, ownerId: 'proc-a', ttlMs: TTL, clock: clock.clock });
  assert.deepEqual(acquired, { acquired: true, holder: 'proc-a' });
});

test('[STORY-64] ownership validates its required inputs', async () => {
  const sink = ownershipSink();
  const key = ownershipKey({ role: 'processor' });
  await assert.rejects(() => readOwnership({}, key), /get/);
  await assert.rejects(() => readOwnership({ sink: {} }, key), /get/);
  await assert.rejects(() => acquireOwnership({ sink: undefined, key, ownerId: 'a', ttlMs: TTL }), /get and put/);
  await assert.rejects(() => acquireOwnership({ sink: { get: async () => undefined }, key, ownerId: 'a', ttlMs: TTL }), /get and put/);
  await assert.rejects(() => acquireOwnership({ sink, key, ownerId: '', ttlMs: TTL }), /ownerId/);
  await assert.rejects(() => acquireOwnership({ sink, key, ownerId: 'a', ttlMs: 0 }), /ttlMs/);
  await assert.rejects(() => renewOwnership({ sink: undefined, key, ownerId: 'a', ttlMs: TTL }), /get and put/);
  await assert.rejects(() => renewOwnership({ sink: { get: async () => undefined }, key, ownerId: 'a', ttlMs: TTL }), /get and put/);
  await assert.rejects(() => renewOwnership({ sink, key, ownerId: '', ttlMs: TTL }), /ownerId/);
  await assert.rejects(() => releaseOwnership({ sink: undefined, key, ownerId: 'a' }), /get and delete/);
  await assert.rejects(() => releaseOwnership({ sink: { get: async () => undefined }, key, ownerId: 'a' }), /get and delete/);
});

test('[STORY-64] readOwnership treats a malformed or non-object lease body as free', async () => {
  const sink = ownershipSink();
  const key = ownershipKey({ role: 'processor' });
  // JSON null body: falsy parsed value.
  sink.objects.set(key, 'null');
  assert.equal(await readOwnership({ sink, key }), null);
  // A holder that is not a string.
  sink.objects.set(key, JSON.stringify({ holder: 42, expiresAt: EPOCH + TTL }));
  assert.equal(await readOwnership({ sink, key }), null);
  // A non-finite expiresAt.
  sink.objects.set(key, JSON.stringify({ holder: 'a', expiresAt: 'later' }));
  assert.equal(await readOwnership({ sink, key }), null);
  // A non-string body is parsed as-is (object) and validated identically.
  sink.objects.set(key, { holder: 42, expiresAt: EPOCH });
  assert.equal(await readOwnership({ sink, key }), null);
});

test('[STORY-64] acquireOwnership reports a lost arbitration when the write is not visible on re-read', async () => {
  // A sink that accepts a put but never reflects it back: models an
  // eventual-consistency / lost-update race where a competing writer wins.
  const sink = {
    async get() { return undefined; },
    async put() { },
    async delete() { }
  };
  const key = ownershipKey({ role: 'processor' });
  const clock = manualClock(EPOCH);
  const result = await acquireOwnership({ sink, key, ownerId: 'proc-a', ttlMs: TTL, clock: clock.clock });
  assert.deepEqual(result, { acquired: false, holder: null });
});

test('[STORY-64] release ownership of an unowned slot is a no-op', async () => {
  const sink = ownershipSink();
  const key = ownershipKey({ role: 'processor' });
  await releaseOwnership({ sink, key, ownerId: 'proc-a' }); // no throw
  assert.equal(await readOwnership({ sink, key }), null);
});

test('[STORY-64] renewOwnership on an unowned slot returns false', async () => {
  const sink = ownershipSink();
  const key = ownershipKey({ role: 'collector' });
  const clock = manualClock(EPOCH);
  assert.equal(await renewOwnership({ sink, key, ownerId: 'col-a', ttlMs: TTL, clock: clock.clock }), false);
});

test('[STORY-64] acquireOwnership reports the competing holder when another writer wins the arbitation', async () => {
  // The first read shows the slot free, but a competitor commits before our
  // re-read, so the arbitration re-read sees a different holder and we report
  // that holder rather than claiming ownership.
  let reads = 0;
  const sink = {
    async get() {
      reads++;
      return reads === 1 ? undefined : JSON.stringify({ holder: 'proc-b', expiresAt: EPOCH + TTL });
    },
    async put() { },
    async delete() { }
  };
  const key = ownershipKey({ role: 'processor' });
  const clock = manualClock(EPOCH);
  const result = await acquireOwnership({ sink, key, ownerId: 'proc-a', ttlMs: TTL, clock: clock.clock });
  assert.deepEqual(result, { acquired: false, holder: 'proc-b' });
});

test('[STORY-64] acquire and renew fall back to the wall clock when no clock is injected', async () => {
  const sink = ownershipSink();
  const key = ownershipKey({ role: 'processor' });
  const acquired = await acquireOwnership({ sink, key, ownerId: 'proc-a', ttlMs: TTL });
  assert.deepEqual(acquired, { acquired: true, holder: 'proc-a' });
  assert.equal(await renewOwnership({ sink, key, ownerId: 'proc-a', ttlMs: TTL }), true);
});
