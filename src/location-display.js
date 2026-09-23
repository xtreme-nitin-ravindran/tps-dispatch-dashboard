import { postalPrefix } from './postal-lookup.js';

const words = { ST:'Street', BLVD:'Boulevard', CRES:'Crescent', RD:'Road', AVE:'Avenue',
  DR:'Drive', CRT:'Court', CT:'Court', PL:'Place', PKWY:'Parkway', HWY:'Highway',
  LN:'Lane', N:'North', S:'South', E:'East', W:'West', TER:'Terrace', GDNS:'Gardens' };
export function streetName(value) {
  return String(value || '').replace(/,\s*(TT|NY|EY|ET|SC|YK)\b/gi, '').trim()
    .split(/\s+/).filter(Boolean).map(word => words[word.toUpperCase()] || word[0]?.toUpperCase() + word.slice(1).toLowerCase()).join(' ');
}
export function locationDisplay(location, points = [], neighbourhood = '') {
  const prefix = postalPrefix(location);
  if (prefix) return { text: `Approximate area: (${prefix}) ${neighbourhood || 'postal area'}`, approximate: true };
  const [street, ...rawCrosses] = String(location || '').split('/').map(streetName);
  const crosses = [...new Set(rawCrosses.filter(cross => cross && cross !== street))];
  const resolved = crosses.filter((_, i) => points[i]);
  if (crosses.length >= 2 && resolved.length === crosses.length) {
    return { text: `${street} between ${crosses.join(' & ')}`, approximate: false };
  }
  if (crosses.length === 1 && resolved.length === 1) {
    return { text: `${street} & ${crosses[0]}`, approximate: false };
  }
  if (resolved.length) return { text: `Approximate location near ${street} & ${resolved[0]}`, approximate: true };
  return { text: `Approximate location on ${street || 'an unspecified street'}${crosses.length >= 2 ? ` between ${crosses.join(' & ')}` : ''}`, approximate: true };
}

// Also handles previously prepared snapshots containing title-cased "Hepc".
export function expandLocationAbbreviations(text) {
  return String(text || '')
    .replace(/\bon HEPC\b/gi, 'along a hydro corridor')
    .replace(/\bHEPC\b/gi, 'hydro corridor');
}
