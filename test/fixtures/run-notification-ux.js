import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { buildPushPayload } from '../../src/notification-delivery.js';
import { incidentArrivalState } from '../../src/incident-selection.js';
import { incidentDeepLink } from '../../src/view-controls.js';
import { deliveryCandidate } from './watch-delivery-backend.js';

const source = await readFile(new URL('../../service-worker.js', import.meta.url), 'utf8');

function worker(windowClients = []) {
  const listeners = {};
  const calls = { notifications: [], opened: [] };
  const context = {
    URL, Set, Promise,
    self: {
      registration: {
        scope: 'https://sirento.example/',
        async showNotification(title, options) { calls.notifications.push({ title, options }); }
      },
      location: { origin: 'https://sirento.example' },
      clients: {
        claim: async () => {}, matchAll: async () => windowClients,
        openWindow: async url => { calls.opened.push(url); }
      },
      addEventListener(type, listener) { listeners[type] = listener; }, skipWaiting() {}
    },
    caches: { open: async () => ({ addAll: async () => {} }), keys: async () => [], delete: async () => {}, match: async () => null },
    fetch: async () => null
  };
  vm.runInNewContext(source, context);
  return { listeners, calls };
}

const canonicalUrl = incidentDeepLink('https://sirento.example/?private=x', 'fixture-incident-1');
const base = deliveryCandidate({ incidentId: 'fixture-incident-1', incidentUrl: canonicalUrl });
const payloads = [
  buildPushPayload({ ...base, incident: { ...base.incident, description: 'Residential Fire Alarm', distanceKm: 0.84 } }),
  buildPushPayload({ ...base, incident: { ...base.incident, source: 'TPS', description: 'Robbery', distanceKm: 0.84 } }),
  buildPushPayload({ ...base, notificationKind: 'updated:2026-09-25T12:05:45.000Z', incident: { ...base.incident, description: 'Residential Fire Alarm', distanceKm: 0.84 } }),
  buildPushPayload({ ...base, incident: { ...base.incident, description: 'Residential Fire Alarm' } })
];

const rendered = worker();
for (const payload of payloads) {
  let work;
  rendered.listeners.push({ data: { json: () => payload }, waitUntil(value) { work = value; } });
  await work;
}

const existingEvents = [];
const existing = worker([{
  url: 'https://sirento.example/',
  async navigate(url) { existingEvents.push(`navigate:${url}`); return this; },
  async focus() { existingEvents.push('focus'); }
}]);
let existingWork;
existing.listeners.notificationclick({
  notification: { data: { url: canonicalUrl, incidentId: 'fixture-incident-1' }, close() { existingEvents.push('close'); } },
  waitUntil(value) { existingWork = value; }
});
await existingWork;

const closed = worker();
let closedWork;
closed.listeners.notificationclick({
  notification: { data: { url: canonicalUrl, incidentId: 'fixture-incident-1' }, close() {} },
  waitUntil(value) { closedWork = value; }
});
await closedWork;

const rejected = worker();
let rejectedWork;
rejected.listeners.notificationclick({
  notification: { data: { url: 'https://evil.example/?view=1&incident=fixture-incident-1', incidentId: 'fixture-incident-1' }, close() {} },
  waitUntil(value) { rejectedWork = value; }
});

const incidents = [{ id: 'fixture-incident-1' }];
console.log(JSON.stringify({
  rendered: rendered.calls.notifications.map(item => ({ title: item.title, body: item.options.body })),
  existingClient: { accepted: true, events: existingEvents },
  closedClient: { opened: closed.calls.opened },
  externalRejected: await rejectedWork === false && rejected.calls.opened.length === 0,
  desktopArrival: incidentArrivalState('fixture-incident-1', incidents, incidents),
  mobileArrival: incidentArrivalState('fixture-incident-1', incidents, [], { mobile: true }),
  missingArrival: incidentArrivalState('expired-incident', incidents, [])
}, null, 2));
