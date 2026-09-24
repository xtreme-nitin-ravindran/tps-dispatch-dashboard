import test from "node:test";
import assert from "node:assert/strict";
import { rankSirenMatches, SIREN_RADIUS_KM, SIREN_RESULT_LIMIT } from "../src/siren-matches.js";

const now = Date.UTC(2026, 8, 23, 18);
const origin = [43.65, -79.38];
const call = (id, minutesAgo, coordinates) => ({
  id,
  timestamp: now - minutesAgo * 60_000,
  geography: { coordinates }
});

test("siren matches stay within 2 km and rank by recency then distance", () => {
  const matches = rankSirenMatches([
    call("older-near", 10, [43.6501, -79.38]),
    call("newer-far", 2, [43.66, -79.38]),
    call("newer-near", 2, [43.6502, -79.38]),
    call("outside", 1, [43.68, -79.38]),
    call("stale", 25 * 60, [43.65, -79.38])
  ], origin, { now });

  assert.equal(SIREN_RADIUS_KM, 2);
  assert.deepEqual(matches.map(match => match.call.id), ["newer-near", "newer-far", "older-near"]);
});

test("siren matches show no more than five incidents", () => {
  const calls = Array.from({ length: 8 }, (_, index) => call(String(index), index, [43.65, -79.38]));
  assert.equal(SIREN_RESULT_LIMIT, 5);
  assert.equal(rankSirenMatches(calls, origin, { now }).length, 5);
});

test("siren matching ignores invalid, future, and unmapped calls", () => {
  const matches = rankSirenMatches([
    { id: "unmapped", timestamp: now },
    call("future", -1, [43.65, -79.38]),
    { id: "invalid", timestamp: Number.NaN, geography: { coordinates: origin } }
  ], origin, { now });
  assert.deepEqual(matches, []);
});

test("siren matching has stable ID ordering and default options", () => {
  const timestamp = Date.now();
  const calls = [
    { id: "b", timestamp, geography: { coordinates: origin } },
    { id: "a", timestamp, geography: { coordinates: origin } }
  ];
  assert.deepEqual(rankSirenMatches(calls, origin).map(match => match.call.id), ["a", "b"]);
});
