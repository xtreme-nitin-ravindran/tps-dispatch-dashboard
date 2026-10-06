// Story 51D browser fixture: the production-shaped route 94 case where an active
// official Service Change receives independently confirmed observed geometry.
//
// It reuses the Story 51A baseline pipeline (official advisory + healthy-empty
// GTFS-RT alerts + confirmed eastbound observed diversion) and projects the
// observed output through the public allow-list so the browser sees exactly what
// production publishes. It is test-only and never imported by production code.
import { baselineSnapshot, baselineStaticIndex, observedEastboundDiversion, BASELINE_EPOCH } from './baseline.js';
import { officialAdvisories } from '../../../src/ttc/official-advisories.js';
import { publicTtcGeometry } from '../../../scripts/publish-ttc-geometry.js';

export function officialAdvisoryFrontendFixture() {
  const snapshot = baselineSnapshot();
  const advisories = officialAdvisories(snapshot.disruptions);
  const observed = observedEastboundDiversion(baselineStaticIndex(), advisories);
  return {
    now: BASELINE_EPOCH,
    // The normalized `disruptions.transit` feed the browser renders.
    transit: snapshot.disruptions.transit,
    // Healthy but empty Story 30 GTFS-RT alert set.
    ttcAlerts: snapshot.ttcAlerts,
    // Confirmed observed geometry that claims the official advisory.
    ttcDiversions: publicTtcGeometry(observed.output)
  };
}
