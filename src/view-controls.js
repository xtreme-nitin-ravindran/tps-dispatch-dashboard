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
