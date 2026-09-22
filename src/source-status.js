export function sourceStatus(name, feed, now = Date.now()) {
  const fetched = Date.parse(feed?.fetchedAt);
  const published = Date.parse(feed?.sourceUpdatedAt);
  const hasPublished = Number.isFinite(published);
  const timestamp = hasPublished ? published : fetched;
  return {
    label: `${name} ${hasPublished ? 'updated' : 'checked'}`,
    timestamp: Number.isFinite(timestamp) ? timestamp : null,
    status: feed?.status === 'unavailable' ? 'unavailable' : !Number.isFinite(fetched) ? 'not loaded' : now - fetched > 600000 ? 'stale' : ''
  };
}
