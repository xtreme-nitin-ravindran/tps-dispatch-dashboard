export function updateLabel(current, incoming) {
  const ids = new Set(current.map(call => call.id));
  const count = incoming.filter(call => !ids.has(call.id)).length;
  return count ? `${count} new call${count === 1 ? '' : 's'} available` : 'Call updates available';
}
