import { loadStaticGtfs } from '../src/ttc/static-source.js';
import { fetchTtcAlerts } from '../src/ttc/alerts.js';
import { correlateState } from '../src/ttc/correlation.js';
const now = new Date();
const loaded = await loadStaticGtfs({now,log:entry => console.log(JSON.stringify(entry))});
console.log(JSON.stringify({source:'ttc-static',...loaded.metadata,...loaded.metrics}));
try {
  const alerts = await fetchTtcAlerts(now);
  const result = correlateState(alerts,loaded.index,now,loaded.metadata);
  const counts = key => {
    const records = result.items.flatMap(i => i.correlation[key]);
    return {matched:records.filter(r => r.matched).length,unmatched:records.filter(r => !r.matched).length};
  };
  console.log(JSON.stringify({source:'ttc-static-diagnostic',...result.staticCorrelation.report,routes:counts('routes'),stops:counts('stops'),trips:counts('trips'),artifactBytes:Buffer.byteLength(JSON.stringify(result)),
    note:alerts.items.length ? 'Exact source-ID joins; no aliases' : 'Static validated; no qualifying alerts, live correlation not exercised'}));
} catch (error) {
  console.log(JSON.stringify({source:'ttc-static-diagnostic',status:'alerts-unavailable',error:error.message,note:'Static validated; live alert correlation not exercised'}));
}
