const INTERSECTION_SEPARATOR = /\s*(?:&|\/|\band\b|\s+-\s+)\s*/i;
const STREET_SUFFIXES = new Set(["st", "street", "rd", "road", "ave", "avenue"]);
const DIRECTIONS = new Set(["n", "north", "s", "south", "e", "east", "w", "west"]);

function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function streetTokens(value) {
  const tokens = String(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/)
    .filter(Boolean);
  const suffix = DIRECTIONS.has(tokens.at(-1)) ? tokens.length - 2 : tokens.length - 1;
  if (STREET_SUFFIXES.has(tokens[suffix])) tokens.splice(suffix, 1);
  return tokens;
}

function splitIntersection(value) {
  const parts = String(value).split(INTERSECTION_SEPARATOR);
  if (parts.length !== 2) return null;
  const streets = parts.map(streetTokens);
  return streets.every(tokens => tokens.length) ? streets : null;
}

function sameStreet(left, right) {
  const leftHasDirection = left.some(token => DIRECTIONS.has(token));
  const rightHasDirection = right.some(token => DIRECTIONS.has(token));
  const comparableLeft = leftHasDirection && rightHasDirection ? left : left.filter(token => !DIRECTIONS.has(token));
  const comparableRight = leftHasDirection && rightHasDirection ? right : right.filter(token => !DIRECTIONS.has(token));
  return comparableLeft.length === comparableRight.length &&
    comparableLeft.every((token, index) => token === comparableRight[index]);
}

function explicitIntersectionMatch(location, query) {
  const candidate = splitIntersection(location);
  const requested = splitIntersection(query);
  if (!candidate || !requested) return false;
  return (sameStreet(candidate[0], requested[0]) && sameStreet(candidate[1], requested[1])) ||
    (sameStreet(candidate[0], requested[1]) && sameStreet(candidate[1], requested[0]));
}

function unorderedStreetNameMatch(location, query) {
  const candidate = splitIntersection(location);
  if (!candidate) return false;
  const requested = streetTokens(query);
  const available = candidate.flat();
  if (!requested.some(token => DIRECTIONS.has(token))) {
    while (available.some(token => DIRECTIONS.has(token))) {
      available.splice(available.findIndex(token => DIRECTIONS.has(token)), 1);
    }
  }
  requested.sort();
  available.sort();
  return requested.length === available.length &&
    requested.every((token, index) => token === available[index]);
}

export function incidentMatchesSearch(call, query, displayLocation = "") {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return true;

  const searchableValues = [call.description, call.location, displayLocation,
    call.division, call.divisionId, call.id, call.keyword].filter(Boolean);

  if (searchableValues.some(value => normalizeText(value).includes(normalizedQuery))) return true;

  return [call.location, displayLocation].filter(Boolean).some(location =>
    explicitIntersectionMatch(location, query) || unorderedStreetNameMatch(location, query)
  );
}
