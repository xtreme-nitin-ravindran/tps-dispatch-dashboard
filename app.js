import { sourceStatus, sourceStatusText } from "./src/source-status.js?v=source-states-1";
import { clusterPoints, spreadPoint, focusGroup } from "./src/map-clusters.js";
import { filterDefaults, filterSummary, readFilters, shareView, shareIncidentView, readSharedIncident, shareIncident, loadPreferences, savePreferences } from "./src/view-controls.js";
import { renderDisruptions } from "./src/disruptions/ui.js?v=source-states-1";
import { compactAge, compactReportedAge, locationConfidence, callStatus, sourceName } from "./src/call-presentation.js?v=incident-cards-1";
import { distanceKm, distanceLabel, withinGeographicScope } from "./src/nearby.js?v=radius-controls-1";
import { policeUnitLabel } from "./src/tps/unit-label.js?v=3";
import { incidentCategory } from "./src/tfs/category.js";
import { locationDisplay, expandLocationAbbreviations } from "./src/location-display.js?v=hydro-corridor-1";
import { isWithinHistoryWindow } from "./src/tfs/time.js";
import { nearbySummary } from "./src/nearby-summary.js";
import { nearbyEmptyState, nextNearbyRadius, radiusLabel } from "./src/nearby-empty-state.js";
import { nearbyCtaCopy } from "./src/cta-copy.js";
import { rankSirenMatches, SIREN_RADIUS_KM } from "./src/siren-matches.js";
import { reconcileIncidentSelection, restoreSharedIncident } from "./src/incident-selection.js";
import { markerAgeLabel, markerAgeTier, markerGlyph } from "./src/marker-age.js";
import { incidentBadge, incidentBadgeExpiry } from "./src/incident-badge.js?v=incident-badges-1";
import { incidentMatchesSearch } from "./src/incident-search.js";
import { DISPATCH_GLOSSARY_FOOTER, glossaryDefinition } from "./src/dispatch-glossary.js?v=glossary-1";
import { applyTheme, normalizeThemePreference } from "./src/theme.js";
import { createRefreshFreshnessTracker } from "./src/refresh-freshness.js";
import { mobileSheetActionLabel, mobileSheetStateAfterDrag, nextMobileSheetState } from "./src/mobile-bottom-sheet.js";
import { NEARBY_SORT_DEFAULT, sortNearbyCalls } from "./src/nearby-sort.js";

const CONFIG = {
  snapshotUrl: "https://raw.githubusercontent.com/xtreme-nitin-ravindran/tps-dispatch-dashboard/data/data/current.json",
  refreshCheckMs: 30_000
};

const state = {
  nearby: null,
  radiusKm: null,
  hours: 24,
  calls: [],
  filtered: [],
  feeds: {},
  lastIngest: null,
  fetchedAt: null,
  search: "",
  division: "all",
  serviceFilter: "all",
  eventFilter: "all",
  nearbySort: NEARBY_SORT_DEFAULT
};

const els = {
  lastUpdated: document.querySelector("#lastUpdated"),
  windowLabel: document.querySelector("#windowLabel"),
  searchInput: document.querySelector("#searchInput"),
  clearSearch: document.querySelector("#clearSearch"),
  divisionSelect: document.querySelector("#divisionSelect"),
  callsCount: document.querySelector("#callsCount"),
  callsCountFoot: document.querySelector("#callsCountFoot"),
  divisionCount: document.querySelector("#divisionCount"),
  busiestDivision: document.querySelector("#busiestDivision"),
  busiestDivisionFoot: document.querySelector("#busiestDivisionFoot"),
  topCall: document.querySelector("#topCall"),
  topCallFoot: document.querySelector("#topCallFoot"),
  resultCount: document.querySelector("#resultCount"),
  callList: document.querySelector("#callList"),
  eventToggles: document.querySelectorAll("[data-event-filter]"),
  dispatchMap: document.querySelector("#dispatchMap"),
  mapStatus: document.querySelector("#mapStatus"),
  sourceUpdated: document.querySelector("#sourceUpdated"),
  mapEmpty: document.querySelector("#mapEmpty"),
  callTemplate: document.querySelector("#callTemplate"),
  footerClock: document.querySelector("#footerClock")
};
const refreshStatus = document.querySelector('#refreshStatus');
const refreshFreshnessIndicator = document.querySelector('#refreshFreshness');
const refreshFreshness = createRefreshFreshnessTracker({
  onChange(label) {
    refreshFreshnessIndicator.textContent = label;
    refreshFreshnessIndicator.hidden = !label;
  }
});
const callsFeedStatus = document.querySelector('#callsFeedStatus');
const radiusToggles = document.querySelectorAll('[data-radius-km]');
const mobileViewToggles = document.querySelectorAll('[data-mobile-view]');
const mobileBottomSheet = document.querySelector('#mobileBottomSheet');
const mobileSheetToggle = document.querySelector('#mobileSheetToggle');
const mobileSheetStateLabel = document.querySelector('#mobileSheetState');
const mobileSheetSummary = document.querySelector('#mobileSheetSummary');
const mobileSheetStateControls = document.querySelectorAll('[data-sheet-target]');
const mobileSheetCallList = document.querySelector('#mobileSheetCallList');
const mobileCallsFeedStatus = document.querySelector('#mobileCallsFeedStatus');
const nearbySort = document.querySelector('#nearbySort');
const expandNearbyRadius = document.querySelector('#expandNearbyRadius');

const TORONTO_CENTER = [43.7001, -79.42];
let dispatchMap = null;
let mapMarkers = new Map();
let callLayer;
let expandedCluster = new Set();
let focusedCallId = null;
let rowHighlightTimer;
let mapHasFitted = false;
let lastRadiusKm = 2;
let boundaryVisible = true;
let sirenMode = false;
let sirenMatches = [];
let choosingArea = false;
let nearbyOriginKind = "device";
let nearbyOriginLayer = null;
let incidentBadgeTimer = null;
let glossaryPopoverSequence = 0;
let themePreference = "system";
let mobileView = "map";
let mobileSheetState = "collapsed";
let mobileSheetDrag = null;
let suppressNextMobileSheetClick = false;
const initialParams = new URLSearchParams(location.search);
let pendingSharedIncidentId = readSharedIncident(initialParams);
const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
const themeColorMeta = document.querySelector('meta[name="theme-color"]');
const mobileViewQuery = "(max-width: 680px), (max-width: 950px) and (max-height: 500px) and (pointer: coarse)";
function syncTheme() {
  applyTheme(document.documentElement, themeColorMeta, themePreference, systemTheme.matches);
}
function rememberPreferences(stateOverrides = {}) {
  try { savePreferences(localStorage,{...state,...stateOverrides},{roads:document.querySelector('#roadOverlay').checked,boundaries:boundaryVisible,theme:themePreference,mobileView}); } catch { /* Browsing still works when storage is blocked. */ }
}

function isMobileViewLayout() {
  return window.matchMedia(mobileViewQuery).matches;
}

function setMobileView(view, { focusSelection = false, persist = true } = {}) {
  if (view !== "map" && view !== "calls") return;
  mobileView = view;
  document.documentElement.dataset.mobileView = view;
  mobileViewToggles.forEach(toggle => {
    const active = toggle.dataset.mobileView === view;
    toggle.classList.toggle("active", active);
    toggle.setAttribute("aria-pressed", String(active));
  });
  if (persist) rememberPreferences();
  if (view === "map") requestAnimationFrame(() => {
    dispatchMap?.invalidateSize({ pan: false });
    if (focusSelection && isMobileViewLayout() && focusedCallId) {
      selectCall(focusedCallId, { panIfNeeded: true });
    }
  });
}

mobileViewToggles.forEach(toggle => toggle.addEventListener("click", () => {
  setMobileView(toggle.dataset.mobileView, { focusSelection: toggle.dataset.mobileView === "map" });
}));
setMobileView(mobileView, { persist: false });

function setMobileSheetState(nextState) {
  if (!mobileBottomSheet || !["collapsed", "half", "expanded"].includes(nextState)) return;
  mobileSheetState = nextState;
  mobileBottomSheet.dataset.sheetState = nextState;
  document.documentElement.dataset.mobileSheetState = nextState;
  mobileSheetStateLabel.textContent = nextState[0].toUpperCase() + nextState.slice(1);
  mobileSheetToggle.setAttribute("aria-expanded", String(nextState !== "collapsed"));
  mobileSheetToggle.setAttribute("aria-label", mobileSheetActionLabel(nextState));
  mobileSheetStateControls.forEach(control => {
    control.setAttribute("aria-pressed", String(control.dataset.sheetTarget === nextState));
  });
  requestAnimationFrame(() => dispatchMap?.invalidateSize({ pan: false }));
}

mobileSheetToggle?.addEventListener("click", () => {
  if (suppressNextMobileSheetClick) {
    suppressNextMobileSheetClick = false;
    return;
  }
  const direction = mobileSheetState === "expanded" ? -2 : 1;
  setMobileSheetState(nextMobileSheetState(mobileSheetState, direction));
});

mobileSheetToggle?.addEventListener("pointerdown", event => {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  mobileSheetDrag = { pointerId: event.pointerId, startY: event.clientY, handled: false };
  mobileSheetToggle.setPointerCapture?.(event.pointerId);
});

mobileSheetToggle?.addEventListener("pointerup", event => {
  if (!mobileSheetDrag || mobileSheetDrag.pointerId !== event.pointerId) return;
  const nextState = mobileSheetStateAfterDrag(mobileSheetState, event.clientY - mobileSheetDrag.startY);
  suppressNextMobileSheetClick = nextState !== mobileSheetState;
  if (suppressNextMobileSheetClick) setMobileSheetState(nextState);
  mobileSheetDrag = null;
});

mobileSheetToggle?.addEventListener("pointercancel", () => { mobileSheetDrag = null; });
mobileSheetStateControls.forEach(control => control.addEventListener("click", () => {
  setMobileSheetState(control.dataset.sheetTarget);
}));
setMobileSheetState(mobileSheetState);

function escapeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeCall(row) {
  const eventType = escapeText(row.event_type || row.eventType).toLowerCase();
  const description = escapeText(row.description || "Call for Service");
  const eventCategory = incidentCategory(description);
  const isFireRelated = eventCategory === "fire";
  const rawTimestamp = row.timestamp ?? row.time_unix;
  const unix = Number(rawTimestamp);
  const date = Number.isFinite(unix) && unix > 0
    ? new Date(unix * (unix < 10_000_000_000 ? 1000 : 1))
    : parseLooseTime(rawTimestamp) || parseLooseTime(row.time);

  return {
    source: row.source === "TPS" ? "TPS" : "TFS",
    id: escapeText(row.id || row.event_id || "—"),
    timestamp: date?.getTime() || Date.now(),
    time: date || new Date(),
    updatedAt: parseLooseTime(row.lastMeaningfulUpdateAt),
    firstSeenAt: parseLooseTime(row.firstSeenAt),
    lastMeaningfulUpdateAt: parseLooseTime(row.lastMeaningfulUpdateAt),
    division: policeUnitLabel(row.geography?.division),
    divisionId: row.geography?.division || "Unknown",
    geography: row.geography,
    description,
    location: escapeText(row.location || "Location not published"),
    isFireRelated,
    isOngoing: typeof row.isOngoing === "boolean" ? row.isOngoing : eventType === "fire" && Number(row.cad) === 1,
    eventCategory,
    alarmLevel: isFireRelated && (row.alarmLevel ?? row.alarm_level) !== undefined
      ? escapeText(row.alarmLevel ?? row.alarm_level)
      : "",
    unitGroups: Array.isArray(row.vehicles)
      ? row.vehicles.map(vehicle => ({ type: vehicle.type, values: vehicle.numbers.join(", ") }))
      : formatUnitGroups(row.units),
    latitude: numberOrNull(row.latitude ?? row.lat),
    longitude: numberOrNull(row.longitude ?? row.lng ?? row.lon),
    highlight: Boolean(row.highlight),
    keyword: escapeText(row.keyword || "")
  };
}

function formatUnitGroups(units) {
  if (!units) return [];

  const groups = new Map();
  let currentType = "Other";
  const addUnit = (type, value) => {
    if (!value) return;
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type).push(value);
  };

  for (const rawUnit of String(units).split(",")) {
    const unit = rawUnit.trim();
    if (!unit) continue;
    const match = unit.match(/^(Aerial|Fire\s+Invest(?:\.|igator)?|Hazmat|Air\s+Light|Pumper|Rescue|Ladder|Tower|Highrise|Cmd\.?\s*unit|Command)\s*[- ]?\s*(.*)$/i);
    const compact = unit.replace(/[\s.-]+/g, "");

    if (match) {
      currentType = normalizeUnitType(match[1]);
      addUnit(currentType, match[2]);
    } else if (/^\d+$/.test(unit) && currentType !== "Other") {
      addUnit(currentType, unit);
    } else if (/^C\d+$/i.test(compact)) {
      currentType = "Command Unit";
      addUnit(currentType, compact.slice(1));
    } else if (/^S\d+$/i.test(compact)) {
      currentType = "Squad Unit";
      addUnit(currentType, compact.slice(1));
    } else if (/^REHAB\d*$/i.test(compact)) {
      currentType = "Rehab Unit";
      addUnit(currentType, compact.slice(5) || "unit");
    } else {
      currentType = "Other Unit";
      addUnit(currentType, unit);
    }
  }

  return [...groups.entries()].map(([type, values]) => ({ type, values: values.join(", ") }));
}

function normalizeUnitType(type) {
  const normalized = type.toLowerCase().replace(/\s+/g, " ").trim();
  if (normalized === "aerial") return "Aerial Truck";
  if (normalized === "pumper") return "Fire Truck";
  if (normalized === "rescue") return "Rescue Truck";
  if (normalized === "ladder") return "Ladder Truck";
  if (normalized === "tower") return "Tower Truck";
  if (normalized === "highrise") return "High-Rise Unit";
  if (normalized === "hazmat") return "Hazmat Unit";
  if (normalized === "air light") return "Air/Light Unit";
  if (normalized.startsWith("fire invest")) return "Fire Investigator";
  if (normalized.startsWith("cmd") || normalized === "command") return "Command Unit";
  return normalized === "other"
    ? "Other Unit"
    : normalized.replace(/\b\w/g, character => character.toUpperCase()) + " Unit";
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseLooseTime(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function fetchSnapshot() {
  const response = await fetch(`${CONFIG.snapshotUrl}?ts=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Official TFS snapshot returned HTTP ${response.status}`);
  const payload = await response.json();
  const rows = Array.isArray(payload) ? payload : (payload.incidents || []);
  return {
    calls: rows.map(row => normalizeCall(row))
      .sort((a, b) => b.timestamp - a.timestamp),
    disruptions: payload.disruptions,
    feeds: payload.feeds,
    fetchedAt: payload.fetchedAt || null,
    updatedAt: payload.sourceUpdatedAt || payload.fetchedAt || null
  };
}

let sourceHighlightTimer;
let snapshotLoaded = false;
function setRefreshState(status) {
  refreshStatus.classList.toggle('is-updating',status === 'updating');
  refreshStatus.classList.toggle('is-error',status === 'error');
  refreshStatus.textContent = status === 'updating'
    ? 'Updating…'
    : status === 'error'
      ? snapshotLoaded ? 'Latest refresh failed. Previously loaded data remains visible.' : 'Dispatch data is temporarily unavailable.'
      : 'Updates from official TFS and TPS feeds.';
}

async function loadData() {
  setRefreshState('updating');
  try {
    const snapshot = await fetchSnapshot();
    const scrollTop = els.callList.scrollTop;
    const firstSnapshot = !snapshotLoaded;
    snapshotLoaded = true;
    const previousSourceTime = parseLooseTime(state.lastIngest)?.getTime();
    const callsChanged = JSON.stringify(state.calls) !== JSON.stringify(snapshot.calls);
    state.disruptions = snapshot.disruptions;
    state.calls = snapshot.calls;
    state.feeds = snapshot.feeds || {};
    state.lastIngest = snapshot.updatedAt;
    state.fetchedAt = snapshot.fetchedAt;
    const sourceTime = parseLooseTime(snapshot.updatedAt);
    const sources = [
      ['TFS', snapshot.feeds?.TFS || {fetchedAt:snapshot.fetchedAt, sourceUpdatedAt:snapshot.updatedAt}],
      ['TPS', snapshot.feeds?.TPS],
      ['Road restrictions', snapshot.disruptions?.roads],
      ['TTC alerts', snapshot.disruptions?.transit]
    ];
    const sourceSubjects = {'TFS':'TFS','TPS':'TPS','Road restrictions':'Road restriction','TTC alerts':'TTC alert'};
    els.sourceUpdated.replaceChildren(...sources.flatMap(([name,feed]) => {
      const info = sourceStatus(name,feed);
      const label = document.createElement('span');
      label.textContent = `${name}:`;
      const value = document.createElement('span');
      value.className = `source-time source-state-${info.status}`;
      value.textContent = sourceStatusText(sourceSubjects[name],feed);
      return [label, value];
    }));
    if (callsChanged || firstSnapshot) {
      applyFilters();
      els.callList.scrollTop = scrollTop;
    }
    if (pendingSharedIncidentId !== null) {
      const requestedId = pendingSharedIncidentId;
      pendingSharedIncidentId = null;
      const restored = restoreSharedIncident(requestedId, state.filtered);
      const status = document.querySelector('#sharedIncidentStatus');
      if (restored.found) {
        status.hidden = true;
        selectCall(restored.id, { revealRow: true });
      } else {
        status.textContent = 'This shared incident is no longer available.';
        status.hidden = false;
      }
    }
    renderDisruptions(state.disruptions, radiusFilterOrigin(), state.radiusKm, dispatchMap);
    updateFreshness();
    refreshFreshness.complete(true);
    setRefreshState('idle');
    if (previousSourceTime != null && sourceTime && sourceTime.getTime() !== previousSourceTime) {
      clearTimeout(sourceHighlightTimer);
      els.sourceUpdated.classList.add('source-just-updated');
      sourceHighlightTimer = setTimeout(() => {
        els.sourceUpdated.classList.remove('source-just-updated');
      }, 4000);
    }
  } catch (error) {
    console.error(error);
    refreshFreshness.complete(false);
    setRefreshState('error');
    if (!snapshotLoaded) {
      els.callList.innerHTML = `
        <div class="error-state">
          <strong>Couldn’t load the public dispatch feed.</strong>
          <p>${escapeText(error.message)}</p>
          <p>Some browsers or networks may block cross-origin requests. See README.md for the optional proxy setup.</p>
        </div>`;
    }
  }
}

function populateDivisionFilter(calls) {
  const current = state.division;
  const divisions = [...new Set(calls.map(c => c.division).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  // A zero-result nearby radius should not erase a division the user selected.
  if (!calls.length && state.radiusKm !== null && current !== "all" && !divisions.includes(current)) {
    divisions.push(current);
  }

  els.divisionSelect.innerHTML = `<option value="all">All police divisions</option>` +
    divisions.map(d => `<option value="${encodeURIComponent(d)}">${d}</option>`).join("");

  const exists = divisions.includes(current);
  state.division = exists ? current : "all";
  els.divisionSelect.value = state.division === "all" ? "all" : encodeURIComponent(state.division);
}

function applyFilters({ map = true } = {}) {
  const eligibleCalls = state.calls.filter(call => {
    if (!withinGeographicScope(state.nearby, state.radiusKm, coordinatesForCall(call))) return false;
    if (state.serviceFilter !== "all" && call.source !== state.serviceFilter) return false;
    if (!isWithinHistoryWindow(call.timestamp, state.hours)) return false;
    if (state.eventFilter === "ongoing" && !call.isOngoing) return false;
    if (state.eventFilter !== "all" && state.eventFilter !== "ongoing" && call.eventCategory !== state.eventFilter) return false;
    return true;
  });

  // Build the facet before applying its own selection or search, so a query cannot reset the division.
  populateDivisionFilter(eligibleCalls);
  state.filtered = eligibleCalls.filter(call =>
    (state.division === "all" || call.division === state.division) &&
    incidentMatchesSearch(call, state.search, displayLocation(call).text)
  );
  focusedCallId = reconcileIncidentSelection(focusedCallId, state.filtered);
  document.querySelector("#filterSummary").textContent = filterSummary(state);
  syncSearchControl();
  render(map);
  rememberPreferences();
}

function render(map = true) {
  if (els.windowLabel) {
    els.windowLabel.textContent = `${state.hours} hour${state.hours === 1 ? "" : "s"}`;
  }
  renderStats();
  renderNearbySummary();
  renderSirenResults();
  renderCalls();
  if (map) renderMap();
  renderDisruptions(state.disruptions, radiusFilterOrigin(), state.radiusKm, dispatchMap);
  els.eventToggles.forEach(toggle => {
    const active = toggle.dataset.eventFilter === state.eventFilter;
    toggle.classList.toggle("active", active);
    toggle.setAttribute("aria-pressed", String(active));
  });
}

function relevantIncidentFeeds() {
  const names=state.serviceFilter === 'all' ? ['TFS','TPS'] : [state.serviceFilter];
  return names.map(name => [name,state.feeds?.[name]]);
}

function incidentAvailability() {
  const feeds=relevantIncidentFeeds().map(([name,feed]) => ({name,...sourceStatus(name,feed)}));
  const unavailable=feeds.filter(feed => ['unavailable','not loaded'].includes(feed.status));
  const stale=feeds.filter(feed => feed.status === 'stale');
  const cachedSources=new Set(state.calls.map(call => call.source));
  return {
    unavailable,
    stale,
    hasRelevantCachedData:feeds.some(feed => cachedSources.has(feed.name)),
    allUnavailable:unavailable.length === feeds.length
  };
}

function renderIncidentFeedStatus() {
  const availability=incidentAvailability();
  const messages=[];
  for (const feed of availability.unavailable) {
    messages.push(feed.age
      ? `${feed.name} data is temporarily unavailable. Last successfully updated ${feed.age}. Previously loaded calls remain visible.`
      : `${feed.name} data is temporarily unavailable.`);
  }
  for (const feed of availability.stale) messages.push(`${feed.name}: Last successfully updated ${feed.age}. Data may be stale.`);
  callsFeedStatus.textContent=messages.join(' ');
  callsFeedStatus.hidden=!messages.length;
  return availability;
}

function updateSirenMatches() {
  sirenMatches = sirenMode && state.nearby
    ? rankSirenMatches(state.calls, state.nearby)
    : [];
}

function renderSirenResults() {
  const panel = document.querySelector("#sirenResults");
  const list = document.querySelector("#sirenResultsList");
  panel.hidden = !sirenMode || !state.nearby;
  if (panel.hidden) {
    sirenMatches = [];
    list.replaceChildren();
    return;
  }

  updateSirenMatches();
  list.replaceChildren();
  if (!sirenMatches.length) {
    const empty = document.createElement("li");
    empty.className = "siren-results-empty";
    const availability=incidentAvailability();
    empty.textContent = availability.allUnavailable && !availability.hasRelevantCachedData
      ? 'Public dispatch data is temporarily unavailable.'
      : "No mapped public calls from the last 24 hours were found within 2 km.";
    list.append(empty);
    return;
  }

  for (const { call, distanceKm: distance } of sirenMatches) {
    const item = document.createElement("li");
    item.append(createIncidentCard(call, { distance: distanceLabel(distance), variant: "nearby" }));
    list.append(item);
  }
}

function renderNearbySummary() {
  const summary = document.querySelector("#nearbySummary");
  summary.hidden = false;
  document.querySelector("#nearbySummaryHeading").textContent = state.radiusKm === null ? "TORONTO SUMMARY" : "NEARBY SUMMARY";
  const empty = !state.filtered.length
    ? nearbyEmptyState({
        radiusKm: state.radiusKm,
        origin: state.nearby,
        matchingCalls: callsMatchingNonGeographicFilters(),
        datasetIsEmpty: !state.calls.length,
        coordinatesForCall
      })
    : null;
  const summaryText = empty?.message
    || nearbySummary(state.filtered, state.radiusKm, Date.now(), state.nearby, coordinatesForCall);
  document.querySelector("#nearbySummaryText").textContent = summaryText;
  if (mobileSheetSummary) mobileSheetSummary.textContent = summaryText;
  expandNearbyRadius.hidden = empty?.nextRadiusKm === undefined;
  if (!expandNearbyRadius.hidden) {
    expandNearbyRadius.dataset.radiusKm = empty.nextRadiusKm === null ? 'toronto' : String(empty.nextRadiusKm);
    expandNearbyRadius.textContent = `Expand to ${radiusLabel(empty.nextRadiusKm)}`;
  }
  if (!state.nearby && state.nearbySort === 'nearest') state.nearbySort = NEARBY_SORT_DEFAULT;
  nearbySort.value = state.nearbySort;
  nearbySort.querySelector('[value="nearest"]').disabled = !state.nearby;
}

function callsMatchingNonGeographicFilters() {
  return state.calls.filter(call => {
    if (state.serviceFilter !== "all" && call.source !== state.serviceFilter) return false;
    if (!isWithinHistoryWindow(call.timestamp, state.hours)) return false;
    if (state.eventFilter === "ongoing" && !call.isOngoing) return false;
    if (state.eventFilter !== "all" && state.eventFilter !== "ongoing" && call.eventCategory !== state.eventFilter) return false;
    if (state.division !== "all" && call.division !== state.division) return false;
    return incidentMatchesSearch(call, state.search, displayLocation(call).text);
  });
}

function renderStats() {
  if (!els.callsCount) return;
  const calls = state.filtered;
  const divisions = countBy(calls, c => c.division);
  const descriptions = countBy(calls, c => c.description);

  const topDivision = maxEntry(divisions);
  const topDescription = maxEntry(descriptions);

  els.callsCount.textContent = calls.length.toLocaleString();
  els.callsCountFoot.textContent = state.search || state.division !== "all"
    ? "After current filters"
    : `Public calls in the last ${state.hours}h`;

  els.divisionCount.textContent = divisions.size.toLocaleString();

  els.busiestDivision.textContent = topDivision?.[0] || "—";
  els.busiestDivisionFoot.textContent = topDivision
    ? `${topDivision[1]} call${topDivision[1] === 1 ? "" : "s"}`
    : "No calls in current view";

  els.topCall.textContent = topDescription?.[0] || "—";
  els.topCallFoot.textContent = topDescription
    ? `${topDescription[1]} call${topDescription[1] === 1 ? "" : "s"}`
    : "No calls in current view";
}

async function handleIncidentShare(event, call) {
  event.preventDefault();
  event.stopPropagation();
  const button = event.currentTarget;
  const url = shareIncidentView(location.href, state, call.id);
  const status = button.closest('[data-call-id]').querySelector('.incident-share-status');
  try {
    const result = await shareIncident(navigator, {
      title: `${call.description} · SirenTO`,
      text: `${call.description} at ${displayLocation(call).text}`,
      url
    });
    status.textContent = result === 'copied' ? 'Link copied.' : result === 'manual' ? 'Copy unavailable.' : '';
    if (result === 'manual') {
      const output = document.querySelector('#shareLink');
      output.value = url;
      output.hidden = false;
      output.focus();
      output.select();
    }
  } catch {
    status.textContent = 'Could not copy link.';
  }
}

function createIncidentCard(call, { distance = "", variant = "list" } = {}) {
  const row = els.callTemplate.content.firstElementChild.cloneNode(true);
  const selected = variant !== "popup" && call.id === focusedCallId;
  row.dataset.callId = call.id;
  row.classList.add(`incident-card--${variant}`);
  row.classList.toggle("selected", selected);
  if (variant !== "popup" && coordinatesForCall(call)) {
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-pressed", String(selected));
    row.setAttribute("aria-label", `Show on map: ${call.description} at ${displayLocation(call).text}`);
  }

  row.querySelector(".call-title").textContent = call.description;
  const glossaryText = glossaryDefinition(call.description);
  if (glossaryText) {
    const glossaryId = `dispatch-glossary-${++glossaryPopoverSequence}`;
    const trigger = row.querySelector(".glossary-trigger");
    const popover = row.querySelector(".glossary-popover");
    trigger.hidden = false;
    trigger.setAttribute("aria-controls", glossaryId);
    trigger.setAttribute("aria-label", `What does “${call.description}” mean?`);
    popover.id = glossaryId;
    row.querySelector(".glossary-definition").textContent = glossaryText;
    row.querySelector(".glossary-footer").textContent = DISPATCH_GLOSSARY_FOOTER;
  }
  row.querySelector(".call-location").textContent = displayLocation(call).text;

  const distanceNode = row.querySelector(".distance-away");
  const distanceSeparator = row.querySelector(".distance-separator");
  distanceNode.textContent = distance;
  distanceNode.hidden = !distance;
  distanceSeparator.hidden = !distance;

  const reportedAge = row.querySelector(".time-ago");
  reportedAge.textContent = compactReportedAge(call.time);
  reportedAge.dataset.reportedAt = call.time.toISOString();
  row.querySelector(".reported-time").textContent = `Reported ${formatIncidentTime(call.time)}`;

  const updatedTime = row.querySelector(".updated-time");
  const updatedSeparator = row.querySelector(".updated-separator");
  updatedTime.hidden = !call.updatedAt;
  updatedSeparator.hidden = !call.updatedAt;
  if (call.updatedAt) {
    updatedTime.textContent = `Updated ${compactAge(call.updatedAt)}`;
    updatedTime.dataset.updatedAt = call.updatedAt.toISOString();
  }
  row.querySelector(".incident-source").textContent = sourceName(call.source);

  const changeBadge = row.querySelector(".incident-change-badge");
  const badge = incidentBadge(call);
  changeBadge.hidden = !badge;
  changeBadge.textContent = badge || "";
  changeBadge.classList.toggle("incident-change-badge--updated", badge === "UPDATED");

  const status = callStatus(call);
  const statusBadge = row.querySelector(".incident-status");
  statusBadge.hidden = !status;
  statusBadge.textContent = status || "";
  if (status) statusBadge.classList.add(`incident-status--${status.toLowerCase()}`);

  row.querySelector(".location-confidence").textContent = locationConfidence(call);

  const division = row.querySelector(".division-value");
  division.textContent = call.source === "TFS" && call.division !== "Unknown"
    ? `${call.division} (estimated)` : call.division;
  row.querySelector(".call-division").hidden = !call.division || call.division === "Unknown";

  const alarm = row.querySelector(".call-alarm");
  if (call.isFireRelated && call.alarmLevel) {
    alarm.hidden = false;
    row.querySelector(".alarm-value").textContent = call.alarmLevel;
  }
  const units = row.querySelector(".unit-list");
  const vehicles = row.querySelector(".call-vehicles");
  vehicles.hidden = !call.unitGroups.length;
  units.innerHTML = call.unitGroups.map(group =>
    `<div><strong>${escapeText(group.type)}:</strong> ${escapeText(group.values)}</div>`).join("");

  const hint = row.querySelector(".show-map-hint");
  hint.hidden = variant === "popup" || !coordinatesForCall(call);
  const shareButton = row.querySelector('.share-incident');
  shareButton.setAttribute('aria-label', `Share incident: ${call.description}`);
  shareButton.addEventListener('click', event => handleIncidentShare(event, call));
  return row;
}

function renderCalls() {
  const availability=renderIncidentFeedStatus();
  if (mobileCallsFeedStatus) {
    mobileCallsFeedStatus.textContent = callsFeedStatus.textContent;
    mobileCallsFeedStatus.hidden = callsFeedStatus.hidden;
  }
  if (!state.filtered.length && !availability.hasRelevantCachedData && availability.unavailable.length) {
    els.resultCount.textContent = availability.allUnavailable ? 'UNAVAILABLE' : '0 FROM AVAILABLE SOURCES';
  } else {
    els.resultCount.textContent = `${state.filtered.length} RESULT${state.filtered.length === 1 ? "" : "S"}`;
  }

  const renderList = list => {
    if (!list) return;
    if (state.filtered.length) {
      const fragment = document.createDocumentFragment();
      sortNearbyCalls(state.filtered, state.nearbySort, state.nearby, coordinatesForCall).forEach(call => {
        const distance = distanceLabel(distanceKm(state.nearby, coordinatesForCall(call)));
        fragment.appendChild(createIncidentCard(call, { distance }));
      });
      list.replaceChildren(fragment);
      return;
    }
    let title=state.search.trim() ? 'No calls match your search.' : 'No calls match these filters.';
    let detail=state.search.trim()
      ? 'Clear the search or try a different call type, street, intersection, or division.'
      : 'Try another time window or division.';
    if (!availability.hasRelevantCachedData && availability.allUnavailable) {
      title='Public dispatch data is temporarily unavailable.';
      detail='The data source could not be checked. This is not a zero-call result.';
    } else if (!availability.hasRelevantCachedData && availability.unavailable.length) {
      title='No calls from the available sources match these filters.';
      detail='At least one selected data source could not be checked.';
    } else if (!state.calls.length) {
      title='No public dispatch calls currently reported.';
      detail='The data sources were checked successfully.';
    }
    list.innerHTML = `
      <div class="empty-state">
        <strong>${title}</strong>
        <p>${detail}</p>
      </div>`;
  };

  renderList(els.callList);
  renderList(mobileSheetCallList);
  scheduleIncidentBadgeExpiry();
}

nearbySort.addEventListener('change', event => {
  state.nearbySort = event.target.value === 'nearest' && state.nearby ? 'nearest' : NEARBY_SORT_DEFAULT;
  nearbySort.value = state.nearbySort;
  renderCalls();
});

function updateIncidentBadges() {
  const calls = new Map(state.calls.map(call => [call.id, call]));
  document.querySelectorAll(".incident-card .incident-change-badge").forEach(node => {
    const call = calls.get(node.closest(".incident-card")?.dataset.callId);
    const badge = call ? incidentBadge(call) : null;
    node.hidden = !badge;
    node.textContent = badge || "";
    node.classList.toggle("incident-change-badge--updated", badge === "UPDATED");
  });
  scheduleIncidentBadgeExpiry();
}

function scheduleIncidentBadgeExpiry() {
  clearTimeout(incidentBadgeTimer);
  const now = Date.now();
  const expiries = state.calls.map(call => incidentBadgeExpiry(call, now)).filter(Number.isFinite);
  if (!expiries.length) return;
  incidentBadgeTimer = setTimeout(updateIncidentBadges, Math.max(0, Math.min(...expiries) - now + 25));
}

function initMap() {
  if (dispatchMap || !els.dispatchMap || typeof L === "undefined") return;

  dispatchMap = L.map(els.dispatchMap, {
    zoomControl: false,
    attributionControl: true
  }).setView(TORONTO_CENTER, 10);

  L.control.zoom({ position: "bottomright" }).addTo(dispatchMap);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; OpenStreetMap contributors',
    subdomains: "abc",
    maxZoom: 19
  }).addTo(dispatchMap);
  callLayer = L.layerGroup().addTo(dispatchMap);
  nearbyOriginLayer = L.layerGroup().addTo(dispatchMap);
  dispatchMap.on("zoomend", () => { expandedCluster.clear(); renderMapMarkers(); });
  dispatchMap.on("click", event => {
    if (!choosingArea) return;
    chooseManualArea([event.latlng.lat, event.latlng.lng]);
  });
  loadDivisionOverlay();
}

async function loadDivisionOverlay() {
  try {
    const response = await fetch("./data/police-divisions.geojson?v=station-details-1");
    if (!response.ok) throw new Error("Division boundaries unavailable");
    const boundaries = await response.json();
    const details = properties => {
      const content = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = properties.UNIT_NAME || `Division ${properties.AREA_NAME}`;
      const address = document.createElement("div");
      address.textContent = properties.ADDRESS
        ? `Station: ${properties.ADDRESS}, ${properties.CITY || "Toronto"}`
        : "Station address unavailable";
      content.append(title, address);
      return content;
    };
    const layer = L.geoJSON(boundaries, {
      style: { className: "police-boundary", color: "#93c5fd", weight: 1.5, opacity: 0.65, fillOpacity: 0.035 },
      attribution: "Division boundaries © Toronto Police Service",
      onEachFeature(feature, polygon) {
        polygon.bindTooltip(details(feature.properties), { sticky: true });
        polygon.bindPopup(details(feature.properties));
      }
    });
    if (boundaryVisible) layer.addTo(dispatchMap);
    dispatchMap.on('overlayadd overlayremove', event => {
      if (event.layer !== layer) return;
      boundaryVisible = event.type === 'overlayadd';
      rememberPreferences();
    });
    L.control.layers(null, { "Police division boundaries": layer }, {
      collapsed: false, position: "topright"
    }).addTo(dispatchMap);
  } catch (error) {
    console.warn("Could not load the optional division overlay", error);
  }
}

function coordinatesForCall(call) {
  const point = call.geography?.coordinates;
  return Array.isArray(point) && point.length === 2 && point.every(Number.isFinite) ? point : null;
}

function displayLocation(call) {
  const location = call.geography || locationDisplay(call.location);
  return { ...location, text: expandLocationAbbreviations(location.text) };
}

function isApproximateLocation(call) {
  return displayLocation(call).approximate !== false;
}

function markerAccessibleLabel(call, selected, now = Date.now()) {
  const age = markerAgeLabel(markerAgeTier(call.timestamp, now));
  return `${selected ? "Selected incident: " : "Incident: "}${call.source} ${call.eventCategory}, ${call.description}, ${age}`;
}

function markerIcon(call, selected = false, sirenMatch = false, now = Date.now()) {
  const ageTier = markerAgeTier(call.timestamp, now);
  const approximate = isApproximateLocation(call);
  return L.divIcon({
    className: "dispatch-marker-wrap",
    html: `<span class="dispatch-marker service-${call.source.toLowerCase()} category-${call.eventCategory} age-${ageTier}${approximate ? " approximate" : ""}${selected ? " selected" : ""}${sirenMatch ? " siren-match" : ""}"><span class="dispatch-marker-glyph" aria-hidden="true">${markerGlyph(call.source, call.eventCategory)}</span></span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11]
  });
}

function updateMarkerAppearances(now = Date.now()) {
  const sirenIds = new Set(sirenMatches.map(match => match.call.id));
  mapMarkers.forEach((marker, id) => {
    const call = state.filtered.find(item => item.id === id);
    if (!call) return;
    const selected = id === focusedCallId;
    const label = markerAccessibleLabel(call, selected, now);
    marker.setIcon(markerIcon(call, selected, sirenIds.has(id), now));
    marker.getElement()?.setAttribute("aria-label", label);
    marker.getElement()?.setAttribute("title", label);
  });
}

function renderMapMarkers() {
  callLayer.clearLayers();
  mapMarkers = new Map();
  const sirenIds = new Set(sirenMatches.map(match => match.call.id));

  const locatedCalls = state.filtered
    .map(call => ({ call, coordinates: coordinatesForCall(call) }))
    .filter(item => item.coordinates);

  const addMarker = ({call, coordinates}, position = coordinates) => {
    const tooltip = document.createElement('span');
    tooltip.textContent = `${call.source}: ${call.description}`;
    const selected = call.id === focusedCallId;
    const accessibleLabel = markerAccessibleLabel(call, selected);
    const marker = L.marker(position, {
      title: accessibleLabel,
      alt: accessibleLabel,
      icon: markerIcon(call, selected, sirenIds.has(call.id))
    })
      .bindTooltip(tooltip, { direction: "top" })
      .bindPopup(createIncidentCard(call, {
        distance: distanceLabel(distanceKm(state.nearby, coordinates)),
        variant: "popup"
      }), { minWidth: 280, maxWidth: 360, closeOnClick: false })
      .on("click", event => {
        const mobile = isMobileViewLayout();
        if (mobile) setMobileSheetState(mobileSheetState === "collapsed" ? "half" : mobileSheetState);
        selectCall(call.id, { pan: false, revealRow: true });
        if (!mobile) setTimeout(() => event.target.openPopup(), 0);
      });
    marker.addTo(callLayer);
    mapMarkers.set(call.id, marker);
  };
  const groups = clusterPoints(locatedCalls, point => dispatchMap.project(point, dispatchMap.getZoom()));
  for (const group of groups) {
    if (group.length === 1) { addMarker(group[0]); continue; }
    const center = L.latLngBounds(group.map(item => item.coordinates)).getCenter();
    if (group.every(item => expandedCluster.has(item.call.id))) {
      const pixel = dispatchMap.latLngToLayerPoint(center);
      group.forEach((item,index) => {
        const spread = spreadPoint(index,group.length,pixel);
        const position = dispatchMap.layerPointToLatLng(L.point(spread.x,spread.y));
        L.polyline([item.coordinates,position],{className:'cluster-connector',color:'#b7c8d9',weight:1,interactive:false}).addTo(callLayer);
        addMarker(item,position);
      });
      continue;
    }
    const matchingCluster = group.some(item => sirenIds.has(item.call.id));
    const newestTimestamp = Math.max(...group.map(item => item.call.timestamp));
    const clusterTier = markerAgeTier(newestTimestamp);
    L.marker(center,{icon:L.divIcon({className:`call-cluster age-${clusterTier}${matchingCluster ? ' siren-match' : ''}`,html:String(group.length),iconSize:[40,40],iconAnchor:[20,20]}), title:`${group.length} calls; newest ${markerAgeLabel(clusterTier)}; zoom or expand`})
      .on('click', () => {
        if (dispatchMap.getZoom() < 18) dispatchMap.setView(center,Math.min(18,dispatchMap.getZoom()+2));
        else { expandedCluster = new Set(group.map(item => item.call.id)); renderMapMarkers(); }
      }).addTo(callLayer);
  }

  els.mapStatus.textContent = locatedCalls.length ? `${locatedCalls.length}/${state.filtered.length} LOCATED` : "NO MAPPED LOCATIONS";
  els.mapEmpty.hidden = locatedCalls.length > 0;
  nearbyOriginLayer?.clearLayers();
  if (state.nearby && state.radiusKm !== null) {
    L.circle(state.nearby, { className: 'nearby-radius', radius: state.radiusKm * 1000, color: '#63e6be', weight: 1, opacity: .65, fillOpacity: .035, interactive: false }).addTo(nearbyOriginLayer);
    L.circleMarker(state.nearby, { className: 'nearby-origin', radius: 6, color: '#fff', weight: 2, fillColor: '#63e6be', fillOpacity: 1, interactive: false }).addTo(nearbyOriginLayer);
  }
  if (!mapHasFitted && state.nearby && state.radiusKm !== null) {
    mapHasFitted = true;
    dispatchMap.setView(state.nearby, state.radiusKm <= 0.5 ? 15 : state.radiusKm <= 2 ? 14 : 12);
  } else if (locatedCalls.length && !mapHasFitted) {
    mapHasFitted = true;
    dispatchMap.fitBounds(L.latLngBounds(locatedCalls.map(item => item.coordinates)), { padding: [24, 24], maxZoom: 12 });
  }
}

function renderMap() {
  initMap();
  if (!dispatchMap) return;

  renderMapMarkers();
  els.mapEmpty.querySelector("strong").textContent = "No mapped locations";
  els.mapEmpty.querySelector("span").textContent = "No locations in this view could be resolved from the published data.";
}

function selectCall(callId, { pan = true, revealRow = false, panIfNeeded = false } = {}) {
  const call = state.filtered.find(item => item.id === callId);
  if (!call) return;

  focusedCallId = callId;
  if (pan && dispatchMap && coordinatesForCall(call)) {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const zoom = dispatchMap.getZoom();
    const coordinates = coordinatesForCall(call);
    const located = state.filtered.map(item => ({call:item,coordinates:coordinatesForCall(item)})).filter(item=>item.coordinates);
    dispatchMap.stop();
    expandedCluster = new Set(focusGroup(located,callId,point=>dispatchMap.project(point,zoom)).map(item=>item.call.id));
    renderMapMarkers();
    if (!panIfNeeded || !dispatchMap.getBounds().contains(coordinates)) {
      dispatchMap.panTo(coordinates, { animate: !reducedMotion, duration: .35, easeLinearity: .25 });
    }
  }


  let selectedRow;
  document.querySelectorAll(".incident-card:not(.incident-card--popup)").forEach(row => {
    const selected = row.dataset.callId === callId;
    row.classList.toggle("selected", selected);
    if (row.hasAttribute("role")) row.setAttribute("aria-pressed", String(selected));
    row.classList.remove("pin-highlight");
    if (selected && row.classList.contains("incident-card--list")) {
      if (!selectedRow || (isMobileViewLayout() && row.closest("#mobileSheetCallList"))) selectedRow = row;
    }
  });
  clearTimeout(rowHighlightTimer);
  if (revealRow && selectedRow) {
    selectedRow.focus({ preventScroll: true });
    selectedRow.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "center"
    });
    selectedRow.classList.add("pin-highlight");
    rowHighlightTimer = setTimeout(() => selectedRow.classList.remove("pin-highlight"), 3500);
  }

  updateMarkerAppearances();
  const marker = mapMarkers.get(callId);
  if (marker) {
    marker.openTooltip();
  }
}

function countBy(items, selector) {
  const map = new Map();
  for (const item of items) {
    const key = selector(item) || "Unknown";
    map.set(key, (map.get(key) || 0) + 1);
  }
  return map;
}

function maxEntry(map) {
  return [...map.entries()].sort((a, b) => b[1] - a[1])[0] || null;
}

function formatTime(date) {
  return new Intl.DateTimeFormat("en-CA", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Toronto"
  }).format(date);
}

function formatIncidentTime(date) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/Toronto"
  }).format(date);
}

function formatDate(date) {
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    timeZone: "America/Toronto"
  }).format(date);
}

function updateFreshness() {
  const newest = state.calls[0]?.time;
  if (!els.lastUpdated) return;
  if (newest) {
    els.lastUpdated.textContent = `${formatDate(newest)} · ${formatTime(newest)}`;
  } else if (state.lastIngest) {
    els.lastUpdated.textContent = state.lastIngest;
  } else {
    els.lastUpdated.textContent = "Unknown";
  }
}

async function checkForChanges() {
  // Reload the snapshot even if sourceUpdatedAt is unchanged: a successful fetch
  // may update fetchedAt or correct normalized fields without changing that marker.
  await loadData();
}

document.querySelector('#historyHours').addEventListener('change', event => {
  state.hours = Number(event.target.value);
  applyFilters();
});

els.divisionSelect.addEventListener("change", (e) => {
  state.division = e.target.value === "all" ? "all" : decodeURIComponent(e.target.value);
  applyFilters();
});

els.searchInput.addEventListener("input", (e) => {
  state.search = e.target.value;
  applyFilters();
});

els.clearSearch.addEventListener("click", () => {
  state.search = "";
  applyFilters();
  els.searchInput.focus();
});

els.eventToggles.forEach(toggle => {
  toggle.addEventListener("click", () => {
    state.eventFilter = toggle.dataset.eventFilter;
    applyFilters();
  });
});

function handleIncidentListClick(event) {
  if (event.target.closest("summary, .glossary-trigger, .glossary-popover, .share-incident")) return;
  const row = event.target.closest(".incident-card--list");
  if (!row) return;
  const showOnMap = event.target.closest(".show-map-hint");
  selectCall(row.dataset.callId, { pan: !isMobileViewLayout() || mobileView === "map" });
  if (showOnMap) {
    event.preventDefault();
    setMobileView("map", { focusSelection: true });
    els.dispatchMap.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "center"
    });
  }
}

function handleIncidentListKeydown(event) {
  if (event.target.closest(".show-map-hint, .glossary-trigger, .glossary-popover, .share-incident")) return;
  if (event.key !== "Enter" && event.key !== " ") return;
  const row = event.target.closest(".incident-card--list");
  if (!row) return;
  event.preventDefault();
  selectCall(row.dataset.callId, { pan: !isMobileViewLayout() || mobileView === "map" });
}

[els.callList, mobileSheetCallList].filter(Boolean).forEach(list => {
  list.addEventListener("click", handleIncidentListClick);
  list.addEventListener("keydown", handleIncidentListKeydown);
});

function closeGlossaryPopovers(except = null) {
  document.querySelectorAll(".glossary-trigger[aria-expanded='true']").forEach(trigger => {
    if (trigger === except) return;
    trigger.setAttribute("aria-expanded", "false");
    const popover = document.getElementById(trigger.getAttribute("aria-controls"));
    if (popover) popover.hidden = true;
  });
}

document.addEventListener("click", event => {
  const trigger = event.target.closest(".glossary-trigger");
  if (!trigger) {
    if (!event.target.closest(".glossary-popover")) closeGlossaryPopovers();
    return;
  }
  const opening = trigger.getAttribute("aria-expanded") !== "true";
  closeGlossaryPopovers(trigger);
  trigger.setAttribute("aria-expanded", String(opening));
  const popover = document.getElementById(trigger.getAttribute("aria-controls"));
  if (popover) popover.hidden = !opening;
});

document.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  const trigger = document.querySelector(".glossary-trigger[aria-expanded='true']");
  if (!trigger) return;
  closeGlossaryPopovers();
  trigger.focus();
});

async function refreshLoop() {
  try {
    await checkForChanges();
  } finally {
    setTimeout(refreshLoop, CONFIG.refreshCheckMs);
  }
}

setInterval(() => {
  els.footerClock.textContent = new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "America/Toronto"
  }).format(new Date());
}, 1000);

try {
  const saved = loadPreferences(localStorage);
  if (saved) {
    Object.assign(state,saved.filters);
    state.radiusKm = saved.radiusKm;
    document.querySelector('#roadOverlay').checked = saved.roads;
    boundaryVisible = saved.boundaries;
    themePreference = saved.theme;
    document.querySelector('#themePreference').value = themePreference;
    syncTheme();
    setMobileView(saved.mobileView, { persist: false });
    syncFilterControls();
  }
} catch { /* Defaults remain usable when storage is blocked. */ }
systemTheme.addEventListener('change', syncTheme);
document.querySelector('#themePreference').addEventListener('change', event => {
  themePreference = normalizeThemePreference(event.target.value);
  event.target.value = themePreference;
  syncTheme();
  rememberPreferences();
});
if (initialParams.has('view')) {
  Object.assign(state, readFilters(initialParams));
  syncFilterControls();
}
refreshLoop();

document.querySelector("#serviceFilter").addEventListener("change", event => {
  state.serviceFilter = event.target.value;
  applyFilters();
});

const nearButton = document.querySelector('#nearMe');
const hearSirensButton = document.querySelector('#hearSirens');
const nearStatus = document.querySelector('#nearStatus');
const nearControls = document.querySelector('#nearControls');
const chooseAreaButton = document.querySelector('#chooseArea');
let locationRequest = 0;
let locationWatch = null;
let requestedRadiusKm = null;
function radiusFilterOrigin() {
  return state.radiusKm === null ? null : state.nearby;
}
function syncRadiusControls() {
  radiusToggles.forEach(toggle => {
    const value = toggle.dataset.radiusKm === 'toronto' ? null : Number(toggle.dataset.radiusKm);
    const active = value === state.radiusKm;
    toggle.classList.toggle('active', active);
    toggle.setAttribute('aria-pressed', String(active));
  });
}
function clearLocationWatch() {
  if (locationWatch !== null && typeof navigator.geolocation?.clearWatch === 'function') {
    navigator.geolocation.clearWatch(locationWatch);
  }
  locationWatch = null;
}
function updateNearbyView() {
  if (state.radiusKm !== null) mapHasFitted = false;
  applyFilters();
  syncRadiusControls();
  nearStatus.textContent = state.radiusKm === null
    ? state.nearby
      ? 'Toronto-wide view. Distance filtering is off; card distances still update from your location.'
      : 'Toronto-wide view. Distance filtering is off. Choose a radius to use your location.'
    : `Within ${state.radiusKm} km of ${nearbyOriginKind === 'map' ? 'the selected area' : 'your location'}. Distances use approximate call locations; unmapped calls are excluded.`;
}
function showLocationFallback(message) {
  nearStatus.textContent = `${message} Enable location in your browser, or choose an area manually.`;
  nearControls.hidden = false;
  chooseAreaButton.hidden = false;
}
function beginAreaChoice() {
  initMap();
  choosingArea = true;
  sirenMode = true;
  chooseAreaButton.textContent = 'Click an area on the map…';
  nearStatus.textContent = 'Choose an area manually by clicking the map.';
  els.dispatchMap.classList.add('choosing-area');
  els.dispatchMap.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' });
}
function activateSirenView() {
  sirenMode = true;
  state.radiusKm = SIREN_RADIUS_KM;
  lastRadiusKm = SIREN_RADIUS_KM;
  Object.assign(state, filterDefaults);
  syncFilterControls();
  nearControls.hidden = false;
  chooseAreaButton.hidden = false;
  mapHasFitted = false;
  updateSirenMatches();
  updateNearbyView();
  document.querySelector('#sirenResults').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'nearest' });
}
function chooseManualArea(origin) {
  choosingArea = false;
  els.dispatchMap.classList.remove('choosing-area');
  chooseAreaButton.textContent = 'Choose a different area on the map';
  state.nearby = origin;
  nearbyOriginKind = 'map';
  state.radiusKm = SIREN_RADIUS_KM;
  lastRadiusKm = SIREN_RADIUS_KM;
  activateSirenView();
  nearStatus.textContent = 'Showing recent calls within 2 km of the area you chose.';
}
function requestLocation(radiusKm = lastRadiusKm, forSiren = false) {
  if (!navigator.geolocation) {
    showLocationFallback('Location is unavailable in this browser.');
    return;
  }
  requestedRadiusKm = radiusKm;
  let firstPosition = true;
  const request = ++locationRequest;
  clearLocationWatch();
  nearButton.disabled = true;
  hearSirensButton.disabled = true;
  nearButton.textContent = nearbyCtaCopy.loading;
  nearStatus.textContent = 'Allow location access when your browser asks.';
  const onPosition = position => {
    if (request !== locationRequest) return;
    state.nearby = [position.coords.latitude, position.coords.longitude];
    nearbyOriginKind = 'device';
    if (requestedRadiusKm !== null) {
      state.radiusKm = requestedRadiusKm;
      lastRadiusKm = requestedRadiusKm;
      requestedRadiusKm = null;
    }
    nearButton.disabled = false;
    hearSirensButton.disabled = false;
    nearButton.textContent = nearbyCtaCopy.refresh;
    nearControls.hidden = false;
    choosingArea = false;
    els.dispatchMap.classList.remove('choosing-area');
    chooseAreaButton.textContent = 'Choose an area on the map';
    if (forSiren && firstPosition) activateSirenView();
    else updateNearbyView();
    firstPosition = false;
  };
  const onError = error => {
    if (request !== locationRequest) return;
    nearButton.disabled = false;
    hearSirensButton.disabled = false;
    nearButton.textContent = state.nearby ? nearbyCtaCopy.refresh : nearbyCtaCopy.primary;
    showLocationFallback(error.code === 1 ? 'Location permission was denied.' : 'Could not get your location.');
    if (error.code === 1) clearLocationWatch();
  };
  const options = { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 };
  if (typeof navigator.geolocation.watchPosition === 'function') {
    locationWatch = navigator.geolocation.watchPosition(onPosition, onError, options);
  } else {
    navigator.geolocation.getCurrentPosition(onPosition, onError, options);
  }
}
nearButton.addEventListener('click', () => {
  requestLocation(SIREN_RADIUS_KM, true);
});
hearSirensButton.addEventListener('click', () => {
  requestLocation(SIREN_RADIUS_KM, true);
});
chooseAreaButton.addEventListener('click', beginAreaChoice);
function selectNearbyRadius(value) {
  sirenMode = false;
  sirenMatches = [];
  if (value === null) {
    requestedRadiusKm = null;
    state.radiusKm = null;
    mapHasFitted = false;
    updateNearbyView();
    return;
  }
  const radiusKm = value;
  lastRadiusKm = radiusKm;
  if (!state.nearby) {
    rememberPreferences({ radiusKm });
    requestLocation(radiusKm);
    return;
  }
  state.radiusKm = radiusKm;
  updateNearbyView();
}
radiusToggles.forEach(toggle => toggle.addEventListener('click', () => {
  selectNearbyRadius(toggle.dataset.radiusKm === 'toronto' ? null : Number(toggle.dataset.radiusKm));
}));
expandNearbyRadius.addEventListener('click', () => {
  const nextRadiusKm = nextNearbyRadius(state.radiusKm);
  if (nextRadiusKm !== undefined) selectNearbyRadius(nextRadiusKm);
});
if (state.radiusKm !== null) {
  lastRadiusKm = state.radiusKm;
  requestLocation(state.radiusKm);
}
document.querySelector('#clearNearby').addEventListener('click', () => {
  locationRequest++;
  clearLocationWatch();
  requestedRadiusKm = null;
  state.nearby = null;
  state.radiusKm = null;
  sirenMode = false;
  sirenMatches = [];
  choosingArea = false;
  nearbyOriginKind = 'device';
  els.dispatchMap.classList.remove('choosing-area');
  nearButton.disabled = false;
  hearSirensButton.disabled = false;
  nearButton.textContent = nearbyCtaCopy.primary;
  nearControls.hidden = true;
  nearStatus.textContent = 'Uses your location with permission. Your location stays in this browser session.';
  mapHasFitted = false;
  syncRadiusControls();
  applyFilters();
});

document.querySelector('#sirenResultsList').addEventListener('click', event => {
  if (event.target.closest('summary, .share-incident')) return;
  const result = event.target.closest('[data-call-id]');
  if (result) selectCall(result.dataset.callId);
});

document.querySelector('#sirenResultsList').addEventListener('keydown', event => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  if (event.target.closest('summary, .share-incident')) return;
  const result = event.target.closest('[data-call-id]');
  if (!result) return;
  event.preventDefault();
  selectCall(result.dataset.callId);
});

setInterval(() => {
  document.querySelectorAll('[data-reported-at]').forEach(label => {
    label.textContent = compactReportedAge(label.dataset.reportedAt);
  });
  document.querySelectorAll('[data-updated-at]').forEach(label => {
    label.textContent = `Updated ${compactAge(label.dataset.updatedAt)}`;
  });
  renderNearbySummary();
  updateMarkerAppearances();
}, 60000);

document.querySelector('#roadOverlay').addEventListener('change', () => {
  rememberPreferences();
  renderDisruptions(state.disruptions, radiusFilterOrigin(), state.radiusKm, dispatchMap);
});

function syncSearchControl() {
  els.searchInput.value = state.search;
  els.clearSearch.hidden = !state.search;
}
function syncFilterControls() {
  syncSearchControl();
  document.querySelector('#historyHours').value = state.hours;
  document.querySelector('#serviceFilter').value = state.serviceFilter;
  syncRadiusControls();
}
document.querySelector('#clearFilters').addEventListener('click', () => {
  Object.assign(state, filterDefaults);
  state.radiusKm = null;
  syncFilterControls();
  document.querySelector('#clearNearby').click();
});

document.querySelector('#shareView').addEventListener('click', async () => {
  const url = shareView(location.href, state);
  const output = document.querySelector('#shareLink');
  output.value = url;
  output.hidden = false;
  const status = document.querySelector('#shareStatus');
  try {
    await navigator.clipboard.writeText(url);
    status.textContent = 'Link copied. Nearby location is not included.';
  } catch {
    output.focus(); output.select();
    status.textContent = 'Copy this link. Nearby location is not included.';
  }
});
