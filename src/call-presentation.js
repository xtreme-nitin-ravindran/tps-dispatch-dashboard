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
