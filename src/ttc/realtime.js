import bindings from 'gtfs-realtime-bindings';

// Shared protobuf runtime; absent optional fields must remain absent.
export function decodeRealtime(bytes) {
  const { FeedMessage } = bindings.transit_realtime;
  const feed = FeedMessage.toObject(FeedMessage.decode(bytes), {longs:String});
  if (!feed.header?.gtfsRealtimeVersion || (feed.header.incrementality ?? 0) !== 0) throw new Error('Invalid or differential TTC feed');
  return feed;
}
export function realtimeInstant(value) {
  if (value === undefined) return undefined;
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds < 0 || seconds > 8640000000000) throw new Error('Invalid TTC timestamp');
  return new Date(seconds * 1000).toISOString();
}
