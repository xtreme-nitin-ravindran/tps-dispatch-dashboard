import test from 'node:test';
import assert from 'node:assert/strict';
import { reportedAge, compactAge, compactReportedAge, callExplanation, locationConfidence, callStatus, sourceName } from '../src/call-presentation.js';
test('report age covers boundaries, invalid times and clock skew', () => {
 const now = Date.UTC(2026,8,22);
 assert.equal(reportedAge(now-60000,now),'Reported 1 minute ago');
 assert.equal(reportedAge(now-120000,now),'Reported 2 minutes ago');
 assert.equal(reportedAge(now-3600000,now),'Reported 1 hour ago');
 assert.equal(reportedAge(now-7200000,now),'Reported 2 hours ago');
 assert.equal(reportedAge(now-86400000,now),'Reported 1 day ago');
 assert.equal(reportedAge(now-172800000,now),'Reported 2 days ago');
 assert.equal(reportedAge(now+60000,now),'Reported just now');
 assert.equal(reportedAge('invalid',now),'Report time unavailable');
});

test('compact report age fits beside incident distance', () => {
 const now = Date.UTC(2026,8,22);
 assert.equal(compactReportedAge(now-420000,now),'7 min ago');
 assert.equal(compactReportedAge(now-7200000,now),'2 hr ago');
 assert.equal(compactReportedAge(now-86400000,now),'1 day ago');
 assert.equal(compactReportedAge(now-172800000,now),'2 days ago');
 assert.equal(compactReportedAge(now+60000,now),'Just now');
 assert.equal(compactReportedAge('invalid',now),'Time unavailable');
});

test('compact age can label incident update times', () => {
 const now = Date.UTC(2026,8,22);
 assert.equal(compactAge(now-120000,now),'2 min ago');
 assert.equal(compactAge('invalid',now),'Time unavailable');
});

test('explanations preserve uncertainty and leave unfamiliar types unexplained', () => {
 assert.match(callExplanation(' personal injury collision '), /reported to involve an injury/);
 assert.equal(callExplanation('NEW DISPATCH CODE'), '');
 assert.equal(callExplanation(null), '');
 assert.equal(callExplanation('constructor'), '');
});

test('confidence distinguishes unmapped, postal, resolved and approximate locations', () => {
 assert.equal(locationConfidence({}), 'Location not mapped');
 const geography = {coordinates:[43.7,-79.4],approximate:false};
 assert.match(locationConfidence({location:'M5A',geography}), /Broad postal area/);
 assert.match(locationConfidence({location:'A / B',geography}), /not an exact incident address/);
 assert.equal(locationConfidence({geography:{...geography,approximate:true}}), 'Approximate location');
});

test('status only labels active calls when the TFS feed supports it', () => {
 assert.equal(callStatus({source:'TPS',isOngoing:false}), null);
 assert.equal(callStatus({source:'TPS',isOngoing:true}), null);
 assert.equal(callStatus({source:'TFS',isOngoing:true}), 'ONGOING');
 assert.equal(callStatus({source:'TFS',isOngoing:false}), null);
 assert.equal(callStatus({source:'TFS'}), null);
});

test('source names are expanded for card attribution', () => {
 assert.equal(sourceName('TPS'), 'Toronto Police Service');
 assert.equal(sourceName('TFS'), 'Toronto Fire Services');
});
