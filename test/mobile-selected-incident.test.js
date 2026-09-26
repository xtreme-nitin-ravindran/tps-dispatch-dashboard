import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { reconcileIncidentSelection } from '../src/incident-selection.js';

const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');

test('tapping a mobile marker opens the sheet and reveals its matching shared card', () => {
  const markerClickMatch = app.match(/\.on\("click", event => \{[\s\S]*?\n {6}\}\);/);
  assert.ok(markerClickMatch);
  const markerClick = markerClickMatch[0];
  assert.match(markerClick, /const mobile = isMobileViewLayout\(\)/);
  assert.match(markerClick, /if \(mobile\) setMobileSheetState\(mobileSheetState === "collapsed" \? "half" : mobileSheetState\)/);
  assert.match(markerClick, /selectCall\(call\.id, \{ pan: false, revealRow: true \}\)/);
  assert.match(app, /row\.closest\("#mobileSheetCallList"\)/);
  assert.match(app, /if \(revealRow && selectedRow\) \{[\s\S]*?focus\(\{ preventScroll: true \}\)[\s\S]*?scrollIntoView\([\s\S]*?pin-highlight/);
});

test('card selection persists into Map and highlights the same marker without changing zoom', () => {
  assert.match(app, /selectCall\(row\.dataset\.callId, \{ pan: !isMobileViewLayout\(\) \|\| mobileView === "map" \}\)/);
  assert.match(app, /setMobileView\(toggle\.dataset\.mobileView, \{ focusSelection: toggle\.dataset\.mobileView === "map" \}\)/);
  assert.match(app, /focusSelection && isMobileViewLayout\(\) && focusedCallId[\s\S]*?selectCall\(focusedCallId, \{ panIfNeeded: true \}\)/);
  assert.match(app, /const selected = id === focusedCallId;[\s\S]*?marker\.setIcon\(markerIcon\(call, selected/);
  assert.match(app, /dispatchMap\.getBounds\(\)\.contains\(coordinates\)[\s\S]*?dispatchMap\.panTo\(coordinates/);
  assert.doesNotMatch(app, /setView\(coordinates/);
});

test('selection clears whenever filtering or refreshed data removes the incident', () => {
  assert.equal(reconcileIncidentSelection('kept', [{ id: 'kept' }]), 'kept');
  assert.equal(reconcileIncidentSelection('filtered-out', [{ id: 'other' }]), null);
  assert.equal(reconcileIncidentSelection('disappeared', []), null);
  assert.match(app, /state\.filtered = eligibleCalls\.filter[\s\S]*?focusedCallId = reconcileIncidentSelection\(focusedCallId, state\.filtered\);[\s\S]*?render\(map\)/);
  assert.match(app, /state\.calls = snapshot\.calls;[\s\S]*?if \(callsChanged \|\| firstSnapshot\) \{[\s\S]*?applyFilters\(\)/);
});

test('mobile behavior reuses the desktop selection model and leaves desktop marker behavior intact', () => {
  assert.equal([...app.matchAll(/let focusedCallId = null/g)].length, 1);
  assert.doesNotMatch(app, /mobileSelected|selectedMobile|mobileSelection/);
  assert.match(app, /if \(!mobile\) setTimeout\(\(\) => event\.target\.openPopup\(\), 0\)/);
  assert.match(app, /if \(focusSelection && isMobileViewLayout\(\) && focusedCallId\)/);
  assert.match(app, /row\.classList\.toggle\("selected", selected\)[\s\S]*?setAttribute\("aria-pressed", String\(selected\)\)/);
});

test('desktop list and layout remain the default outside the mobile media query', () => {
  assert.match(app, /const activeList = mobile && mobileView === "map" \? mobileSheetCallList : els\.callList/);
  assert.match(app, /\[els\.callList, mobileSheetCallList\][\s\S]*?handleIncidentListClick/);
  assert.match(app, /if \(!mobile\) setTimeout\(\(\) => event\.target\.openPopup\(\), 0\)/);
});
