import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { incidentMatchesSearch } from "../src/incident-search.js";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../app.js", import.meta.url), "utf8");

function listenerFor(start, end = "\n});") {
  const offset = app.indexOf(start);
  return app.slice(offset, app.indexOf(end, offset) + end.length);
}

const incident = location => ({ id: "TPS-123", source: "TPS",
  description: "Medical Emergency", location, division: "Division 53" });

test("existing incident fields support case-insensitive partial matching", () => {
  const call = { ...incident("Queen St & Bay St"), divisionId: "D53", keyword: "Rescue" };
  for (const query of ["medical", "EMERG", "queen", "division 5", "d53", "tps-12", "RESC"])
    assert.equal(incidentMatchesSearch(call, query), true, query);
  assert.equal(incidentMatchesSearch(call, "   "), true);
  assert.equal(incidentMatchesSearch(call, "unrelated place"), false);
});

test("display locations and missing optional fields are handled safely", () => {
  assert.equal(incidentMatchesSearch({}, "harbour", "Harbourfront"), true);
  assert.equal(incidentMatchesSearch({}, null), true);
  assert.equal(incidentMatchesSearch({}, "harbour"), false);
});

test("common intersection separators match the existing location", () => {
  const call = incident("Yonge & Bloor");
  for (const query of ["Yonge & Bloor", "Yonge and Bloor", "Yonge/Bloor", "Yonge - Bloor"]) {
    assert.equal(incidentMatchesSearch(call, query), true, query);
  }
});

test("street order is ignored for unseparated intersection queries", () => {
  const call = incident("Yonge St & Bloor St W");
  assert.equal(incidentMatchesSearch(call, "Yonge Bloor"), true);
  assert.equal(incidentMatchesSearch(call, "Bloor Yonge"), true);
});

test("common street suffix variants are equivalent", () => {
  for (const [location, query] of [
    ["King St & Bay Street", "King Street and Bay St"],
    ["Avenue Rd / Bloor St", "Avenue Road & Bloor Street"],
    ["University Ave - College Street", "University Avenue/College St"]
  ]) assert.equal(incidentMatchesSearch(incident(location), query), true, `${location} / ${query}`);
});

test("street punctuation, whitespace, accents, and directions normalize without broadening matches", () => {
  assert.equal(incidentMatchesSearch(incident("St. Clair Ave W & Bathurst St"), "  bathurst / st clair w  "), true);
  assert.equal(incidentMatchesSearch(incident("Églinton Avenue E & Mount Pleasant Road"),
    "Mount-Pleasant & Eglinton Ave E"), true);
  assert.equal(incidentMatchesSearch(incident("King St E & Parliament St"), "King St W & Parliament"), false);
  assert.equal(incidentMatchesSearch(incident("Yonge St N & Bloor St W"), "Yonge & Bloor"), true);
  assert.equal(incidentMatchesSearch(incident("Yonge St & Bloor St"), "Yonge N & Bloor W"), true);
  assert.equal(incidentMatchesSearch(incident("Yonge St N & Bloor St W"), "Bloor W Yonge N"), true);
});

test("malformed or incomplete intersections fall back without false positives", () => {
  const call = incident("Yonge St & Bloor St");
  for (const query of ["Yonge &", "Yonge & Bloor & Bay", "Yonge Bloor Bay", "!!!"])
    assert.equal(incidentMatchesSearch(call, query), false, query);
  assert.equal(incidentMatchesSearch(call, "& Bloor"), true);
  assert.equal(incidentMatchesSearch(incident("Yonge Street"), "Bloor & Yonge"), false);
});

test("intersection normalization does not match unrelated locations", () => {
  const call = incident("Yonge St & Bloor St");
  for (const query of ["Yonge & College", "Bloor & Bay", "Yonge Boulevard", "Kingston Bloor"]) {
    assert.equal(incidentMatchesSearch(call, query), false, query);
  }
});

test("search input reuses loaded data without refetching", async () => {
  const listenerStart = app.indexOf('els.searchInput.addEventListener("input"');
  const listener = app.slice(listenerStart, app.indexOf("\n});", listenerStart) + 4);
  assert.match(listener, /state\.search = e\.target\.value;\s*applyFilters\(\);/);
  assert.doesNotMatch(listener, /fetch|loadData|checkForChanges|refreshLoop/);
});

test("search control explains its scope and has explicit accessible labels", () => {
  const search = html.slice(html.indexOf('<div class="search-wrap">'), html.indexOf('<div class="control-group">'));
  assert.match(search, /<label[^>]+for="searchInput"[^>]*>Search dispatch calls<\/label>/);
  assert.match(search, /placeholder="Search call type, street, intersection, or division…"/);
  assert.match(search, /aria-describedby="searchHelp"/);
  assert.match(search, /id="searchHelp"[^>]*>Search by call type, street, intersection, or division\.<\/span>/);
  assert.match(search, /id="clearSearch"[^>]+aria-label="Clear search"/);
});

test("a search with no matches renders a clear search-specific empty state", () => {
  assert.match(app, /state\.search\.trim\(\) \? 'No calls match your search\.'/);
  assert.match(app, /Clear the search or try a different call type, street, intersection, or division\./);
});

test("clear search removes only the query and reapplies the current filters", () => {
  const listener = listenerFor('els.clearSearch.addEventListener("click"');
  assert.match(listener, /state\.search = "";\s*applyFilters\(\);\s*els\.searchInput\.focus\(\);/);
  assert.doesNotMatch(listener, /state\.(?:hours|division|serviceFilter|eventFilter|radiusKm|nearby)\s*=/);

  const filteredCalls = [incident("Queen St & Bay St"), incident("Yonge St & Bloor St")]
    .filter(call => call.division === "Division 53");
  assert.equal(filteredCalls.filter(call => incidentMatchesSearch(call, "Queen")).length, 1);
  assert.deepEqual(filteredCalls.filter(call => incidentMatchesSearch(call, "")), filteredCalls);
  assert.match(app, /populateDivisionFilter\(eligibleCalls\);\s*state\.filtered = eligibleCalls\.filter\(call =>\s*\(state\.division[^;]+incidentMatchesSearch/);
});

test("filter and radius changes preserve and resync the current query", () => {
  for (const listener of [
    listenerFor("document.querySelector('#historyHours').addEventListener('change'"),
    listenerFor('els.divisionSelect.addEventListener("change"'),
    listenerFor('document.querySelector("#serviceFilter").addEventListener("change"'),
    listenerFor("radiusToggles.forEach(toggle => toggle.addEventListener('click'", "\n}));")
  ]) {
    assert.doesNotMatch(listener, /state\.search\s*=/);
  }
  assert.match(app, /function applyFilters[\s\S]*?syncSearchControl\(\);[\s\S]*?render\(map\);/);
  assert.match(app, /function syncSearchControl\(\) \{\s*els\.searchInput\.value = state\.search;/);
});
