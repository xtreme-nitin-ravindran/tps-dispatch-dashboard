// Story 64 — enforced single-writer ownership interlock (Piece 6).
//
// The collector and processor are each long-running, single-writer services.
// A TTL lease stored in a private R2 prefix is the deployment interlock that
// prevents two instances of the same role from publishing concurrently. The
// lease is *advisory but enforced by convention*: a claimant only writes when
// the slot is free, expired, or already its own, and every later write is
// conditional on the slot still being the claimant's after a re-read, so the
// last writer to commit wins and no two live leases for the same role coexist.
//
// Properties that make rollback safe:
//
//   - A stale holder (one that crashed without releasing) is recoverable: once
//     its TTL expires, a new claimant can take the slot over. There is never a
//     window with two *live* writers, because the old writer's lease has expired
//     by the time the new one commits.
//   - `releaseOwnership` deletes the lease only when the caller is still the
//     holder, so a graceful shutdown never revokes a lease it no longer owns
//     (another instance may already have taken it over after a TTL expiry).
//   - The lease key is derived from a configurable `prefix` plus the role, so a
//     development deployment points at an isolated prefix and can never contend
//     with the production writer's lease.
//
// The `sink` is any object store exposing `get(key)` -> body|undefined, `put`,
// and `delete` (the same shape as `createR2CaptureSink`). `clock` is injectable
// so expiry is deterministic in tests; it defaults to the wall clock.

// Lease object stored under the ownership key. `holder` is the `ownerId` that
// currently owns the slot; `expiresAt` is the epoch-millisecond instant at which
// the lease expires and the slot becomes free for takeover.
const lease = (holder, expiresAt) => ({ holder, expiresAt });

// The private R2 prefix ownership leases live under. It is deliberately distinct
// from the raw-capture (`ttc-captures/`), diagnostic (`ttc-diagnostics/`) and
// public (`data/`) prefixes so cleanup and publication never touch it.
export const OWNERSHIP_PREFIX = 'ttc-ownership';

// Build the lease key for a role under a prefix. Defaults to the private
// `ttc-ownership/` prefix; a development deployment passes an isolated prefix so
// its lease never collides with the production writer's.
export function ownershipKey({ role, prefix = OWNERSHIP_PREFIX }) {
  if (typeof role !== 'string' || role.length === 0) throw new Error('Ownership requires a role');
  if (typeof prefix !== 'string' || prefix.length === 0) throw new Error('Ownership requires a prefix');
  return `${prefix.replace(/\/+$/, '')}/${role}.json`;
}

// Read and parse the current lease, or `null` when the slot is unowned or the
// stored body is unreadable (for example a corrupt or partial write from a
// crash). An unreadable lease is treated as free rather than blocking, so a
// corrupt lease never permanently wedges the writer.
export async function readOwnership({ sink, key }) {
  if (!sink || typeof sink.get !== 'function') throw new Error('Ownership requires a sink with get');
  const body = await sink.get(key);
  if (body === undefined) return null;
  let parsed;
  try {
    parsed = typeof body === 'string' ? JSON.parse(body) : body;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed.holder !== 'string' || !Number.isFinite(parsed.expiresAt)) return null;
  return { holder: parsed.holder, expiresAt: parsed.expiresAt };
}

// Try to acquire the slot. Returns `{ acquired, holder }`: `acquired` is true when
// the caller now owns the slot (it was free, expired, or already the caller's),
// and `holder` is the owner that ended up holding it (the caller when acquired,
// otherwise the competing holder that blocked the take-over).
export async function acquireOwnership({ sink, key, ownerId, ttlMs, clock = () => new Date() }) {
  if (!sink || typeof sink.get !== 'function' || typeof sink.put !== 'function') throw new Error('Ownership requires a sink with get and put');
  if (typeof ownerId !== 'string' || ownerId.length === 0) throw new Error('Ownership requires an ownerId');
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('Ownership requires a positive ttlMs');
  const now = +clock();
  const current = await readOwnership({ sink, key });
  // The slot is free when unowned, or when the current lease has expired. A live
  // lease held by a different owner blocks the take-over.
  if (current && current.expiresAt > now && current.holder !== ownerId) {
    return { acquired: false, holder: current.holder };
  }
  await sink.put(key, JSON.stringify(lease(ownerId, now + ttlMs)));
  // Re-read to arbitrate a simultaneous writer: last-writer-wins means whoever's
  // lease is present after our write is the holder. (With R2 there is no true
  // compare-and-swap, so this re-read is the single-writer arbitration.)
  const after = await readOwnership({ sink, key });
  if (after && after.holder === ownerId) return { acquired: true, holder: ownerId };
  return { acquired: false, holder: after ? after.holder : null };
}

// Renew the caller's lease, extending its TTL only while the caller is still the
// holder. Returns true on success; false when the lease is gone, expired, or held
// by a different owner (so a stale process can never extend a lease it no longer
// owns and resurrect itself as a second writer).
export async function renewOwnership({ sink, key, ownerId, ttlMs, clock = () => new Date() }) {
  if (!sink || typeof sink.get !== 'function' || typeof sink.put !== 'function') throw new Error('Ownership requires a sink with get and put');
  if (typeof ownerId !== 'string' || ownerId.length === 0) throw new Error('Ownership requires an ownerId');
  const now = +clock();
  const current = await readOwnership({ sink, key });
  // The caller must still hold a *live* lease: a lease that has already expired
  // is a stale slot that a successor may take over, so renewing it would
  // resurrect a crashed process as a second writer.
  if (!current || current.holder !== ownerId || current.expiresAt <= now) return false;
  await sink.put(key, JSON.stringify(lease(ownerId, now + ttlMs)));
  return true;
}

// Release the caller's lease. Deletes the slot only when the caller is still the
// holder, so a graceful shutdown never revokes a lease a successor already took
// over after a TTL expiry. Returns nothing; a missing lease is a no-op.
export async function releaseOwnership({ sink, key, ownerId }) {
  if (!sink || typeof sink.get !== 'function' || typeof sink.delete !== 'function') throw new Error('Ownership requires a sink with get and delete');
  const current = await readOwnership({ sink, key });
  if (!current || current.holder !== ownerId) return;
  await sink.delete(key);
}
