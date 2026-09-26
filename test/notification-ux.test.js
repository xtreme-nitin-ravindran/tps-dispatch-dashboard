import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { formatNotificationContent } from '../src/notification-content.js';
import { incidentArrivalState, MISSING_INCIDENT_MESSAGE } from '../src/incident-selection.js';
import { pushFixtureOptions } from '../src/push-subscription.js';
import { incidentDeepLink, readSharedIncident } from '../src/view-controls.js';

const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');

test('production wording is concise, source-aware, and differs for the two supported kinds', () => {
  const base = { notificationKind: 'new:v1', incident: { source: 'TFS', description: 'Residential Fire Alarm', distanceKm: 0.84 } };
  assert.deepEqual(formatNotificationContent(base), {
    title: 'SirenTO — New incident nearby',
    body: 'Residential Fire Alarm · 0.8 km away · Toronto Fire Services'
  });
  assert.deepEqual(formatNotificationContent({
    notificationKind: 'updated:2026-09-25T12:05:45.000Z',
    incident: { source: 'TPS', description: 'Robbery' }
  }), {
    title: 'SirenTO — Incident update nearby',
    body: 'Robbery · Toronto Police Service'
  });
});

test('notification content omits invalid distance and private watch context', () => {
  const candidate = {
    notificationKind: 'new:v1', watchId: 'private-watch', possessionToken: 'private-token',
    incident: { source: 'TFS', description: 'Alarm', distanceKm: NaN },
    subscription: { endpoint: 'https://push.example/private' }
  };
  const content = formatNotificationContent(candidate);
  assert.equal(content.body, 'Alarm · Toronto Fire Services');
  assert.doesNotMatch(JSON.stringify(content), /private|push\.example|Home|latitude|longitude/i);
  assert.equal(formatNotificationContent(null).body, 'Incident');
  assert.equal(formatNotificationContent({ incident: { source: 'TFS', description: null, distanceKm: -1 } }).body,
    'Toronto Fire Services incident · Toronto Fire Services');
  assert.equal(formatNotificationContent({ incident: { source: 'OTHER', description: '   ' } }).body, 'Incident');
  const shortened = formatNotificationContent({ incident: { source: 'TPS', description: `  ${'x'.repeat(220)}  ` } });
  assert.ok(shortened.body.endsWith('… · Toronto Police Service'));
  assert.ok(shortened.body.length <= 180);
});

test('canonical incident links reuse the established parser and contain only allowlisted context', () => {
  const url = new URL(incidentDeepLink('https://sirento.example/app/?secret=x#private', 'TPS/42'));
  assert.equal(url.href, 'https://sirento.example/app/?view=1&incident=TPS%2F42');
  assert.equal(readSharedIncident(url.searchParams), 'TPS/42');
  assert.deepEqual([...url.searchParams.keys()], ['view', 'incident']);
  assert.throws(() => incidentDeepLink('https://sirento.example/', ''), /incidentId/);
  assert.throws(() => incidentDeepLink('https://sirento.example/', null), /incidentId/);
  assert.throws(() => incidentDeepLink('https://sirento.example/', 'x'.repeat(301)), /incidentId/);
});

test('arrival restoration distinguishes visible, filtered, missing, mobile, and desktop states', () => {
  const incidents = [{ id: 'present' }];
  assert.deepEqual(incidentArrivalState('present', incidents, incidents), {
    id: 'present', found: true, missing: false, needsReveal: false, mobileView: null, mobileSheetState: null
  });
  assert.deepEqual(incidentArrivalState('present', incidents, [], { mobile: true }), {
    id: 'present', found: true, missing: false, needsReveal: true, mobileView: 'map', mobileSheetState: 'half'
  });
  assert.deepEqual(incidentArrivalState('missing', incidents, []), {
    id: null, found: false, missing: true, needsReveal: false, message: MISSING_INCIDENT_MESSAGE
  });
  assert.deepEqual(incidentArrivalState(null, incidents, []), {
    id: null, found: false, missing: false, needsReveal: false
  });
  assert.match(app, /restorePendingIncident\(\)[\s\S]*?state\.calls, state\.filtered[\s\S]*?setMobileSheetState/);
});

test('manual notification fixtures are loopback-only production guards', () => {
  const search = '?push=new-tfs&arrival=present&click=existing-client';
  assert.deepEqual(pushFixtureOptions({ hostname: '127.0.0.1', search }), {
    push: 'new-tfs', arrival: 'present', click: 'existing-client'
  });
  assert.equal(pushFixtureOptions({ hostname: 'sirento.example', search }), null);
});
