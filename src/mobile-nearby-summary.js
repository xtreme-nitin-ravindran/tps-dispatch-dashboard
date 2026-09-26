import { distanceKm, distanceLabel } from './nearby.js';

function compactAge(timestamp, now) {
  const elapsedMinutes = Math.floor(Math.max(0, now - new Date(timestamp).getTime()) / 60_000);
  if (elapsedMinutes < 1) return 'just now';
  if (elapsedMinutes < 60) return `${elapsedMinutes} min ago`;
  const hours = Math.floor(elapsedMinutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function closestDistance(calls, origin, coordinatesForCall) {
  if (!origin || !calls.length) return '';
  const distance = Math.min(...calls.map(call => distanceKm(origin, coordinatesForCall(call))));
  return distanceLabel(distance).replace(/ away$/, '');
}

export function mobileNearbySummary(
  calls,
  radiusKm,
  now = Date.now(),
  origin = null,
  coordinatesForCall = call => call?.geography?.coordinates
) {
  if (!calls.length) return radiusKm === null ? 'No recent Toronto calls.' : 'No calls match in this area.';
  const noun = calls.length === 1 ? 'call' : 'calls';
  const context = radiusKm === null ? `${calls.length} Toronto ${noun}` : `${calls.length} ${noun}`;
  const newest = Math.max(...calls.map(call => new Date(call.timestamp).getTime()));
  const closest = closestDistance(calls, origin, coordinatesForCall);
  return `${context}${closest ? ` · Closest ${closest}` : ''} · Latest ${compactAge(newest, now)}`;
}
