export function relativeUpdateAge(timestamp, now = Date.now()) {
  const elapsed = Math.max(0, now - timestamp);
  const seconds = Math.floor(elapsed / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds} sec ago`;
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function sourceStatus(name, feed, now = Date.now(), staleAfterMs = 600000) {
  const fetched = Date.parse(feed?.fetchedAt);
  const published = Date.parse(feed?.sourceUpdatedAt);
  const hasPublished = Number.isFinite(published);
  const timestamp = hasPublished ? published : fetched;
  const lastSuccessfulAt = Number.isFinite(fetched) ? fetched : null;
  const status = feed?.status === 'unavailable'
    ? 'unavailable'
    : lastSuccessfulAt === null
      ? 'not loaded'
      : now - lastSuccessfulAt > staleAfterMs
        ? 'stale'
        : 'ok';
  return {
    label: `${name} ${hasPublished ? 'updated' : 'checked'}`,
    timestamp: Number.isFinite(timestamp) ? timestamp : null,
    lastSuccessfulAt,
    status,
    age: lastSuccessfulAt === null ? null : relativeUpdateAge(lastSuccessfulAt, now)
  };
}

export function sourceStatusText(subject, feed, now = Date.now(), staleAfterMs = 600000) {
  const info = sourceStatus(subject, feed, now, staleAfterMs);
  const lastSuccess = info.age ? ` Last successfully updated ${info.age}.` : '';
  if (info.status === 'unavailable') return `${subject} data is temporarily unavailable.${lastSuccess}`;
  if (info.status === 'not loaded') return `${subject} data has not been checked yet.`;
  if (info.status === 'stale') return `Last successfully updated ${info.age}. Data may be stale.`;
  return `Last successfully updated ${info.age}.`;
}
