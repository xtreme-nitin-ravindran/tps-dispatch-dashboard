import { sourceStatus } from "./src/source-status.js";
import { clusterPoints, spreadPoint, focusGroup } from "./src/map-clusters.js";
import { filterDefaults, filterSummary, readFilters, shareView, loadPreferences, savePreferences } from "./src/view-controls.js";
import { renderDisruptions } from "./src/disruptions/ui.js";
import { reportedAge, callExplanation, locationConfidence, callStatus } from "./src/call-presentation.js?v=status-1";
import { distanceKm } from "./src/nearby.js";
import { policeUnitLabel } from "./src/tps/unit-label.js?v=3";
import { incidentCategory } from "./src/tfs/category.js";
import { locationDisplay, expandLocationAbbreviations } from "./src/location-display.js?v=hydro-corridor-1";
import { isWithinHistoryWindow } from "./src/tfs/time.js";
import { nearbySummary } from "./src/nearby-summary.js";

const CONFIG = {
  snapshotUrl: "https://raw.githubusercontent.com/xtreme-nitin-ravindran/tps-dispatch-dashboard/data/data/current.json",
  refreshCheckMs: 30_000
};

const state = {
  nearby: null,
  radiusKm: 2,
  hours: 24,
  calls: [],
  filtered: [],
  lastIngest: null,
  fetchedAt: null,
  search: "",
  division: "all",
  serviceFilter: "all",
  eventFilter: "all"
};

const els = {
  lastUpdated: document.querySelector("#lastUpdated"),
  windowLabel: document.querySelector("#windowLabel"),
  searchInput: document.querySelector("#searchInput"),
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

const TORONTO_CENTER = [43.7001, -79.42];
let dispatchMap = null;
let mapMarkers = new Map();
let callLayer;
let expandedCluster = new Set();
let focusedCallId = null;
let rowHighlightTimer;
let mapHasFitted = false;
let boundaryVisible = true;
function rememberPreferences() {
  try { savePreferences(localStorage,state,{roads:document.querySelector('#roadOverlay').checked,boundaries:boundaryVisible}); } catch { /* Browsing still works when storage is blocked. */ }
}

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
    calls: rows.map(normalizeCall).sort((a, b) => b.timestamp - a.timestamp),
    disruptions: payload.disruptions,
    feeds: payload.feeds,
    fetchedAt: payload.fetchedAt || null,
    updatedAt: payload.sourceUpdatedAt || payload.fetchedAt || null
  };
}

let sourceHighlightTimer;
let snapshotLoaded = false;
async function loadData() {

  try {
    const snapshot = await fetchSnapshot();
    const scrollTop = els.callList.scrollTop;
    const firstSnapshot = !snapshotLoaded;
    snapshotLoaded = true;
    const previousSourceTime = parseLooseTime(state.lastIngest)?.getTime();
    const callsChanged = JSON.stringify(state.calls) !== JSON.stringify(snapshot.calls);
    state.disruptions = snapshot.disruptions;
    state.calls = snapshot.calls;
    state.lastIngest = snapshot.updatedAt;
    state.fetchedAt = snapshot.fetchedAt;
    const sourceTime = parseLooseTime(snapshot.updatedAt);
    const sources = [
      ['TFS', snapshot.feeds?.TFS || {fetchedAt:snapshot.fetchedAt, sourceUpdatedAt:snapshot.updatedAt}],
      ['TPS', snapshot.feeds?.TPS],
      ['Road restrictions', snapshot.disruptions?.roads],
      ['TTC alerts', snapshot.disruptions?.transit]
    ];
    els.sourceUpdated.replaceChildren(...sources.flatMap(([name,feed]) => {
      const info = sourceStatus(name,feed);
      const label = document.createElement('span');
      label.textContent = `${info.label}:`;
      const value = document.createElement('span');
      value.className = 'source-time';
      const time = info.timestamp === null ? 'not loaded' : `${formatDate(new Date(info.timestamp))} · ${formatTime(new Date(info.timestamp))}`;
      value.textContent = `${time}${info.status && info.status !== 'not loaded' ? ` (${info.status})` : ''}`;
      return [label, value];
    }));
    if (callsChanged || firstSnapshot) {
      applyFilters();
      els.callList.scrollTop = scrollTop;
    }
    renderDisruptions(state.disruptions, state.nearby, state.radiusKm, dispatchMap);
    updateFreshness();
    if (previousSourceTime != null && sourceTime && sourceTime.getTime() !== previousSourceTime) {
      clearTimeout(sourceHighlightTimer);
      els.sourceUpdated.classList.add('source-just-updated');
      sourceHighlightTimer = setTimeout(() => {
        els.sourceUpdated.classList.remove('source-just-updated');
      }, 4000);
    }
  } catch (error) {
    console.error(error);
    if (!state.calls.length) {
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

  els.divisionSelect.innerHTML = `<option value="all">All police divisions</option>` +
    divisions.map(d => `<option value="${encodeURIComponent(d)}">${d}</option>`).join("");

  const exists = divisions.includes(current);
  state.division = exists ? current : "all";
  els.divisionSelect.value = state.division === "all" ? "all" : encodeURIComponent(state.division);
}

function applyFilters({ map = true } = {}) {
  const q = state.search.trim().toLowerCase();

  const eligibleCalls = state.calls.filter(call => {
    if (state.nearby && distanceKm(state.nearby, coordinatesForCall(call)) > state.radiusKm) return false;
    if (state.serviceFilter !== "all" && call.source !== state.serviceFilter) return false;
    if (!isWithinHistoryWindow(call.timestamp, state.hours)) return false;
    if (state.eventFilter === "ongoing" && !call.isOngoing) return false;
    if (state.eventFilter !== "all" && state.eventFilter !== "ongoing" && call.eventCategory !== state.eventFilter) return false;
    if (!q) return true;

    return [
      call.description,
      call.location,
      displayLocation(call).text,
      call.division,
      call.divisionId,
      call.id,
      call.keyword
    ].some(v => v.toLowerCase().includes(q));
  });

  // Build the facet before applying its own selection, so other divisions remain available.
  populateDivisionFilter(eligibleCalls);
  state.filtered = eligibleCalls.filter(call => state.division === "all" || call.division === state.division);
  document.querySelector("#filterSummary").textContent = filterSummary(state);
  render(map);
  rememberPreferences();
}

function render(map = true) {
  if (els.windowLabel) {
    els.windowLabel.textContent = `${state.hours} hour${state.hours === 1 ? "" : "s"}`;
  }
  renderStats();
  renderNearbySummary();
  renderCalls();
  if (map) renderMap();
  renderDisruptions(state.disruptions, state.nearby, state.radiusKm, dispatchMap);
  els.eventToggles.forEach(toggle => {
    const active = toggle.dataset.eventFilter === state.eventFilter;
    toggle.classList.toggle("active", active);
    toggle.setAttribute("aria-pressed", String(active));
  });
}

function renderNearbySummary() {
  const summary = document.querySelector("#nearbySummary");
  summary.hidden = !state.nearby;
  if (state.nearby) {
    document.querySelector("#nearbySummaryText").textContent = nearbySummary(state.filtered, state.radiusKm);
  }
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

function renderCalls() {
  els.resultCount.textContent = `${state.filtered.length} RESULT${state.filtered.length === 1 ? "" : "S"}`;

  if (!state.filtered.length) {
    els.callList.innerHTML = `
      <div class="empty-state">
        <strong>No calls match these filters.</strong>
        <p>Try another time window, division, or search term.</p>
      </div>`;
    return;
  }

  const fragment = document.createDocumentFragment();

  state.filtered.forEach(call => {
    const node = els.callTemplate.content.cloneNode(true);
    const row = node.querySelector(".call-row");
    row.dataset.callId = call.id;
    row.classList.toggle("selected", call.id === focusedCallId);
    row.tabIndex = 0;
    if (coordinatesForCall(call)) {
      row.setAttribute("role", "button");
      row.setAttribute("aria-label", `Show on map: ${call.description} at ${displayLocation(call).text}`);
      const hint = document.createElement('span');
      hint.className = 'show-map-hint'; hint.textContent = 'Show on map ↗';
      node.querySelector('.call-main').append(hint);
    }
    node.querySelector(".time-main").textContent = formatTime(call.time);
    node.querySelector(".time-ago").textContent = reportedAge(call.time);
    node.querySelector(".time-ago").dataset.reportedAt = call.time.toISOString();
    node.querySelector(".call-title").textContent = call.description;
    const explanation = node.querySelector('.call-explanation');
    explanation.textContent = callExplanation(call.description);
    explanation.hidden = !explanation.textContent;
    const statusBadge = node.querySelector('.ongoing-badge');
    statusBadge.hidden = false;
    statusBadge.textContent = callStatus(call);
    statusBadge.classList.toggle('status-neutral', call.source !== 'TFS' || !call.isOngoing);
    node.querySelector(".source-badge").textContent = call.source;
    node.querySelector(".police-division-badge").textContent = call.source === "TFS" && call.division !== "Unknown"
      ? `${call.division} (estimated)` : call.division;
    node.querySelector(".call-vehicles").hidden = call.source === "TPS";
    node.querySelector(".call-location").textContent = displayLocation(call).text;
    node.querySelector(".location-confidence").textContent = locationConfidence(call);
    const alarm = node.querySelector(".call-alarm");
    const alarmValue = node.querySelector(".alarm-value");
    const units = node.querySelector(".unit-list");
    if (call.isFireRelated && call.alarmLevel) {
      alarm.hidden = false;
      alarmValue.textContent = call.alarmLevel;
    }
    units.innerHTML = call.unitGroups.length
      ? call.unitGroups.map(group => `<div><strong>${escapeText(group.type)} #:</strong> ${escapeText(group.values)}</div>`).join("")
      : "Not provided by public feed";
    node.querySelector(".call-date").textContent = formatDate(call.time);
    fragment.appendChild(node);
  });

  els.callList.replaceChildren(fragment);
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
  dispatchMap.on("zoomend", () => { expandedCluster.clear(); renderMapMarkers(); });
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
      style: { color: "#93c5fd", weight: 1.5, opacity: 0.65, fillOpacity: 0.035 },
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

function markerIcon(selected = false, approximate = false) {
  return L.divIcon({
    className: "dispatch-marker-wrap",
    html: `<span class="dispatch-marker${approximate ? " approximate" : ""}${selected ? " selected" : ""}"></span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9]
  });
}

function renderMapMarkers() {
  callLayer.clearLayers();
  mapMarkers = new Map();

  const locatedCalls = state.filtered
    .map(call => ({ call, coordinates: coordinatesForCall(call) }))
    .filter(item => item.coordinates);

  const addMarker = ({call, coordinates}, position = coordinates) => {
    const tooltip = document.createElement('span');
    tooltip.textContent = `${call.source}: ${call.description}`;
    const marker = L.marker(position, { title: `${call.source}: ${call.description}`, icon: markerIcon(call.id === focusedCallId, isApproximateLocation(call)) })
      .bindTooltip(tooltip, { direction: "top" })
      .on("click", () => selectCall(call.id, { pan: false, revealRow: true }));
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
        L.polyline([item.coordinates,position],{color:'#b7c8d9',weight:1,interactive:false}).addTo(callLayer);
        addMarker(item,position);
      });
      continue;
    }
    L.marker(center,{icon:L.divIcon({className:'call-cluster',html:String(group.length),iconSize:[40,40],iconAnchor:[20,20]}), title:`${group.length} calls; zoom or expand`})
      .on('click', () => {
        if (dispatchMap.getZoom() < 18) dispatchMap.setView(center,Math.min(18,dispatchMap.getZoom()+2));
        else { expandedCluster = new Set(group.map(item => item.call.id)); renderMapMarkers(); }
      }).addTo(callLayer);
  }

  els.mapStatus.textContent = locatedCalls.length ? `${locatedCalls.length}/${state.filtered.length} LOCATED` : "NO MAPPED LOCATIONS";
  els.mapEmpty.hidden = locatedCalls.length > 0;
  if (locatedCalls.length && !mapHasFitted) {
    mapHasFitted = true;
    dispatchMap.fitBounds(L.latLngBounds(locatedCalls.map(item => item.coordinates)), { padding: [24, 24], maxZoom: 12 });
  }
}

function renderMap() {
  initMap();
  if (!dispatchMap) return;

  if (!state.filtered.some(call => call.id === focusedCallId)) focusedCallId = null;
  renderMapMarkers();
  els.mapEmpty.querySelector("strong").textContent = "No mapped locations";
  els.mapEmpty.querySelector("span").textContent = "No locations in this view could be resolved from the published data.";
}

async function selectCall(callId, { pan = true, revealRow = false } = {}) {
  const call = state.filtered.find(item => item.id === callId);
  if (!call) return;

  focusedCallId = callId;
  if (pan && dispatchMap && coordinatesForCall(call)) {
    dispatchMap.stop();
    dispatchMap.setView(coordinatesForCall(call),18,{animate:false});
    const located = state.filtered.map(call => ({call,coordinates:coordinatesForCall(call)})).filter(item=>item.coordinates);
    expandedCluster = new Set(focusGroup(located,callId,point=>dispatchMap.project(point,18)).map(item=>item.call.id));
    renderMapMarkers();
    els.dispatchMap.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',block:'center'});
    els.dispatchMap.focus({preventScroll:true});
  }


  let selectedRow;
  document.querySelectorAll(".call-row").forEach(row => {
    const selected = row.dataset.callId === callId;
    row.classList.toggle("selected", selected);
    row.classList.remove("pin-highlight");
    if (selected) selectedRow = row;
  });
  clearTimeout(rowHighlightTimer);
  if (revealRow && selectedRow) {
    selectedRow.focus({ preventScroll: true });
    selectedRow.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
      block: "center"
    });
    selectedRow.classList.add("pin-highlight");
    rowHighlightTimer = setTimeout(() => selectedRow.classList.remove("pin-highlight"), 3500);
  }

  mapMarkers.forEach((marker, id) => {
    const mappedCall = state.filtered.find(item => item.id === id);
    marker.setIcon(markerIcon(id === callId, isApproximateLocation(mappedCall)));
  });
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

els.eventToggles.forEach(toggle => {
  toggle.addEventListener("click", () => {
    state.eventFilter = toggle.dataset.eventFilter;
    applyFilters();
  });
});

els.callList.addEventListener("click", (event) => {
  const row = event.target.closest(".call-row");
  if (row) selectCall(row.dataset.callId);
});

els.callList.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const row = event.target.closest(".call-row");
  if (!row) return;
  event.preventDefault();
  selectCall(row.dataset.callId);
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
    document.querySelector('#roadOverlay').checked = saved.roads;
    boundaryVisible = saved.boundaries;
    syncFilterControls();
  }
} catch { /* Defaults remain usable when storage is blocked. */ }
if (new URLSearchParams(location.search).has('view')) {
  Object.assign(state, readFilters(new URLSearchParams(location.search)));
  syncFilterControls();
}
refreshLoop();

document.querySelector("#serviceFilter").addEventListener("change", event => {
  state.serviceFilter = event.target.value;
  applyFilters();
});

const nearButton = document.querySelector('#nearMe');
const nearStatus = document.querySelector('#nearStatus');
const nearControls = document.querySelector('#nearControls');
let locationRequest = 0;
function updateNearbyView() {
  mapHasFitted = false;
  applyFilters();
  if (dispatchMap && state.nearby) dispatchMap.setView(state.nearby, state.radiusKm <= 2 ? 14 : 12);
  nearStatus.textContent = `Within ${state.radiusKm} km of your location. Other filters still apply. Distances use approximate call locations; unmapped calls are excluded.`;
}
nearButton.addEventListener('click', () => {
  if (!navigator.geolocation) {
    nearStatus.textContent = 'Location is unavailable in this browser. You can search by street or neighbourhood instead.';
    return;
  }
  const request = ++locationRequest;
  nearButton.disabled = true;
  nearButton.textContent = 'Finding your location…';
  nearStatus.textContent = 'Allow location access when your browser asks.';
  navigator.geolocation.getCurrentPosition(position => {
    if (request !== locationRequest) return;
    state.nearby = [position.coords.latitude, position.coords.longitude];
    nearButton.disabled = false;
    nearButton.textContent = 'Update my location';
    nearControls.hidden = false;
    updateNearbyView();
  }, error => {
    if (request !== locationRequest) return;
    nearButton.disabled = false;
    nearButton.textContent = state.nearby ? 'Update my location' : 'Calls near me';
    nearStatus.textContent = (error.code === 1 ? 'Location permission was denied.' : 'Could not get your location. Please try again.') + (state.nearby ? ' Your previous nearby filter remains active.' : ' You can search by street or neighbourhood instead.');
  }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
});
document.querySelector('#nearRadius').addEventListener('change', event => {
  state.radiusKm = Number(event.target.value);
  if (state.nearby) updateNearbyView();
});
document.querySelector('#clearNearby').addEventListener('click', () => {
  locationRequest++;
  state.nearby = null;
  nearButton.disabled = false;
  nearButton.textContent = 'Calls near me';
  nearControls.hidden = true;
  nearStatus.textContent = 'Uses your location with permission. Your location stays in this browser session.';
  mapHasFitted = false;
  applyFilters();
});

setInterval(() => {
  document.querySelectorAll('[data-reported-at]').forEach(label => {
    label.textContent = reportedAge(label.dataset.reportedAt);
  });
  renderNearbySummary();
}, 60000);

document.querySelector('#roadOverlay').addEventListener('change', () => {
  rememberPreferences();
  renderDisruptions(state.disruptions, state.nearby, state.radiusKm, dispatchMap);
});

function syncFilterControls() {
  els.searchInput.value = state.search;
  document.querySelector('#historyHours').value = state.hours;
  document.querySelector('#serviceFilter').value = state.serviceFilter;
}
document.querySelector('#clearFilters').addEventListener('click', () => {
  Object.assign(state, filterDefaults);
  state.radiusKm = 2;
  document.querySelector('#nearRadius').value = 2;
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
