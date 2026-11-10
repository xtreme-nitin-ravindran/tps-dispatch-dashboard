// Shared publication policy for the incident snapshot.
//
// Concourse's single-writer `update-feed` job decides whether the incident
// snapshot needs refreshing through this module: the same freshness/skip
// threshold, the same per-feed failure and history semantics, and the same
// timestamp meaning. This module is the single source of truth for that policy.
// The ETL itself lives in `scripts/tfs-etl.js` and the write to Cloudflare R2 in
// `scripts/lib/publication-sink.js`.
//
// Publication (the write to R2) is deliberately *not* handled here. The
// `update-feed` phase script publishes directly to R2 through
// the sink; the git `data` branch was retired in Story 55E. The
// writer writes only `data/current.json` (incidents); TTC geometry
// (`data/ttc-diversions.json`) is owned by the independent continuous capture
// stack (Story 79 single-writer ownership), so the two datasets cannot
// conflict. No lock and no custom retry loop are needed.

// The schedule runs every five minutes and the browser marks a feed stale after
// ten minutes (`src/source-status.js`). A five-minute threshold keeps each
// scheduled run refreshing the snapshot, so published data stays comfortably
// under the ten-minute UI stale warning instead of sitting right at its edge.
// The previous ten-minute threshold let a run skip and left data up to ten
// minutes old, which is exactly when the browser warning fires.
export const FRESHNESS_THRESHOLD_MS = 300000;

// A snapshot needs an update when its envelope is missing, unparseable,
// future-dated, or older than the threshold, or when either incident feed is
// unavailable or older than the threshold. A missing `feeds` block is treated as
// "no feed evidence" and does not by itself force an update, matching the
// historical fallback behavior.
export function needsUpdate(snapshot, now = new Date(), thresholdMs = FRESHNESS_THRESHOLD_MS) {
  const nowMs = now.getTime();
  const timestampNeedsUpdate = value => {
    const timestamp = Date.parse(value);
    return !Number.isFinite(timestamp) || timestamp > nowMs || nowMs - timestamp >= thresholdMs;
  };
  if (timestampNeedsUpdate(snapshot && snapshot.fetchedAt)) return true;
  if (!snapshot || !snapshot.feeds) return false;
  const feeds = snapshot.feeds;
  return ['TFS', 'TPS'].some(source => {
    const feed = feeds[source];
    return feed?.status !== 'ok' || timestampNeedsUpdate(feed.fetchedAt);
  });
}
