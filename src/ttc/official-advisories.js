// Story 51B — Shared Official-Advisory Contract & Pipeline Input.
//
// The official TTC Service Changes live in the snapshot under
// `disruptions.transit` (normalized by `src/disruptions/source.js`). Story 30's
// vehicle inference runs in a separate process that never sees that snapshot, so
// it cannot yet reason about official advisories at all. This module derives the
// smallest source-qualified advisory contract from the already-normalized
// `disruptions.transit` feed and validates it, so local execution, GitHub
// Actions, and Concourse can all hand the same advisory context to inference.
//
// It deliberately does NOT fetch the TTC website again, does NOT derive geometry
// from prose, and does NOT associate advisories with observed trajectories. It
// only carries stable identity, provenance, routes, active periods, title/effect/
// URL, and source status/freshness. GTFS-RT alert identities stay in their own
// namespace (`ttc-gtfs-rt`); official Service Changes use `ttc-service-change`.
export const OFFICIAL_ADVISORY_SOURCE = 'ttc-service-change';
export const OFFICIAL_ADVISORY_SCHEMA_VERSION = 1;
export const OFFICIAL_ADVISORY_POLICY = Object.freeze({ maxAdvisories: 2000, maxArtifactBytes: 4 * 1024 * 1024 });

const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const id = value => typeof value === 'string' && value.trim().length > 0;
const stringList = value => Array.isArray(value) && value.every(id) && new Set(value).size === value.length;

// A stable, source-qualified reference. The prefix keeps official Service Change
// identities distinct from GTFS-RT alert IDs even when the raw ids collide.
export const advisoryRef = rawId => `${OFFICIAL_ADVISORY_SOURCE}:${rawId}`;

// Normalize the official active periods into the same half-open shape used by the
// GTFS-RT lifecycle so downstream code can reason about them uniformly.
function normalizePeriods(periods) {
  if (!Array.isArray(periods)) return [];
  return periods.map(period => {
    const start = Number.isFinite(period?.start) ? new Date(period.start).toISOString() : null;
    const end = Number.isFinite(period?.end) ? new Date(period.end).toISOString() : null;
    return { start, end };
  }).sort((a, b) => (a.start || '').localeCompare(b.start || '') || (a.end || '').localeCompare(b.end || ''));
}

// Derive the advisory contract from the normalized `disruptions.transit` feed.
// `status` mirrors the source feed: `ok` (successful, possibly empty), `unavailable`
// (retained items, source down), or `not-loaded` (no feed at all). A successful
// empty feed is distinct from an unavailable source.
export function officialAdvisories(disruptions) {
  const feed = disruptions?.transit;
  const checkedAt = iso(feed?.checkedAt) ? feed.checkedAt : null;
  const sourceUpdatedAt = iso(feed?.sourceUpdatedAt) ? feed.sourceUpdatedAt : null;
  const fetchedAt = iso(feed?.fetchedAt) ? feed.fetchedAt : null;
  const status = !feed ? 'not-loaded' : feed.status === 'unavailable' ? 'unavailable' : 'ok';
  const items = Array.isArray(feed?.items) ? feed.items : [];
  const advisories = items.filter(item => id(item?.id)).map(item => ({
    ref: advisoryRef(item.id),
    source: OFFICIAL_ADVISORY_SOURCE,
    sourceId: item.id,
    title: typeof item.title === 'string' ? item.title : '',
    effect: typeof item.effect === 'string' ? item.effect : '',
    url: typeof item.url === 'string' ? item.url : null,
    routeIds: stringList(item.routes) ? [...item.routes] : [],
    activePeriods: normalizePeriods(item.periods)
  })).sort((a, b) => a.ref.localeCompare(b.ref));
  const result = {
    schemaVersion: OFFICIAL_ADVISORY_SCHEMA_VERSION,
    source: OFFICIAL_ADVISORY_SOURCE,
    status,
    checkedAt,
    sourceUpdatedAt,
    fetchedAt,
    advisories
  };
  validateOfficialAdvisories(result);
  return result;
}

// Strict validation of the owned advisory artifact before it crosses a process or
// pipeline boundary. Rejects malformed records, duplicate refs, and oversized input.
export function validateOfficialAdvisories(value) {
  const fail = () => { throw new Error('Invalid TTC official advisory artifact'); };
  if (!value || value.schemaVersion !== OFFICIAL_ADVISORY_SCHEMA_VERSION || value.source !== OFFICIAL_ADVISORY_SOURCE ||
    !['ok', 'unavailable', 'not-loaded'].includes(value.status) ||
    !(value.checkedAt === null || iso(value.checkedAt)) ||
    !(value.sourceUpdatedAt === null || iso(value.sourceUpdatedAt)) ||
    !(value.fetchedAt === null || iso(value.fetchedAt)) ||
    !Array.isArray(value.advisories) || value.advisories.length > OFFICIAL_ADVISORY_POLICY.maxAdvisories) fail();
  if (Buffer.byteLength(JSON.stringify(value)) > OFFICIAL_ADVISORY_POLICY.maxArtifactBytes) fail();
  const refs = new Set();
  for (const advisory of value.advisories) {
    if (!advisory || typeof advisory !== 'object' || !id(advisory.ref) || refs.has(advisory.ref) ||
      advisory.source !== OFFICIAL_ADVISORY_SOURCE || !id(advisory.sourceId) ||
      advisory.ref !== advisoryRef(advisory.sourceId) ||
      typeof advisory.title !== 'string' || typeof advisory.effect !== 'string' ||
      !(advisory.url === null || typeof advisory.url === 'string') ||
      !stringList(advisory.routeIds) ||
      !Array.isArray(advisory.activePeriods) || !advisory.activePeriods.every(period =>
        period && typeof period === 'object' &&
        (period.start === null || iso(period.start)) && (period.end === null || iso(period.end)) &&
        !(period.start && period.end && period.start > period.end))) fail();
    refs.add(advisory.ref);
  }
  return value;
}

// Read the advisory contract from a snapshot file path. A missing file is a
// `not-loaded` contract rather than an error, so a cold cache cannot fabricate
// advisories and a missing input cannot crash inference.
export async function loadOfficialAdvisories(path, { readFile } = {}) {
  if (!path) return officialAdvisories(undefined);
  let snapshot;
  try {
    snapshot = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return officialAdvisories(undefined);
    throw error;
  }
  return officialAdvisories(snapshot?.disruptions);
}
