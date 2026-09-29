import { updateTtcAlerts, validateTtcAlerts } from './alerts.js';
import { loadStaticGtfs } from './static-source.js';
import { correlateState } from './correlation.js';
import { alertContentHash } from './lifecycle.js';

// Shared entry point for Concourse, GitHub fallback, and standalone development.
export async function updateTtcBackend(previous, now = new Date(), {updateAlerts = updateTtcAlerts, loadStatic = loadStaticGtfs, log = entry => console.log(JSON.stringify(entry))} = {}) {
  const state = await updateAlerts(previous,now);
  let loaded;
  try { loaded = await loadStatic({now,log}); }
  catch (error) {
    const prior = new Map((previous?.items || []).map(i => [i.id,i]));
    const items = state.items.map(item => {
      const copy = {...item}; delete copy.correlation;
      const old = prior.get(item.id);
      if (old?.correlation && alertContentHash(old) === alertContentHash(item)) copy.correlation = old.correlation;
      return copy;
    });
    const referenced = new Set(items.flatMap(i => [...(i.correlation?.candidates || []),...(i.correlation?.trips || [])].map(v => v.patternId).filter(Boolean)));
    const patterns = Object.fromEntries(Object.entries(previous?.staticCorrelation?.patterns || {}).filter(([id]) => referenced.has(id)));
    const metadata = {...previous?.staticCorrelation}; delete metadata.report;
    const result = {...state,items,staticCorrelation:{schemaVersion:1,...metadata,status:'unavailable',checkedAt:now.toISOString(),patterns}};
    validateTtcAlerts(result);
    log({source:'ttc-static',status:'unavailable',error:error.message});
    return result;
  }
  const start = performance.now();
  const result = correlateState(state,loaded.index,now,loaded.metadata);
  validateTtcAlerts(result);
  log({source:'ttc-correlation',status:result.staticCorrelation.status,...loaded.metrics,...result.staticCorrelation.report,
    correlationMs:Math.round(performance.now()-start),artifactBytes:Buffer.byteLength(JSON.stringify(result))});
  return result;
}
