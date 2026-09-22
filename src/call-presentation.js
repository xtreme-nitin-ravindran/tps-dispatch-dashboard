export function reportedAge(timestamp, now = Date.now()) {
  const time = new Date(timestamp).getTime();
  if (!Number.isFinite(time)) return 'Report time unavailable';
  const minutes = Math.floor(Math.max(0, now - time) / 60000);
  if (!minutes) return 'Reported just now';
  if (minutes < 60) return `Reported ${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Reported ${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `Reported ${days} day${days === 1 ? '' : 's'} ago`;
}

const DESCRIPTIONS = {
  'MEDICAL': 'A call for medical assistance.',
  'PERSONAL INJURY COLLISION': 'A traffic collision reported to involve an injury.',
  'PROPERTY DAMAGE COLLISION': 'A traffic collision reported as involving property damage.',
  'VEHICLE - PERSONAL INJURY': 'A vehicle incident reported to involve an injury.',
  'VEHICLE - PERSONAL INJURY HIGHWAY': 'A highway vehicle incident reported to involve an injury.',
  'UNKNOWN TROUBLE': 'A request for help where the nature of the problem is unclear.',
  'BREAK & ENTER': 'A reported break-in.',
  'RESCUE - ELEVATOR': 'A request for rescue involving an elevator.',
  'FIRE - GRASS/RUBBISH': 'A reported fire involving grass or rubbish.'
};
export function callExplanation(description) {
  const key = String(description || '').trim().toUpperCase();
  return Object.hasOwn(DESCRIPTIONS, key) ? DESCRIPTIONS[key] : '';
}

export function locationConfidence(call) {
  const point = call.geography?.coordinates;
  if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)) return 'Location not mapped';
  if (/^[A-Z]\d[A-Z]$/i.test(String(call.location || '').trim())) return 'Broad postal area — approximate';
  if (call.geography.approximate === false) return 'Resolved intersection or street segment — not an exact incident address';
  return 'Approximate location';
}
