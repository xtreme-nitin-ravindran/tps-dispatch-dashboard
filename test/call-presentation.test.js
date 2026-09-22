import test from 'node:test';
import assert from 'node:assert/strict';
import { reportedAge, callExplanation } from '../src/call-presentation.js';
test('report age covers boundaries, invalid times and clock skew', () => {
 const now = Date.UTC(2026,8,22);
 assert.equal(reportedAge(now-60000,now),'Reported 1 minute ago');
 assert.equal(reportedAge(now-3600000,now),'Reported 1 hour ago');
 assert.equal(reportedAge(now-86400000,now),'Reported 1 day ago');
 assert.equal(reportedAge(now+60000,now),'Reported just now');
 assert.equal(reportedAge('invalid',now),'Report time unavailable');
});

test('explanations preserve uncertainty and leave unfamiliar types unexplained', () => {
 assert.match(callExplanation(' personal injury collision '), /reported to involve an injury/);
 assert.equal(callExplanation('NEW DISPATCH CODE'), '');
 assert.equal(callExplanation('constructor'), '');
});
