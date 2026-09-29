import { createHash } from 'node:crypto';

// Canonical object keys make versions independent of serialization order.
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])])) : value;
export function alertContentHash(item) {
  const content = {...item};
  for (const key of ['id','fetchedAt','contentHash','state','firstSeenAt','updatedAt','correlation']) delete content[key];
  return createHash('sha256').update(JSON.stringify(canonical(content))).digest('hex');
}

/** Half-open periods; absent bounds are unlimited. Gaps before a later window are scheduled. */
export function alertState(item, now) {
  const time = new Date(now).getTime();
  if (!Number.isFinite(time)) throw new Error('Invalid TTC reference time');
  const periods = item.activePeriods;
  if (!periods.length || periods.some(p => (!p.start || Date.parse(p.start) <= time) && (!p.end || time < Date.parse(p.end)))) return 'active';
  return periods.some(p => p.start && Date.parse(p.start) > time && (!p.end || Date.parse(p.end) > Date.parse(p.start))) ? 'scheduled' : 'expired';
}
export const isAlertActive = (item, now) => alertState(item, now) === 'active';

export function reconcileAlerts(result, previous, now) {
  const at = now.toISOString();
  const prior = new Map((previous?.items || []).map(item => [item.id,item]));
  const changes = {new:[],unchanged:[],updated:[],removed:[]};
  const items = result.items.map(item => {
    const old = prior.get(item.id);
    const contentHash = alertContentHash(item);
    const changed = old && alertContentHash(old) !== contentHash;
    changes[!old ? 'new' : changed ? 'updated' : 'unchanged'].push(item.id);
    prior.delete(item.id);
    return {...item,contentHash,state:alertState(item,now),firstSeenAt:old?.firstSeenAt || old?.fetchedAt || at,
      updatedAt:!old || changed ? at : old.updatedAt || old.fetchedAt || at};
  });
  changes.removed = [...prior.values()].map(item => ({id:item.id,contentHash:alertContentHash(item),state:alertState(item,now) === 'expired' ? 'expired' : 'removed'}));
  return {...result,items,lifecycleVersion:1,changes};
}
