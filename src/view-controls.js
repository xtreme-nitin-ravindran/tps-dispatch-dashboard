import { normalizeThemePreference } from './theme.js';

export function updateLabel(current, incoming) {
  const ids = new Set(current.map(call => call.id));
  const count = incoming.filter(call => !ids.has(call.id)).length;
  return count ? `${count} new call${count === 1 ? '' : 's'} available` : 'Call updates available';
}

export const filterDefaults = { search: '', division: 'all', serviceFilter: 'all', eventFilter: 'all', hours: 24 };
export function activeSecondaryFilterCount(state) {
  return ['division', 'serviceFilter', 'eventFilter', 'hours']
    .filter(field => state[field] !== filterDefaults[field]).length;
}
const supportedRadii = [0.5, 1, 2, 5];
const supportedMobileViews = ['map', 'calls'];
export function filterSummary(s) {
  return [s.hours < 24 ? `Last ${s.hours} hour${s.hours === 1 ? '' : 's'}` : s.hours === 24 ? 'Last 24 hours' : `Last ${s.hours / 24} days`,
    s.serviceFilter !== 'all' && s.serviceFilter, s.eventFilter !== 'all' && `Event: ${s.eventFilter}`,
    s.division !== 'all' && s.division, s.search && `Search: “${s.search}”`, s.nearby && s.radiusKm !== null && `Within ${s.radiusKm} km`].filter(Boolean).join(' · ');
}

export function readFilters(params) {
  const result = {...filterDefaults};
  if ([1,3,6,12,24,72,168].includes(Number(params.get('hours')))) result.hours = Number(params.get('hours'));
  if (['all','TFS','TPS'].includes(params.get('service'))) result.serviceFilter = params.get('service');
  if (['all','medical','fire','ongoing','other'].includes(params.get('event'))) result.eventFilter = params.get('event');
  result.search = (params.get('q') || '').slice(0,300);
  result.division = (params.get('division') || 'all').slice(0,150);
  return result;
}
export function shareView(base, state) {
  const url = new URL(base);
  url.search = ''; url.hash = '';
  url.searchParams.set('view','1');
  for (const [key,field] of [['q','search'],['division','division'],['service','serviceFilter'],['event','eventFilter'],['hours','hours']]) url.searchParams.set(key,state[field]);
  return url.href;
}

export function shareIncidentView(base, state, incidentId) {
  const url = new URL(shareView(base, state));
  url.searchParams.set('incident', String(incidentId));
  return url.href;
}

export function incidentDeepLink(base, incidentId) {
  const id = String(incidentId ?? '');
  if (!id || id.length > 300) throw new TypeError('incidentId must be between 1 and 300 characters');
  const url = new URL(base);
  url.search = '';
  url.hash = '';
  url.searchParams.set('view', '1');
  url.searchParams.set('incident', id);
  return url.href;
}

export function readSharedIncident(params) {
  const value = params.get('incident');
  return value ? value.slice(0, 300) : null;
}

export async function shareIncident(navigatorApi, data) {
  if (typeof navigatorApi.share === 'function') {
    try {
      await navigatorApi.share(data);
      return 'shared';
    } catch (error) {
      if (error?.name === 'AbortError') return 'cancelled';
    }
  }
  if (typeof navigatorApi.clipboard?.writeText === 'function') {
    await navigatorApi.clipboard.writeText(data.url);
    return 'copied';
  }
  return 'manual';
}

export function preferenceRecord(state, preferences) {
  return {hours:state.hours, service:state.serviceFilter, event:state.eventFilter, division:state.division,
    radiusKm:supportedRadii.includes(state.radiusKm) ? state.radiusKm : null,
    mobileView:supportedMobileViews.includes(preferences.mobileView) ? preferences.mobileView : 'map',
    roads:Boolean(preferences.roads), boundaries:Boolean(preferences.boundaries), theme:normalizeThemePreference(preferences.theme)};
}
export function loadPreferences(storage) {
  try {
    const value = JSON.parse(storage.getItem('sirento.preferences.v1'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return {filters:readFilters(new URLSearchParams({hours:value.hours,service:value.service,event:value.event,division:typeof value.division === 'string' ? value.division : 'all'})),
      radiusKm:supportedRadii.includes(value.radiusKm) ? value.radiusKm : null,
      mobileView:supportedMobileViews.includes(value.mobileView) ? value.mobileView : 'map',
      roads:value.roads === true,boundaries:value.boundaries !== false,theme:normalizeThemePreference(value.theme)};
  } catch { return null; }
}
export function savePreferences(storage, state, layers) {
  try { storage.setItem('sirento.preferences.v1',JSON.stringify(preferenceRecord(state,layers))); } catch { /* Browsing still works when storage is blocked. */ }
}
