import { glossaryDefinition } from "./dispatch-glossary.js";

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

export function compactAge(timestamp, now = Date.now()) {
  const time = new Date(timestamp).getTime();
  if (!Number.isFinite(time)) return 'Time unavailable';
  const minutes = Math.floor(Math.max(0, now - time) / 60000);
  if (!minutes) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function compactReportedAge(timestamp, now = Date.now()) {
  return compactAge(timestamp, now);
}

export function callExplanation(description) {
  return glossaryDefinition(description);
}

export function locationConfidence(call) {
  const point = call.geography?.coordinates;
  if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)) return 'Location not mapped';
  if (/^[A-Z]\d[A-Z]$/i.test(String(call.location || '').trim())) return 'Broad postal area — approximate';
  if (call.geography.approximate === false) return 'Resolved intersection or street segment — not an exact incident address';
  return 'Approximate location';
}

export function callStatus(call) {
  return call.source === 'TFS' && call.isOngoing === true ? 'ONGOING' : null;
}

export function sourceName(source) {
  return source === 'TPS' ? 'Toronto Police Service' : 'Toronto Fire Services';
}

export function respondingUnitLabel(count) {
  if (!Number.isInteger(count) || count < 1) return '';
  return `${count} responding unit${count === 1 ? '' : 's'}`;
}
