export function updateLabel(current, incoming) {
  const ids = new Set(current.map(call => call.id));
  const count = incoming.filter(call => !ids.has(call.id)).length;
  return count ? `${count} new call${count === 1 ? '' : 's'} available` : 'Call updates available';
}

export const filterDefaults = { search: '', division: 'all', serviceFilter: 'all', eventFilter: 'all', hours: 24 };
export function filterSummary(s) {
  return [s.hours < 24 ? `Last ${s.hours} hour${s.hours === 1 ? '' : 's'}` : s.hours === 24 ? 'Last 24 hours' : `Last ${s.hours / 24} days`,
    s.serviceFilter !== 'all' && s.serviceFilter, s.eventFilter !== 'all' && `Event: ${s.eventFilter}`,
    s.division !== 'all' && s.division, s.search && `Search: “${s.search}”`, s.nearby && `Within ${s.radiusKm} km`].filter(Boolean).join(' · ');
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
