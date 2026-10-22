import test from 'node:test';
import assert from 'node:assert/strict';
import bindings from 'gtfs-realtime-bindings';
import { fetchDisruptionSource } from '../src/disruptions/source.js';
import { TTC_ALERTS_URL, parseTtcAlerts } from '../src/ttc/alerts.js';
import { options } from './helpers/live-source.js';

test('live transit feed satisfies production parser', options, async () => {
  const data = await fetchDisruptionSource('transit');
  assert.ok(Array.isArray(data.items));
  for (const item of data.items) {
    assert.ok(item.id);
    assert.ok(item.title);
  }
  assert.ok(Number.isFinite(Date.parse(data.sourceUpdatedAt)));
});

// The bustime protobuf feed had no live gate, so a silent feed-shape change
// (explicit UNKNOWN enum sentinels instead of absent cause/effect) dropped every
// detour alert from the snapshot for weeks without failing any check. Mirror the
// production pre-filter and assert that every live detour alert whose structured
// classification is unknown but whose text names a detour still parses into the
// published item set. Passes trivially when the feed carries no such entities.
test('[STORY-30A][STORY-74] live bustime feed surfaces detour alerts that carry UNKNOWN enum sentinels', options, async () => {
  const response = await fetch(TTC_ALERTS_URL, { signal: AbortSignal.timeout(12000) });
  assert.ok(response.ok, `TTC alerts HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const feed = bindings.transit_realtime.FeedMessage.decode(bytes);
  const { Alert } = bindings.transit_realtime;
  const enumName = (type, value) => value === undefined ? undefined : Object.keys(type).find(key => type[key] === value) || `UNKNOWN_${value}`;
  const unclassified = value => value === undefined || value === 'UNKNOWN_CAUSE' || value === 'UNKNOWN_EFFECT';
  const expected = [];
  for (const entity of feed.entity || []) {
    if (entity.isDeleted || !entity.alert) continue;
    const informed = entity.alert.informedEntity || [];
    if (informed.length && informed.every(e => e.routeType !== undefined && ![0,3,11].includes(e.routeType))) continue;
    const cause = enumName(Alert.Cause, entity.alert.cause);
    const effect = enumName(Alert.Effect, entity.alert.effect);
    const text = [...(entity.alert.headerText?.translation || []), ...(entity.alert.descriptionText?.translation || [])].map(t => t.text).join('\n');
    if (unclassified(cause) && unclassified(effect) && /\b(detour|diversion|construction)\b/i.test(text)) expected.push(entity.id);
  }
  const ids = new Set(parseTtcAlerts(bytes).items.map(item => item.id));
  for (const id of expected) assert.ok(ids.has(id), `live detour alert ${id} must parse into ttcAlerts`);
});
