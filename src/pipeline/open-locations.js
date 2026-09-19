import { streetName, locationDisplay } from '../location-display.js';
import { postalPrefix } from '../postal-lookup.js';
import { policeDivision } from '../police-divisions.js';
import { intersectionDivision } from '../intersection-lookup.js';

const key = value => streetName(value).toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g,' ').trim();
export function createOpenLocationResolver(index, boundaries) {
  const streets = new Map();
  for (const [name, ids] of Object.entries(index.streets)) {
    const normalized = key(name);
    for (const alias of new Set([normalized, normalized.replace(/ (EAST|WEST|NORTH|SOUTH)$/, '')])) {
      if (!streets.has(alias)) streets.set(alias, new Set());
      ids.forEach(id => streets.get(alias).add(id));
    }
  }
  return location => {
    const prefix = postalPrefix(location);
    if (prefix) {
      const area = index.postal[prefix];
      const coordinates = area?.coordinates || null;
      return { ...locationDisplay(location, [], area?.name), coordinates,
        division: policeDivision(location, coordinates, boundaries, {postalEstimate:true}) };
    }
    const [main, ...rawCrosses] = String(location || '').split('/').map(key);
    const crosses = [...new Set(rawCrosses.filter(c => c && c !== main))];
    const ids = streets.get(main);
    const points = crosses.map(cross => {
      const other = streets.get(cross);
      const matches = ids && other ? [...ids].filter(id => other.has(id)) : [];
      // Multiple intersections are ambiguous; never pick one arbitrarily.
      return matches.length === 1 ? index.nodes[matches[0]] : null;
    });
    const resolved = points.filter(Boolean);
    const coordinates = resolved.length === 2
      ? [(resolved[0][0]+resolved[1][0])/2,(resolved[0][1]+resolved[1][1])/2]
      : resolved[0] || null;
    return { ...locationDisplay(location, points), coordinates,
      division: intersectionDivision(location, points, boundaries) };
  };
}
