import test from 'node:test';
import assert from 'node:assert/strict';
import { locationDisplay } from '../src/location-display.js';
const points = [[43.6,-79.5],[43.61,-79.51]];
test('formats resolved TFS segments and distinguishes missing endpoints', () => {
  const location = 'LAKE SHORE BLVD, ET / NORRIS CRES / DOUGLAS BLVD';
  assert.deepEqual(locationDisplay(location, points), { text:'Lake Shore Boulevard between Norris Crescent & Douglas Boulevard', approximate:false });
  assert.deepEqual(locationDisplay(location, [points[0],null]), { text:'Approximate location near Lake Shore Boulevard & Norris Crescent', approximate:true });
  assert.equal(locationDisplay(location).approximate, true);
});
test('formats postal area hints and laneways without claiming exact addresses', () => {
  assert.equal(locationDisplay('M4L', [], 'Beaches / Woodbine').text, 'Approximate area: (M4L) Beaches / Woodbine');
  assert.equal(locationDisplay('M6K').approximate, true);
  assert.equal(locationDisplay('FIFTEENTH ST, ET / LN N LAKE SHORE E FIFTEENTH / BIRMINGHAM ST',points).text, 'Fifteenth Street between Lane North Lake Shore East Fifteenth & Birmingham Street');
});

test('single intersections, duplicate cross streets and missing locations remain readable', () => {
  assert.deepEqual(locationDisplay('KING ST / BAY ST / BAY ST / KING ST', [points[0]]), {text:'King Street & Bay Street',approximate:false});
  assert.deepEqual(locationDisplay('KING ST / BAY ST'), {text:'Approximate location on King Street',approximate:true});
  assert.deepEqual(locationDisplay(null), {text:'Approximate location on an unspecified street',approximate:true});
  assert.deepEqual(locationDisplay('KING ST / BAY ST / YORK ST', [null,points[0]]), {text:'Approximate location near King Street & York Street',approximate:true});
});

test('hydro corridor abbreviations expand without changing other words', async () => {
  const { expandLocationAbbreviations } = await import('../src/location-display.js');
  assert.equal(expandLocationAbbreviations('Approximate location on Hepc'), 'Approximate location along a hydro corridor');
  assert.equal(expandLocationAbbreviations('HEPC / KING ST'), 'hydro corridor / KING ST');
  assert.equal(expandLocationAbbreviations('HEPCOTHER'), 'HEPCOTHER');
  assert.equal(expandLocationAbbreviations(null), '');
});
