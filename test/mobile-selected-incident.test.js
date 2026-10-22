import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { reconcileIncidentSelection } from '../src/incident-selection.js';

const app = await readFile(new URL('../src/app/app.js', import.meta.url), 'utf8');
const maintenanceSrc = await readFile(new URL('../src/map-maintenance.js', import.meta.url), 'utf8');
const markersSrc = await readFile(new URL('../src/incident-markers.js', import.meta.url), 'utf8');

test('[MUST-6][STORY-9] tapping a mobile marker opens the sheet and reveals its matching shared card', () => {
  const markerClickMatch = markersSrc.match(/\.on\("click", event => \{[\s\S]*?\n {8}\}\);/);
  assert.ok(markerClickMatch);
  const markerClick = markerClickMatch[0];
  assert.match(markerClick, /const mobile = isMobileLayout\(\)/);
  assert.match(markerClick, /if \(mobile\) setMobileSheetState\(getMobileSheetState\(\) === "collapsed" \? "half" : getMobileSheetState\(\)\)/);
  assert.match(markerClick, /selectCall\(call\.id\);/);
  assert.match(app, /row\.closest\("#mobileSheetCallList"\)/);
  assert.match(app, /if \(revealRow && selectedRow\) \{[\s\S]*?focus\(\{ preventScroll: true \}\)[\s\S]*?scrollIntoView\([\s\S]*?pin-highlight/);
});

test('[MUST-6][STORY-9] card selection persists into Map and highlights the same marker without changing zoom', () => {
  assert.match(app, /selectCall\(row\.dataset\.callId, \{ pan: !isMobileViewLayout\(\) \|\| mobileView === "map" \}\)/);
  assert.match(app, /setMobileView\(toggle\.dataset\.mobileView, \{ focusSelection: toggle\.dataset\.mobileView === "map" \}\)/);
  assert.match(maintenanceSrc, /focusSelection && mobile && view === "map" && getFocusedCallId\(\)[\s\S]*?selectFocusedCall\(\)/);
  assert.match(app, /selectFocusedCall: \(\) => selectCall\(focusedCallId, \{ panIfNeeded: true \}\)/);
  assert.match(markersSrc, /const selected = id === getFocusedCallId\(\);[\s\S]*?marker\.setIcon\(markerIcon\(call, selected/);
  assert.match(app, /dispatchMap\.getBounds\(\)\.contains\(coordinates\)[\s\S]*?dispatchMap\.panTo\(coordinates/);
  assert.doesNotMatch(app, /setView\(coordinates/);
});

test('[MUST-6][STORY-9] selection clears whenever filtering or refreshed data removes the incident', () => {
  assert.equal(reconcileIncidentSelection('kept', [{ id: 'kept' }]), 'kept');
  assert.equal(reconcileIncidentSelection('filtered-out', [{ id: 'other' }]), null);
  assert.equal(reconcileIncidentSelection('disappeared', []), null);
  assert.match(app, /state\.filtered = eligibleCalls\.filter[\s\S]*?focusedCallId = reconcileIncidentSelection\(focusedCallId, state\.filtered\);[\s\S]*?render\(map, preserveReadingPosition\)/);
  assert.match(app, /state\.calls = snapshot\.calls;[\s\S]*?if \(callsChanged \|\| firstSnapshot\) \{[\s\S]*?applyFilters\(\)/);
});

test('[MUST-6][STORY-9] mobile behavior reuses the desktop selection model and leaves desktop marker behavior intact', () => {
  assert.equal([...app.matchAll(/let focusedCallId = null/g)].length, 1);
  assert.doesNotMatch(app, /mobileSelected|selectedMobile|mobileSelection/);
  assert.match(markersSrc, /if \(!mobile\) setTimeout\(\(\) => reopenPopup\(event\.target\), 0\)/);
  assert.match(maintenanceSrc, /if \(focusSelection && mobile && view === "map" && getFocusedCallId\(\)\)/);
  assert.match(app, /row\.classList\.toggle\("selected", selected\)[\s\S]*?setAttribute\("aria-pressed", String\(selected\)\)/);
});

test('[MUST-6][STORY-9] desktop list and layout remain the default outside the mobile media query', () => {
  assert.match(app, /const host = mobile && mobileView === "map" \? mobileSheetCallList : callsListHome/);
  assert.match(app, /\[els\.callList\][\s\S]*?handleIncidentListClick/);
  assert.match(markersSrc, /if \(!mobile\) setTimeout\(\(\) => reopenPopup\(event\.target\), 0\)/);
});
